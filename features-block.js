// ============================================================
// === FEATURE MIGRATIONS ===
// ============================================================
const featureMigrations = [
  // FEATURE 1: Online Exams & Quizzes
  `CREATE TABLE IF NOT EXISTS quizzes (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL, description TEXT, subject VARCHAR(255),
    class_name VARCHAR(100), duration_minutes INTEGER DEFAULT 30,
    passing_score INTEGER DEFAULT 50, is_published BOOLEAN DEFAULT false,
    randomize_questions BOOLEAN DEFAULT false, show_results BOOLEAN DEFAULT true,
    created_by VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS quiz_questions (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL, question_type VARCHAR(20) NOT NULL DEFAULT 'multiple_choice',
    options JSONB, correct_answer TEXT, points INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
  )`,
  `ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
  `CREATE TABLE IF NOT EXISTS quiz_attempts (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id), student_email VARCHAR(255) NOT NULL,
    student_name VARCHAR(255), answers JSONB, score NUMERIC(5,1), total_points INTEGER,
    passed BOOLEAN, started_at TIMESTAMPTZ DEFAULT NOW(), submitted_at TIMESTAMPTZ,
    time_spent_seconds INTEGER DEFAULT 0
  )`,
  // FEATURE 2: WhatsApp Integration)
  `CREATE TABLE IF NOT EXISTS whatsapp_config (
    id SERIAL PRIMARY KEY, tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number_id VARCHAR(255), business_account_id VARCHAR(255),
    access_token TEXT, verify_token TEXT, webhook_url TEXT,
    is_enabled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    message_id VARCHAR(255), direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
    recipient VARCHAR(255) NOT NULL, recipient_name VARCHAR(255),
    template_name VARCHAR(255), template_params JSONB,
    message_text TEXT, status VARCHAR(20) DEFAULT 'sent',
    wa_message_id VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, category VARCHAR(50) DEFAULT 'utility',
    template_body TEXT NOT NULL, sample_params TEXT,
    is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // FEATURE 3: Scheduled Reports)
  `CREATE TABLE IF NOT EXISTS scheduled_reports (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, report_type VARCHAR(100) NOT NULL,
    frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
    recipients TEXT NOT NULL,
    last_run TIMESTAMPTZ, next_run TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS report_history (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scheduled_report_id INTEGER REFERENCES scheduled_reports(id) ON DELETE CASCADE,
    report_type VARCHAR(100), generated_at TIMESTAMPTZ DEFAULT NOW(),
    recipients TEXT, status VARCHAR(20) DEFAULT 'sent', error_message TEXT
  )`,
  // FEATURE 4: Multi-Branch Management)
  `CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, code VARCHAR(50), location TEXT,
    manager_name VARCHAR(255), manager_email VARCHAR(255),
    phone VARCHAR(50), is_active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS branch_transfers (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    from_branch_id INTEGER REFERENCES branches(id), to_branch_id INTEGER REFERENCES branches(id),
    item_type VARCHAR(50) NOT NULL, item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1, status VARCHAR(20) DEFAULT 'pending',
    notes TEXT, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // FEATURE 5: Enhanced Clinic Portal)
  `CREATE TABLE IF NOT EXISTS clinic_patients (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id VARCHAR(50) NOT NULL UNIQUE, full_name VARCHAR(255) NOT NULL,
    date_of_birth DATE, gender VARCHAR(10), phone VARCHAR(50),
    address TEXT, blood_type VARCHAR(10), allergies TEXT,
    emergency_contact VARCHAR(255), emergency_phone VARCHAR(50),
    insurance_provider VARCHAR(255), insurance_number VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS clinic_appointments (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id INTEGER REFERENCES clinic_patients(id) ON DELETE CASCADE,
    appointment_date DATE NOT NULL, appointment_time TIME,
    doctor_name VARCHAR(255), department VARCHAR(100),
    reason TEXT, status VARCHAR(20) DEFAULT 'scheduled',
    notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS clinic_consultations (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    patient_id INTEGER REFERENCES clinic_patients(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES clinic_appointments(id),
    doctor_name VARCHAR(255), chief_complaint TEXT,
    history TEXT, examination TEXT, diagnosis TEXT,
    vital_signs JSONB, weight NUMERIC(5,1), temperature NUMERIC(4,1),
    blood_pressure VARCHAR(20), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS clinic_prescriptions (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    consultation_id INTEGER REFERENCES clinic_consultations(id) ON DELETE CASCADE,
    patient_id INTEGER REFERENCES clinic_patients(id) ON DELETE CASCADE,
    prescribed_by VARCHAR(255), status VARCHAR(20) DEFAULT 'active',
    notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS clinic_prescription_items (
    id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    prescription_id INTEGER NOT NULL REFERENCES clinic_prescriptions(id) ON DELETE CASCADE,
    medication_name VARCHAR(255) NOT NULL, dosage VARCHAR(100),
    frequency VARCHAR(100), duration VARCHAR(100), instructions TEXT
  )`,
  `ALTER TABLE clinic_prescription_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`
];
featureMigrations.forEach(m => migrations.push(m));

// Add new tables to VALID_TABLES
['quizzes','quiz_questions','quiz_attempts','whatsapp_config','whatsapp_messages','whatsapp_templates','scheduled_reports','report_history','branches','branch_transfers','clinic_patients','clinic_appointments','clinic_consultations','clinic_prescriptions','clinic_prescription_items'].forEach(t => VALID_TABLES.add(t));

// ============================================================
// FEATURE 0: UNIVERSAL DEV ACCESS (Portal Switcher)
// ============================================================
const DEV_PORTAL_TYPES = [
  { type: 'school', label: 'School Portal', icon: '🏫', color: '#3b82f6' },
  { type: 'church', label: 'Church Portal', icon: '⛪', color: '#8b5cf6' },
  { type: 'business', label: 'Business Portal', icon: '🏢', color: '#f59e0b' },
  { type: 'organization', label: 'Organization Portal', icon: '🤝', color: '#10b981' },
  { type: 'individual', label: 'Individual Portal', icon: '👤', color: '#ec4899' },
  { type: 'clinic', label: 'Clinic Portal', icon: '🏥', color: '#ef4444' }
];

app.get('/dev/portals', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const original = req.session._original_tenant;
  const current = req.session.user;
  const devEmail = current.email;
  // Check which demo tenants exist
  const existing = (await pool.query(
    `SELECT t.id, t.name, t.type FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.email = $1 AND t.name ILIKE 'Dev %'`,
    [devEmail]
  )).rows;
  const existingMap = {};
  existing.forEach(r => { existingMap[r.type] = r; });
  const cards = DEV_PORTAL_TYPES.map(p => {
    const demo = existingMap[p.type];
    const isActive = current.tenant_type === p.type && (original || current.tenant_name?.startsWith('Dev'));
    return `<div style="border:2px solid ${isActive ? '#22c55e' : '#e2e8f0'};border-radius:12px;padding:20px;text-align:center;cursor:pointer;background:${isActive ? '#f0fdf4' : '#fff'}" onclick="document.getElementById('switch-${p.type}').submit()">
      <div style="font-size:48px;margin-bottom:8px">${p.icon}</div>
      <h3 style="margin:0 0 4px">${esc(p.label)}</h3>
      <p style="font-size:13px;color:#64748b;margin:0 0 12px">${demo ? `Tenant #${demo.id} exists` : 'Not yet created'}</p>
      ${isActive ? '<span style="color:#22c55e;font-weight:bold;font-size:13px">● ACTIVE</span>' : `<button class="btn" style="background:${p.color};color:#fff;font-size:13px">Switch to ${esc(p.type)}</button>`}
      <form id="switch-${p.type}" method="POST" action="/dev/switch-tenant" style="display:none"><input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}"><input name="type" value="${esc(p.type)}"></form>
    </div>`;
  }).join('');
  res.send(renderPage('Dev Portal Switcher', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🛠️ Dev Portal Switcher</h1>
      <p style="opacity:0.9;margin-top:4px">Click any portal to create a demo tenant and switch your session</p>
      ${original ? `<p style="background:rgba(255,255,255,0.2);display:inline-block;padding:6px 14px;border-radius:8px;margin-top:8px">Original: ${esc(original.name)} (${esc(original.type)})</p>` : ''}
    </div>
    ${original ? `<div style="margin-bottom:16px"><a href="/dev/restore-session" class="btn btn-gold">← Restore Original Session (${esc(original.name)})</a></div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">${cards}</div>
  `, req.session.user));
}));

app.post('/dev/switch-tenant', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { type } = req.body;
  if (!DEV_PORTAL_TYPES.find(p => p.type === type)) return res.status(400).send('Invalid portal type');
  const user = req.session.user;
  // Save original if not already in dev mode
  if (!req.session._original_tenant) {
    req.session._original_tenant = { id: user.tenant_id, name: user.tenant_name, type: user.tenant_type };
  }
  const tenantName = type === 'clinic' ? 'Dev Clinic Portal' : `Dev ${type.charAt(0).toUpperCase() + type.slice(1)} Portal`;
  const tenantType = type === 'clinic' ? 'organization' : type;
  // Check if demo tenant already exists for this user
  let tenant = (await pool.query(
    `SELECT t.id, t.name, t.type FROM tenants t JOIN users u ON u.tenant_id = t.id WHERE u.email = $1 AND t.name = $2`,
    [user.email, tenantName]
  )).rows[0];
  if (!tenant) {
    // Create tenant
    tenant = (await pool.query(
      `INSERT INTO tenants (name, type, email, verified, approved) VALUES ($1, $2, $3, true, true) RETURNING id, name, type`,
      [tenantName, tenantType, user.email]
    )).rows[0];
    // Create a dummy subscription
    await pool.query(`INSERT INTO subscriptions (tenant_id, plan, status) VALUES ($1, 'enterprise', 'active')`, [tenant.id]);
    audit(user.email, 'dev_create_tenant', `Created demo tenant: ${tenantName} (#${tenant.id})`);
  }
  // Switch session
  await pool.query(`UPDATE users SET tenant_id = $1 WHERE email = $2`, [tenant.id, user.email]);
  req.session.user.tenant_id = tenant.id;
  req.session.user.tenant_name = tenant.name;
  req.session.user.tenant_type = type;
  audit(user.email, 'dev_switch_tenant', `Switched to ${tenantName} (#${tenant.id})`);
  req.session.save(() => { res.redirect(`/portal/${type}`); });
}));

app.get('/dev/restore-session', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const orig = req.session._original_tenant;
  if (!orig) return res.redirect('/dev/portals');
  const user = req.session.user;
  await pool.query(`UPDATE users SET tenant_id = $1 WHERE email = $2`, [orig.id, user.email]);
  req.session.user.tenant_id = orig.id;
  req.session.user.tenant_name = orig.name;
  req.session.user.tenant_type = orig.type;
  delete req.session._original_tenant;
  audit(user.email, 'dev_restore_session', `Restored to ${orig.name} (#${orig.id})`);
  req.session.save(() => { res.redirect('/dashboard'); });
}));

