module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS health_screenings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        screening_type VARCHAR(100) NOT NULL, results JSONB DEFAULT '{}',
        risk_level VARCHAR(20) DEFAULT 'low', recommendations TEXT,
        screened_by INTEGER, date DATE DEFAULT CURRENT_DATE
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS health_records (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        blood_type VARCHAR(10), allergies JSONB DEFAULT '[]',
        conditions JSONB DEFAULT '[]', medications JSONB DEFAULT '[]',
        emergency_contacts JSONB DEFAULT '[]'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS vaccinations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        vaccine_name VARCHAR(200) NOT NULL, dose_number INTEGER DEFAULT 1,
        date_administered DATE DEFAULT CURRENT_DATE, next_due DATE,
        administered_by VARCHAR(200)
      )`);
      console.log('[school-health-ai] OK');
    } catch(e) { console.warn('[school-health-ai] Warn:', e.message); }
  })();

  // Helper: AI symptom checker scoring
  function aiSymptomScore(symptoms) {
    const severityMap = { mild: 1, moderate: 2, severe: 3, critical: 4 };
    if (!symptoms || !Array.isArray(symptoms)) return { score: 0, risk: 'low', color: '#22c55e' };
    let total = 0;
    symptoms.forEach(s => { total += (severityMap[s.severity] || 1); });
    const avg = total / symptoms.length;
    if (avg >= 3.5) return { score: Math.round(avg * 25), risk: 'critical', color: '#ef4444' };
    if (avg >= 2.5) return { score: Math.round(avg * 25), risk: 'high', color: '#f97316' };
    if (avg >= 1.5) return { score: Math.round(avg * 25), risk: 'moderate', color: '#eab308' };
    return { score: Math.round(avg * 25), risk: 'low', color: '#22c55e' };
  }

  // Helper: BMI calculation
  function calcBMI(heightCm, weightKg) {
    if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
    const h = heightCm / 100;
    const bmi = weightKg / (h * h);
    let cat = 'Normal';
    if (bmi < 18.5) cat = 'Underweight';
    else if (bmi >= 25 && bmi < 30) cat = 'Overweight';
    else if (bmi >= 30) cat = 'Obese';
    return { bmi: Math.round(bmi * 10) / 10, category: cat, color: cat === 'Normal' ? '#22c55e' : cat === 'Underweight' ? '#3b82f6' : '#f97316' };
  }

  // Helper: build SVG bar chart
  function svgBarChart(data, width, height, label) {
    if (!data.length) return '<p style="color:' + GRAY + '">No data available</p>';
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.max(20, (width - 60) / data.length - 10);
    let bars = '';
    data.forEach((d, i) => {
      const h = (d.value / max) * (height - 50);
      const x = 40 + i * (barW + 10);
      bars += `<rect x="${x}" y="${height - 30 - h}" width="${barW}" height="${h}" fill="${d.color || P}" rx="4"/>`;
      bars += `<text x="${x + barW/2}" y="${height - 12}" text-anchor="middle" font-size="10" fill="${GRAY}">${esc(d.label).substring(0,8)}</text>`;
      bars += `<text x="${x + barW/2}" y="${height - 35 - h}" text-anchor="middle" font-size="10" fill="${GRAY}">${d.value}</text>`;
    });
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>${bars}</svg>`;
  }

  // Helper: build SVG donut chart
  function svgDonut(data, size, label) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let offset = 0;
    let arcs = '';
    const r = size / 2 - 20, cx = size / 2, cy = size / 2 + 10;
    data.forEach(d => {
      const pct = d.value / total;
      const circ = 2 * Math.PI * r;
      const dash = pct * circ;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="28" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash;
    });
    let legend = '';
    data.forEach(d => {
      const pct = Math.round((d.value / total) * 100);
      legend += `<span style="display:inline-flex;align-items:center;margin-right:12px;font-size:12px"><span style="width:10px;height:10px;border-radius:50%;background:${d.color};display:inline-block;margin-right:4px"></span>${esc(d.label)} (${pct}%)</span>`;
    });
    return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cx}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="20" font-weight="bold" fill="${P}">${total}</text>
      ${arcs}</svg><div style="text-align:center;margin-top:4px">${legend}</div>`;
  }

  // ===== ROUTE 1: Dashboard =====
  app.get('/school/health-ai', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [screenings] = await pool.query(
        'SELECT screening_type, risk_level, COUNT(*)::int as cnt FROM health_screenings WHERE tenant_id=? GROUP BY screening_type, risk_level ORDER BY screening_type', [tid]);
      const [vacc] = await pool.query(
        'SELECT COUNT(*)::int as total FROM vaccinations WHERE tenant_id=?', [tid]);
      const [recs] = await pool.query(
        'SELECT COUNT(*)::int as total FROM health_records WHERE tenant_id=?', [tid]);
      const [dueVacc] = await pool.query(
        'SELECT COUNT(*)::int as cnt FROM vaccinations WHERE tenant_id=? AND next_due <= CURRENT_DATE', [tid]);

      const riskDist = {};
      screenings.forEach(r => { riskDist[r.risk_level] = (riskDist[r.risk_level] || 0) + r.cnt; });
      const donutData = [
        { label: 'Low', value: riskDist['low'] || 0, color: '#22c55e' },
        { label: 'Moderate', value: riskDist['moderate'] || 0, color: '#eab308' },
        { label: 'High', value: riskDist['high'] || 0, color: '#f97316' },
        { label: 'Critical', value: riskDist['critical'] || 0, color: '#ef4444' }
      ];

      const typeData = [];
      const typeMap = {};
      screenings.forEach(r => {
        typeMap[r.screening_type] = (typeMap[r.screening_type] || 0) + r.cnt;
      });
      Object.keys(typeMap).forEach(k => typeData.push({ label: k, value: typeMap[k], color: P }));

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Health AI Dashboard</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🏥 Health AI Dashboard</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:28px;font-weight:bold;color:${P}">${vacc[0].total}</div><div style="color:${GRAY}">Vaccinations</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:28px;font-weight:bold;color:#22c55e">${recs[0].total}</div><div style="color:${GRAY}">Health Records</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:28px;font-weight:bold;color:#f97316">${screenings.length}</div><div style="color:${GRAY}">Screening Types</div></div>
          <div class="card" style="border-left:4px solid #ef4444"><div style="font-size:28px;font-weight:bold;color:#ef4444">${dueVacc[0].cnt}</div><div style="color:${GRAY}">Vaccines Due</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgDonut(donutData, 320, 'Risk Distribution')}</div>
          <div class="card">${svgBarChart(typeData, 500, 220, 'Screenings by Type')}</div>
        </div>
        <div class="card" style="margin-top:16px">
          <a href="/school/health-ai/symptom-checker" class="btn" style="margin-right:8px">🩺 Symptom Checker</a>
          <a href="/school/health-ai/screenings" class="btn" style="margin-right:8px">📋 Screenings</a>
          <a href="/school/health-ai/records" class="btn" style="margin-right:8px">📁 Health Records</a>
          <a href="/school/health-ai/vaccinations" class="btn" style="margin-right:8px">💉 Vaccinations</a>
          <a href="/school/health-ai/bmi-tracker" class="btn" style="margin-right:8px">⚖️ BMI Tracker</a>
          <a href="/school/health-ai/reports" class="btn">📊 Reports</a>
        </div>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 2: Symptom Checker =====
  app.get('/school/health-ai/symptom-checker', requireAuth, requireNotBanned, async (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>AI Symptom Checker</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🩺 AI Symptom Checker</h2>
      <div class="card">
        <p style="color:${GRAY};margin-bottom:12px">Enter symptoms to assess health risk. This is an AI-assisted preliminary check — always consult a medical professional.</p>
        <div id="symptoms"></div>
        <button class="btn" onclick="addSymptom()" style="margin:12px 0">+ Add Symptom</button>
        <div style="margin-bottom:12px">
          <label style="font-weight:bold">Student (ID):</label>
          <input type="number" id="studentId" placeholder="Student ID" style="max-width:200px">
        </div>
        <button class="btn" onclick="analyzeSymptoms()" style="background:#059669">🔍 Analyze Symptoms</button>
        <div id="result" style="margin-top:16px"></div>
      </div>
      <script>
        let symCount = 0;
        function addSymptom() {
          const d = document.createElement('div');
          d.className = 'sym-row';
          d.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
          d.innerHTML = '<input placeholder="Symptom name" class="sym-name" style="flex:2"><select class="sym-sev" style="flex:1"><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="critical">Critical</option></select><button class="btn" style="background:#ef4444;padding:6px 10px" onclick="this.parentElement.remove()">✕</button>';
          document.getElementById('symptoms').appendChild(d);
          symCount++;
        }
        addSymptom();
        function analyzeSymptoms() {
          const rows = document.querySelectorAll('.sym-row');
          const symptoms = [];
          rows.forEach(r => {
            const name = r.querySelector('.sym-name').value.trim();
            const sev = r.querySelector('.sym-sev').value;
            if (name) symptoms.push({ name, severity: sev });
          });
          if (!symptoms.length) { alert('Please add at least one symptom'); return; }
          fetch('/school/health-ai/api/symptom-check', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ symptoms, student_id: document.getElementById('studentId').value })
          }).then(r => r.json()).then(data => {
            const colors = { low:'#22c55e', moderate:'#eab308', high:'#f97316', critical:'#ef4444' };
            const icons = { low:'✅', moderate:'⚠️', high:'🔶', critical:'🚨' };
            document.getElementById('result').innerHTML = '<div class="card" style="border-left:4px solid ' + colors[data.risk] + '">' +
              '<h3>' + icons[data.risk] + ' Risk Level: ' + data.risk.toUpperCase() + '</h3>' +
              '<p>Health Score: <strong>' + data.score + '/100</strong></p>' +
              '<p style="margin-top:8px">' + data.recommendation + '</p>' +
              (data.advice ? '<ul style="margin-top:8px">' + data.advice.map(a => '<li>' + a + '</li>').join('') + '</ul>' : '') +
              '</div>';
          });
        }
      </script></body></html>`;
    res.send(html);
  });

  // ===== ROUTE 3: API Symptom Check =====
  app.post('/school/health-ai/api/symptom-check', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { symptoms, student_id } = req.body;
    const tid = req.user.tenant_id;
    if (!symptoms || !Array.isArray(symptoms) || !symptoms.length) {
      return res.status(400).json({ error: 'Provide symptoms array' });
    }
    const analysis = aiSymptomScore(symptoms);
    const recommendations = {
      low: 'Student appears to be in good health. Continue monitoring symptoms.',
      moderate: 'Consider a follow-up check in 24-48 hours. Monitor symptoms closely.',
      high: 'Recommend consulting the school nurse or a healthcare provider promptly.',
      critical: 'URGENT: Immediate medical attention recommended. Contact parents/guardians.'
    };
    const adviceMap = {
      low: ['Ensure adequate hydration', 'Encourage regular rest breaks', 'Monitor for changes'],
      moderate: ['Schedule nurse visit', 'Reduce physical activity', 'Keep parents informed', 'Monitor temperature'],
      high: ['Refer to school nurse immediately', 'Contact parents', 'Consider early pickup', 'Document symptoms'],
      critical: ['Call emergency contacts immediately', 'Do not administer medication without authorization', 'Keep student comfortable', 'Prepare incident report']
    };
    const rec = recommendations[analysis.risk];
    const advice = adviceMap[analysis.risk];
    if (student_id) {
      await pool.query(
        'INSERT INTO health_screenings (tenant_id, student_id, screening_type, results, risk_level, recommendations, screened_by, date) VALUES (?,?,\'symptom_check\',?,?,?,1,CURRENT_DATE)',
        [tid, student_id, JSON.stringify(symptoms), analysis.risk, rec]);
      if (analysis.risk === 'high' || analysis.risk === 'critical') {
        audit(req, 'health_screening_alert', { student_id, risk: analysis.risk, symptoms });
      }
    }
    res.json({ score: analysis.score, risk: analysis.risk, color: analysis.color, recommendation: rec, advice });
  }));

  // ===== ROUTE 4: Screenings List =====
  app.get('/school/health-ai/screenings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT s.*, u.name as screener_name FROM health_screenings s LEFT JOIN users u ON s.screened_by=u.id WHERE s.tenant_id=? ORDER BY s.date DESC LIMIT 100', [tid]);
      const riskBadge = (r) => {
        const c = { low:'#22c55e', moderate:'#eab308', high:'#f97316', critical:'#ef4444' };
        return `<span style="background:${c[r]||GRAY};color:#fff;padding:2px 8px;border-radius:12px;font-size:12px">${r||'low'}</span>`;
      };
      let rows = list.map(s => `<tr>
        <td>${s.id}</td><td>${s.student_id}</td><td>${esc(s.screening_type)}</td>
        <td>${riskBadge(s.risk_level)}</td><td>${s.date?.toISOString().split('T')[0]}</td>
        <td>${esc((s.screener_name||'').substring(0,20))}</td>
        <td><a href="/school/health-ai/screenings/${s.id}" class="btn" style="padding:4px 8px;font-size:12px">View</a></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Health Screenings</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Health Screenings</h2>
        <a href="/school/health-ai/screenings/new" class="btn" style="margin-bottom:16px;display:inline-block">+ New Screening</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Type</th><th>Risk</th><th>Date</th><th>By</th><th>Action</th></tr>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No screenings found</td></tr>'}
        </table></div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 5: New Screening Form =====
  app.get('/school/health-ai/screenings/new', requireAuth, requireNotBanned, async (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Health Screening</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">📋 New Health Screening</h2>
      <div class="card">
        <form method="POST" action="/school/health-ai/screenings/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Screening Type *</label>
              <select name="screening_type" required>
                <option value="general">General Checkup</option>
                <option value="vision">Vision Screening</option>
                <option value="hearing">Hearing Screening</option>
                <option value="dental">Dental Check</option>
                <option value="bmi">BMI Assessment</option>
                <option value="blood_pressure">Blood Pressure</option>
                <option value="mental_health">Mental Health</option>
                <option value="scoliosis">Scoliosis Check</option>
              </select>
            </div>
            <div><label>Height (cm)</label><input type="number" name="height" step="0.1"></div>
            <div><label>Weight (kg)</label><input type="number" name="weight" step="0.1"></div>
            <div><label>Vision Left (20/)</label><input type="text" name="vision_left"></div>
            <div><label>Vision Right (20/)</label><input type="text" name="vision_right"></div>
          </div>
          <div style="margin-top:12px">
            <label>Risk Level</label>
            <select name="risk_level">
              <option value="low">Low</option><option value="moderate">Moderate</option>
              <option value="high">High</option><option value="critical">Critical</option>
            </select>
          </div>
          <div style="margin-top:12px"><label>Recommendations</label>
            <textarea name="recommendations" rows="3"></textarea></div>
          <div style="margin-top:12px"><label>Additional Notes (JSON)</label>
            <textarea name="results_json" rows="2" placeholder='{"key":"value"}'></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px">Save Screening</button>
        </form>
      </div>
      <a href="/school/health-ai/screenings" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  // ===== ROUTE 6: Save New Screening =====
  app.post('/school/health-ai/screenings/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, screening_type, height, weight, vision_left, vision_right, risk_level, recommendations, results_json } = req.body;
    if (!student_id || !screening_type) return res.status(400).send('Student ID and type required');
    let results = {};
    if (height) results.height = parseFloat(height);
    if (weight) results.weight = parseFloat(weight);
    if (vision_left) results.vision_left = vision_left;
    if (vision_right) results.vision_right = vision_right;
    if (results_json) { try { Object.assign(results, JSON.parse(results_json)); } catch(e) {} }
    const bmi = calcBMI(results.height, results.weight);
    if (bmi) results.bmi = bmi;
    await pool.query(
      'INSERT INTO health_screenings (tenant_id, student_id, screening_type, results, risk_level, recommendations, screened_by, date) VALUES (?,?,?,?,?,?,?,CURRENT_DATE)',
      [tid, parseInt(student_id), screening_type, JSON.stringify(results), risk_level || 'low', recommendations || '', req.user.id]);
    audit(req, 'health_screening_created', { student_id, screening_type, risk_level });
    res.redirect('/school/health-ai/screenings');
  }));

  // ===== ROUTE 7: View Screening =====
  app.get('/school/health-ai/screenings/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM health_screenings WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
      if (!rows.length) return res.status(404).send('Not found');
      const s = rows[0];
      const results = typeof s.results === 'string' ? JSON.parse(s.results) : (s.results || {});
      let resultHtml = Object.entries(results).map(([k, v]) => {
        if (typeof v === 'object' && v !== null) return `<div><strong>${esc(k)}:</strong> <code>${esc(JSON.stringify(v))}</code></div>`;
        return `<div><strong>${esc(k)}:</strong> ${esc(String(v))}</div>`;
      }).join('');
      const riskBadge = { low:'#22c55e', moderate:'#eab308', high:'#f97316', critical:'#ef4444' };
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Screening #${s.id}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Screening #${s.id}</h2>
        <div class="card" style="border-left:4px solid ${riskBadge[s.risk_level]||GRAY}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div><strong>Student:</strong> #${s.student_id}</div>
            <div><strong>Type:</strong> ${esc(s.screening_type)}</div>
            <div><strong>Date:</strong> ${s.date?.toISOString().split('T')[0]}</div>
            <div><strong>Risk:</strong> <span style="color:${riskBadge[s.risk_level]||GRAY};font-weight:bold">${s.risk_level}</span></div>
          </div>
          <div style="margin-top:12px"><h4>Results</h4>${resultHtml}</div>
          <div style="margin-top:12px"><h4>Recommendations</h4><p>${esc(s.recommendations || 'None')}</p></div>
        </div>
        <a href="/school/health-ai/screenings" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 8: Health Records =====
  app.get('/school/health-ai/records', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM health_records WHERE tenant_id=? ORDER BY id DESC LIMIT 100', [tid]);
      let rows = list.map(r => {
        const allergies = typeof r.allergies === 'string' ? JSON.parse(r.allergies) : (r.allergies || []);
        const meds = typeof r.medications === 'string' ? JSON.parse(r.medications) : (r.medications || []);
        return `<tr>
          <td>${r.id}</td><td>#${r.student_id}</td>
          <td>${esc(r.blood_type || 'N/A')}</td>
          <td>${allergies.map(a => typeof a === 'string' ? a : a.name).join(', ') || 'None'}</td>
          <td>${meds.length} medications</td>
          <td><a href="/school/health-ai/records/${r.id}/edit" class="btn" style="padding:4px 8px;font-size:12px">Edit</a></td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Health Records</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📁 Health Records</h2>
        <a href="/school/health-ai/records/new" class="btn" style="margin-bottom:16px;display:inline-block">+ New Record</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Blood Type</th><th>Allergies</th><th>Medications</th><th>Action</th></tr>
          ${rows || '<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No records found</td></tr>'}
        </table></div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 9: New Health Record =====
  app.get('/school/health-ai/records/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Health Record</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">📁 New Health Record</h2>
      <div class="card">
        <form method="POST" action="/school/health-ai/records/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Blood Type</label>
              <select name="blood_type">
                <option value="">Unknown</option><option value="A+">A+</option><option value="A-">A-</option>
                <option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option>
                <option value="AB-">AB-</option><option value="O+">O+</option><option value="O-">O-</option>
              </select>
            </div>
          </div>
          <div style="margin-top:12px"><label>Allergies (one per line: name,severity)</label>
            <textarea name="allergies" rows="3" placeholder="Peanuts,severe\nLatex,mild"></textarea></div>
          <div style="margin-top:12px"><label>Medical Conditions (one per line)</label>
            <textarea name="conditions" rows="2" placeholder="Asthma\nDiabetes Type 1"></textarea></div>
          <div style="margin-top:12px"><label>Current Medications (one per line: name,dosage)</label>
            <textarea name="medications" rows="2" placeholder="Albuterol,2 puffs\nInsulin,10 units"></textarea></div>
          <div style="margin-top:12px"><label>Emergency Contacts (JSON array)</label>
            <textarea name="emergency_contacts" rows="2" placeholder='[{"name":"Mom","phone":"555-0100"}]'></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px">Save Record</button>
        </form>
      </div>
      <a href="/school/health-ai/records" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  // ===== ROUTE 10: Save Health Record =====
  app.post('/school/health-ai/records/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, blood_type, allergies, conditions, medications, emergency_contacts } = req.body;
    if (!student_id) return res.status(400).send('Student ID required');
    const parseLines = (str) => str ? str.split('\n').map(l => l.trim()).filter(Boolean) : [];
    const parseAllergies = (str) => str ? str.split('\n').map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { name: parts[0], severity: parts[1] || 'unknown' };
    }).filter(a => a.name) : [];
    const parseMeds = (str) => str ? str.split('\n').map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { name: parts[0], dosage: parts[1] || '' };
    }).filter(m => m.name) : [];
    let ec = [];
    if (emergency_contacts) { try { ec = JSON.parse(emergency_contacts); } catch(e) {} }
    await pool.query(
      'INSERT INTO health_records (tenant_id, student_id, blood_type, allergies, conditions, medications, emergency_contacts) VALUES (?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), blood_type || null, JSON.stringify(parseAllergies(allergies)), JSON.stringify(parseLines(conditions)), JSON.stringify(parseMeds(medications)), JSON.stringify(ec)]);
    audit(req, 'health_record_created', { student_id, blood_type });
    res.redirect('/school/health-ai/records');
  }));

  // ===== ROUTE 11: Edit Health Record =====
  app.get('/school/health-ai/records/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM health_records WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
      if (!rows.length) return res.status(404).send('Not found');
      const r = rows[0];
      const allergies = typeof r.allergies === 'string' ? JSON.parse(r.allergies) : (r.allergies || []);
      const conditions = typeof r.conditions === 'string' ? JSON.parse(r.conditions) : (r.conditions || []);
      const meds = typeof r.medications === 'string' ? JSON.parse(r.medications) : (r.medications || []);
      const ec = typeof r.emergency_contacts === 'string' ? JSON.parse(r.emergency_contacts) : (r.emergency_contacts || []);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Edit Health Record</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">✏️ Edit Health Record #${r.id}</h2>
        <div class="card">
          <form method="POST" action="/school/health-ai/records/${r.id}/edit">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Student ID</label><input type="number" name="student_id" value="${r.student_id}" readonly style="background:#f3f4f6"></div>
              <div><label>Blood Type</label>
                <select name="blood_type">
                  ${['','A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b => `<option value="${b}" ${r.blood_type===b?'selected':''}>${b||'Unknown'}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="margin-top:12px"><label>Allergies</label>
              <textarea name="allergies" rows="3">${allergies.map(a => typeof a === 'string' ? a : a.name + ',' + (a.severity||'')).join('\n')}</textarea></div>
            <div style="margin-top:12px"><label>Conditions</label>
              <textarea name="conditions" rows="2">${(Array.isArray(conditions) ? conditions : []).join('\n')}</textarea></div>
            <div style="margin-top:12px"><label>Medications</label>
              <textarea name="medications" rows="2">${meds.map(m => typeof m === 'string' ? m : m.name + ',' + (m.dosage||'')).join('\n')}</textarea></div>
            <div style="margin-top:12px"><label>Emergency Contacts (JSON)</label>
              <textarea name="emergency_contacts" rows="2">${esc(JSON.stringify(ec))}</textarea></div>
            <button type="submit" class="btn" style="margin-top:12px">Update Record</button>
          </form>
        </div>
        <a href="/school/health-ai/records" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.post('/school/health-ai/records/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { blood_type, allergies, conditions, medications, emergency_contacts } = req.body;
    const parseLines = (str) => str ? str.split('\n').map(l => l.trim()).filter(Boolean) : [];
    const parseAllergies = (str) => str ? str.split('\n').map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { name: parts[0], severity: parts[1] || 'unknown' };
    }).filter(a => a.name) : [];
    const parseMeds = (str) => str ? str.split('\n').map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { name: parts[0], dosage: parts[1] || '' };
    }).filter(m => m.name) : [];
    let ec = [];
    if (emergency_contacts) { try { ec = JSON.parse(emergency_contacts); } catch(e) {} }
    await pool.query(
      'UPDATE health_records SET blood_type=?, allergies=?, conditions=?, medications=?, emergency_contacts=? WHERE id=? AND tenant_id=?',
      [blood_type || null, JSON.stringify(parseAllergies(allergies)), JSON.stringify(parseLines(conditions)), JSON.stringify(parseMeds(medications)), JSON.stringify(ec), req.params.id, tid]);
    audit(req, 'health_record_updated', { id: req.params.id });
    res.redirect('/school/health-ai/records');
  }));

  // ===== ROUTE 12: Vaccinations =====
  app.get('/school/health-ai/vaccinations', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM vaccinations WHERE tenant_id=? ORDER BY date_administered DESC LIMIT 100', [tid]);
      const isOverdue = (d) => d && new Date(d) <= new Date();
      let rows = list.map(v => `<tr>
        <td>${v.id}</td><td>#${v.student_id}</td><td>${esc(v.vaccine_name)}</td>
        <td>${v.dose_number}</td><td>${v.date_administered?.toISOString().split('T')[0]}</td>
        <td>${v.next_due ? (isOverdue(v.next_due) ? '<span style="color:#ef4444;font-weight:bold">' + v.next_due.toISOString().split('T')[0] + ' ⚠️' : v.next_due.toISOString().split('T')[0]) : 'N/A'}</td>
        <td>${esc((v.administered_by||'').substring(0,20))}</td>
        <td><a href="/school/health-ai/vaccinations/${v.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Vaccinations</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">💉 Vaccination Records</h2>
        <a href="/school/health-ai/vaccinations/new" class="btn" style="margin-bottom:16px;display:inline-block">+ Add Vaccination</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Vaccine</th><th>Dose</th><th>Date</th><th>Next Due</th><th>By</th><th></th></tr>
          ${rows || '<tr><td colspan="8" style="text-align:center;color:'+GRAY+'">No vaccinations found</td></tr>'}
        </table></div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 13: Add Vaccination =====
  app.get('/school/health-ai/vaccinations/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Add Vaccination</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">💉 Add Vaccination</h2>
      <div class="card">
        <form method="POST" action="/school/health-ai/vaccinations/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Vaccine Name *</label><input name="vaccine_name" required placeholder="e.g., MMR, DPT, HPV"></div>
            <div><label>Dose Number</label><input type="number" name="dose_number" value="1" min="1"></div>
            <div><label>Date Administered</label><input type="date" name="date_administered"></div>
            <div><label>Next Due Date</label><input type="date" name="next_due"></div>
            <div><label>Administered By</label><input name="administered_by" placeholder="Clinic/Doctor name"></div>
          </div>
          <button type="submit" class="btn" style="margin-top:12px">Save Vaccination</button>
        </form>
      </div>
      <a href="/school/health-ai/vaccinations" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/health-ai/vaccinations/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, vaccine_name, dose_number, date_administered, next_due, administered_by } = req.body;
    if (!student_id || !vaccine_name) return res.status(400).send('Student ID and vaccine name required');
    await pool.query(
      'INSERT INTO vaccinations (tenant_id, student_id, vaccine_name, dose_number, date_administered, next_due, administered_by) VALUES (?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), vaccine_name, parseInt(dose_number) || 1, date_administered || null, next_due || null, administered_by || null]);
    audit(req, 'vaccination_added', { student_id, vaccine_name });
    res.redirect('/school/health-ai/vaccinations');
  }));

  app.get('/school/health-ai/vaccinations/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM vaccinations WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    audit(req, 'vaccination_deleted', { id: req.params.id });
    res.redirect('/school/health-ai/vaccinations');
  }));

  // ===== ROUTE 14: BMI Tracker =====
  app.get('/school/health-ai/bmi-tracker', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [records] = await pool.query(
        "SELECT student_id, results FROM health_screenings WHERE tenant_id=? AND screening_type='bmi' AND results::text LIKE '%height%' ORDER BY date DESC LIMIT 50", [tid]);
      const data = [];
      records.forEach(r => {
        const res2 = typeof r.results === 'string' ? JSON.parse(r.results) : (r.results || {});
        if (res2.bmi) data.push({ student_id: r.student_id, ...res2.bmi });
      });
      const catCounts = { Normal: 0, Underweight: 0, Overweight: 0, Obese: 0 };
      data.forEach(d => { catCounts[d.category] = (catCounts[d.category] || 0) + 1; });
      const donutData = [
        { label: 'Normal', value: catCounts.Normal, color: '#22c55e' },
        { label: 'Underweight', value: catCounts.Underweight, color: '#3b82f6' },
        { label: 'Overweight', value: catCounts.Overweight, color: '#f97316' },
        { label: 'Obese', value: catCounts.Obese, color: '#ef4444' }
      ];
      const barData = data.slice(0, 15).map(d => ({
        label: '#' + d.student_id, value: d.bmi, color: d.color
      }));
      let tableRows = data.map(d => `<tr>
        <td>#${d.student_id}</td><td>${d.bmi}</td>
        <td><span style="color:${d.color};font-weight:bold">${d.category}</span></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>BMI Tracker</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">⚖️ BMI Tracker</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgDonut(donutData, 300, 'BMI Distribution')}</div>
          <div class="card">${svgBarChart(barData, 500, 220, 'BMI by Student')}</div>
        </div>
        <div class="card" style="margin-top:16px;overflow-x:auto">
          <table><tr><th>Student</th><th>BMI</th><th>Category</th></tr>
          ${tableRows || '<tr><td colspan="3" style="text-align:center;color:'+GRAY+'">No BMI data yet. Add screenings with height/weight.</td></tr>'}
          </table>
        </div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 15: Reports =====
  app.get('/school/health-ai/reports', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [typeStats] = await pool.query(
        'SELECT screening_type, COUNT(*)::int as cnt, AVG(CASE WHEN risk_level=\'low\' THEN 0 WHEN risk_level=\'moderate\' THEN 1 WHEN risk_level=\'high\' THEN 2 ELSE 3 END)::numeric(3,1) as avg_risk FROM health_screenings WHERE tenant_id=? GROUP BY screening_type ORDER BY cnt DESC', [tid]);
      const [monthlyTrend] = await pool.query(
        "SELECT TO_CHAR(date,'YYYY-MM') as month, COUNT(*)::int as cnt FROM health_screenings WHERE tenant_id=? GROUP BY TO_CHAR(date,'YYYY-MM') ORDER BY month DESC LIMIT 12", [tid]);
      const [vaccStats] = await pool.query(
        'SELECT vaccine_name, COUNT(*)::int as cnt FROM vaccinations WHERE tenant_id=? GROUP BY vaccine_name ORDER BY cnt DESC LIMIT 10', [tid]);
      const trendData = monthlyTrend.reverse().map(m => ({ label: m.month, value: m.cnt, color: P }));
      const vaccData = vaccStats.map(v => ({ label: v.vaccine_name, value: v.cnt, color: '#059669' }));
      const riskColors = { 0: '#22c55e', 1: '#eab308', 2: '#f97316', 3: '#ef4444' };
      let statsRows = typeStats.map(s => `<tr>
        <td>${esc(s.screening_type)}</td><td>${s.cnt}</td>
        <td><span style="color:${riskColors[Math.round(s.avg_risk)] || GRAY}">${s.avg_risk}</span></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Health Reports</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📊 Health Reports</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgBarChart(trendData, 500, 220, 'Monthly Screening Trend')}</div>
          <div class="card">${svgBarChart(vaccData, 500, 220, 'Top Vaccines')}</div>
        </div>
        <div class="card" style="margin-top:16px;overflow-x:auto">
          <h3 style="color:${P}">Screening Type Analysis</h3>
          <table><tr><th>Type</th><th>Count</th><th>Avg Risk Score</th></tr>
          ${statsRows || '<tr><td colspan="3" style="text-align:center;color:'+GRAY+'">No data</td></tr>'}
          </table>
        </div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 16: Parent Notification =====
  app.get('/school/health-ai/notify-parents/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [screenings] = await pool.query(
        'SELECT * FROM health_screenings WHERE tenant_id=? AND student_id=? ORDER BY date DESC LIMIT 5', [tid, sid]);
      const [vaccs] = await pool.query(
        'SELECT * FROM vaccinations WHERE tenant_id=? AND student_id=? AND next_due <= CURRENT_DATE + INTERVAL \'30 days\'', [tid, sid]);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Notify Parent - Student #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📧 Notify Parent — Student #${sid}</h2>
        <div class="card">
          <p style="color:${GRAY}">Send a health summary to the student's parent/guardian.</p>
          <form method="POST" action="/school/health-ai/notify-parents/${sid}">
            <div><label>Parent Email</label><input type="email" name="email" required placeholder="parent@email.com"></div>
            <div style="margin-top:12px"><label>Subject</label>
              <input name="subject" value="Health Update for Student #${sid}"></div>
            <div style="margin-top:12px"><label>Message</label>
              <textarea name="message" rows="8">Dear Parent/Guardian,

This is a health update regarding your child (Student #${sid}).

Recent Screenings: ${screenings.length} on record
Upcoming Vaccinations Due: ${vaccs.length}

${screenings.filter(s => s.risk_level !== 'low').map(s => `- ${s.screening_type} on ${s.date}: Risk level ${s.risk_level}`).join('\n')}

Please contact the school health office if you have any questions.

Best regards,
School Health Team</textarea></div>
            <button type="submit" class="btn" style="margin-top:12px;background:#059669">📨 Send Notification</button>
          </form>
        </div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.post('/school/health-ai/notify-parents/:studentId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { email, subject, message } = req.body;
    if (!email || !message) return res.status(400).send('Email and message required');
    await queueEmail({ to: email, subject: subject || 'Health Update', html: message.replace(/\n/g, '<br>') });
    audit(req, 'health_parent_notification', { student_id: req.params.studentId, email });
    res.send(`<html><body style="font-family:system-ui;padding:40px"><div class="card" style="max-width:500px;margin:auto;text-align:center">
      <h2 style="color:#22c55e">✅ Notification Sent</h2>
      <p>Email sent to <strong>${esc(email)}</strong></p>
      <a href="/school/health-ai" class="btn" style="display:inline-block;margin-top:16px">← Dashboard</a>
    </div></body></html>`);
  }));

  // ===== ROUTE 17: Growth Monitoring =====
  app.get('/school/health-ai/growth/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [records] = await pool.query(
        "SELECT date, results FROM health_screenings WHERE tenant_id=? AND student_id=? AND (screening_type='bmi' OR screening_type='general') AND results::text LIKE '%height%' ORDER BY date ASC", [tid, sid]);
      const heightData = [], weightData = [], bmiData = [];
      records.forEach(r => {
        const res2 = typeof r.results === 'string' ? JSON.parse(r.results) : (r.results || {});
        const dt = r.date?.toISOString().split('T')[0] || '';
        if (res2.height) heightData.push({ label: dt.substring(5), value: res2.height, color: '#3b82f6' });
        if (res2.weight) weightData.push({ label: dt.substring(5), value: res2.weight, color: '#f97316' });
        if (res2.bmi && res2.bmi.bmi) bmiData.push({ label: dt.substring(5), value: res2.bmi.bmi, color: P });
      });
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Growth Monitoring - Student #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📏 Growth Monitoring — Student #${sid}</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
          <div class="card">${svgBarChart(heightData, 400, 200, 'Height (cm)')}</div>
          <div class="card">${svgBarChart(weightData, 400, 200, 'Weight (kg)')}</div>
          <div class="card">${svgBarChart(bmiData, 400, 200, 'BMI')}</div>
        </div>
        ${records.length === 0 ? '<div class="card" style="text-align:center;color:'+GRAY+'"><p>No growth data available for this student.</p></div>' : ''}
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 18: Vision/Hearing Screening Overview =====
  app.get('/school/health-ai/vision-hearing', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [vision] = await pool.query(
        "SELECT student_id, results, date FROM health_screenings WHERE tenant_id=? AND screening_type='vision' ORDER BY date DESC LIMIT 50", [tid]);
      const [hearing] = await pool.query(
        "SELECT student_id, results, date FROM health_screenings WHERE tenant_id=? AND screening_type='hearing' ORDER BY date DESC LIMIT 50", [tid]);
      let visionIssues = 0, hearingIssues = 0;
      const visionRows = vision.map(v => {
        const r = typeof v.results === 'string' ? JSON.parse(v.results) : (v.results || {});
        const lv = r.vision_left || 'N/A', rv = r.vision_right || 'N/A';
        const hasIssue = lv !== 'N/A' && lv !== '20/20';
        if (hasIssue) visionIssues++;
        return `<tr><td>#${v.student_id}</td><td>${esc(lv)}</td><td>${esc(rv)}</td><td>${v.date?.toISOString().split('T')[0]}</td><td>${hasIssue ? '<span style="color:#f97316">⚠ Follow-up</span>' : '<span style="color:#22c55e">Normal</span>'}</td></tr>`;
      }).join('');
      const hearingRows = hearing.map(h => {
        const r = typeof h.results === 'string' ? JSON.parse(h.results) : (h.results || {});
        const passed = r.passed !== false;
        if (!passed) hearingIssues++;
        return `<tr><td>#${h.student_id}</td><td>${passed ? '<span style="color:#22c55e">Passed</span>' : '<span style="color:#ef4444">Failed</span>'}</td><td>${h.date?.toISOString().split('T')[0]}</td></tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Vision & Hearing</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">👁️👂 Vision & Hearing Screening</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div class="card" style="border-left:4px solid #3b82f6"><div style="font-size:24px;font-weight:bold;color:#3b82f6">${vision.length}</div><div style="color:${GRAY}">Vision Screenings</div><div style="font-size:12px;color:#f97316">${visionIssues} need follow-up</div></div>
          <div class="card" style="border-left:4px solid #8b5cf6"><div style="font-size:24px;font-weight:bold;color:#8b5cf6">${hearing.length}</div><div style="color:${GRAY}">Hearing Screenings</div><div style="font-size:12px;color:#ef4444">${hearingIssues} need follow-up</div></div>
        </div>
        <div class="card"><h3>Vision Results</h3>
          <table><tr><th>Student</th><th>Left Eye</th><th>Right Eye</th><th>Date</th><th>Status</th></tr>
          ${visionRows || '<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No vision screenings</td></tr>'}
          </table>
        </div>
        <div class="card"><h3>Hearing Results</h3>
          <table><tr><th>Student</th><th>Result</th><th>Date</th></tr>
          ${hearingRows || '<tr><td colspan="3" style="text-align:center;color:'+GRAY+'">No hearing screenings</td></tr>'}
          </table>
        </div>
        <a href="/school/health-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

};
