// ============================================================
// === v14.0: AI SYMPTOM CHECKER, SMART NOTIFICATIONS, PATIENT KIOSK, HEALTH WALLET, THEATRE ===
// ============================================================

// --- AI TRIAGE ---
app.get('/clinic/ai-triage', requireAuth, requireNotBanned, requireFeature('ai_triage'), aiTriageLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const recentLogs = (await pool.query('SELECT * FROM ai_triage_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])).rows;
  const severityCounts = (await pool.query("SELECT severity, COUNT(*)::int as cnt FROM ai_triage_logs WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY severity ORDER BY cnt DESC", [t])).rows;
  res.send(renderPage('AI Symptom Triage', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>AI Symptom Checker</h1><p>Intelligent symptom assessment and triage recommendations</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${severityCounts.find(s=>s.severity==='mild')?.cnt||0}</h3><p>Mild</p></div>
      <div class="stat-card"><h3>${severityCounts.find(s=>s.severity==='moderate')?.cnt||0}</h3><p>Moderate</p></div>
      <div class="stat-card"><h3>${severityCounts.find(s=>s.severity==='severe')?.cnt||0}</h3><p>Severe</p></div>
      <div class="stat-card"><h3>${severityCounts.find(s=>s.severity==='critical')?.cnt||0}</h3><p>Critical</p></div>
    </div>
    <div class="card"><h2>Check Symptoms</h2>
      <form method="POST" action="/clinic/ai-triage/check" class="form-grid">
        <div><label>Patient Name</label><input name="patient_name" required placeholder="Enter patient name"></div>
        <div><label>Patient ID (optional)</label><input name="patient_id" type="number" placeholder="Optional"></div>
        <div class="full-width"><label>Symptoms (comma-separated)</label><textarea name="symptoms" rows="3" required placeholder="e.g. headache, fever, nausea, body aches"></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Analyze Symptoms</button></div>
      </form>
    </div>
    <div class="card"><h2>Recent Triage Logs</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Patient</th><th>Symptoms</th><th>Severity</th><th>Recommendation</th><th>Date</th></tr></thead>
      <tbody>${recentLogs.map(l => `<tr><td>${esc(l.patient_name)}</td><td>${esc(l.symptoms)}</td><td><span class="badge badge-${l.severity==='critical'?'red':l.severity==='severe'?'orange':'green'}">${esc(l.severity)}</span></td><td>${esc(l.recommendation||'')}</td><td>${l.created_at?.toLocaleDateString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/ai-triage/check', requireAuth, requireNotBanned, requireFeature('ai_triage'), aiTriageLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_name, patient_id, symptoms } = req.body;
  const symList = symptoms.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  // Rule-based severity assessment
  const criticalKw = ['chest pain','difficulty breathing','unconscious','severe bleeding','seizure'];
  const severeKw = ['high fever','severe pain','vomiting blood','blurred vision','fainting'];
  const moderateKw = ['fever','headache','abdominal pain','diarrhea','cough','rash','swelling'];
  let severity = 'mild', dept = 'General Outpatient';
  if (symList.some(s => criticalKw.some(k => s.includes(k)))) { severity = 'critical'; dept = 'Emergency'; }
  else if (symList.some(s => severeKw.some(k => s.includes(k)))) { severity = 'severe'; dept = 'Emergency / Urgent Care'; }
  else if (symList.some(s => moderateKw.some(k => s.includes(k)))) { severity = 'moderate'; dept = 'Outpatient Clinic'; }
  const rec = severity === 'critical' ? 'Immediate emergency attention required' : severity === 'severe' ? 'See a doctor within 1 hour' : severity === 'moderate' ? 'Schedule appointment within 24 hours' : 'Self-care, monitor symptoms';
  await pool.query('INSERT INTO ai_triage_logs (tenant_id,patient_id,patient_name,symptoms,severity,recommendation,department) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, patient_id||null, patient_name, symptoms, severity, rec, dept]);
  await audit(req.session.user.email, 'ai_triage', { patient_name, symptoms, severity });
  res.redirect('/clinic/ai-triage');
}));

app.get('/api/health/triage/severity', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { symptoms } = req.query;
  if (!symptoms) return res.json({ error: 'Symptoms required' });
  const symList = symptoms.split(',').map(s => s.trim().toLowerCase());
  const criticalKw = ['chest pain','difficulty breathing','unconscious','severe bleeding','seizure'];
  const severeKw = ['high fever','severe pain','vomiting blood','blurred vision','fainting'];
  const moderateKw = ['fever','headache','abdominal pain','diarrhea','cough','rash','swelling'];
  let severity = 'mild';
  if (symList.some(s => criticalKw.some(k => s.includes(k)))) severity = 'critical';
  else if (symList.some(s => severeKw.some(k => s.includes(k)))) severity = 'severe';
  else if (symList.some(s => moderateKw.some(k => s.includes(k)))) severity = 'moderate';
  res.json({ severity, symptoms: symList });
}));

// --- SMART NOTIFICATIONS ---
app.get('/clinic/notifications', requireAuth, requireNotBanned, requireFeature('smart_notifications'), notificationLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [templates, history, prefs] = await Promise.all([
    pool.query('SELECT * FROM notification_templates WHERE tenant_id=$1 ORDER BY created_at DESC', [t]),
    pool.query('SELECT * FROM notification_history WHERE tenant_id=$1 ORDER BY sent_at DESC LIMIT 50', [t]),
    pool.query('SELECT * FROM notification_preferences WHERE tenant_id=$1', [t])
  ]);
  res.send(renderPage('Smart Notifications', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><h1>Smart Notifications</h1><p>Template management, delivery tracking &amp; preferences</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${templates.rows.length}</h3><p>Templates</p></div>
      <div class="stat-card"><h3>${history.rows.length}</h3><p>Sent</p></div>
      <div class="stat-card"><h3>${prefs.rows.length}</h3><p>Preferences</p></div>
    </div>
    <div class="card"><h2>Create Notification</h2>
      <form method="POST" action="/clinic/notifications/send" class="form-grid">
        <div><label>Recipient</label><input name="recipient" required placeholder="Email or phone"></div>
        <div><label>Channel</label><select name="channel"><option value="in_app">In-App</option><option value="email">Email</option><option value="sms">SMS</option></select></div>
        <div><label>Subject</label><input name="subject" placeholder="Notification subject"></div>
        <div class="full-width"><label>Message</label><textarea name="body" rows="3" required></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Send Notification</button></div>
      </form>
    </div>
    <div class="card"><h2>Recent Notifications</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>To</th><th>Channel</th><th>Subject</th><th>Status</th><th>Sent</th></tr></thead>
      <tbody>${history.rows.map(h => `<tr><td>${esc(h.recipient)}</td><td>${esc(h.channel)}</td><td>${esc(h.subject||h.body?.substring(0,50))}</td><td><span class="badge badge-${h.status==='sent'?'green':'orange'}">${esc(h.status)}</span></td><td>${h.sent_at?.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/notifications/send', requireAuth, requireNotBanned, requireFeature('smart_notifications'), notificationLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { recipient, channel, subject, body } = req.body;
  await pool.query('INSERT INTO notification_history (tenant_id,recipient,channel,subject,body,status) VALUES ($1,$2,$3,$4,$5,$6)', [t, recipient, channel||'in_app', subject, body, 'sent']);
  await audit(req.session.user.email, 'notification_sent', { recipient, channel });
  res.redirect('/clinic/notifications');
}));

app.get('/clinic/notifications/templates', requireAuth, requireNotBanned, requireFeature('smart_notifications'), notificationLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const templates = (await pool.query('SELECT * FROM notification_templates WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Notification Templates', `
    <div class="card"><h2>Notification Templates</h2>
      <form method="POST" action="/clinic/notifications/templates/save" class="form-grid">
        <div><label>Template Name</label><input name="name" required></div>
        <div><label>Channel</label><select name="channel"><option value="in_app">In-App</option><option value="email">Email</option><option value="sms">SMS</option></select></div>
        <div><label>Subject</label><input name="subject"></div>
        <div class="full-width"><label>Body</label><textarea name="body" rows="3" required></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Save Template</button></div>
      </form>
    </div>
    <div class="card"><h2>Existing Templates</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Name</th><th>Channel</th><th>Subject</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${templates.map(tp => `<tr><td>${esc(tp.name)}</td><td>${esc(tp.channel)}</td><td>${esc(tp.subject||'-')}</td><td><span class="badge badge-${tp.is_active?'green':'red'}">${tp.is_active?'Active':'Inactive'}</span></td><td>${tp.created_at?.toLocaleDateString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/notifications/templates/save', requireAuth, requireNotBanned, requireFeature('smart_notifications'), notificationLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, channel, subject, body } = req.body;
  await pool.query('INSERT INTO notification_templates (tenant_id,name,channel,subject,body) VALUES ($1,$2,$3,$4,$5)', [t, name, channel||'in_app', subject, body]);
  await audit(req.session.user.email, 'notification_template_created', { name });
  res.redirect('/clinic/notifications/templates');
}));

app.post('/clinic/notifications/bulk', requireAuth, requireNotBanned, requireFeature('smart_notifications'), notificationLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { channel, subject, body } = req.body;
  const recipients = (await pool.query('SELECT DISTINCT email FROM users WHERE tenant_id=$1 AND approved=true AND banned=false', [t])).rows;
  let sent = 0;
  for (const r of recipients) {
    await pool.query('INSERT INTO notification_history (tenant_id,recipient,channel,subject,body,status) VALUES ($1,$2,$3,$4,$5,$6)', [t, r.email, channel||'in_app', subject, body, 'sent']);
    sent++;
  }
  await audit(req.session.user.email, 'bulk_notification', { channel, sent_count: sent });
  res.send(renderPage('Bulk Notification Sent', `<div class="card" style="text-align:center;padding:40px"><h2 style="color:#059669">Notification sent to ${sent} users</h2><a href="/clinic/notifications" class="btn btn-primary" style="margin-top:16px">Back to Notifications</a></div>`));
}));

// --- PATIENT KIOSK ---
app.get('/clinic/kiosk', requireAuth, requireNotBanned, requireFeature('patient_kiosk'), kioskLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const today = new Date().toISOString().split('T')[0];
  const [todayCheckins, waiting] = await Promise.all([
    pool.query('SELECT * FROM kiosk_checkins WHERE tenant_id=$1 AND checked_in_at::date=$2 ORDER BY checked_in_at DESC', [t, today]),
    pool.query("SELECT COUNT(*)::int FROM kiosk_checkins WHERE tenant_id=$1 AND status='waiting'", [t])
  ]);
  res.send(renderPage('Patient Kiosk', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)"><h1>Patient Self Check-In Kiosk</h1><p>Streamline patient arrivals with self-service check-in</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${todayCheckins.rows.length}</h3><p>Today</p></div>
      <div class="stat-card"><h3>${waiting.rows[0]?.count||0}</h3><p>Waiting</p></div>
    </div>
    <div class="card"><h2>Patient Check-In</h2>
      <form method="POST" action="/clinic/kiosk/checkin" class="form-grid">
        <div><label>Patient Name</label><input name="patient_name" required></div>
        <div><label>Patient ID (optional)</label><input name="patient_id" type="number"></div>
        <div><label>Visit Type</label><select name="visit_type"><option value="consultation">Consultation</option><option value="followup">Follow-Up</option><option value="lab">Lab Test</option><option value="pharmacy">Pharmacy</option><option value="imaging">Imaging</option></select></div>
        <div><label>Department</label><select name="department"><option value="general">General</option><option value="pediatrics">Pediatrics</option><option value="obgyn">OB/GYN</option><option value="surgery">Surgery</option><option value="internal">Internal Medicine</option><option value="emergency">Emergency</option></select></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Check In Patient</button></div>
      </form>
    </div>
    <div class="card"><h2>Today's Queue</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>#</th><th>Patient</th><th>Visit Type</th><th>Dept</th><th>Status</th><th>Time</th></tr></thead>
      <tbody>${todayCheckins.rows.map(c => `<tr><td>${c.queue_number}</td><td>${esc(c.patient_name)}</td><td>${esc(c.visit_type)}</td><td>${esc(c.department)}</td><td><span class="badge badge-${c.status==='waiting'?'orange':c.status==='seen'?'green':'blue'}">${esc(c.status)}</span></td><td>${c.checked_in_at?.toLocaleTimeString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/kiosk/checkin', requireAuth, requireNotBanned, requireFeature('patient_kiosk'), kioskLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_name, patient_id, visit_type, department } = req.body;
  const qResult = (await pool.query("SELECT COALESCE(MAX(queue_number),0)+1 as next FROM kiosk_checkins WHERE tenant_id=$1 AND checked_in_at::date=CURRENT_DATE", [t])).rows[0];
  await pool.query('INSERT INTO kiosk_checkins (tenant_id,patient_id,patient_name,visit_type,department,queue_number) VALUES ($1,$2,$3,$4,$5,$6)', [t, patient_id||null, patient_name, visit_type, department, qResult.next]);
  await audit(req.session.user.email, 'kiosk_checkin', { patient_name, visit_type });
  res.redirect('/clinic/kiosk');
}));

// --- HEALTH WALLET ---
app.get('/clinic/wallet', requireAuth, requireNotBanned, requireFeature('health_wallet'), walletLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const wallets = (await pool.query('SELECT hw.*, COUNT(wt.id)::int as tx_count FROM health_wallets hw LEFT JOIN wallet_transactions wt ON wt.wallet_id=hw.id WHERE hw.tenant_id=$1 GROUP BY hw.id ORDER BY hw.created_at DESC', [t])).rows;
  const totalBalance = wallets.reduce((s,w) => s + (w.balance||0), 0);
  res.send(renderPage('Health Wallet', `
    <div class="hero" style="background:linear-gradient(135deg,#0ea5e9,#06b6d4)"><h1>Health Wallet</h1><p>Prepaid patient wallets for seamless payments</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${wallets.length}</h3><p>Wallets</p></div>
      <div class="stat-card"><h3>${totalBalance.toLocaleString()}</h3><p>Total Balance (UGX)</p></div>
    </div>
    <div class="card"><h2>Top Up Wallet</h2>
      <form method="POST" action="/clinic/wallet/topup" class="form-grid">
        <div><label>Patient ID</label><input name="patient_id" type="number" required></div>
        <div><label>Amount (UGX)</label><input name="amount" type="number" required min="1000"></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Top Up</button></div>
      </form>
    </div>
    <div class="card"><h2>All Wallets</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>ID</th><th>Patient ID</th><th>Balance</th><th>Transactions</th><th>Status</th></tr></thead>
      <tbody>${wallets.map(w => `<tr><td>${w.id}</td><td>${w.patient_id}</td><td>${(w.balance||0).toLocaleString()} UGX</td><td>${w.tx_count}</td><td><span class="badge badge-${w.is_active?'green':'red'}">${w.is_active?'Active':'Inactive'}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/wallet/topup', requireAuth, requireNotBanned, requireFeature('health_wallet'), walletLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_id, amount } = req.body;
  const amt = parseInt(amount);
  if (!amt || amt < 1000) return res.redirect('/clinic/wallet');
  const existing = (await pool.query('SELECT * FROM health_wallets WHERE tenant_id=$1 AND patient_id=$2', [t, patient_id])).rows[0];
  let walletId;
  if (existing) {
    const newBal = existing.balance + amt;
    await pool.query('UPDATE health_wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [newBal, existing.id]);
    walletId = existing.id;
    await pool.query('INSERT INTO wallet_transactions (tenant_id,wallet_id,type,amount,balance_after,description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, walletId, 'topup', amt, newBal, 'Wallet top-up', req.session.user.email]);
  } else {
    const w = (await pool.query('INSERT INTO health_wallets (tenant_id,patient_id,balance) VALUES ($1,$2,$3) RETURNING id', [t, patient_id, amt])).rows[0];
    walletId = w.id;
    await pool.query('INSERT INTO wallet_transactions (tenant_id,wallet_id,type,amount,balance_after,description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, walletId, 'topup', amt, amt, 'Initial wallet top-up', req.session.user.email]);
  }
  await audit(req.session.user.email, 'wallet_topup', { patient_id, amount: amt });
  res.redirect('/clinic/wallet');
}));

app.post('/clinic/wallet/spend', requireAuth, requireNotBanned, requireFeature('health_wallet'), walletLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_id, amount, description } = req.body;
  const amt = parseInt(amount);
  const wallet = (await pool.query('SELECT * FROM health_wallets WHERE tenant_id=$1 AND patient_id=$2 AND is_active=true', [t, patient_id])).rows[0];
  if (!wallet || wallet.balance < amt) return res.send(renderPage('Wallet Error', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Insufficient balance or wallet not found</h2></div>'));
  const newBal = wallet.balance - amt;
  await pool.query('UPDATE health_wallets SET balance=$1, updated_at=NOW() WHERE id=$2', [newBal, wallet.id]);
  await pool.query('INSERT INTO wallet_transactions (tenant_id,wallet_id,type,amount,balance_after,description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, wallet.id, 'spend', amt, newBal, description||'Payment', req.session.user.email]);
  await audit(req.session.user.email, 'wallet_spend', { patient_id, amount: amt });
  res.redirect('/clinic/wallet');
}));

app.get('/clinic/wallet/history/:patient_id', requireAuth, requireNotBanned, requireFeature('health_wallet'), walletLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const wallet = (await pool.query('SELECT * FROM health_wallets WHERE tenant_id=$1 AND patient_id=$2', [t, req.params.patient_id])).rows[0];
  if (!wallet) return res.redirect('/clinic/wallet');
  const txns = (await pool.query('SELECT * FROM wallet_transactions WHERE tenant_id=$1 AND wallet_id=$2 ORDER BY created_at DESC LIMIT 50', [t, wallet.id])).rows;
  res.send(renderPage('Wallet History - Patient #' + req.params.patient_id, `
    <div class="stats"><div class="stat-card"><h3>${(wallet.balance||0).toLocaleString()} UGX</h3><p>Current Balance</p></div></div>
    <div class="card"><h2>Transaction History</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance After</th><th>Description</th><th>By</th></tr></thead>
      <tbody>${txns.map(tx => `<tr><td>${tx.created_at?.toLocaleString()}</td><td><span class="badge badge-${tx.type==='topup'?'green':'red'}">${tx.type}</span></td><td>${tx.type==='topup'?'+':''}${tx.amount.toLocaleString()}</td><td>${(tx.balance_after||0).toLocaleString()}</td><td>${esc(tx.description||'')}</td><td>${esc(tx.created_by||'')}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <a href="/clinic/wallet" class="btn btn-sm" style="margin-top:12px">Back to Wallets</a>
  `));
}));

// --- THEATRE / SURGERY ---
app.get('/clinic/theatre', requireAuth, requireNotBanned, requireFeature('theatre'), theatreLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [theatres, todaySurgeries, upcoming] = await Promise.all([
    pool.query('SELECT * FROM theatres WHERE tenant_id=$1 ORDER BY name', [t]),
    pool.query('SELECT ss.*, th.name as theatre_name FROM surgery_schedules ss LEFT JOIN theatres th ON th.id=ss.theatre_id WHERE ss.tenant_id=$1 AND ss.scheduled_date=CURRENT_DATE ORDER BY ss.scheduled_time', [t]),
    pool.query("SELECT ss.*, th.name as theatre_name FROM surgery_schedules ss LEFT JOIN theatres th ON th.id=ss.theatre_id WHERE ss.tenant_id=$1 AND ss.scheduled_date > CURRENT_DATE AND ss.status='scheduled' ORDER BY ss.scheduled_date LIMIT 20", [t])
  ]);
  res.send(renderPage('Theatre Management', `
    <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#6d28d9)"><h1>Theatre &amp; Surgery</h1><p>Operating theatre scheduling and surgical management</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${theatres.rows.length}</h3><p>Theatres</p></div>
      <div class="stat-card"><h3>${todaySurgeries.rows.length}</h3><p>Today</p></div>
      <div class="stat-card"><h3>${upcoming.rows.length}</h3><p>Upcoming</p></div>
    </div>
    <div class="card"><h2>Schedule Surgery</h2>
      <form method="POST" action="/clinic/theatre/schedule" class="form-grid">
        <div><label>Patient ID</label><input name="patient_id" type="number" required></div>
        <div><label>Patient Name</label><input name="patient_name" required></div>
        <div><label>Procedure</label><input name="procedure_name" required></div>
        <div><label>Theatre</label><select name="theatre_id">${theatres.rows.map(th => `<option value="${th.id}">${esc(th.name)}</option>`).join('')}</select></div>
        <div><label>Surgeon</label><input name="surgeon" required></div>
        <div><label>Anesthetist</label><input name="anesthetist"></div>
        <div><label>Date</label><input name="scheduled_date" type="date" required></div>
        <div><label>Time</label><input name="scheduled_time" type="time"></div>
        <div><label>Duration (min)</label><input name="estimated_duration_min" type="number"></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Schedule</button></div>
      </form>
    </div>
    <div class="card"><h2>Today's Surgeries</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Patient</th><th>Procedure</th><th>Theatre</th><th>Surgeon</th><th>Time</th><th>Status</th></tr></thead>
      <tbody>${todaySurgeries.rows.map(s => `<tr><td>${esc(s.patient_name)}</td><td>${esc(s.procedure_name)}</td><td>${esc(s.theatre_name||'TBD')}</td><td>${esc(s.surgeon)}</td><td>${s.scheduled_time||'TBD'}</td><td><span class="badge badge-${s.status==='completed'?'green':s.status==='in_progress'?'blue':s.status==='cancelled'?'red':'orange'}">${esc(s.status)}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/theatre/schedule', requireAuth, requireNotBanned, requireFeature('theatre'), theatreLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_id, patient_name, procedure_name, theatre_id, surgeon, anesthetist, scheduled_date, scheduled_time, estimated_duration_min } = req.body;
  await pool.query('INSERT INTO surgery_schedules (tenant_id,patient_id,patient_name,procedure_name,theatre_id,surgeon,anesthetist,scheduled_date,scheduled_time,estimated_duration_min) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t, patient_id, patient_name, procedure_name, theatre_id||null, surgeon, anesthetist, scheduled_date, scheduled_time||null, estimated_duration_min||null]);
  await audit(req.session.user.email, 'surgery_scheduled', { patient_name, procedure_name });
  res.redirect('/clinic/theatre');
}));

app.get('/clinic/theatre/list', requireAuth, requireNotBanned, requireFeature('theatre'), theatreLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const theatres = (await pool.query('SELECT * FROM theatres WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Theatres', `
    <div class="card"><h2>Manage Theatres</h2>
      <form method="POST" action="/clinic/theatre/save" class="form-grid">
        <div><label>Name</label><input name="name" required></div>
        <div><label>Type</label><select name="type"><option value="general">General</option><option value="orthopedic">Orthopedic</option><option value="cardiac">Cardiac</option><option value="neuro">Neuro</option><option value="obstetric">Obstetric</option></select></div>
        <div><label>Floor</label><input name="floor" placeholder="e.g. 2nd Floor"></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Add Theatre</button></div>
      </form>
    </div>
    <div class="card"><h2>Existing Theatres</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Name</th><th>Type</th><th>Floor</th><th>Status</th></tr></thead>
      <tbody>${theatres.map(th => `<tr><td>${esc(th.name)}</td><td>${esc(th.type||'General')}</td><td>${esc(th.floor||'-')}</td><td><span class="badge badge-${th.status==='available'?'green':'red'}">${esc(th.status)}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/theatre/save', requireAuth, requireNotBanned, requireFeature('theatre'), theatreLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, type, floor } = req.body;
  await pool.query('INSERT INTO theatres (tenant_id,name,type,floor) VALUES ($1,$2,$3,$4)', [t, name, type||'general', floor]);
  await audit(req.session.user.email, 'theatre_created', { name });
  res.redirect('/clinic/theatre/list');
}));

app.post('/clinic/theatre/status', requireAuth, requireNotBanned, requireFeature('theatre'), theatreLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { id, status } = req.body;
  await pool.query('UPDATE theatres SET status=$1 WHERE id=$2 AND tenant_id=$3', [status, id, t]);
  res.json({ success: true });
}));

app.get('/clinic/theatre/reports', requireAuth, requireNotBanned, requireFeature('theatre'), theatreLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [totalCompleted, thisMonth, byStatus] = await Promise.all([
    pool.query("SELECT COUNT(*)::int FROM surgery_schedules WHERE tenant_id=$1 AND status='completed'", [t]),
    pool.query("SELECT COUNT(*)::int FROM surgery_schedules WHERE tenant_id=$1 AND status='completed' AND scheduled_date >= DATE_TRUNC('month', CURRENT_DATE)", [t]),
    pool.query("SELECT status, COUNT(*)::int as cnt FROM surgery_schedules WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC", [t])
  ]);
  res.send(renderPage('Surgery Reports', `
    <div class="stats">
      <div class="stat-card"><h3>${totalCompleted.rows[0]?.count||0}</h3><p>Total Completed</p></div>
      <div class="stat-card"><h3>${thisMonth.rows[0]?.count||0}</h3><p>This Month</p></div>
    </div>
    <div class="card"><h2>By Status</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Status</th><th>Count</th></tr></thead>
      <tbody>${byStatus.rows.map(s => `<tr><td><span class="badge badge-${s.status==='completed'?'green':s.status==='cancelled'?'red':'orange'}">${esc(s.status)}</span></td><td>${s.cnt}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));


// ============================================================
// === v15.0: ICU/CCU, RADIOLOGY, CLINICAL PATHWAYS, DRUG FORMULARY, SUPPLY CHAIN ===
// ============================================================

// --- ICU/CCU MONITORING ---
app.get('/clinic/icu', requireAuth, requireNotBanned, requireFeature('icu_monitoring'), icuLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const patients = (await pool.query("SELECT * FROM icu_patients WHERE tenant_id=$1 AND status='admitted' ORDER BY acuity DESC, admission_date", [t])).rows;
  const discharged = (await pool.query("SELECT COUNT(*)::int FROM icu_patients WHERE tenant_id=$1 AND status='discharged' AND discharged_at >= DATE_TRUNC('month', CURRENT_DATE)", [t])).rows[0]?.count || 0;
  res.send(renderPage('ICU/CCU Monitoring', `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444)"><h1>ICU/CCU Monitoring</h1><p>Real-time critical care patient monitoring</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${patients.length}</h3><p>Active ICU Patients</p></div>
      <div class="stat-card"><h3>${discharged}</h3><p>Discharged This Month</p></div>
    </div>
    <div class="card"><h2>Admit Patient to ICU</h2>
      <form method="POST" action="/clinic/icu/admit" class="form-grid">
        <div><label>Patient ID</label><input name="patient_id" type="number" required></div>
        <div><label>Patient Name</label><input name="patient_name" required></div>
        <div><label>Bed Number</label><input name="bed_number" required></div>
        <div><label>Diagnosis</label><input name="diagnosis" required></div>
        <div><label>Acuity</label><select name="acuity"><option value="stable">Stable</option><option value="guarded">Guarded</option><option value="critical">Critical</option></select></div>
        <div><label>Attending Doctor</label><input name="attending_doctor" required></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Admit to ICU</button></div>
      </form>
    </div>
    <div class="card"><h2>Current ICU Patients</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Bed</th><th>Patient</th><th>Diagnosis</th><th>Acuity</th><th>Doctor</th><th>Admitted</th><th>Actions</th></tr></thead>
      <tbody>${patients.map(p => `<tr><td>${esc(p.bed_number)}</td><td>${esc(p.patient_name)}</td><td>${esc(p.diagnosis)}</td><td><span class="badge badge-${p.acuity==='critical'?'red':p.acuity==='guarded'?'orange':'green'}">${esc(p.acuity)}</span></td><td>${esc(p.attending_doctor)}</td><td>${p.admission_date}</td><td><a href="/clinic/icu/vitals/${p.id}" class="btn btn-sm">Vitals</a> <a href="/clinic/icu/chart/${p.id}" class="btn btn-sm">Chart</a></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/icu/admit', requireAuth, requireNotBanned, requireFeature('icu_monitoring'), icuLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_id, patient_name, bed_number, diagnosis, acuity, attending_doctor } = req.body;
  await pool.query('INSERT INTO icu_patients (tenant_id,patient_id,patient_name,bed_number,admission_date,diagnosis,acuity,attending_doctor) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7)', [t, patient_id, patient_name, bed_number, diagnosis, acuity, attending_doctor]);
  await audit(req.session.user.email, 'icu_admit', { patient_name, bed_number });
  res.redirect('/clinic/icu');
}));

app.get('/clinic/icu/vitals/:id', requireAuth, requireNotBanned, requireFeature('icu_monitoring'), icuLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const patient = (await pool.query('SELECT * FROM icu_patients WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!patient) return res.redirect('/clinic/icu');
  const vitals = (await pool.query('SELECT * FROM icu_vitals WHERE icu_patient_id=$1 ORDER BY recorded_at DESC LIMIT 30', [req.params.id])).rows;
  res.send(renderPage('ICU Vitals - ' + patient.patient_name, `
    <div class="stats"><div class="stat-card"><h3>Bed ${esc(patient.bed_number)}</h3><p>${esc(patient.diagnosis)}</p></div></div>
    <div class="card"><h2>Record Vitals</h2>
      <form method="POST" action="/clinic/icu/vitals/save" class="form-grid">
        <input type="hidden" name="icu_patient_id" value="${patient.id}">
        <div><label>Temp (C)</label><input name="temp" type="number" step="0.1"></div>
        <div><label>Pulse</label><input name="pulse" type="number"></div>
        <div><label>BP Systolic</label><input name="bp_systolic" type="number"></div>
        <div><label>BP Diastolic</label><input name="bp_diastolic" type="number"></div>
        <div><label>Resp Rate</label><input name="resp_rate" type="number"></div>
        <div><label>SpO2 (%)</label><input name="spo2" type="number"></div>
        <div><label>GCS</label><input name="gcs" type="number" min="3" max="15"></div>
        <div><label>Blood Sugar</label><input name="blood_sugar" type="number"></div>
        <div><label>Pain Score (0-10)</label><input name="pain_score" type="number" min="0" max="10"></div>
        <div><label>Urine Output (ml)</label><input name="urine_output" type="number"></div>
        <div class="full-width"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Save Vitals</button></div>
      </form>
    </div>
    <div class="card"><h2>Vitals History</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Time</th><th>Temp</th><th>Pulse</th><th>BP</th><th>RR</th><th>SpO2</th><th>GCS</th></tr></thead>
      <tbody>${vitals.map(v => `<tr><td>${v.recorded_at?.toLocaleString()}</td><td>${v.temp||'-'}</td><td>${v.pulse||'-'}</td><td>${v.bp_systolic||'-'}/${v.bp_diastolic||'-'}</td><td>${v.resp_rate||'-'}</td><td>${v.spo2||'-'}</td><td>${v.gcs||'-'}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <a href="/clinic/icu" class="btn btn-sm" style="margin-top:12px">Back to ICU</a>
  `));
}));

app.post('/clinic/icu/vitals/save', requireAuth, requireNotBanned, requireFeature('icu_monitoring'), icuLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { icu_patient_id, temp, pulse, bp_systolic, bp_diastolic, resp_rate, spo2, gcs, blood_sugar, pain_score, urine_output, notes } = req.body;
  await pool.query('INSERT INTO icu_vitals (tenant_id,icu_patient_id,temp,pulse,bp_systolic,bp_diastolic,resp_rate,spo2,gcs,blood_sugar,pain_score,urine_output,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [t, icu_patient_id, temp||null, pulse||null, bp_systolic||null, bp_diastolic||null, resp_rate||null, spo2||null, gcs||null, blood_sugar||null, pain_score||null, urine_output||null, notes]);
  await audit(req.session.user.email, 'icu_vitals_recorded', { icu_patient_id });
  res.redirect(`/clinic/icu/vitals/${icu_patient_id}`);
}));

app.post('/clinic/icu/handover', requireAuth, requireNotBanned, requireFeature('icu_monitoring'), icuLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { icu_patient_id, shift_from, shift_to, summary, pending_tasks } = req.body;
  await pool.query('INSERT INTO icu_handovers (tenant_id,icu_patient_id,shift_from,shift_to,handed_over_by,summary,pending_tasks) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, icu_patient_id, shift_from, shift_to, req.session.user.email, summary, pending_tasks]);
  await audit(req.session.user.email, 'icu_handover', { icu_patient_id });
  res.redirect('/clinic/icu');
}));

// --- RADIOLOGY / IMAGING ---
app.get('/clinic/radiology', requireAuth, requireNotBanned, requireFeature('radiology'), radiologyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [pending, completed, modalities] = await Promise.all([
    pool.query("SELECT * FROM imaging_orders WHERE tenant_id=$1 AND status IN ('ordered','in_progress') ORDER BY urgency DESC, ordered_at", [t]),
    pool.query("SELECT COUNT(*)::int FROM imaging_orders WHERE tenant_id=$1 AND status='completed'", [t]),
    pool.query("SELECT modality, COUNT(*)::int as cnt FROM imaging_orders WHERE tenant_id=$1 GROUP BY modality ORDER BY cnt DESC", [t])
  ]);
  res.send(renderPage('Radiology & Imaging', `
    <div class="hero" style="background:linear-gradient(135deg,#2563eb,#3b82f6)"><h1>Radiology &amp; Imaging</h1><p>Order management, results tracking &amp; reporting</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${pending.rows.length}</h3><p>Pending</p></div>
      <div class="stat-card"><h3>${completed.rows[0]?.count||0}</h3><p>Completed</p></div>
    </div>
    <div class="card"><h2>Order Imaging</h2>
      <form method="POST" action="/clinic/radiology/order" class="form-grid">
        <div><label>Patient ID</label><input name="patient_id" type="number" required></div>
        <div><label>Patient Name</label><input name="patient_name" required></div>
        <div><label>Modality</label><select name="modality"><option value="X-Ray">X-Ray</option><option value="CT Scan">CT Scan</option><option value="MRI">MRI</option><option value="Ultrasound">Ultrasound</option><option value="Mammography">Mammography</option><option value="Fluoroscopy">Fluoroscopy</option></select></div>
        <div><label>Body Part</label><input name="body_part" required placeholder="e.g. Chest, Abdomen"></div>
        <div><label>Urgency</label><select name="urgency"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></div>
        <div><label>Ordering Doctor</label><input name="ordering_doctor" required></div>
        <div class="full-width"><label>Clinical Indication</label><textarea name="clinical_indication" rows="2" required></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Place Order</button></div>
      </form>
    </div>
    <div class="card"><h2>Pending Orders</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Patient</th><th>Modality</th><th>Body Part</th><th>Urgency</th><th>Doctor</th><th>Ordered</th><th>Actions</th></tr></thead>
      <tbody>${pending.rows.map(o => `<tr><td>${esc(o.patient_name)}</td><td>${esc(o.modality)}</td><td>${esc(o.body_part)}</td><td><span class="badge badge-${o.urgency==='stat'?'red':o.urgency==='urgent'?'orange':'green'}">${esc(o.urgency)}</span></td><td>${esc(o.ordering_doctor)}</td><td>${o.ordered_at?.toLocaleDateString()}</td><td><a href="/clinic/radiology/result/${o.id}" class="btn btn-sm">Add Result</a></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/radiology/order', requireAuth, requireNotBanned, requireFeature('radiology'), radiologyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_id, patient_name, modality, body_part, urgency, ordering_doctor, clinical_indication } = req.body;
  await pool.query('INSERT INTO imaging_orders (tenant_id,patient_id,patient_name,modality,body_part,urgency,ordering_doctor,clinical_indication) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [t, patient_id, patient_name, modality, body_part, urgency, ordering_doctor, clinical_indication]);
  await audit(req.session.user.email, 'imaging_ordered', { patient_name, modality, body_part });
  res.redirect('/clinic/radiology');
}));

app.get('/clinic/radiology/result/:id', requireAuth, requireNotBanned, requireFeature('radiology'), radiologyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const order = (await pool.query('SELECT * FROM imaging_orders WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!order) return res.redirect('/clinic/radiology');
  const results = (await pool.query('SELECT * FROM imaging_results WHERE order_id=$1 ORDER BY reported_at DESC', [req.params.id])).rows;
  res.send(renderPage('Imaging Result - ' + order.patient_name, `
    <div class="card"><h2>Order Details</h2><p><strong>Patient:</strong> ${esc(order.patient_name)} | <strong>Modality:</strong> ${esc(order.modality)} | <strong>Body Part:</strong> ${esc(order.body_part)} | <strong>Urgency:</strong> ${esc(order.urgency)}</p></div>
    <div class="card"><h2>Add Result</h2>
      <form method="POST" action="/clinic/radiology/result/save" class="form-grid">
        <input type="hidden" name="order_id" value="${order.id}">
        <input type="hidden" name="patient_id" value="${order.patient_id}">
        <div><label>Radiologist</label><input name="radiologist" required></div>
        <div><label>Images Count</label><input name="images_count" type="number" value="0"></div>
        <div class="full-width"><label>Findings</label><textarea name="findings" rows="4" required></textarea></div>
        <div class="full-width"><label>Impression</label><textarea name="impression" rows="3" required></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Save Result</button></div>
      </form>
    </div>
    <div class="card"><h2>Previous Results</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Radiologist</th><th>Findings</th><th>Impression</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${results.map(r => `<tr><td>${esc(r.radiologist)}</td><td>${esc(r.findings?.substring(0,100))}</td><td>${esc(r.impression?.substring(0,100))}</td><td><span class="badge badge-${r.report_status==='approved'?'green':'orange'}">${esc(r.report_status)}</span></td><td>${r.reported_at?.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/radiology/result/save', requireAuth, requireNotBanned, requireFeature('radiology'), radiologyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { order_id, patient_id, radiologist, images_count, findings, impression } = req.body;
  await pool.query('INSERT INTO imaging_results (tenant_id,order_id,patient_id,radiologist,findings,impression,images_count) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, order_id, patient_id, radiologist, findings, impression, images_count||0]);
  await pool.query("UPDATE imaging_orders SET status='completed', completed_at=NOW() WHERE id=$1 AND tenant_id=$2", [order_id, t]);
  await audit(req.session.user.email, 'imaging_result', { order_id });
  res.redirect(`/clinic/radiology/result/${order_id}`);
}));

app.get('/clinic/radiology/stats', requireAuth, requireNotBanned, requireFeature('radiology'), radiologyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [byModality, byStatus, thisMonth] = await Promise.all([
    pool.query("SELECT modality, COUNT(*)::int as cnt FROM imaging_orders WHERE tenant_id=$1 GROUP BY modality ORDER BY cnt DESC", [t]),
    pool.query("SELECT status, COUNT(*)::int as cnt FROM imaging_orders WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC", [t]),
    pool.query("SELECT COUNT(*)::int FROM imaging_orders WHERE tenant_id=$1 AND ordered_at >= DATE_TRUNC('month', CURRENT_DATE)", [t])
  ]);
  res.send(renderPage('Radiology Statistics', `
    <div class="stats"><div class="stat-card"><h3>${thisMonth.rows[0]?.count||0}</h3><p>This Month</p></div></div>
    <div class="card"><h2>By Modality</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Modality</th><th>Count</th></tr></thead><tbody>${byModality.rows.map(r => `<tr><td>${esc(r.modality)}</td><td>${r.cnt}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>By Status</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${byStatus.rows.map(r => `<tr><td>${esc(r.status)}</td><td>${r.cnt}</td></tr>`).join('')}</tbody></table></div></div>
  `));
}));

// --- CLINICAL PATHWAYS ---
app.get('/clinic/pathways', requireAuth, requireNotBanned, requireFeature('clinical_pathways'), pathwayLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [pathways, activeInstances] = await Promise.all([
    pool.query('SELECT * FROM clinical_pathways WHERE tenant_id=$1 AND is_active=true ORDER BY name', [t]),
    pool.query("SELECT COUNT(*)::int FROM pathway_instances WHERE tenant_id=$1 AND status='active'", [t])
  ]);
  res.send(renderPage('Clinical Pathways', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)"><h1>Clinical Pathways</h1><p>Standardized care protocols and patient pathway tracking</p></div>
    <div class="stats"><div class="stat-card"><h3>${pathways.rows.length}</h3><p>Pathways</p></div><div class="stat-card"><h3>${activeInstances.rows[0]?.count||0}</h3><p>Active Instances</p></div></div>
    <div class="card"><h2>Create Pathway</h2>
      <form method="POST" action="/clinic/pathways/save" class="form-grid">
        <div><label>Name</label><input name="name" required></div>
        <div><label>Condition</label><input name="condition" required placeholder="e.g. Diabetes Management"></div>
        <div><label>Duration (days)</label><input name="estimated_duration_days" type="number"></div>
        <div class="full-width"><label>Description</label><textarea name="description" rows="2"></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Create Pathway</button></div>
      </form>
    </div>
    <div class="card"><h2>Pathways</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Name</th><th>Condition</th><th>Duration</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${pathways.rows.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.condition||'')}</td><td>${p.estimated_duration_days ? p.estimated_duration_days+' days' : '-'}</td><td>${p.created_at?.toLocaleDateString()}</td><td><a href="/clinic/pathways/assign/${p.id}" class="btn btn-sm">Assign</a></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/pathways/save', requireAuth, requireNotBanned, requireFeature('clinical_pathways'), pathwayLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, condition, description, estimated_duration_days } = req.body;
  await pool.query('INSERT INTO clinical_pathways (tenant_id,name,condition,description,estimated_duration_days) VALUES ($1,$2,$3,$4,$5)', [t, name, condition, description, estimated_duration_days||null]);
  await audit(req.session.user.email, 'pathway_created', { name });
  res.redirect('/clinic/pathways');
}));

app.get('/clinic/pathways/assign/:id', requireAuth, requireNotBanned, requireFeature('clinical_pathways'), pathwayLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const pathway = (await pool.query('SELECT * FROM clinical_pathways WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!pathway) return res.redirect('/clinic/pathways');
  res.send(renderPage('Assign Pathway', `
    <div class="card" style="max-width:500px;margin:0 auto"><h2>Assign: ${esc(pathway.name)}</h2>
      <form method="POST" action="/clinic/pathways/assign/save" class="form-grid">
        <input type="hidden" name="pathway_id" value="${pathway.id}">
        <div><label>Patient ID</label><input name="patient_id" type="number" required></div>
        <div><label>Patient Name</label><input name="patient_name" required></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Assign Pathway</button></div>
      </form>
    </div>
  `));
}));

app.post('/clinic/pathways/assign/save', requireAuth, requireNotBanned, requireFeature('clinical_pathways'), pathwayLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { pathway_id, patient_id, patient_name } = req.body;
  await pool.query('INSERT INTO pathway_instances (tenant_id,pathway_id,patient_id,patient_name,assigned_by) VALUES ($1,$2,$3,$4,$5)', [t, pathway_id, patient_id, patient_name, req.session.user.email]);
  await audit(req.session.user.email, 'pathway_assigned', { pathway_id, patient_name });
  res.redirect('/clinic/pathways');
}));

// --- DRUG FORMULARY ---
app.get('/clinic/formulary', requireAuth, requireNotBanned, requireFeature('drug_formulary'), formularyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const drugs = (await pool.query('SELECT * FROM drug_formulary WHERE tenant_id=$1 ORDER BY drug_name', [t])).rows;
  res.send(renderPage('Drug Formulary', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)"><h1>Drug Formulary</h1><p>Institutional formulary management and drug information</p></div>
    <div class="stats"><div class="stat-card"><h3>${drugs.length}</h3><p>Drugs on Formulary</p></div></div>
    <div class="card"><h2>Add Drug</h2>
      <form method="POST" action="/clinic/formulary/save" class="form-grid">
        <div><label>Drug Name</label><input name="drug_name" required></div>
        <div><label>Generic Name</label><input name="generic_name"></div>
        <div><label>Strength</label><input name="strength" placeholder="e.g. 500mg"></div>
        <div><label>Dosage Form</label><select name="dosage_form"><option value="tablet">Tablet</option><option value="capsule">Capsule</option><option value="syrup">Syrup</option><option value="injection">Injection</option><option value="cream">Cream</option><option value="drops">Drops</option><option value="inhaler">Inhaler</option></select></div>
        <div><label>Category</label><input name="category" placeholder="e.g. Antibiotic, Analgesic"></div>
        <div><label>Route</label><select name="route"><option value="oral">Oral</option><option value="IV">IV</option><option value="IM">IM</option><option value="SC">SC</option><option value="topical">Topical</option></select></div>
        <div><label>Max Dose</label><input name="max_dose" placeholder="e.g. 4g/day"></div>
        <div><label>Frequency</label><input name="frequency" placeholder="e.g. 3x daily"></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Add to Formulary</button></div>
      </form>
    </div>
    <div class="card"><h2>Formulary List</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Drug Name</th><th>Strength</th><th>Form</th><th>Category</th><th>Route</th><th>Frequency</th><th>Status</th></tr></thead>
      <tbody>${drugs.map(d => `<tr><td>${esc(d.drug_name)}</td><td>${esc(d.strength||'')}</td><td>${esc(d.dosage_form||'')}</td><td>${esc(d.category||'')}</td><td>${esc(d.route||'')}</td><td>${esc(d.frequency||'')}</td><td><span class="badge badge-${d.is_on_formulary?'green':'red'}">${d.is_on_formulary?'On Formulary':'Off'}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/formulary/save', requireAuth, requireNotBanned, requireFeature('drug_formulary'), formularyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { drug_name, generic_name, strength, dosage_form, category, route, max_dose, frequency } = req.body;
  await pool.query('INSERT INTO drug_formulary (tenant_id,drug_name,generic_name,strength,dosage_form,category,route,max_dose,frequency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, drug_name, generic_name, strength, dosage_form, category, route, max_dose, frequency]);
  await audit(req.session.user.email, 'formulary_drug_added', { drug_name });
  res.redirect('/clinic/formulary');
}));

app.get('/api/health/formulary/search', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const drugs = (await pool.query("SELECT * FROM drug_formulary WHERE tenant_id=$1 AND (drug_name ILIKE $2 OR generic_name ILIKE $2 OR category ILIKE $2) LIMIT 20", [t, `%${q}%`])).rows;
  res.json({ results: drugs });
}));

// --- SUPPLY CHAIN ---
app.get('/clinic/supply-chain', requireAuth, requireNotBanned, requireFeature('supply_chain'), supplyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [suppliers, pos, pendingGRN] = await Promise.all([
    pool.query('SELECT * FROM suppliers WHERE tenant_id=$1 ORDER BY name', [t]),
    pool.query("SELECT * FROM supply_purchase_orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20", [t]),
    pool.query("SELECT COUNT(*)::int FROM goods_received_notes WHERE tenant_id=$1 AND status='partial'", [t])
  ]);
  res.send(renderPage('Supply Chain', `
    <div class="hero" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h1>Supply Chain</h1><p>Suppliers, purchase orders &amp; inventory management</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${suppliers.rows.length}</h3><p>Suppliers</p></div>
      <div class="stat-card"><h3>${pos.rows.length}</h3><p>Purchase Orders</p></div>
      <div class="stat-card"><h3>${pendingGRN.rows[0]?.count||0}</h3><p>Pending GRN</p></div>
    </div>
    <div class="card"><h2>Add Supplier</h2>
      <form method="POST" action="/clinic/supply-chain/supplier/save" class="form-grid">
        <div><label>Name</label><input name="name" required></div>
        <div><label>Contact Person</label><input name="contact_person"></div>
        <div><label>Phone</label><input name="phone"></div>
        <div><label>Email</label><input name="email" type="email"></div>
        <div><label>Category</label><input name="category" placeholder="e.g. Pharmaceuticals, Equipment"></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Add Supplier</button></div>
      </form>
    </div>
    <div class="card"><h2>Purchase Orders</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>PO #</th><th>Supplier</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${pos.rows.map(po => `<tr><td>${esc(po.po_number||'PO-'+po.id)}</td><td>${esc(po.supplier_name||'')}</td><td>${(po.total_amount||0).toLocaleString()}</td><td><span class="badge badge-${po.status==='approved'?'green':po.status==='delivered'?'blue':'orange'}">${esc(po.status)}</span></td><td>${po.order_date}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/supply-chain/supplier/save', requireAuth, requireNotBanned, requireFeature('supply_chain'), supplyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, contact_person, phone, email, category, address } = req.body;
  await pool.query('INSERT INTO suppliers (tenant_id,name,contact_person,phone,email,category,address) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, name, contact_person, phone, email, category, address]);
  await audit(req.session.user.email, 'supplier_created', { name });
  res.redirect('/clinic/supply-chain');
}));

app.get('/clinic/supply-chain/po/new', requireAuth, requireNotBanned, requireFeature('supply_chain'), supplyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const suppliers = (await pool.query('SELECT * FROM suppliers WHERE tenant_id=$1 AND is_active=true ORDER BY name', [t])).rows;
  res.send(renderPage('New Purchase Order', `
    <div class="card" style="max-width:800px;margin:0 auto"><h2>Create Purchase Order</h2>
      <form method="POST" action="/clinic/supply-chain/po/save" class="form-grid">
        <div><label>Supplier</label><select name="supplier_id">${suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div><label>Expected Delivery Date</label><input name="expected_date" type="date"></div>
        <div class="full-width"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Create PO</button></div>
      </form>
    </div>
  `));
}));

app.post('/clinic/supply-chain/po/save', requireAuth, requireNotBanned, requireFeature('supply_chain'), supplyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { supplier_id, expected_date, notes } = req.body;
  const supplier = (await pool.query('SELECT * FROM suppliers WHERE id=$1', [supplier_id])).rows[0];
  const poNumber = 'PO-' + Date.now().toString(36).toUpperCase();
  await pool.query('INSERT INTO supply_purchase_orders (tenant_id,po_number,supplier_id,supplier_name,expected_date,notes,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, poNumber, supplier_id, supplier?.name, expected_date, notes, 'pending']);
  await audit(req.session.user.email, 'po_created', { po_number: poNumber });
  res.redirect('/clinic/supply-chain');
}));

app.get('/clinic/supply-chain/reports', requireAuth, requireNotBanned, requireFeature('supply_chain'), supplyLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [totalPOs, totalSuppliers, byStatus] = await Promise.all([
    pool.query("SELECT COUNT(*)::int FROM supply_purchase_orders WHERE tenant_id=$1", [t]),
    pool.query("SELECT COUNT(*)::int FROM suppliers WHERE tenant_id=$1", [t]),
    pool.query("SELECT status, COUNT(*)::int as cnt FROM supply_purchase_orders WHERE tenant_id=$1 GROUP BY status", [t])
  ]);
  res.send(renderPage('Supply Chain Reports', `
    <div class="stats"><div class="stat-card"><h3>${totalPOs.rows[0]?.count||0}</h3><p>Total POs</p></div><div class="stat-card"><h3>${totalSuppliers.rows[0]?.count||0}</h3><p>Suppliers</p></div></div>
    <div class="card"><h2>PO Status Breakdown</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${byStatus.rows.map(r => `<tr><td>${esc(r.status)}</td><td>${r.cnt}</td></tr>`).join('')}</tbody></table></div></div>
  `));
}));


// ============================================================
// === v16.0: HL7/FHIR API, ELECTRONIC PRESCRIPTIONS, LAB AUTOMATION, MULTI-LOCATION SYNC ===
// ============================================================

// --- FHIR API ---
app.get('/clinic/fhir/Patient', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const patients = (await pool.query('SELECT id, name, phone, email FROM patients WHERE tenant_id=$1 ORDER BY name LIMIT 50', [t])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: patients.map(p => ({ resource: { resourceType: 'Patient', id: String(p.id), name: [{ text: p.name }], telecom: p.phone ? [{ system: 'phone', value: p.phone }] : [] } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'Patient', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/Observation', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const patientId = req.query.patient;
  const vitals = (await pool.query('SELECT * FROM patient_vitals WHERE tenant_id=$1 $2 ORDER BY recorded_at DESC LIMIT 50', [t, patientId ? `AND patient_id=${patientId}` : ''])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: vitals.map(v => ({ resource: { resourceType: 'Observation', subject: { reference: `Patient/${v.patient_id}` }, effectiveDateTime: v.recorded_at, valueQuantity: v.temperature ? { value: v.temperature, unit: 'C' } : undefined } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'Observation', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/Condition', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const diagnoses = (await pool.query("SELECT id, patient_id, diagnosis, date FROM consultations WHERE tenant_id=$1 AND diagnosis IS NOT NULL AND diagnosis != '' ORDER BY date DESC LIMIT 50", [t])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: diagnoses.map(d => ({ resource: { resourceType: 'Condition', id: String(d.id), subject: { reference: `Patient/${d.patient_id}` }, code: { text: d.diagnosis }, onsetDateTime: d.date } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'Condition', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/MedicationRequest', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rxs = (await pool.query('SELECT * FROM electronic_prescriptions WHERE tenant_id=$1 ORDER BY issued_at DESC LIMIT 50', [t])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: rxs.map(r => ({ resource: { resourceType: 'MedicationRequest', id: String(r.id), subject: { reference: `Patient/${r.patient_id}` }, status: r.status, authoredOn: r.issued_at } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'MedicationRequest', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/ServiceRequest', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const labs = (await pool.query('SELECT id, patient_id, test_name, date_ordered FROM lab_results WHERE tenant_id=$1 ORDER BY date_ordered DESC LIMIT 50', [t])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: labs.map(l => ({ resource: { resourceType: 'ServiceRequest', id: String(l.id), subject: { reference: `Patient/${l.patient_id}` }, code: { text: l.test_name }, authoredOn: l.date_ordered } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'ServiceRequest', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/DiagnosticReport', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const imaging = (await pool.query('SELECT ir.*, io.patient_id FROM imaging_results ir JOIN imaging_orders io ON io.id=ir.order_id WHERE ir.tenant_id=$1 ORDER BY ir.reported_at DESC LIMIT 50', [t])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: imaging.map(i => ({ resource: { resourceType: 'DiagnosticReport', id: String(i.id), subject: { reference: `Patient/${i.patient_id}` }, status: i.report_status, conclusion: i.impression, effectiveDateTime: i.reported_at } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'DiagnosticReport', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/AllergyIntolerance', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const allergies = (await pool.query("SELECT * FROM patient_allergies WHERE tenant_id=$1 LIMIT 50", [t])).rows;
  const fhirBundle = { resourceType: 'Bundle', type: 'collection', entry: allergies.map(a => ({ resource: { resourceType: 'AllergyIntolerance', id: String(a.id), subject: { reference: `Patient/${a.patient_id}` }, code: { text: a.allergen || a.allergy }, criticality: a.severity || 'low' } })) };
  await pool.query('INSERT INTO fhir_audit_log (tenant_id,resource_type,operation,user_email) VALUES ($1,$2,$3,$4)', [t, 'AllergyIntolerance', 'read', req.session.user.email]);
  res.json(fhirBundle);
}));

app.get('/clinic/fhir/audit', requireAuth, requireNotBanned, requireFeature('fhir_api'), fhirLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const logs = (await pool.query('SELECT * FROM fhir_audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100', [t])).rows;
  res.send(renderPage('FHIR API Audit', `
    <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#6366f1)"><h1>FHIR API Audit Log</h1><p>Track all FHIR API access</p></div>
    <div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Resource</th><th>Operation</th><th>User</th><th>Status</th></tr></thead>
    <tbody>${logs.map(l => `<tr><td>${l.created_at?.toLocaleString()}</td><td>${esc(l.resource_type)}</td><td>${esc(l.operation)}</td><td>${esc(l.user_email)}</td><td>${l.response_status||'-'}</td></tr>`).join('')}</tbody></table></div></div>
  `));
}));

// --- ELECTRONIC PRESCRIPTIONS ---
app.get('/clinic/erx', requireAuth, requireNotBanned, requireFeature('electronic_rx'), erxLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const prescriptions = (await pool.query('SELECT * FROM electronic_prescriptions WHERE tenant_id=$1 ORDER BY issued_at DESC LIMIT 30', [t])).rows;
  const [activeCount, dispensedCount] = await Promise.all([
    pool.query("SELECT COUNT(*)::int FROM electronic_prescriptions WHERE tenant_id=$1 AND status='active'", [t]),
    pool.query("SELECT COUNT(*)::int FROM electronic_prescriptions WHERE tenant_id=$1 AND status='dispensed'", [t])
  ]);
  res.send(renderPage('Electronic Prescriptions', `
    <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#8b5cf6)"><h1>Electronic Prescriptions</h1><p>Digital prescribing, verification &amp; dispensing</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${activeCount.rows[0]?.count||0}</h3><p>Active</p></div>
      <div class="stat-card"><h3>${dispensedCount.rows[0]?.count||0}</h3><p>Dispensed</p></div>
    </div>
    <div class="card"><h2>New e-Prescription</h2>
      <form method="POST" action="/clinic/erx/create" class="form-grid">
        <div><label>Patient ID</label><input name="patient_id" type="number" required></div>
        <div><label>Patient Name</label><input name="patient_name" required></div>
        <div><label>Prescriber</label><input name="prescriber" required></div>
        <div><label>License #</label><input name="prescriber_license"></div>
        <div class="full-width"><label>Medications (JSON)</label><textarea name="medications" rows="3" placeholder='[{"drug":"Amoxicillin","dose":"500mg","frequency":"3x daily","duration":"7 days"}]'></textarea></div>
        <div><label>Diagnosis</label><input name="diagnosis"></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Issue Prescription</button></div>
      </form>
    </div>
    <div class="card"><h2>Prescriptions</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Rx #</th><th>Patient</th><th>Prescriber</th><th>Diagnosis</th><th>Status</th><th>Issued</th><th>Actions</th></tr></thead>
      <tbody>${prescriptions.map(rx => `<tr><td>${esc(rx.rx_number||'RX-'+rx.id)}</td><td>${esc(rx.patient_name)}</td><td>${esc(rx.prescriber)}</td><td>${esc(rx.diagnosis||'')}</td><td><span class="badge badge-${rx.status==='active'?'green':rx.status==='dispensed'?'blue':'red'}">${esc(rx.status)}</span></td><td>${rx.issued_at?.toLocaleDateString()}</td><td><a href="/clinic/erx/verify/${rx.id}" class="btn btn-sm">Verify</a></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/erx/create', requireAuth, requireNotBanned, requireFeature('electronic_rx'), erxLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_id, patient_name, prescriber, prescriber_license, medications, diagnosis } = req.body;
  let medsParsed = medications;
  try { medsParsed = JSON.parse(medications); } catch(e) { /* keep as-is */ }
  const rxNumber = 'RX-' + Date.now().toString(36).toUpperCase();
  await pool.query('INSERT INTO electronic_prescriptions (tenant_id,patient_id,patient_name,prescriber,prescriber_license,medications,diagnosis,rx_number,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()+INTERVAL \'30 days\')', [t, patient_id, patient_name, prescriber, prescriber_license, JSON.stringify(medsParsed), diagnosis, rxNumber]);
  await audit(req.session.user.email, 'erx_issued', { rx_number: rxNumber, patient_name });
  res.redirect('/clinic/erx');
}));

app.post('/clinic/erx/verify/:id', requireAuth, requireNotBanned, requireFeature('electronic_rx'), erxLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { verification_status, notes } = req.body;
  await pool.query('INSERT INTO erx_verification_log (tenant_id,rx_id,verified_by,verification_status,notes) VALUES ($1,$2,$3,$4,$5)', [t, req.params.id, req.session.user.email, verification_status, notes]);
  if (verification_status === 'verified') await pool.query("UPDATE electronic_prescriptions SET status='verified' WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
  await audit(req.session.user.email, 'erx_verified', { rx_id: req.params.id });
  res.redirect('/clinic/erx');
}));

app.get('/clinic/erx/history', requireAuth, requireNotBanned, requireFeature('electronic_rx'), erxLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const logs = (await pool.query('SELECT ev.*, ep.rx_number, ep.patient_name FROM erx_verification_log ev JOIN electronic_prescriptions ep ON ep.id=ev.rx_id WHERE ev.tenant_id=$1 ORDER BY ev.created_at DESC LIMIT 50', [t])).rows;
  res.send(renderPage('e-Rx Verification History', `
    <div class="card"><div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Rx #</th><th>Patient</th><th>Verified By</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>${logs.map(l => `<tr><td>${l.created_at?.toLocaleString()}</td><td>${esc(l.rx_number||'')}</td><td>${esc(l.patient_name||'')}</td><td>${esc(l.verified_by)}</td><td><span class="badge badge-${l.verification_status==='verified'?'green':'red'}">${esc(l.verification_status)}</span></td><td>${esc(l.notes||'')}</td></tr>`).join('')}</tbody></table></div></div>
  `));
}));

// --- LAB AUTOMATION ---
app.get('/clinic/lab-automation', requireAuth, requireNotBanned, requireFeature('lab_automation'), labAutoLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [rules, qcRecords] = await Promise.all([
    pool.query('SELECT * FROM lab_automation_rules WHERE tenant_id=$1 ORDER BY test_name', [t]),
    pool.query('SELECT * FROM lab_quality_control WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [t])
  ]);
  res.send(renderPage('Lab Automation', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)"><h1>Lab Automation</h1><p>Auto-result rules, quality control &amp; critical value management</p></div>
    <div class="card"><h2>Add Automation Rule</h2>
      <form method="POST" action="/clinic/lab-automation/rules/save" class="form-grid">
        <div><label>Test Name</label><input name="test_name" required></div>
        <div><label>Condition Field</label><input name="condition_field" required placeholder="e.g. result_value"></div>
        <div><label>Operator</label><select name="operator"><option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option><option value=">="> >=</option><option value="<="><=</option></select></div>
        <div><label>Threshold Value</label><input name="threshold_value" type="number" step="0.01" required></div>
        <div><label>Action</label><select name="action"><option value="flag">Flag</option><option value="alert">Alert</option><option value="hold">Hold</option><option value="auto_repeat">Auto Repeat</option></select></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Save Rule</button></div>
      </form>
    </div>
    <div class="card"><h2>Automation Rules</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Test</th><th>Condition</th><th>Threshold</th><th>Action</th><th>Active</th></tr></thead>
      <tbody>${rules.rows.map(r => `<tr><td>${esc(r.test_name)}</td><td>${esc(r.condition_field)} ${esc(r.operator)}</td><td>${r.threshold_value}</td><td>${esc(r.action)}</td><td><span class="badge badge-${r.is_active?'green':'red'}">${r.is_active?'Active':'Inactive'}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/lab-automation/rules/save', requireAuth, requireNotBanned, requireFeature('lab_automation'), labAutoLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { test_name, condition_field, operator, threshold_value, action } = req.body;
  await pool.query('INSERT INTO lab_automation_rules (tenant_id,test_name,condition_field,operator,threshold_value,action) VALUES ($1,$2,$3,$4,$5,$6)', [t, test_name, condition_field, operator, threshold_value, action]);
  await audit(req.session.user.email, 'lab_rule_created', { test_name });
  res.redirect('/clinic/lab-automation');
}));

app.post('/clinic/lab-automation/qc/save', requireAuth, requireNotBanned, requireFeature('lab_automation'), labAutoLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { test_name, lot_number, expected_value, actual_value, technician } = req.body;
  const withinRange = Math.abs(parseFloat(actual_value) - parseFloat(expected_value)) <= parseFloat(expected_value) * 0.1;
  await pool.query('INSERT INTO lab_quality_control (tenant_id,test_name,lot_number,expected_value,actual_value,is_within_range,technician) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t, test_name, lot_number, expected_value, actual_value, withinRange, technician]);
  await audit(req.session.user.email, 'lab_qc_recorded', { test_name, within_range: withinRange });
  res.redirect('/clinic/lab-automation');
}));

app.get('/clinic/lab-automation/stats', requireAuth, requireNotBanned, requireFeature('lab_automation'), labAutoLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [totalRules, qcPassRate, recentFlags] = await Promise.all([
    pool.query("SELECT COUNT(*)::int FROM lab_automation_rules WHERE tenant_id=$1 AND is_active=true", [t]),
    pool.query("SELECT ROUND(COUNT(*) FILTER (WHERE is_within_range=true)::numeric / NULLIF(COUNT(*),0) * 100, 1) as pass_rate FROM lab_quality_control WHERE tenant_id=$1", [t]),
    pool.query("SELECT COUNT(*)::int as cnt FROM lab_quality_control WHERE tenant_id=$1 AND is_within_range=false AND created_at >= NOW() - INTERVAL '30 days'", [t])
  ]);
  res.send(renderPage('Lab Automation Stats', `
    <div class="stats">
      <div class="stat-card"><h3>${totalRules.rows[0]?.count||0}</h3><p>Active Rules</p></div>
      <div class="stat-card"><h3>${qcPassRate.rows[0]?.pass_rate||0}%</h3><p>QC Pass Rate</p></div>
      <div class="stat-card"><h3>${recentFlags.rows[0]?.cnt||0}</h3><p>QC Failures (30d)</p></div>
    </div>
  `));
}));

// --- MULTI-LOCATION SYNC ---
app.get('/clinic/sync', requireAuth, requireNotBanned, requireFeature('multi_location_sync'), syncLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [syncLogs, pending, failed] = await Promise.all([
    pool.query('SELECT * FROM sync_log WHERE tenant_id=$1 ORDER BY synced_at DESC LIMIT 50', [t]),
    pool.query("SELECT COUNT(*)::int FROM sync_log WHERE tenant_id=$1 AND sync_status='pending'", [t]),
    pool.query("SELECT COUNT(*)::int FROM sync_log WHERE tenant_id=$1 AND sync_status='failed'", [t])
  ]);
  res.send(renderPage('Multi-Location Sync', `
    <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#6366f1)"><h1>Multi-Location Sync</h1><p>Synchronize data across multiple locations</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${pending.rows[0]?.count||0}</h3><p>Pending</p></div>
      <div class="stat-card"><h3>${failed.rows[0]?.count||0}</h3><p>Failed</p></div>
    </div>
    <div class="card"><h2>Sync Log</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Entity</th><th>Operation</th><th>Source</th><th>Target</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>${syncLogs.rows.map(s => `<tr><td>${esc(s.entity_type)}</td><td>${esc(s.operation)}</td><td>${esc(s.source_location||'')}</td><td>${esc(s.target_location||'')}</td><td><span class="badge badge-${s.sync_status==='completed'?'green':s.sync_status==='failed'?'red':'orange'}">${esc(s.sync_status)}</span></td><td>${s.synced_at?.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));


// ============================================================
// === v17.0: ADVANCED ANALYTICS, REVENUE CYCLE, COMPLIANCE, MOBILE API, DATA EXPORT ===
// ============================================================

// --- ADVANCED ANALYTICS ---
app.get('/clinic/analytics', requireAuth, requireNotBanned, requireFeature('advanced_analytics'), analyticsLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const today = new Date().toISOString().split('T')[0];
  const [totalPatients, todayVisits, monthlyRevenue, totalBilled] = await Promise.all([
    pool.query('SELECT COUNT(*)::int FROM patients WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*)::int FROM clinic_queue WHERE tenant_id=$1 AND visit_date=$2', [t, today]),
    pool.query("SELECT COALESCE(SUM(amount),0)::int FROM payments WHERE tenant_id=$1 AND status='successful' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0)::int FROM payments WHERE tenant_id=$1", [t])
  ]);
  res.send(renderPage('Advanced Analytics', `
    <div class="hero" style="background:linear-gradient(135deg,#0f172a,#1e293b)"><h1>Advanced Analytics</h1><p>Comprehensive healthcare analytics dashboard</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${totalPatients.rows[0]?.count||0}</h3><p>Total Patients</p></div>
      <div class="stat-card"><h3>${todayVisits.rows[0]?.count||0}</h3><p>Today's Visits</p></div>
      <div class="stat-card"><h3>${monthlyRevenue.rows[0]?.sum?.toLocaleString()||0}</h3><p>Monthly Revenue</p></div>
      <div class="stat-card"><h3>${totalBilled.rows[0]?.sum?.toLocaleString()||0}</h3><p>Total Billed</p></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
      <a href="/clinic/analytics/revenue" class="card" style="text-decoration:none;display:block"><h3>Revenue Analytics</h3><p>Detailed revenue breakdowns</p></a>
      <a href="/clinic/analytics/patient-flow" class="card" style="text-decoration:none;display:block"><h3>Patient Flow</h3><p>Visit trends and patterns</p></a>
      <a href="/clinic/analytics/disease-burden" class="card" style="text-decoration:none;display:block"><h3>Disease Burden</h3><p>Top diagnoses and conditions</p></a>
      <a href="/clinic/analytics/financial" class="card" style="text-decoration:none;display:block"><h3>Financial Overview</h3><p>Income, expenses, projections</p></a>
    </div>
  `));
}));

app.get('/clinic/analytics/revenue', requireAuth, requireNotBanned, requireFeature('advanced_analytics'), analyticsLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const monthly = (await pool.query("SELECT DATE_TRUNC('month', created_at)::date as month, SUM(amount)::int as total, COUNT(*)::int as cnt FROM payments WHERE tenant_id=$1 AND status='successful' GROUP BY month ORDER BY month DESC LIMIT 12", [t])).rows;
  res.send(renderPage('Revenue Analytics', `
    <div class="card"><h2>Monthly Revenue</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Month</th><th>Transactions</th><th>Revenue</th></tr></thead>
      <tbody>${monthly.map(m => `<tr><td>${m.month}</td><td>${m.cnt}</td><td>${m.total?.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.get('/clinic/analytics/patient-flow', requireAuth, requireNotBanned, requireFeature('advanced_analytics'), analyticsLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const daily = (await pool.query("SELECT visit_date, COUNT(*)::int as visits FROM clinic_queue WHERE tenant_id=$1 AND visit_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY visit_date ORDER BY visit_date DESC", [t])).rows;
  res.send(renderPage('Patient Flow', `
    <div class="card"><h2>Daily Visits (Last 30 Days)</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Visits</th></tr></thead>
      <tbody>${daily.map(d => `<tr><td>${d.visit_date}</td><td>${d.visits}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.get('/clinic/analytics/disease-burden', requireAuth, requireNotBanned, requireFeature('advanced_analytics'), analyticsLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const topDiagnoses = (await pool.query("SELECT diagnosis, COUNT(*)::int as cnt FROM consultations WHERE tenant_id=$1 AND diagnosis IS NOT NULL AND diagnosis != '' GROUP BY diagnosis ORDER BY cnt DESC LIMIT 20", [t])).rows;
  res.send(renderPage('Disease Burden', `
    <div class="card"><h2>Top Diagnoses</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Diagnosis</th><th>Count</th></tr></thead>
      <tbody>${topDiagnoses.map(d => `<tr><td>${esc(d.diagnosis)}</td><td>${d.cnt}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.get('/clinic/analytics/financial', requireAuth, requireNotBanned, requireFeature('advanced_analytics'), analyticsLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [totalIncome, totalExpenses, netProfit] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(amount),0)::int FROM payments WHERE tenant_id=$1 AND status='successful'", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0)::int FROM expenses WHERE tenant_id=$1", [t]),
    pool.query("SELECT (SELECT COALESCE(SUM(amount),0) FROM payments WHERE tenant_id=$1 AND status='successful') - (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE tenant_id=$1) as net", [t])
  ]);
  res.send(renderPage('Financial Overview', `
    <div class="stats">
      <div class="stat-card"><h3>${totalIncome.rows[0]?.sum?.toLocaleString()||0}</h3><p>Total Income</p></div>
      <div class="stat-card"><h3>${totalExpenses.rows[0]?.sum?.toLocaleString()||0}</h3><p>Total Expenses</p></div>
      <div class="stat-card"><h3>${netProfit.rows[0]?.net?.toLocaleString()||0}</h3><p>Net Profit</p></div>
    </div>
  `));
}));

// --- REVENUE CYCLE ---
app.get('/clinic/revenue-cycle', requireAuth, requireNotBanned, requireFeature('revenue_cycle'), revenueLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const metrics = (await pool.query('SELECT * FROM revenue_cycle_metrics WHERE tenant_id=$1 ORDER BY period DESC LIMIT 12', [t])).rows;
  const denials = (await pool.query("SELECT * FROM claim_denials WHERE tenant_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 20", [t])).rows;
  res.send(renderPage('Revenue Cycle Management', `
    <div class="hero" style="background:linear-gradient(135deg,#0ea5e9,#2563eb)"><h1>Revenue Cycle</h1><p>Billing, claims, denials &amp; collections management</p></div>
    <div class="card"><h2>Monthly Metrics</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Period</th><th>Billed</th><th>Collected</th><th>Outstanding</th><th>Denial Rate</th><th>Claims</th></tr></thead>
      <tbody>${metrics.map(m => `<tr><td>${esc(m.period)}</td><td>${m.total_billed?.toLocaleString()}</td><td>${m.total_collected?.toLocaleString()}</td><td>${m.total_outstanding?.toLocaleString()}</td><td>${m.denial_rate}%</td><td>${m.claim_count}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card"><h2>Open Denials</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Patient</th><th>Insurer</th><th>Code</th><th>Reason</th><th>Amount</th></tr></thead>
      <tbody>${denials.map(d => `<tr><td>${esc(d.patient_name||'')}</td><td>${esc(d.insurer||'')}</td><td>${esc(d.denial_code||'')}</td><td>${esc(d.denial_reason||'')}</td><td>${d.amount?.toLocaleString()||'-'}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.get('/clinic/revenue-cycle/aging', requireAuth, requireNotBanned, requireFeature('revenue_cycle'), revenueLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const aging = (await pool.query("SELECT CASE WHEN age < 30 THEN '0-30 days' WHEN age < 60 THEN '31-60 days' WHEN age < 90 THEN '61-90 days' WHEN age < 120 THEN '91-120 days' ELSE '120+ days' END as bucket, COUNT(*)::int as cnt, SUM(amount)::int as total FROM (SELECT *, CURRENT_DATE - COALESCE(due_date, created_at::date) as age FROM invoices WHERE tenant_id=$1 AND status='unpaid') sub GROUP BY bucket ORDER BY bucket", [t])).rows;
  res.send(renderPage('Aging Report', `
    <div class="card"><h2>Accounts Receivable Aging</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Age Bucket</th><th>Invoices</th><th>Total Outstanding</th></tr></thead>
      <tbody>${aging.map(a => `<tr><td>${esc(a.bucket)}</td><td>${a.cnt}</td><td>${a.total?.toLocaleString()||0}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.get('/clinic/revenue-cycle/denials', requireAuth, requireNotBanned, requireFeature('revenue_cycle'), revenueLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [denials, byReason] = await Promise.all([
    pool.query('SELECT * FROM claim_denials WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t]),
    pool.query("SELECT denial_reason, COUNT(*)::int as cnt, SUM(amount)::int as total FROM claim_denials WHERE tenant_id=$1 GROUP BY denial_reason ORDER BY cnt DESC LIMIT 10", [t])
  ]);
  res.send(renderPage('Denial Management', `
    <div class="card"><h2>Denials by Reason</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Reason</th><th>Count</th><th>Total Amount</th></tr></thead><tbody>${byReason.rows.map(r => `<tr><td>${esc(r.denial_reason||'Unknown')}</td><td>${r.cnt}</td><td>${r.total?.toLocaleString()||0}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>All Denials</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Patient</th><th>Insurer</th><th>Code</th><th>Reason</th><th>Amount</th><th>Status</th></tr></thead><tbody>${denials.rows.map(d => `<tr><td>${esc(d.patient_name||'')}</td><td>${esc(d.insurer||'')}</td><td>${esc(d.denial_code||'')}</td><td>${esc(d.denial_reason||'')}</td><td>${d.amount?.toLocaleString()||'-'}</td><td><span class="badge badge-${d.status==='resolved'?'green':'red'}">${esc(d.status)}</span></td></tr>`).join('')}</tbody></table></div></div>
  `));
}));

app.get('/clinic/revenue-cycle/collections', requireAuth, requireNotBanned, requireFeature('revenue_cycle'), revenueLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const outstanding = (await pool.query("SELECT i.*, t.name as tenant_name FROM invoices i JOIN tenants t ON t.id=i.tenant_id WHERE i.tenant_id=$1 AND i.status='unpaid' ORDER BY i.due_date ASC LIMIT 30", [t])).rows;
  res.send(renderPage('Collections', `
    <div class="card"><h2>Outstanding Invoices</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Invoice #</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Days Overdue</th></tr></thead>
      <tbody>${outstanding.map(i => { const overdue = Math.max(0, Math.floor((Date.now() - new Date(i.due_date)) / 86400000)); return `<tr><td>${esc(i.invoice_no)}</td><td>${esc(i.customer_name||'')}</td><td>${i.amount?.toLocaleString()}</td><td>${i.due_date}</td><td style="color:${overdue>60?'#dc2626':overdue>30?'#f59e0b':'inherit'}">${overdue} days</td></tr>`; }).join('')}</tbody></table></div>
    </div>
  `));
}));

// --- COMPLIANCE AUDIT ---
app.get('/clinic/compliance', requireAuth, requireNotBanned, requireFeature('compliance_audit'), complianceLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const logs = (await pool.query('SELECT * FROM compliance_audit_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  const [highRisk, thisMonth] = await Promise.all([
    pool.query("SELECT COUNT(*)::int FROM compliance_audit_log WHERE tenant_id=$1 AND risk_level='high'", [t]),
    pool.query("SELECT COUNT(*)::int FROM compliance_audit_log WHERE tenant_id=$1 AND created_at >= DATE_TRUNC('month', CURRENT_DATE)", [t])
  ]);
  res.send(renderPage('Compliance Audit', `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#b91c1c)"><h1>Compliance Audit</h1><p>Regulatory compliance tracking and audit trail</p></div>
    <div class="stats">
      <div class="stat-card"><h3>${thisMonth.rows[0]?.count||0}</h3><p>This Month</p></div>
      <div class="stat-card"><h3>${highRisk.rows[0]?.count||0}</h3><p>High Risk</p></div>
    </div>
    <div class="card"><h2>Audit Log</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Action</th><th>Performed By</th><th>Risk Level</th></tr></thead>
      <tbody>${logs.map(l => `<tr><td>${l.created_at?.toLocaleString()}</td><td>${esc(l.category)}</td><td>${esc(l.action)}</td><td>${esc(l.performed_by||'')}</td><td><span class="badge badge-${l.risk_level==='high'?'red':l.risk_level==='medium'?'orange':'green'}">${esc(l.risk_level)}</span></td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.get('/clinic/compliance/search', requireAuth, requireNotBanned, requireFeature('compliance_audit'), complianceLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const q = req.query.q || '';
  const results = q ? (await pool.query("SELECT * FROM compliance_audit_log WHERE tenant_id=$1 AND (action ILIKE $2 OR category ILIKE $2 OR details ILIKE $2 OR performed_by ILIKE $2) ORDER BY created_at DESC LIMIT 50", [t, `%${q}%`])).rows : [];
  res.send(renderPage('Compliance Search', `
    <div class="card"><h2>Search Audit Log</h2>
      <form method="GET" class="form-grid"><div class="full-width"><input name="q" value="${esc(q)}" placeholder="Search actions, categories, details..." style="width:100%;padding:10px"></div><div class="full-width"><button class="btn btn-primary" type="submit">Search</button></div></form>
    </div>
    ${q ? `<div class="card"><p>${results.length} result(s) for "${esc(q)}"</p><div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Category</th><th>Action</th><th>Details</th></tr></thead><tbody>${results.map(r => `<tr><td>${r.created_at?.toLocaleString()}</td><td>${esc(r.category)}</td><td>${esc(r.action)}</td><td>${esc(r.details?.substring(0,100)||'')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  `));
}));

app.get('/clinic/compliance/report', requireAuth, requireNotBanned, requireFeature('compliance_audit'), complianceLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [byCategory, byRisk, byPerformer] = await Promise.all([
    pool.query("SELECT category, COUNT(*)::int as cnt FROM compliance_audit_log WHERE tenant_id=$1 GROUP BY category ORDER BY cnt DESC", [t]),
    pool.query("SELECT risk_level, COUNT(*)::int as cnt FROM compliance_audit_log WHERE tenant_id=$1 GROUP BY risk_level ORDER BY cnt DESC", [t]),
    pool.query("SELECT performed_by, COUNT(*)::int as cnt FROM compliance_audit_log WHERE tenant_id=$1 AND performed_by IS NOT NULL GROUP BY performed_by ORDER BY cnt DESC LIMIT 10", [t])
  ]);
  res.send(renderPage('Compliance Report', `
    <div class="card"><h2>By Category</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>${byCategory.rows.map(r => `<tr><td>${esc(r.category)}</td><td>${r.cnt}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>By Risk Level</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>Level</th><th>Count</th></tr></thead><tbody>${byRisk.rows.map(r => `<tr><td><span class="badge badge-${r.risk_level==='high'?'red':r.risk_level==='medium'?'orange':'green'}">${esc(r.risk_level)}</span></td><td>${r.cnt}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>Top Performers</h2><div style="overflow-x:auto"><table class="table"><thead><tr><th>User</th><th>Actions</th></tr></thead><tbody>${byPerformer.rows.map(r => `<tr><td>${esc(r.performed_by)}</td><td>${r.cnt}</td></tr>`).join('')}</tbody></table></div></div>
  `));
}));

// --- MOBILE API ---
app.post('/api/mobile/login', ah(async (req, res) => {
  const { email, password, device_id, platform } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = (await pool.query('SELECT u.*, t.approved as tenant_approved FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=$1', [email])).rows[0];
  if (!user || !user.tenant_approved) return res.status(401).json({ error: 'Invalid credentials' });
  const hash = user.password_hash || user.password;
  if (!hash) return res.status(401).json({ error: 'Account not set up' });
  const bcrypt = require('bcrypt');
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = require('crypto').randomBytes(32).toString('hex');
  await pool.query('INSERT INTO mobile_tokens (tenant_id,user_id,device_id,token,platform) VALUES ($1,$2,$3,$4,$5)', [user.tenant_id, user.id, device_id||'unknown', token, platform||'unknown']);
  await pool.query('INSERT INTO mobile_devices (tenant_id,user_id,device_name,device_type,os_version,app_version,last_login) VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING', [user.tenant_id, user.id, req.headers['user-agent']?.substring(0,100), platform||'mobile', '', '']);
  res.json({ token, user: { id: user.id, name: user.name || user.email, email: user.email, role: user.role, tenant_id: user.tenant_id } });
}));

app.get('/api/mobile/profile', ah(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token required' });
  const token = authHeader.replace('Bearer ', '');
  const mt = (await pool.query('SELECT mt.*, u.email, u.role FROM mobile_tokens mt JOIN users u ON u.id=mt.user_id WHERE mt.token=$1 AND mt.is_active=true', [token])).rows[0];
  if (!mt) return res.status(401).json({ error: 'Invalid token' });
  res.json({ id: mt.user_id, email: mt.email, role: mt.role, tenant_id: mt.tenant_id });
}));

app.get('/api/mobile/appointments', ah(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token required' });
  const token = authHeader.replace('Bearer ', '');
  const mt = (await pool.query('SELECT * FROM mobile_tokens WHERE token=$1 AND is_active=true', [token])).rows[0];
  if (!mt) return res.status(401).json({ error: 'Invalid token' });
  const appts = (await pool.query('SELECT * FROM clinic_appointments WHERE tenant_id=$1 AND patient_id=$2 ORDER BY appointment_date DESC LIMIT 20', [mt.tenant_id, mt.user_id])).rows;
  res.json({ appointments: appts });
}));

app.get('/api/mobile/vitals', ah(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token required' });
  const token = authHeader.replace('Bearer ', '');
  const mt = (await pool.query('SELECT * FROM mobile_tokens WHERE token=$1 AND is_active=true', [token])).rows[0];
  if (!mt) return res.status(401).json({ error: 'Invalid token' });
  const vitals = (await pool.query('SELECT * FROM patient_vitals WHERE tenant_id=$1 AND patient_id=$2 ORDER BY recorded_at DESC LIMIT 20', [mt.tenant_id, mt.user_id])).rows;
  res.json({ vitals });
}));

app.get('/api/mobile/prescriptions', ah(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token required' });
  const token = authHeader.replace('Bearer ', '');
  const mt = (await pool.query('SELECT * FROM mobile_tokens WHERE token=$1 AND is_active=true', [token])).rows[0];
  if (!mt) return res.status(401).json({ error: 'Invalid token' });
  const rxs = (await pool.query('SELECT id, rx_number, medications, diagnosis, status, issued_at FROM electronic_prescriptions WHERE tenant_id=$1 AND patient_id=$2 ORDER BY issued_at DESC LIMIT 20', [mt.tenant_id, mt.user_id])).rows;
  res.json({ prescriptions: rxs });
}));

app.get('/api/mobile/notifications', ah(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token required' });
  const token = authHeader.replace('Bearer ', '');
  const mt = (await pool.query('SELECT * FROM mobile_tokens WHERE token=$1 AND is_active=true', [token])).rows[0];
  if (!mt) return res.status(401).json({ error: 'Invalid token' });
  const user = (await pool.query('SELECT email FROM users WHERE id=$1', [mt.user_id])).rows[0];
  const notifs = (await pool.query('SELECT * FROM notification_history WHERE tenant_id=$1 AND recipient=$2 ORDER BY sent_at DESC LIMIT 20', [mt.tenant_id, user?.email])).rows;
  res.json({ notifications: notifs });
}));

// --- DATA EXPORT ---
app.get('/clinic/export', requireAuth, requireNotBanned, requireFeature('data_export'), exportLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const jobs = (await pool.query('SELECT * FROM export_jobs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 20', [t])).rows;
  res.send(renderPage('Data Export', `
    <div class="hero" style="background:linear-gradient(135deg,#0f172a,#334155)"><h1>Data Export</h1><p>Export your data in CSV, Excel or JSON format</p></div>
    <div class="card"><h2>New Export</h2>
      <form method="POST" action="/clinic/export/start" class="form-grid">
        <div><label>Data Type</label><select name="export_type"><option value="patients">Patients</option><option value="appointments">Appointments</option><option value="lab_results">Lab Results</option><option value="prescriptions">Prescriptions</option><option value="financial">Financial</option><option value="inventory">Inventory</option></select></div>
        <div><label>Format</label><select name="format"><option value="csv">CSV</option><option value="json">JSON</option></select></div>
        <div class="full-width"><button class="btn btn-primary" type="submit">Start Export</button></div>
      </form>
    </div>
    <div class="card"><h2>Export History</h2>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Type</th><th>Format</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead>
      <tbody>${jobs.map(j => `<tr><td>${esc(j.export_type)}</td><td>${esc(j.format)}</td><td><span class="badge badge-${j.status==='completed'?'green':j.status==='failed'?'red':'orange'}">${esc(j.status)}</span></td><td>${j.started_at?.toLocaleString()}</td><td>${j.completed_at?.toLocaleString()||'-'}</td></tr>`).join('')}</tbody></table></div>
    </div>
  `));
}));

app.post('/clinic/export/start', requireAuth, requireNotBanned, requireFeature('data_export'), exportLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { export_type, format } = req.body;
  const job = (await pool.query('INSERT INTO export_jobs (tenant_id,export_type,format,started_by,status) VALUES ($1,$2,$3,$4,$5) RETURNING id', [t, export_type, format||'csv', req.session.user.email, 'pending'])).rows[0];
  // Process export in background
  (async () => {
    try {
      let data;
      const tableMap = { patients: 'patients', appointments: 'clinic_appointments', lab_results: 'lab_results', prescriptions: 'electronic_prescriptions', financial: 'payments', inventory: 'pharmacy_inventory' };
      const table = tableMap[export_type] || 'patients';
      data = (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1 LIMIT 10000`, [t])).rows;
      await pool.query("UPDATE export_jobs SET status='completed', file_size=$1, completed_at=NOW(), details=$2 WHERE id=$3", [JSON.stringify(data).length, `${data.length} records`, job.id]);
    } catch(e) {
      await pool.query("UPDATE export_jobs SET status='failed', error_message=$1 WHERE id=$2", [e.message, job.id]);
    }
  })();
  await audit(req.session.user.email, 'export_started', { export_type, format, job_id: job.id });
  res.redirect('/clinic/export');
}));

app.get('/api/health/export/patients', requireAuth, requireNotBanned, requireFeature('data_export'), exportLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const patients = (await pool.query('SELECT id, name, phone, email, gender, dob, address, created_at FROM patients WHERE tenant_id=$1 ORDER BY name LIMIT 10000', [t])).rows;
  const format = req.query.format || 'csv';
  if (format === 'json') return res.json({ patients, exported_at: new Date().toISOString(), count: patients.length });
  // CSV
  const headers = Object.keys(patients[0] || {}).join(',');
  const rows = patients.map(p => Object.values(p).map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=patients_export.csv');
  res.send([headers, ...rows].join('\n'));
}));

app.get('/api/health/export/financial', requireAuth, requireNotBanned, requireFeature('data_export'), exportLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const payments = (await pool.query('SELECT id, amount, method, reference, status, description, created_at FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10000', [t])).rows;
  const format = req.query.format || 'csv';
  if (format === 'json') return res.json({ payments, exported_at: new Date().toISOString(), count: payments.length });
  const headers = Object.keys(payments[0] || {}).join(',');
  const rows = payments.map(p => Object.values(p).map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=financial_export.csv');
  res.send([headers, ...rows].join('\n'));
}));

app.get('/api/health/export/clinical', requireAuth, requireNotBanned, requireFeature('data_export'), exportLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const consultations = (await pool.query('SELECT id, patient_id, diagnosis, treatment, notes, date FROM consultations WHERE tenant_id=$1 ORDER BY date DESC LIMIT 10000', [t])).rows;
  const format = req.query.format || 'csv';
  if (format === 'json') return res.json({ consultations, exported_at: new Date().toISOString(), count: consultations.length });
  const headers = Object.keys(consultations[0] || {}).join(',');
  const rows = consultations.map(c => Object.values(c).map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=clinical_export.csv');
  res.send([headers, ...rows].join('\n'));
}));

app.get('/api/health/export/inventory', requireAuth, requireNotBanned, requireFeature('data_export'), exportLimiter, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT id, medicine_name, category, unit, unit_price, quantity_in_stock, expiry_date, supplier FROM pharmacy_inventory WHERE tenant_id=$1 ORDER BY medicine_name LIMIT 10000', [t])).rows;
  const format = req.query.format || 'csv';
  if (format === 'json') return res.json({ inventory: items, exported_at: new Date().toISOString(), count: items.length });
  const headers = Object.keys(items[0] || {}).join(',');
  const rows = items.map(i => Object.values(i).map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory_export.csv');
  res.send([headers, ...rows].join('\n'));
}));

console.log('[v14-v17] All v14-v17+ routes loaded successfully');