// ============================================================
// FEATURE 1: ONLINE EXAMS & QUIZZES
// ============================================================
app.get('/exams', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const rows = (await pool.query(`
    SELECT q.*, COUNT(DISTINCT qa.id) AS attempt_count,
      COALESCE(ROUND(AVG(qa.score),1),0) AS avg_score,
      COUNT(DISTINCT qq.id) AS question_count
    FROM quizzes q
    LEFT JOIN quiz_questions qq ON qq.quiz_id = q.id
    LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id
    WHERE q.tenant_id = $1 GROUP BY q.id ORDER BY q.created_at DESC)
  `, [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#3b82f6,#2563eb);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📝 Online Exams & Quizzes</h1><p style="opacity:0.9;margin-top:4px">Create, publish, and auto-grade assessments</p>
    <a href="/exams/new" class="btn" style="background:white;color:#3b82f6;margin-top:10px;display:inline-block">+ New Quiz</a>
    <a href="/exams/my-results" class="btn" style="background:rgba(255,255,255,0.2);color:white;margin-top:10px;display:inline-block;margin-left:8px">My Results</a>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Title</th><th>Subject</th><th>Questions</th><th>Attempts</th><th>Avg Score</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>${rows.map(q => `<tr style="border-bottom:1px solid #f1f5f9">
    <td><a href="/exams/${q.id}" style="color:#3b82f6;font-weight:600">${esc(q.title)}</a></td>
    <td>${esc(q.subject || '-')}</td><td>${q.question_count}</td><td>${q.attempt_count}</td>
    <td>${q.avg_score}%</td>
    <td>${q.is_published ? '<span style="color:#22c55e">Published</span>' : '<span style="color:#f59e0b">Draft</span>'}</td>
    <td>
      <a href="/exams/${q.id}" class="btn btn-sm">View</a>
      <a href="/exams/${q.id}/results" class="btn btn-sm">Results</a>
      ${!q.is_published ? `<a href="/exams/take/${q.id}" class="btn btn-sm" style="background:#22c55e;color:white">Preview</a>` : `<a href="/exams/take/${q.id}" class="btn btn-sm" style="background:#22c55e;color:white">Take</a>`}
    </td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px">No quizzes yet. Create your first one!</p>' : ''}
  </div>`;
  res.send(renderPage('Exams & Quizzes', html, req.session.user));
}));

app.get('/exams/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const html = `<div class="hero" style="background:linear-gradient(135deg,#3b82f6,#2563eb);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>Create New Quiz</h1>
  </div>
  <div class="card"><form method="POST" action="/exams/save" style="display:grid;gap:12px;max-width:600px">
    <div><label>Title *</label><input name="title" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    <div><label>Description</label><textarea name="description" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label>Subject</label><input name="subject" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Class</label><input name="class_name" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div><label>Duration (min)</label><input name="duration_minutes" type="number" value="30" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Passing Score %</label><input name="passing_score" type="number" value="50" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Options</label>
        <label style="display:block"><input type="checkbox" name="randomize_questions" value="true"> Randomize</label>
        <label style="display:block"><input type="checkbox" name="show_results" value="true" checked> Show Results</label>
      </div>
    </div>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit">Save Quiz</button>
    <a href="/exams" class="btn" style="background:#94a3b8;color:white">Cancel</a>
  </form></div>`;
  res.send(renderPage('New Quiz', html, req.session.user));
}));

app.post('/exams/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { title, description, subject, class_name, duration_minutes, passing_score, randomize_questions, show_results } = req.body;
  const result = await pool.query(
    `INSERT INTO quizzes (tenant_id,title,description,subject,class_name,duration_minutes,passing_score,randomize_questions,show_results,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [tid, title, description, subject, class_name, parseInt(duration_minutes)||30, parseInt(passing_score)||50, randomize_questions==='true', show_results!=='false', req.session.user.email]
  );
  audit(req.session.user.email, 'quiz_created', `Quiz: ${title}`);
  res.redirect(`/exams/${result.rows[0].id}`);
}));

app.get('/exams/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found');
  const questions = (await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=$1 ORDER BY sort_order', [quiz.id])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#3b82f6,#2563eb);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>${esc(quiz.title)}</h1>
    <p style="opacity:0.9">${esc(quiz.description || '')} — ${quiz.subject || 'No subject'} | ${quiz.duration_minutes}min | Pass: ${quiz.passing_score}%</p>
    <span style="background:${quiz.is_published ? '#22c55e' : '#f59e0b'};padding:4px 12px;border-radius:20px;font-size:13px">${quiz.is_published ? 'Published' : 'Draft'}</span>
  </div>
  <div class="card"><h3>Questions (${questions.length})</h3>
    <form method="POST" action="/exams/${quiz.id}/questions/add" style="margin-bottom:20px;display:grid;gap:10px">
      <div><label>Question *</label><textarea name="question_text" required rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div><label>Type</label><select name="question_type" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
          <option value="multiple_choice">Multiple Choice</option><option value="true_false">True / False</option><option value="short_answer">Short Answer</option>
        </select></div>
        <div><label>Points</label><input name="points" type="number" value="1" min="1" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <div><label>Sort Order</label><input name="sort_order" type="number" value="${questions.length}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      </div>
      <div><label>Options (JSON array for MC, e.g. ["A","B","C","D"])</label><input name="options" placeholder='["Option A","Option B","Option C","Option D"]' style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Correct Answer</label><input name="correct_answer" placeholder="A, true, or the expected answer" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
      <button class="btn btn-green" type="submit">Add Question</button>
    </form>
    ${questions.length ? questions.map((q, i) => {
      const opts = typeof q.options === 'string' ? JSON.parse(q.options||'[]') : (q.options || []);
      return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px">
        <strong>Q${i+1}.</strong> ${esc(q.question_text)}
        <span style="float:right;font-size:12px;color:#64748b">${q.question_type} | ${q.points}pt</span>
        ${opts.length ? '<div style="margin-top:6px;font-size:13px">' + opts.map(o => `<span style="display:inline-block;padding:2px 10px;background:#f1f5f9;border-radius:6px;margin:2px">${esc(o)}${o === q.correct_answer ? ' ✓' : ''}</span>`).join('') + '</div>' : ''}
        <div style="font-size:12px;color:#64748b;margin-top:4px">Answer: <strong>${esc(q.correct_answer || 'N/A')}</strong></div>
      </div>`;
    }).join('') : '<p style="color:#94a3b8">No questions added yet.</p>'}
  </div>
  ${!quiz.is_published ? `<div style="margin-top:12px"><form method="POST" action="/exams/${quiz.id}/publish"><input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}"><button class="btn" style="background:#22c55e;color:white" type="submit">Publish Quiz</button></form></div>` : ''}
  <div style="margin-top:8px"><a href="/exams" class="btn">← Back to Exams</a></div>`;
  res.send(renderPage('Quiz: ' + quiz.title, html, req.session.user));
}));

app.post('/exams/:id/questions/add', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const quiz = (await pool.query('SELECT id FROM quizzes WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found');
  const { question_text, question_type, options, correct_answer, points, sort_order } = req.body;
  let parsedOpts = null;
  try { parsedOpts = options ? JSON.parse(options) : null; } catch { parsedOpts = null; }
  await pool.query(
    `INSERT INTO quiz_questions (quiz_id,question_text,question_type,options,correct_answer,points,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [quiz.id, question_text, question_type || 'multiple_choice', JSON.stringify(parsedOpts), correct_answer, parseInt(points)||1, parseInt(sort_order)||0]
  );
  res.redirect(`/exams/${quiz.id}`);
}));

app.post('/exams/:id/publish', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  await pool.query('UPDATE quizzes SET is_published=true WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
  audit(req.session.user.email, 'quiz_published', `Quiz ID: ${req.params.id}`);
  res.redirect(`/exams/${req.params.id}`);
}));

app.get('/exams/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const quiz = (await pool.query('SELECT title FROM quizzes WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found');
  const attempts = (await pool.query('SELECT * FROM quiz_attempts WHERE quiz_id=$1 AND tenant_id=$2 ORDER BY submitted_at DESC', [req.params.id, tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#3b82f6,#2563eb);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>Results: ${esc(quiz.title)}</h1><p>${attempts.length} attempt(s)</p>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Student</th><th>Score</th><th>Total</th><th>Pass</th><th>Time</th><th>Submitted</th>
  </tr></thead><tbody>${attempts.map(a => `<tr style="border-bottom:1px solid #f1f5f9">
    <td>${esc(a.student_name || a.student_email)}</td>
    <td><strong>${a.score !== null ? a.score + '%' : '-'}</strong></td><td>${a.total_points || '-'}</td>
    <td>${a.passed ? '<span style="color:#22c55e">Yes</span>' : '<span style="color:#ef4444">No</span>'}</td>
    <td>${a.time_spent_seconds ? Math.round(a.time_spent_seconds/60) + 'm' : '-'}</td>
    <td>${a.submitted_at ? a.submitted_at.toISOString().replace('T',' ').slice(0,16) : '-'}</td>
  </tr>`).join('')}</tbody></table>
  ${attempts.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No attempts yet.</p>' : ''}
  </div><div style="margin-top:12px"><a href="/exams" class="btn">← Back to Exams</a></div>`;
  res.send(renderPage('Quiz Results', html, req.session.user));
}));

app.get('/exams/take/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id=$1 AND tenant_id=$2 AND is_published=true', [req.params.id, tid])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found or not published');
  let questions = (await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=$1 ORDER BY sort_order', [quiz.id])).rows;
  if (quiz.randomize_questions) questions = questions.sort(() => Math.random() - 0.5);
  const html = `<div class="hero" style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>${esc(quiz.title)}</h1>
    <p>${quiz.duration_minutes} minutes | Pass: ${quiz.passing_score}% | ${questions.length} questions</p>
    <div id="timer" style="font-size:24px;font-weight:bold;margin-top:8px">${quiz.duration_minutes}:00</div>
  </div>
  <form method="POST" action="/exams/take/${quiz.id}/submit" id="quizForm">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <input type="hidden" name="started_at" value="${new Date().toISOString()}">
    ${questions.map((q, i) => {
      const opts = typeof q.options === 'string' ? JSON.parse(q.options||'[]') : (q.options || []);
      let input = '';
      if (q.question_type === 'multiple_choice' && opts.length) {
        input = opts.map((o, j) => `<label style="display:block;padding:6px 0"><input type="radio" name="q_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('');
      } else if (q.question_type === 'true_false') {
        input = `<label style="display:block;padding:6px 0"><input type="radio" name="q_${q.id}" value="true"> True</label>
                 <label style="display:block;padding:6px 0"><input type="radio" name="q_${q.id}" value="false"> False</label>`;
      } else {
        input = `<textarea name="q_${q.id}" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Type your answer..."></textarea>`;
      }
      return `<div class="card" style="margin-bottom:12px"><strong>${i+1}.</strong> ${esc(q.question_text)} <span style="color:#64748b;font-size:13px">(${q.points}pt)</span><div style="margin-top:8px">${input}</div></div>`;
    }).join('')}
    <button class="btn btn-green" type="submit" style="padding:12px 32px;font-size:16px">Submit Quiz</button>
  </form>
  <script>
    let mins=${quiz.duration_minutes},secs=0;
    const iv=setInterval(()=>{if(mins<=0&&secs<=0){clearInterval(iv);document.getElementById('quizForm').submit();}if(secs===0){mins--;secs=59;}else{secs--;}document.getElementById('timer').textContent=String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0');},1000);
  </script>`;
  res.send(renderPage('Take Quiz: ' + quiz.title, html, req.session.user));
}));

app.post('/exams/take/:id/submit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found');
  const questions = (await pool.query('SELECT * FROM quiz_questions WHERE quiz_id=$1', [quiz.id])).rows;
  const answers = {};
  let score = 0, totalPoints = 0;
  questions.forEach(q => {
    const ans = req.body[`q_${q.id}`] || '';
    answers[q.id] = ans;
    totalPoints += q.points;
    if (q.question_type === 'short_answer') {
      if (ans.trim().toLowerCase() === (q.correct_answer || '').trim().toLowerCase()) score += q.points;
    } else {
      if (ans === q.correct_answer) score += q.points;
    }
  });
  const pct = totalPoints > 0 ? Math.round((score / totalPoints) * 100 * 10) / 10 : 0;
  const passed = pct >= quiz.passing_score;
  const startedAt = req.body.started_at ? new Date(req.body.started_at) : new Date();
  const timeSpent = Math.round((Date.now() - startedAt.getTime()) / 1000);
  await pool.query(
    `INSERT INTO quiz_attempts (tenant_id,quiz_id,student_email,student_name,answers,score,total_points,passed,submitted_at,time_spent_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)`,
    [tid, quiz.id, req.session.user.email, req.session.user.email.split('@')[0], JSON.stringify(answers), pct, totalPoints, passed, timeSpent]
  );
  audit(req.session.user.email, 'quiz_submitted', `Quiz ${quiz.title}: ${pct}% (${passed?'PASS':'FAIL'})`);
  const html = `<div class="card" style="text-align:center;padding:40px">
    <h1>${passed ? '🎉 Congratulations!' : '😞 Not Quite'}</h1>
    <p style="font-size:48px;font-weight:bold;color:${passed ? '#22c55e' : '#ef4444'}">${pct}%</p>
    <p>Score: ${score}/${totalPoints} points | Time: ${Math.round(timeSpent/60)}m ${timeSpent%60}s</p>
    <p>You ${passed ? 'passed' : 'did not pass'} (passing: ${quiz.passing_score}%)</p>
    <a href="/exams" class="btn" style="margin-top:16px">Back to Exams</a>
    <a href="/exams/my-results" class="btn" style="margin-top:16px;margin-left:8px">My Results</a>
  </div>`;
  res.send(renderPage('Quiz Submitted', html, req.session.user));
}));

app.get('/exams/my-results', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const rows = (await pool.query(`
    SELECT qa.*, q.title AS quiz_title FROM quiz_attempts qa
    JOIN quizzes q ON q.id = qa.quiz_id
    WHERE qa.tenant_id=$1 AND qa.student_email=$2 ORDER BY qa.submitted_at DESC
  `, [tid, req.session.user.email])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📊 My Quiz Results</h1><p>${rows.length} attempt(s)</p>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Quiz</th><th>Score</th><th>Passed</th><th>Time</th><th>Date</th>
  </tr></thead><tbody>${rows.map(a => `<tr style="border-bottom:1px solid #f1f5f9">
    <td>${esc(a.quiz_title)}</td><td><strong>${a.score}%</strong></td>
    <td>${a.passed ? '<span style="color:#22c55e">✓ Pass</span>' : '<span style="color:#ef4444">✗ Fail</span>'}</td>
    <td>${a.time_spent_seconds ? Math.round(a.time_spent_seconds/60)+'m' : '-'}</td>
    <td>${a.submitted_at ? a.submitted_at.toISOString().slice(0,10) : '-'}</td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No quiz attempts yet.</p>' : ''}
  </div><div style="margin-top:12px"><a href="/exams" class="btn">← All Exams</a></div>`;
  res.send(renderPage('My Results', html, req.session.user));
}));

// ============================================================
// FEATURE 2: WHATSAPP INTEGRATION
// ============================================================
app.get('/whatsapp', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const config = (await pool.query('SELECT * FROM whatsapp_config WHERE tenant_id=$1', [tid])).rows[0];
  const msgCount = (await pool.query('SELECT COUNT(*) FROM whatsapp_messages WHERE tenant_id=$1', [tid])).rows[0].count;
  const sentCount = (await pool.query("SELECT COUNT(*) FROM whatsapp_messages WHERE tenant_id=$1 AND direction='outbound'", [tid])).rows[0].count;
  const recent = (await pool.query('SELECT * FROM whatsapp_messages WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>💬 WhatsApp Integration</h1><p>Send messages, manage templates, view analytics</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
    <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:bold;color:#22c55e">${msgCount}</div><div style="color:#64748b">Total Messages</div></div>
    <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:bold;color:#3b82f6">${sentCount}</div><div style="color:#64748b">Sent</div></div>
    <div class="card" style="text-align:center"><div style="font-size:24px;font-weight:bold;color:${config?.is_enabled ? '#22c55e' : '#ef4444'}">${config?.is_enabled ? 'Active' : 'Inactive'}</div><div style="color:#64748b">Status</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="card"><h3>⚙️ Configuration</h3>
      <form method="POST" action="/whatsapp/config" style="display:grid;gap:8px">
        <div><label>Phone Number ID</label><input name="phone_number_id" value="${esc(config?.phone_number_id||'')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <div><label>Business Account ID</label><input name="business_account_id" value="${esc(config?.business_account_id||'')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <div><label>Access Token</label><input name="access_token" type="password" value="${esc(config?.access_token||'')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <div><label>Verify Token</label><input name="verify_token" value="${esc(config?.verify_token||'')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <label><input type="checkbox" name="is_enabled" value="true" ${config?.is_enabled?'checked':''}> Enabled</label>
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
        <button class="btn btn-green" type="submit">Save Config</button>
      </form>
    </div>
    <div class="card"><h3>📨 Recent Messages</h3>
      ${recent.map(m => `<div style="border-bottom:1px solid #f1f5f9;padding:8px 0;font-size:13px">
        <span style="color:${m.direction==='inbound'?'#3b82f6':'#22c55e'}">${m.direction==='inbound'?'←':'→'}</span>
        <strong>${esc(m.recipient)}</strong>: ${esc((m.message_text||'').substring(0,60))}...
        <span style="color:#94a3b8">${m.created_at.toISOString().slice(0,16)}</span>
      </div>`).join('')}
      ${recent.length === 0 ? '<p style="color:#94a3b8">No messages yet.</p>' : ''}
    </div>
  </div>
  <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
    <a href="/whatsapp/templates" class="btn">Templates</a>
    <a href="/whatsapp/send" class="btn btn-green">Send Message</a>
    <a href="/whatsapp/analytics" class="btn">Analytics</a>
  </div>`;
  res.send(renderPage('WhatsApp', html, req.session.user));
}));

app.post('/whatsapp/config', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { phone_number_id, business_account_id, access_token, verify_token, is_enabled } = req.body;
  const existing = (await pool.query('SELECT id FROM whatsapp_config WHERE tenant_id=$1', [tid])).rows[0];
  if (existing) {
    await pool.query('UPDATE whatsapp_config SET phone_number_id=$1,business_account_id=$2,access_token=$3,verify_token=$4,is_enabled=$5 WHERE tenant_id=$6',
      [phone_number_id, business_account_id, access_token, verify_token, is_enabled==='true', tid]);
  } else {
    await pool.query('INSERT INTO whatsapp_config (tenant_id,phone_number_id,business_account_id,access_token,verify_token,is_enabled,webhook_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, phone_number_id, business_account_id, access_token, verify_token, is_enabled==='true', `${process.env.BASE_URL||''}/whatsapp/webhook`]);
  }
  audit(req.session.user.email, 'whatsapp_config_updated', '');
  res.redirect('/whatsapp');
}));

app.get('/whatsapp/templates', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const templates = (await pool.query('SELECT * FROM whatsapp_templates WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>Message Templates</h1>
  </div>
  <div class="card"><h3>Add Template</h3>
    <form method="POST" action="/whatsapp/templates/save" style="display:grid;gap:8px;max-width:500px">
      <div><label>Name *</label><input name="name" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Category</label><select name="category" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
        <option value="utility">Utility</option><option value="marketing">Marketing</option><option value="authentication">Authentication</option>
      </select></div>
      <div><label>Body * (use {{1}}, {{2}} for params)</label><textarea name="template_body" required rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
      <div><label>Sample Params (comma-separated)</label><input name="sample_params" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
      <button class="btn btn-green" type="submit">Save Template</button>
    </form>
  </div>
  <div class="card" style="margin-top:16px"><h3>Templates (${templates.length})</h3>
    ${templates.map(t => `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px">
      <strong>${esc(t.name)}</strong> <span style="color:#94a3b8;font-size:13px">${t.category} ${t.is_active?'· <span style="color:#22c55e">Active</span>':''}</span>
      <div style="font-size:13px;margin-top:4px;white-space:pre-wrap">${esc(t.template_body)}</div>
    </div>`).join('')}
    ${templates.length === 0 ? '<p style="color:#94a3b8">No templates yet.</p>' : ''}
  </div>
  <div style="margin-top:12px"><a href="/whatsapp" class="btn">← Back</a></div>`;
  res.send(renderPage('WhatsApp Templates', html, req.session.user));
}));

app.post('/whatsapp/templates/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { name, category, template_body, sample_params } = req.body;
  await pool.query('INSERT INTO whatsapp_templates (tenant_id,name,category,template_body,sample_params) VALUES ($1,$2,$3,$4,$5)',
    [tid, name, category || 'utility', template_body, sample_params]);
  res.redirect('/whatsapp/templates');
}));

app.post('/whatsapp/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { recipient, recipient_name, template_name, message_text } = req.body;
  if (!recipient) return res.status(400).send('Recipient required');
  await pool.query(
    `INSERT INTO whatsapp_messages (tenant_id,direction,recipient,recipient_name,template_name,message_text,status) VALUES ($1,'outbound',$2,$3,$4,$5,'sent')`,
    [tid, recipient, recipient_name || '', template_name || '', message_text || '']
  );
  audit(req.session.user.email, 'whatsapp_sent', `To: ${recipient}`);
  res.redirect('/whatsapp');
}));

app.post('/whatsapp/broadcast', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { recipients, template_name, message_text } = req.body;
  const list = (recipients || '').split(',').map(r => r.trim()).filter(Boolean);
  for (const r of list) {
    await pool.query(
      `INSERT INTO whatsapp_messages (tenant_id,direction,recipient,template_name,message_text,status) VALUES ($1,'outbound',$2,$3,$4,'sent')`,
      [tid, r, template_name || '', message_text || '']
    );
  }
  audit(req.session.user.email, 'whatsapp_broadcast', `To ${list.length} recipients`);
  res.redirect('/whatsapp');
}));

app.get('/whatsapp/webhook', ah(async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token) {
    const config = (await pool.query('SELECT verify_token FROM whatsapp_config WHERE verify_token=$1', [token])).rows[0];
    if (config) return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
}));

app.post('/whatsapp/webhook', ah(async (req, res) => {
  // Acknowledge webhook
  res.status(200).send('OK');
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account' && body.entry) {
      for (const entry of body.entry) {
        for (const change of (entry.changes || [])) {
          if (change.field === 'messages' && change.value?.messages) {
            for (const msg of change.value.messages) {
              const phone = msg.from;
              const text = msg.text?.body || '[Media]';
              // Find tenant by phone number in config
              // Log inbound message (we'll store with tenant_id=0 for now as a placeholder)
              console.log(`[WhatsApp Webhook] From: ${phone}, Message: ${text}`);
            }
          }
        }
      }
    }
  } catch (e) { console.error('[WhatsApp Webhook Error]', e.message); }
}));

app.get('/whatsapp/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const stats = (await pool.query(`
    SELECT direction, status, COUNT(*) AS cnt FROM whatsapp_messages WHERE tenant_id=$1 GROUP BY direction, status ORDER BY direction, status
  `, [tid])).rows;
  const daily = (await pool.query(`
    SELECT DATE(created_at) AS day, COUNT(*) AS cnt FROM whatsapp_messages WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day
  `, [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>WhatsApp Analytics</h1>
  </div>
  <div class="card"><h3>Message Stats</h3><table style="width:100%;border-collapse:collapse">
    <thead><tr style="border-bottom:2px solid #e2e8f0"><th>Direction</th><th>Status</th><th>Count</th></tr></thead>
    <tbody>${stats.map(s => `<tr style="border-bottom:1px solid #f1f5f9"><td>${s.direction}</td><td>${s.status}</td><td><strong>${s.cnt}</strong></td></tr>`).join('')}</tbody>
  </table></div>
  <div class="card" style="margin-top:16px"><h3>Last 30 Days</h3>
    ${daily.map(d => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:13px">
      <span style="min-width:80px">${d.day}</span>
      <div style="background:#22c55e;height:16px;border-radius:4px;width:${Math.min(d.cnt * 5, 300)}px"></div>
      <span>${d.cnt}</span>
    </div>`).join('')}
  </div>
  <div style="margin-top:12px"><a href="/whatsapp" class="btn">← Back</a></div>`;
  res.send(renderPage('WhatsApp Analytics', html, req.session.user));
}));

// ============================================================
// FEATURE 3: SCHEDULED REPORTS
// ============================================================
const REPORT_TYPES = [
  { value: 'fee_summary', label: 'Fee Summary' },
  { value: 'attendance_summary', label: 'Attendance Summary' },
  { value: 'financial_report', label: 'Financial Report' },
  { value: 'tithe_statement', label: 'Tithe Statement' },
  { value: 'sales_report', label: 'Sales Report' }
];
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'];

app.get('/scheduled-reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const rows = (await pool.query('SELECT * FROM scheduled_reports WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📅 Scheduled Reports</h1><p>Automate report generation and delivery</p>
    <a href="/scheduled-reports/new" class="btn" style="background:white;color:#f59e0b;margin-top:10px;display:inline-block">+ New Schedule</a>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Name</th><th>Type</th><th>Frequency</th><th>Next Run</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
    <td><strong>${esc(r.name)}</strong></td><td>${esc(r.report_type)}</td><td>${r.frequency}</td>
    <td>${r.next_run ? r.next_run.toISOString().slice(0,16) : '-'}</td>
    <td><span style="color:${r.is_active ? '#22c55e' : '#94a3b8'}">${r.is_active ? 'Active' : 'Paused'}</span></td>
    <td>
      <a href="/scheduled-reports/${r.id}/toggle" class="btn btn-sm">${r.is_active ? 'Pause' : 'Resume'}</a>
      <a href="/scheduled-reports/${r.id}/history" class="btn btn-sm">History</a>
      <a href="/scheduled-reports/${r.id}/delete" class="btn btn-sm" style="color:#ef4444" onclick="return confirm('Delete this scheduled report?')">Delete</a>
    </td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No scheduled reports.</p>' : ''}
  </div>`;
  res.send(renderPage('Scheduled Reports', html, req.session.user));
}));

app.get('/scheduled-reports/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const html = `<div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>New Scheduled Report</h1>
  </div>
  <div class="card"><form method="POST" action="/scheduled-reports/save" style="display:grid;gap:12px;max-width:500px">
    <div><label>Report Name *</label><input name="name" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    <div><label>Report Type</label><select name="report_type" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
      ${REPORT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
    </select></div>
    <div><label>Frequency</label><select name="frequency" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
      ${FREQUENCIES.map(f => `<option value="${f}">${f.charAt(0).toUpperCase()+f.slice(1)}</option>`).join('')}
    </select></div>
    <div><label>Recipients (comma-separated emails) *</label><textarea name="recipients" required rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="admin@example.com, manager@example.com"></textarea></div>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit">Save Schedule</button>
    <a href="/scheduled-reports" class="btn" style="background:#94a3b8;color:white">Cancel</a>
  </form></div>`;
  res.send(renderPage('New Scheduled Report', html, req.session.user));
}));

app.post('/scheduled-reports/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { name, report_type, frequency, recipients } = req.body;
  const freq = frequency || 'weekly';
  const interval = freq === 'daily' ? '{1 day}' : freq === 'weekly' ? '{7 days}' : freq === 'monthly' ? '{1 month}' : '{3 months}';
  const result = await pool.query(
    `INSERT INTO scheduled_reports (tenant_id,name,report_type,frequency,recipients,next_run,is_active) VALUES ($1,$2,$3,$4,$5,NOW() + interval '${interval}',true) RETURNING id`,
    [tid, name, report_type, freq, recipients]
  );
  audit(req.session.user.email, 'scheduled_report_created', `Report: ${name}`);
  res.redirect('/scheduled-reports');
}));

app.post('/scheduled-reports/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  await pool.query('UPDATE scheduled_reports SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
  res.redirect('/scheduled-reports');
}));

app.get('/scheduled-reports/:id/history', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const report = (await pool.query('SELECT name FROM scheduled_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!report) return res.status(404).send('Not found');
  const rows = (await pool.query('SELECT * FROM report_history WHERE tenant_id=$1 AND scheduled_report_id=$2 ORDER BY generated_at DESC', [tid, req.params.id])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>History: ${esc(report.name)}</h1>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Generated</th><th>Recipients</th><th>Status</th><th>Error</th>
  </tr></thead><tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
    <td>${r.generated_at.toISOString().slice(0,16)}</td><td>${esc(r.recipients||'')}</td>
    <td><span style="color:${r.status==='sent'?'#22c55e':'#ef4444'}">${r.status}</span></td>
    <td style="color:#ef4444;font-size:13px">${esc(r.error_message||'')}</td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No run history.</p>' : ''}
  </div><div style="margin-top:12px"><a href="/scheduled-reports" class="btn">← Back</a></div>`;
  res.send(renderPage('Report History', html, req.session.user));
}));

app.get('/scheduled-reports/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  await pool.query('DELETE FROM scheduled_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
  audit(req.session.user.email, 'scheduled_report_deleted', `ID: ${req.params.id}`);
  res.redirect('/scheduled-reports');
}));

// Scheduled reports runner (runs every minute)
setInterval(async () => {
  try {
    const due = (await pool.query(`SELECT * FROM scheduled_reports WHERE is_active=true AND next_run <= NOW()`)).rows;
    for (const sr of due) {
      try {
        // Generate report and send via email
        const emailList = (sr.recipients || '').split(',').map(e => e.trim()).filter(Boolean);
        const subject = `Scheduled Report: ${sr.name} (${sr.report_type})`;
        const body = `<p>This is your scheduled <strong>${esc(sr.report_type)}</strong> report for <strong>${esc(sr.name)}</strong>.</p><p>Generated at: ${new Date().toISOString()}</p>`;
        for (const email of emailList) {
          await queueEmail(email, subject, body, 'report');
        }
        const freq = sr.frequency;
        const interval = freq === 'daily' ? '{1 day}' : freq === 'weekly' ? '{7 days}' : freq === 'monthly' ? '{1 month}' : '{3 months}';
        await pool.query(
          `UPDATE scheduled_reports SET last_run=NOW(), next_run=NOW() + interval '${interval}' WHERE id=$1`,
          [sr.id]
        );
        await pool.query(
          `INSERT INTO report_history (tenant_id,scheduled_report_id,report_type,recipients,status) VALUES ($1,$2,$3,$4,'sent')`,
          [sr.tenant_id, sr.id, sr.report_type, sr.recipients]
        );
        console.log(`[ScheduledReport] Ran report: ${sr.name} (ID:${sr.id})`);
      } catch (err) {
        await pool.query(
          `INSERT INTO report_history (tenant_id,scheduled_report_id,report_type,recipients,status,error_message) VALUES ($1,$2,$3,$4,'failed',$5)`,
          [sr.tenant_id, sr.id, sr.report_type, sr.recipients, err.message]
        );
        console.error(`[ScheduledReport] Error on report ${sr.id}:`, err.message);
      }
    }
  } catch (e) { /* silently ignore scheduler errors */ }
}, 60000);

// ============================================================
// FEATURE 4: MULTI-BRANCH MANAGEMENT
// ============================================================
app.get('/branches', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const branches = (await pool.query('SELECT * FROM branches WHERE tenant_id=$1 ORDER BY is_default DESC, name', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>🏢 Multi-Branch Management</h1><p>Manage locations, transfer stock, compare performance</p>
    <a href="/branches/new" class="btn" style="background:white;color:#8b5cf6;margin-top:10px;display:inline-block">+ New Branch</a>
  </div>
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <a href="/branches/consolidated" class="btn">📊 Consolidated View</a>
    <a href="/branches/select" class="btn">🔀 Switch Branch</a>
  </div>
  <div class="card"><h3>Branches (${branches.length})</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
    ${branches.map(b => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px;${b.is_default?'border-color:#8b5cf6;background:#faf5ff':''}">
      ${b.is_default ? '<span style="background:#8b5cf6;color:white;padding:2px 8px;border-radius:10px;font-size:11px">DEFAULT</span>' : ''}
      <h4 style="margin:8px 0 4px">${esc(b.name)} ${b.code ? `<span style="color:#94a3b8;font-size:13px">(${esc(b.code)})</span>` : ''}</h4>
      <p style="font-size:13px;color:#64748b;margin:2px 0">${esc(b.location || 'No location')}</p>
      <p style="font-size:13px;color:#64748b;margin:2px 0">Manager: ${esc(b.manager_name || 'Unassigned')}</p>
      <p style="font-size:13px;color:#64748b;margin:2px 0">Phone: ${esc(b.phone || '-')}</p>
      <span style="color:${b.is_active?'#22c55e':'#94a3b8'};font-size:13px">${b.is_active?'● Active':'○ Inactive'}</span>
      <div style="margin-top:8px"><a href="/branches/${b.id}" class="btn btn-sm">Dashboard</a>
        <a href="/branches/${b.id}/transfer" class="btn btn-sm">Transfer</a></div>
    </div>`).join('')}
    ${branches.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px">No branches yet. Create your first branch!</p>' : ''}
    </div>
  </div>`;
  res.send(renderPage('Branches', html, req.session.user));
}));

app.get('/branches/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const html = `<div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>Add New Branch</h1>
  </div>
  <div class="card"><form method="POST" action="/branches/save" style="display:grid;gap:12px;max-width:500px">
    <div><label>Branch Name *</label><input name="name" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label>Code</label><input name="code" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Phone</label><input name="phone" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div><label>Location</label><textarea name="location" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label>Manager Name</label><input name="manager_name" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Manager Email</label><input name="manager_email" type="email" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <label><input type="checkbox" name="is_default" value="true"> Set as Default Branch</label>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit">Save Branch</button>
    <a href="/branches" class="btn" style="background:#94a3b8;color:white">Cancel</a>
  </form></div>`;
  res.send(renderPage('New Branch', html, req.session.user));
}));

app.post('/branches/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { name, code, location, manager_name, manager_email, phone, is_default } = req.body;
  if (is_default === 'true') {
    await pool.query('UPDATE branches SET is_default=false WHERE tenant_id=$1', [tid]);
  }
  await pool.query(
    `INSERT INTO branches (tenant_id,name,code,location,manager_name,manager_email,phone,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tid, name, code, location, manager_name, manager_email, phone, is_default === 'true']
  );
  audit(req.session.user.email, 'branch_created', `Branch: ${name}`);
  res.redirect('/branches');
}));

app.get('/branches/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const branch = (await pool.query('SELECT * FROM branches WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!branch) return res.status(404).send('Branch not found');
  const transferCount = (await pool.query('SELECT COUNT(*) FROM branch_transfers WHERE tenant_id=$1 AND (from_branch_id=$2 OR to_branch_id=$2)', [tid, branch.id])).rows[0].count;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>${esc(branch.name)}</h1><p>${esc(branch.location || '')} ${branch.code ? '| Code: '+esc(branch.code) : ''}</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold">Manager</div><div style="color:#64748b">${esc(branch.manager_name||'N/A')}</div></div>
    <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold">${esc(branch.phone||'N/A')}</div><div style="color:#64748b">Phone</div></div>
    <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold">${transferCount}</div><div style="color:#64748b">Transfers</div></div>
    <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold;color:${branch.is_active?'#22c55e':'#ef4444'}">${branch.is_active?'Active':'Inactive'}</div><div style="color:#64748b">Status</div></div>
  </div>
  <div class="card"><h3>Quick Actions</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a href="/branches/${branch.id}/transfer" class="btn btn-green">Transfer Stock</a>
      <a href="/branches" class="btn">← All Branches</a>
    </div>
  </div>`;
  res.send(renderPage('Branch: ' + branch.name, html, req.session.user));
}));

app.post('/branches/:id/transfer', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { to_branch_id, item_type, item_id, quantity, notes } = req.body;
  await pool.query(
    `INSERT INTO branch_transfers (tenant_id,from_branch_id,to_branch_id,item_type,item_id,quantity,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tid, req.params.id, to_branch_id, item_type || 'inventory', parseInt(item_id)||0, parseInt(quantity)||1, notes, req.session.user.email]
  );
  audit(req.session.user.email, 'branch_transfer', `From branch ${req.params.id} to ${to_branch_id}`);
  res.redirect(`/branches/${req.params.id}`);
}));

app.get('/branches/consolidated', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const branches = (await pool.query('SELECT id, name, code, is_active FROM branches WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📊 Consolidated Branch View</h1><p>Compare all branches side by side</p>
  </div>
  <div class="card"><h3>Branch Comparison</h3>
    <table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
      <th>Branch</th><th>Code</th><th>Status</th><th>Transfers</th>
    </tr></thead><tbody>${await Promise.all(branches.map(async b => {
      const tc = (await pool.query('SELECT COUNT(*) FROM branch_transfers WHERE tenant_id=$1 AND (from_branch_id=$2 OR to_branch_id=$2)', [tid, b.id])).rows[0].count;
      return `<tr style="border-bottom:1px solid #f1f5f9">
        <td><a href="/branches/${b.id}" style="color:#8b5cf6;font-weight:600">${esc(b.name)}</a></td>
        <td>${esc(b.code||'-')}</td>
        <td><span style="color:${b.is_active?'#22c55e':'#94a3b8'}">${b.is_active?'Active':'Inactive'}</span></td>
        <td>${tc}</td>
      </tr>`;
    }))}</tbody></table>
    ${branches.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No branches to compare.</p>' : ''}
  </div>
  <div style="margin-top:12px"><a href="/branches" class="btn">← Back</a></div>`;
  res.send(renderPage('Consolidated View', html, req.session.user));
}));

app.get('/branches/select', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const branches = (await pool.query('SELECT * FROM branches WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid])).rows;
  const currentBranch = req.session.branch_id;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>🔀 Select Branch</h1>
  </div>
  <div class="card"><form method="POST" action="/branches/select">
    <label style="display:block;margin-bottom:8px">Active Branch</label>
    <select name="branch_id" style="width:100%;max-width:400px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:16px">
      <option value="">-- All Branches --</option>
      ${branches.map(b => `<option value="${b.id}" ${currentBranch == b.id ? 'selected' : ''}>${esc(b.name)} ${b.code ? '('+esc(b.code)+')' : ''}</option>`).join('')}
    </select>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit" style="margin-top:12px">Set Active Branch</button>
  </form></div>
  <div style="margin-top:12px"><a href="/branches" class="btn">← Back</a></div>`;
  res.send(renderPage('Select Branch', html, req.session.user));
}));

app.post('/branches/select', requireAuth, requireNotBanned, ah(async (req, res) => {
  const branchId = req.body.branch_id;
  if (branchId) {
    req.session.branch_id = parseInt(branchId);
  } else {
    delete req.session.branch_id;
  }
  res.redirect('/branches');
}));

// ============================================================
// FEATURE 5: ENHANCED CLINIC PORTAL
// ============================================================
app.get('/clinic', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const patientCount = (await pool.query('SELECT COUNT(*) FROM clinic_patients WHERE tenant_id=$1', [tid])).rows[0].count;
  const todayAppts = (await pool.query("SELECT COUNT(*) FROM clinic_appointments WHERE tenant_id=$1 AND appointment_date= CURRENT_DATE", [tid])).rows[0].count;
  const pendingQueue = (await pool.query("SELECT COUNT(*) FROM clinic_appointments WHERE tenant_id=$1 AND appointment_date=CURRENT_DATE AND status='scheduled'", [tid])).rows[0].count;
  const completedToday = (await pool.query("SELECT COUNT(*) FROM clinic_consultations WHERE tenant_id=$1 AND created_at >= CURRENT_DATE", [tid])).rows[0].count;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>🏥 Clinic Dashboard</h1><p>Patient management, appointments, consultations</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#3b82f6">${patientCount}</div><div style="color:#64748b">Patients</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#f59e0b">${todayAppts}</div><div style="color:#64748b">Today's Appointments</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#22c55e">${completedToday}</div><div style="color:#64748b">Consultations Today</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#ef4444">${pendingQueue}</div><div style="color:#64748b">In Queue</div></div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
    <a href="/clinic/patients" class="btn" style="padding:16px;text-align:center;display:block">📋 Patients</a>
    <a href="/clinic/patients/new" class="btn btn-green" style="padding:16px;text-align:center;display:block">+ New Patient</a>
    <a href="/clinic/appointments" class="btn" style="padding:16px;text-align:center;display:block">📅 Appointments</a>
    <a href="/clinic/queue" class="btn" style="background:#f59e0b;color:white;padding:16px;text-align:center;display:block">🏥 Queue</a>
    <a href="/clinic/prescriptions" class="btn" style="padding:16px;text-align:center;display:block">💊 Prescriptions</a>
    <a href="/clinic/reports" class="btn" style="padding:16px;text-align:center;display:block">📊 Reports</a>
  </div>`;
  res.send(renderPage('Clinic Dashboard', html, req.session.user));
}));

app.get('/clinic/patients', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const search = req.query.search || '';
  const rows = search
    ? (await pool.query('SELECT * FROM clinic_patients WHERE tenant_id=$1 AND (full_name ILIKE $2 OR patient_id ILIKE $2 OR phone ILIKE $2) ORDER BY created_at DESC', [tid, `%${search}%`])).rows
    : (await pool.query('SELECT * FROM clinic_patients WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📋 Patients</h1>
    <a href="/clinic/patients/new" class="btn" style="background:white;color:#ef4444;margin-top:8px;display:inline-block">+ Register Patient</a>
  </div>
  <div class="card" style="margin-bottom:16px"><form method="GET" style="display:flex;gap:8px">
    <input name="search" value="${esc(search)}" placeholder="Search by name, ID, or phone..." style="flex:1;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
    <button class="btn" type="submit">Search</button>
    ${search ? `<a href="/clinic/patients" class="btn" style="background:#94a3b8;color:white">Clear</a>` : ''}
  </form></div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>ID</th><th>Name</th><th>Gender</th><th>Phone</th><th>Blood</th><th>Registered</th><th>Actions</th>
  </tr></thead><tbody>${rows.map(p => `<tr style="border-bottom:1px solid #f1f5f9">
    <td><code>${esc(p.patient_id)}</code></td>
    <td><a href="/clinic/patients/${p.id}" style="color:#ef4444;font-weight:600">${esc(p.full_name)}</a></td>
    <td>${esc(p.gender||'-')}</td><td>${esc(p.phone||'-')}</td><td>${esc(p.blood_type||'-')}</td>
    <td>${p.created_at.toISOString().slice(0,10)}</td>
    <td><a href="/clinic/patients/${p.id}" class="btn btn-sm">View</a>
      <a href="/clinic/consultations/new/${p.id}" class="btn btn-sm btn-green">Consult</a></td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No patients found.</p>' : ''}
  </div>
  <div style="margin-top:12px"><a href="/clinic" class="btn">← Dashboard</a></div>`;
  res.send(renderPage('Patients', html, req.session.user));
}));

app.get('/clinic/patients/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>Register New Patient</h1>
  </div>
  <div class="card"><form method="POST" action="/clinic/patients/save" style="display:grid;gap:10px;max-width:600px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Patient ID *</label><input name="patient_id" required placeholder="Auto: PT-XXXX" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Full Name *</label><input name="full_name" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div><label>Date of Birth</label><input name="date_of_birth" type="date" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Gender</label><select name="gender" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
        <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
      </select></div>
      <div><label>Blood Type</label><select name="blood_type" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
        <option value="">Unknown</option><option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option>
      </select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Phone</label><input name="phone" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Address</label><input name="address" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div><label>Allergies</label><textarea name="allergies" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="List any known allergies"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Emergency Contact</label><input name="emergency_contact" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Emergency Phone</label><input name="emergency_phone" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Insurance Provider</label><input name="insurance_provider" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Insurance Number</label><input name="insurance_number" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit">Register Patient</button>
    <a href="/clinic/patients" class="btn" style="background:#94a3b8;color:white">Cancel</a>
  </form></div>`;
  res.send(renderPage('Register Patient', html, req.session.user));
}));

app.post('/clinic/patients/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { patient_id, full_name, date_of_birth, gender, phone, address, blood_type, allergies, emergency_contact, emergency_phone, insurance_provider, insurance_number } = req.body;
  const pid = patient_id || `PT-${Date.now().toString(36).toUpperCase()}`;
  await pool.query(
    `INSERT INTO clinic_patients (tenant_id,patient_id,full_name,date_of_birth,gender,phone,address,blood_type,allergies,emergency_contact,emergency_phone,insurance_provider,insurance_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [tid, pid, full_name, date_of_birth||null, gender, phone, address, blood_type, allergies, emergency_contact, emergency_phone, insurance_provider, insurance_number]
  );
  audit(req.session.user.email, 'patient_registered', `Patient: ${full_name} (${pid})`);
  res.redirect('/clinic/patients');
}));

app.get('/clinic/patients/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const patient = (await pool.query('SELECT * FROM clinic_patients WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
  if (!patient) return res.status(404).send('Patient not found');
  const appointments = (await pool.query('SELECT * FROM clinic_appointments WHERE patient_id=$1 ORDER BY appointment_date DESC LIMIT 20', [patient.id])).rows;
  const consultations = (await pool.query('SELECT * FROM clinic_consultations WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 20', [patient.id])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>${esc(patient.full_name)}</h1>
    <p>ID: ${esc(patient.patient_id)} | ${esc(patient.gender||'-')} | Blood: ${esc(patient.blood_type||'Unknown')}</p>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
    <div class="card"><h3>📋 Details</h3>
      <p><strong>DOB:</strong> ${patient.date_of_birth || 'N/A'}</p>
      <p><strong>Phone:</strong> ${esc(patient.phone||'N/A')}</p>
      <p><strong>Address:</strong> ${esc(patient.address||'N/A')}</p>
      <p><strong>Allergies:</strong> ${esc(patient.allergies||'None')}</p>
      <p><strong>Emergency:</strong> ${esc(patient.emergency_contact||'N/A')} ${esc(patient.emergency_phone||'')}</p>
      <p><strong>Insurance:</strong> ${esc(patient.insurance_provider||'N/A')} ${esc(patient.insurance_number||'')}</p>
    </div>
    <div class="card"><h3>📊 Summary</h3>
      <p><strong>Appointments:</strong> ${appointments.length}</p>
      <p><strong>Consultations:</strong> ${consultations.length}</p>
      <div style="margin-top:12px">
        <a href="/clinic/appointments/new?patient_id=${patient.id}" class="btn btn-sm">Book Appointment</a>
        <a href="/clinic/consultations/new/${patient.id}" class="btn btn-sm btn-green">New Consultation</a>
      </div>
    </div>
  </div>
  <div class="card"><h3>Recent Consultations (${consultations.length})</h3>
    ${consultations.map(c => `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:6px">
      <strong>${esc(c.doctor_name||'Unknown')}</strong> — ${c.created_at.toISOString().slice(0,10)}
      <p style="margin:4px 0;font-size:13px"><strong>Complaint:</strong> ${esc(c.chief_complaint||'N/A')}</p>
      <p style="margin:2px 0;font-size:13px"><strong>Diagnosis:</strong> ${esc(c.diagnosis||'N/A')}</p>
      ${c.vital_signs ? `<p style="margin:2px 0;font-size:13px"><strong>Vitals:</strong> ${esc(JSON.stringify(c.vital_signs))} | BP: ${esc(c.blood_pressure||'-')} | Temp: ${c.temperature||'-'}°C | Wt: ${c.weight||'-'}kg</p>` : ''}
    </div>`).join('')}
    ${consultations.length === 0 ? '<p style="color:#94a3b8">No consultations yet.</p>' : ''}
  </div>
  <div style="margin-top:12px"><a href="/clinic/patients" class="btn">← All Patients</a></div>`;
  res.send(renderPage('Patient: ' + patient.full_name, html, req.session.user));
}));

app.get('/clinic/appointments', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const rows = (await pool.query(`
    SELECT a.*, p.full_name AS patient_name, p.patient_id AS patient_code
    FROM clinic_appointments a
    LEFT JOIN clinic_patients p ON p.id = a.patient_id
    WHERE a.tenant_id=$1 ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 100
  `, [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📅 Appointments</h1>
    <a href="/clinic/appointments/new" class="btn" style="background:white;color:#ef4444;margin-top:8px;display:inline-block">+ Book Appointment</a>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Patient</th><th>Date</th><th>Time</th><th>Doctor</th><th>Dept</th><th>Status</th>
  </tr></thead><tbody>${rows.map(a => `<tr style="border-bottom:1px solid #f1f5f9">
    <td>${esc(a.patient_name||'N/A')}</td><td>${a.appointment_date}</td><td>${a.appointment_time||'-'}</td>
    <td>${esc(a.doctor_name||'-')}</td><td>${esc(a.department||'-')}</td>
    <td><span style="color:${a.status==='completed'?'#22c55e':a.status==='cancelled'?'#ef4444':a.status==='in_progress'?'#f59e0b':'#3b82f6'}">${a.status}</span></td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No appointments.</p>' : ''}
  </div>
  <div style="margin-top:12px"><a href="/clinic" class="btn">← Dashboard</a></div>`;
  res.send(renderPage('Appointments', html, req.session.user));
}));

app.get('/clinic/appointments/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const patients = (await pool.query('SELECT id, full_name, patient_id FROM clinic_patients WHERE tenant_id=$1 ORDER BY full_name LIMIT 200', [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>Book Appointment</h1>
  </div>
  <div class="card"><form method="POST" action="/clinic/appointments/save" style="display:grid;gap:10px;max-width:500px">
    <div><label>Patient *</label><select name="patient_id" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
      <option value="">Select patient...</option>
      ${patients.map(p => `<option value="${p.id}" ${req.query.patient_id == p.id ? 'selected' : ''}>${esc(p.full_name)} (${esc(p.patient_id)})</option>`).join('')}
    </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Date *</label><input name="appointment_date" type="date" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Time</label><input name="appointment_time" type="time" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Doctor</label><input name="doctor_name" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Department</label><input name="department" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div><label>Reason</label><textarea name="reason" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit">Book Appointment</button>
    <a href="/clinic/appointments" class="btn" style="background:#94a3b8;color:white">Cancel</a>
  </form></div>`;
  res.send(renderPage('Book Appointment', html, req.session.user));
}));

app.post('/clinic/appointments/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { patient_id, appointment_date, appointment_time, doctor_name, department, reason } = req.body;
  await pool.query(
    `INSERT INTO clinic_appointments (tenant_id,patient_id,appointment_date,appointment_time,doctor_name,department,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tid, parseInt(patient_id), appointment_date, appointment_time||null, doctor_name, department, reason]
  );
  audit(req.session.user.email, 'appointment_booked', `Date: ${appointment_date}`);
  res.redirect('/clinic/appointments');
}));

app.get('/clinic/queue', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const queue = (await pool.query(`
    SELECT a.*, p.full_name AS patient_name, p.patient_id AS patient_code
    FROM clinic_appointments a
    LEFT JOIN clinic_patients p ON p.id = a.patient_id
    WHERE a.tenant_id=$1 AND a.appointment_date=CURRENT_DATE
    ORDER BY CASE WHEN a.status='in_progress' THEN 1 WHEN a.status='scheduled' THEN 2 ELSE 3 END, a.appointment_time
  `, [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>🏥 Today's Queue</h1><p>${queue.length} patient(s) today</p>
  </div>
  <form method="POST" action="/clinic/queue/update">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
      <th>#</th><th>Patient</th><th>Time</th><th>Doctor</th><th>Reason</th><th>Status</th><th>Action</th>
    </tr></thead><tbody>${queue.map((a, i) => `<tr style="border-bottom:1px solid #f1f5f9">
      <td>${i+1}</td><td><strong>${esc(a.patient_name||'N/A')}</strong></td><td>${a.appointment_time||'-'}</td>
      <td>${esc(a.doctor_name||'-')}</td><td style="font-size:13px">${esc((a.reason||'').substring(0,40))}</td>
      <td><span style="color:${a.status==='in_progress'?'#f59e0b':a.status==='completed'?'#22c55e':a.status==='cancelled'?'#ef4444':'#3b82f6'}">${a.status}</span></td>
      <td><select name="status_${a.id}" style="padding:4px;border:1px solid #e2e8f0;border-radius:4px;font-size:13px">
        <option value="scheduled" ${a.status==='scheduled'?'selected':''}>Waiting</option>
        <option value="in_progress" ${a.status==='in_progress'?'selected':''}>In Progress</option>
        <option value="completed" ${a.status==='completed'?'selected':''}>Completed</option>
        <option value="cancelled" ${a.status==='cancelled'?'selected':''}>Cancelled</option>
      </select></td>
    </tr>`).join('')}</tbody></table>
    ${queue.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No patients in queue today.</p>' : ''}
    ${queue.length > 0 ? '<button class="btn btn-green" type="submit" style="margin-top:12px">Update Status</button>' : ''}
    </div>
  </form>
  <div style="margin-top:12px"><a href="/clinic" class="btn">← Dashboard</a></div>`;
  res.send(renderPage('Clinic Queue', html, req.session.user));
}));

app.post('/clinic/queue/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  for (const [key, value] of Object.entries(req.body)) {
    if (key.startsWith('status_')) {
      const id = key.replace('status_', '');
      await pool.query('UPDATE clinic_appointments SET status=$1 WHERE id=$2 AND tenant_id=$3', [value, id, tid]);
    }
  }
  res.redirect('/clinic/queue');
}));

app.get('/clinic/consultations/new/:patientId', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const patient = (await pool.query('SELECT id, full_name, patient_id FROM clinic_patients WHERE id=$1 AND tenant_id=$2', [req.params.patientId, tid])).rows[0];
  if (!patient) return res.status(404).send('Patient not found');
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>New Consultation — ${esc(patient.full_name)}</h1>
  </div>
  <div class="card"><form method="POST" action="/clinic/consultations/save" style="display:grid;gap:10px;max-width:600px">
    <input type="hidden" name="patient_id" value="${patient.id}">
    <div><label>Doctor Name</label><input name="doctor_name" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    <div><label>Chief Complaint *</label><textarea name="chief_complaint" required rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <div><label>History</label><textarea name="history" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <div><label>Examination</label><textarea name="examination" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <div><label>Diagnosis</label><textarea name="diagnosis" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div><label>Weight (kg)</label><input name="weight" type="number" step="0.1" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Temperature (°C)</label><input name="temperature" type="number" step="0.1" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
      <div><label>Blood Pressure</label><input name="blood_pressure" placeholder="120/80" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
    </div>
    <div><label>Notes</label><textarea name="notes" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <button class="btn btn-green" type="submit">Save Consultation</button>
    <a href="/clinic/patients/${patient.id}" class="btn" style="background:#94a3b8;color:white">Cancel</a>
  </form></div>`;
  res.send(renderPage('New Consultation', html, req.session.user));
}));

app.post('/clinic/consultations/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { patient_id, appointment_id, doctor_name, chief_complaint, history, examination, diagnosis, weight, temperature, blood_pressure, notes } = req.body;
  const result = await pool.query(
    `INSERT INTO clinic_consultations (tenant_id,patient_id,appointment_id,doctor_name,chief_complaint,history,examination,diagnosis,weight,temperature,blood_pressure,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [tid, parseInt(patient_id), appointment_id ? parseInt(appointment_id) : null, doctor_name, chief_complaint, history, examination, diagnosis, parseFloat(weight)||null, parseFloat(temperature)||null, blood_pressure, notes]
  );
  // If linked to appointment, mark as completed
  if (appointment_id) {
    await pool.query("UPDATE clinic_appointments SET status='completed' WHERE id=$1", [parseInt(appointment_id)]);
  }
  audit(req.session.user.email, 'consultation_saved', `Patient ID: ${patient_id}`);
  res.redirect(`/clinic/patients/${patient_id}`);
}));

app.get('/clinic/prescriptions', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const rows = (await pool.query(`
    SELECT pr.*, p.full_name AS patient_name, p.patient_id AS patient_code
    FROM clinic_prescriptions pr
    LEFT JOIN clinic_patients p ON p.id = pr.patient_id
    WHERE pr.tenant_id=$1 ORDER BY pr.created_at DESC LIMIT 100
  `, [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>💊 Prescriptions</h1>
  </div>
  <div class="card"><table style="width:100%;border-collapse:collapse"><thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
    <th>Patient</th><th>Prescribed By</th><th>Status</th><th>Date</th>
  </tr></thead><tbody>${rows.map(r => `<tr style="border-bottom:1px solid #f1f5f9">
    <td>${esc(r.patient_name||'N/A')}</td><td>${esc(r.prescribed_by||'N/A')}</td>
    <td><span style="color:${r.status==='active'?'#22c55e':'#94a3b8'}">${r.status}</span></td>
    <td>${r.created_at.toISOString().slice(0,10)}</td>
  </tr>`).join('')}</tbody></table>
  ${rows.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:20px">No prescriptions.</p>' : ''}
  </div>
  <div style="margin-top:12px"><a href="/clinic" class="btn">← Dashboard</a></div>`;
  res.send(renderPage('Prescriptions', html, req.session.user));
}));

app.post('/clinic/prescriptions/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const { consultation_id, patient_id, prescribed_by, notes, medications } = req.body;
  const medList = typeof medications === 'string' ? JSON.parse(medications || '[]') : (medications || []);
  const result = await pool.query(
    `INSERT INTO clinic_prescriptions (tenant_id,consultation_id,patient_id,prescribed_by,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [tid, consultation_id ? parseInt(consultation_id) : null, parseInt(patient_id), prescribed_by || req.session.user.email, notes]
  );
  const rxId = result.rows[0].id;
  // Insert medication items from form fields
  const medNames = req.body.med_name ? (Array.isArray(req.body.med_name) ? req.body.med_name : [req.body.med_name]) : [];
  const dosages = req.body.dosage ? (Array.isArray(req.body.dosage) ? req.body.dosage : [req.body.dosage]) : [];
  const frequencies = req.body.frequency ? (Array.isArray(req.body.frequency) ? req.body.frequency : [req.body.frequency]) : [];
  const durations = req.body.duration ? (Array.isArray(req.body.duration) ? req.body.duration : [req.body.duration]) : [];
  for (let i = 0; i < medNames.length; i++) {
    if (medNames[i]) {
      await pool.query(
        `INSERT INTO clinic_prescription_items (prescription_id,medication_name,dosage,frequency,duration,instructions) VALUES ($1,$2,$3,$4,$5,$6)`,
        [rxId, medNames[i], dosages[i]||'', frequencies[i]||'', durations[i]||'', '']
      );
    }
  }
  audit(req.session.user.email, 'prescription_saved', `Rx ID: ${rxId}`);
  res.redirect(`/clinic/patients/${patient_id}`);
}));

app.get('/clinic/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const totalPatients = (await pool.query('SELECT COUNT(*) FROM clinic_patients WHERE tenant_id=$1', [tid])).rows[0].count;
  const totalAppts = (await pool.query('SELECT COUNT(*) FROM clinic_appointments WHERE tenant_id=$1', [tid])).rows[0].count;
  const totalConsultations = (await pool.query('SELECT COUNT(*) FROM clinic_consultations WHERE tenant_id=$1', [tid])).rows[0].count;
  const totalRx = (await pool.query('SELECT COUNT(*) FROM clinic_prescriptions WHERE tenant_id=$1', [tid])).rows[0].count;
  const todayConsultations = (await pool.query("SELECT COUNT(*) FROM clinic_consultations WHERE tenant_id=$1 AND created_at >= CURRENT_DATE", [tid])).rows[0].count;
  const byDiagnosis = (await pool.query("SELECT diagnosis, COUNT(*) AS cnt FROM clinic_consultations WHERE tenant_id=$1 AND diagnosis IS NOT NULL GROUP BY diagnosis ORDER BY cnt DESC LIMIT 10", [tid])).rows;
  const byMonth = (await pool.query("SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS cnt FROM clinic_consultations WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [tid])).rows;
  const html = `<div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
    <h1>📊 Clinic Reports</h1>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#3b82f6">${totalPatients}</div><div style="color:#64748b">Total Patients</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#f59e0b">${totalAppts}</div><div style="color:#64748b">Total Appointments</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#22c55e">${totalConsultations}</div><div style="color:#64748b">Total Consultations</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#8b5cf6">${totalRx}</div><div style="color:#64748b">Prescriptions</div></div>
    <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:bold;color:#ef4444">${todayConsultations}</div><div style="color:#64748b">Today</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="card"><h3>Top Diagnoses</h3>
      ${byDiagnosis.map(d => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span>${esc(d.diagnosis||'N/A')}</span><strong>${d.cnt}</strong>
      </div>`).join('')}
      ${byDiagnosis.length === 0 ? '<p style="color:#94a3b8">No data yet.</p>' : ''}
    </div>
    <div class="card"><h3>Monthly Consultations</h3>
      ${byMonth.map(m => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:13px">
        <span style="min-width:80px">${m.month ? m.month.toISOString().slice(0,7) : 'N/A'}</span>
        <div style="background:#ef4444;height:16px;border-radius:4px;width:${Math.min(m.cnt*3,250)}px"></div>
        <span>${m.cnt}</span>
      </div>`).join('')}
      ${byMonth.length === 0 ? '<p style="color:#94a3b8">No data yet.</p>' : ''}
    </div>
  </div>
  <div style="margin-top:12px"><a href="/clinic" class="btn">← Dashboard</a></div>`;
  res.send(renderPage('Clinic Reports', html, req.session.user));
}));
