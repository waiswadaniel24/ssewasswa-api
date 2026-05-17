module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS meal_plans (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(200) NOT NULL,
        meals JSONB DEFAULT '{}', total_calories INTEGER DEFAULT 0,
        nutrition JSONB DEFAULT '{}', dietary_type VARCHAR(100),
        created_by INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nutritional_records (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        date DATE NOT NULL, meal_type VARCHAR(50) NOT NULL,
        foods JSONB DEFAULT '[]', calories DECIMAL(8,1) DEFAULT 0,
        protein DECIMAL(8,1) DEFAULT 0, carbs DECIMAL(8,1) DEFAULT 0,
        fats DECIMAL(8,1) DEFAULT 0, fiber DECIMAL(8,1) DEFAULT 0
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS dietary_restrictions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        restriction_type VARCHAR(100) NOT NULL, description TEXT,
        severity VARCHAR(20) DEFAULT 'moderate', doctor_note TEXT
      )`);
      console.log('[nutrition-ai] OK');
    } catch(e) { console.warn('[nutrition-ai] Warn:', e.message); }
  })();

  // Helper: AI meal optimization suggestion
  function aiMealOptimize(nutrition) {
    const suggestions = [];
    if (!nutrition) return { score: 70, suggestions: ['No nutritional data available'] };
    const p = nutrition.protein || 0, c = nutrition.carbs || 0, f = nutrition.fats || 0, fb = nutrition.fiber || 0;
    let score = 70;
    if (p < 20) { suggestions.push('Increase protein intake — add lean meats, beans, or dairy'); score -= 15; }
    if (c > 300) { suggestions.push('Reduce carbohydrate intake — limit refined sugars and white bread'); score -= 10; }
    if (f > 80) { suggestions.push('Reduce fat intake — choose grilled over fried options'); score -= 10; }
    if (fb < 15) { suggestions.push('Add more fiber — include whole grains, fruits, and vegetables'); score -= 10; }
    if (p >= 20 && p <= 50 && c >= 150 && c <= 300 && f >= 30 && f <= 70) { suggestions.push('Nutritional balance looks good!'); score += 15; }
    if (suggestions.length === 0) suggestions.push('Meal plan meets basic nutritional guidelines.');
    return { score: Math.max(0, Math.min(100, score)), suggestions };
  }

  // Helper: SVG bar chart
  function svgBarChart(data, width, height, label) {
    if (!data.length) return '<p style="color:' + GRAY + '">No data available</p>';
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.max(16, (width - 60) / data.length - 8);
    let bars = '';
    data.forEach((d, i) => {
      const h = (d.value / max) * (height - 50);
      const x = 40 + i * (barW + 8);
      bars += `<rect x="${x}" y="${height - 30 - h}" width="${barW}" height="${h}" fill="${d.color || P}" rx="4"/>`;
      bars += `<text x="${x + barW/2}" y="${height - 12}" text-anchor="middle" font-size="9" fill="${GRAY}">${esc(String(d.label).substring(0, 10))}</text>`;
      bars += `<text x="${x + barW/2}" y="${height - 35 - h}" text-anchor="middle" font-size="9" fill="${GRAY}">${d.value}</text>`;
    });
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>${bars}</svg>`;
  }

  // Helper: SVG donut chart
  function svgDonut(data, size, label) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let offset = 0, arcs = '';
    const r = size / 2 - 20, cx = size / 2, cy = size / 2 + 10;
    data.forEach(d => {
      const pct = d.value / total;
      const circ = 2 * Math.PI * r;
      const dash = pct * circ;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="28" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash;
    });
    let legend = data.map(d => {
      const pct = Math.round((d.value / total) * 100);
      return `<span style="display:inline-flex;align-items:center;margin-right:12px;font-size:12px"><span style="width:10px;height:10px;border-radius:50%;background:${d.color};display:inline-block;margin-right:4px"></span>${esc(d.label)} (${pct}%)</span>`;
    }).join('');
    return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cx}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="20" font-weight="bold" fill="${P}">${total}</text>
      ${arcs}</svg><div style="text-align:center;margin-top:4px">${legend}</div>`;
  }

  // Helper: SVG line chart (simple)
  function svgLineChart(data, width, height, label) {
    if (data.length < 2) return '<p style="color:' + GRAY + '">Need more data points</p>';
    const max = Math.max(...data.map(d => d.value), 1);
    const min = Math.min(...data.map(d => d.value), 0);
    const range = max - min || 1;
    const stepX = (width - 60) / (data.length - 1);
    const chartH = height - 50;
    let points = data.map((d, i) => {
      const x = 40 + i * stepX;
      const y = height - 30 - ((d.value - min) / range) * chartH;
      return `${x},${y}`;
    }).join(' ');
    let labels = data.map((d, i) => {
      const x = 40 + i * stepX;
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="9" fill="${GRAY}">${esc(String(d.label).substring(0, 8))}</text>`;
    }).join('');
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      <polyline fill="none" stroke="${P}" stroke-width="2" points="${points}"/>
      ${data.map((d, i) => {
        const x = 40 + i * stepX;
        const y = height - 30 - ((d.value - min) / range) * chartH;
        return `<circle cx="${x}" cy="${y}" r="4" fill="${P}"/>`;
      }).join('')}
      ${labels}</svg>`;
  }

  // ===== ROUTE 1: Dashboard =====
  app.get('/school/nutrition-ai', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [plans] = await pool.query('SELECT COUNT(*)::int as cnt FROM meal_plans WHERE tenant_id=?', [tid]);
      const [records] = await pool.query('SELECT COUNT(*)::int as cnt FROM nutritional_records WHERE tenant_id=?', [tid]);
      const [restrictions] = await pool.query('SELECT COUNT(*)::int as cnt FROM dietary_restrictions WHERE tenant_id=?', [tid]);
      const [avgNutrition] = await pool.query(
        'SELECT AVG(calories)::numeric(8,0)::int as avg_cal, AVG(protein)::numeric(5,1) as avg_pro, AVG(carbs)::numeric(5,1) as avg_carb, AVG(fats)::numeric(5,1) as avg_fat FROM nutritional_records WHERE tenant_id=? AND date >= CURRENT_DATE - INTERVAL \'7 days\'', [tid]);
      const avg = avgNutrition[0];
      const macroData = [
        { label: 'Protein', value: parseFloat(avg.avg_pro) || 0, color: '#ef4444' },
        { label: 'Carbs', value: parseFloat(avg.avg_carb) || 0, color: '#3b82f6' },
        { label: 'Fats', value: parseFloat(avg.avg_fat) || 0, color: '#eab308' }
      ];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Nutrition AI Dashboard</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🥗 Nutrition AI Dashboard</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:28px;font-weight:bold;color:${P}">${plans[0].cnt}</div><div style="color:${GRAY}">Meal Plans</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:28px;font-weight:bold;color:#22c55e">${records[0].cnt}</div><div style="color:${GRAY}">Nutritional Records</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:28px;font-weight:bold;color:#f97316">${restrictions[0].cnt}</div><div style="color:${GRAY}">Dietary Restrictions</div></div>
          <div class="card" style="border-left:4px solid #8b5cf6"><div style="font-size:28px;font-weight:bold;color:#8b5cf6">${avg.avg_cal || 0}</div><div style="color:${GRAY}">Avg Daily Calories</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgDonut(macroData, 320, 'Avg Macros (g)')}</div>
          <div class="card">
            <h4 style="color:${P}">Quick Actions</h4>
            <a href="/school/nutrition-ai/meal-plans" class="btn" style="margin:4px;display:block;text-align:center">📋 Meal Plans</a>
            <a href="/school/nutrition-ai/log-meal" class="btn" style="margin:4px;display:block;text-align:center;background:#059669">📝 Log Meal</a>
            <a href="/school/nutrition-ai/restrictions" class="btn" style="margin:4px;display:block;text-align:center;background:#f97316">⚠️ Dietary Restrictions</a>
            <a href="/school/nutrition-ai/reports" class="btn" style="margin:4px;display:block;text-align:center;background:#8b5cf6">📊 Reports</a>
          </div>
        </div>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 2: Meal Plans =====
  app.get('/school/nutrition-ai/meal-plans', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM meal_plans WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50', [tid]);
      let rows = list.map(p => {
        const meals = typeof p.meals === 'string' ? JSON.parse(p.meals) : (p.meals || {});
        const mealCount = Object.keys(meals).length;
        const opt = aiMealOptimize(typeof p.nutrition === 'string' ? JSON.parse(p.nutrition) : p.nutrition);
        return `<tr>
          <td>${p.id}</td><td>${esc(p.name)}</td>
          <td>${esc(p.dietary_type || 'Standard')}</td>
          <td>${mealCount} meals</td>
          <td>${p.total_calories || 0} cal</td>
          <td><span style="color:${opt.score >= 70 ? '#22c55e' : '#f97316'};font-weight:bold">${opt.score}/100</span></td>
          <td>
            <a href="/school/nutrition-ai/meal-plans/${p.id}" class="btn" style="padding:4px 8px;font-size:12px">View</a>
            <a href="/school/nutrition-ai/meal-plans/${p.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a>
          </td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Meal Plans</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Meal Plans</h2>
        <a href="/school/nutrition-ai/meal-plans/new" class="btn" style="margin-bottom:16px;display:inline-block">+ New Meal Plan</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Name</th><th>Dietary Type</th><th>Meals</th><th>Calories</th><th>Score</th><th>Actions</th></tr>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No meal plans yet</td></tr>'}
        </table></div>
        <a href="/school/nutrition-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 3: Create Meal Plan =====
  app.get('/school/nutrition-ai/meal-plans/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Meal Plan</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🆕 New Meal Plan</h2>
      <div class="card">
        <form method="POST" action="/school/nutrition-ai/meal-plans/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Plan Name *</label><input name="name" required placeholder="e.g., Weekly Balanced Plan"></div>
            <div><label>Dietary Type</label>
              <select name="dietary_type">
                <option value="standard">Standard</option><option value="vegetarian">Vegetarian</option>
                <option value="vegan">Vegan</option><option value="halal">Halal</option>
                <option value="kosher">Kosher</option><option value="gluten-free">Gluten-Free</option>
                <option value="low-carb">Low Carb</option><option value="high-protein">High Protein</option>
              </select>
            </div>
          </div>
          <div style="margin-top:12px"><label>Breakfast</label>
            <textarea name="breakfast" rows="2" placeholder="Oatmeal with berries, 1 boiled egg, orange juice"></textarea></div>
          <div style="margin-top:8px"><label>Snack 1</label>
            <textarea name="snack1" rows="1" placeholder="Apple, granola bar"></textarea></div>
          <div style="margin-top:8px"><label>Lunch</label>
            <textarea name="lunch" rows="2" placeholder="Grilled chicken, brown rice, steamed vegetables"></textarea></div>
          <div style="margin-top:8px"><label>Snack 2</label>
            <textarea name="snack2" rows="1" placeholder="Yogurt, mixed nuts"></textarea></div>
          <div style="margin-top:8px"><label>Dinner</label>
            <textarea name="dinner" rows="2" placeholder="Fish, quinoa, mixed salad"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label>Estimated Total Calories</label><input type="number" name="total_calories" value="2000"></div>
            <div><label>Protein (g)</label><input type="number" name="protein" value="60"></div>
            <div><label>Carbs (g)</label><input type="number" name="carbs" value="250"></div>
            <div><label>Fats (g)</label><input type="number" name="fats" value="65"></div>
          </div>
          <button type="submit" class="btn" style="margin-top:12px;background:#059669">🤖 AI Optimize & Save Plan</button>
        </form>
      </div>
      <a href="/school/nutrition-ai/meal-plans" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/nutrition-ai/meal-plans/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, dietary_type, breakfast, snack1, lunch, snack2, dinner, total_calories, protein, carbs, fats } = req.body;
    if (!name) return res.status(400).send('Plan name required');
    const meals = {};
    if (breakfast) meals.breakfast = breakfast;
    if (snack1) meals.snack1 = snack1;
    if (lunch) meals.lunch = lunch;
    if (snack2) meals.snack2 = snack2;
    if (dinner) meals.dinner = dinner;
    const nutrition = { protein: parseFloat(protein) || 0, carbs: parseFloat(carbs) || 0, fats: parseFloat(fats) || 0 };
    await pool.query(
      'INSERT INTO meal_plans (tenant_id, name, meals, total_calories, nutrition, dietary_type, created_by) VALUES (?,?,?,?,?,?,?)',
      [tid, name, JSON.stringify(meals), parseInt(total_calories) || 0, JSON.stringify(nutrition), dietary_type || 'standard', req.user.id]);
    audit(req, 'meal_plan_created', { name, dietary_type });
    res.redirect('/school/nutrition-ai/meal-plans');
  }));

  // ===== ROUTE 4: View Meal Plan =====
  app.get('/school/nutrition-ai/meal-plans/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM meal_plans WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
      if (!rows.length) return res.status(404).send('Not found');
      const p = rows[0];
      const meals = typeof p.meals === 'string' ? JSON.parse(p.meals) : (p.meals || {});
      const nutrition = typeof p.nutrition === 'string' ? JSON.parse(p.nutrition) : (p.nutrition || {});
      const opt = aiMealOptimize(nutrition);
      const mealNames = { breakfast: '🌅 Breakfast', snack1: '🍎 Snack 1', lunch: '☀️ Lunch', snack2: '🍌 Snack 2', dinner: '🌙 Dinner' };
      let mealHtml = Object.entries(meals).map(([k, v]) =>
        `<div style="margin-bottom:8px"><strong>${mealNames[k] || k}:</strong> ${esc(v)}</div>`
      ).join('');
      const macroData = [
        { label: 'Protein', value: nutrition.protein || 0, color: '#ef4444' },
        { label: 'Carbs', value: nutrition.carbs || 0, color: '#3b82f6' },
        { label: 'Fats', value: nutrition.fats || 0, color: '#eab308' }
      ];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>${esc(p.name)}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 ${esc(p.name)}</h2>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
          <div class="card">
            <h4>Meals</h4>${mealHtml}
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb">
              <strong>Dietary Type:</strong> ${esc(p.dietary_type || 'Standard')}<br>
              <strong>Total Calories:</strong> ${p.total_calories || 0}
            </div>
          </div>
          <div>
            <div class="card" style="text-align:center">
              <div style="font-size:48px;font-weight:bold;color:${opt.score >= 70 ? '#22c55e' : '#f97316'}">${opt.score}</div>
              <div style="color:${GRAY}">Nutrition Score</div>
            </div>
            <div class="card">${svgDonut(macroData, 250, 'Macros')}</div>
            <div class="card"><h4>AI Suggestions</h4>
              <ul>${opt.suggestions.map(s => '<li style="font-size:13px;margin-bottom:4px">' + esc(s) + '</li>').join('')}</ul>
            </div>
          </div>
        </div>
        <a href="/school/nutrition-ai/meal-plans" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/nutrition-ai/meal-plans/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM meal_plans WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    audit(req, 'meal_plan_deleted', { id: req.params.id });
    res.redirect('/school/nutrition-ai/meal-plans');
  }));

  // ===== ROUTE 5: Log Meal =====
  app.get('/school/nutrition-ai/log-meal', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Log Meal</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">📝 Log Meal Intake</h2>
      <div class="card">
        <form method="POST" action="/school/nutrition-ai/log-meal">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>
            <div><label>Meal Type *</label>
              <select name="meal_type" required>
                <option value="breakfast">Breakfast</option><option value="snack1">Morning Snack</option>
                <option value="lunch">Lunch</option><option value="snack2">Afternoon Snack</option>
                <option value="dinner">Dinner</option>
              </select>
            </div>
          </div>
          <div style="margin-top:12px"><label>Foods Eaten (one per line)</label>
            <textarea name="foods" rows="3" placeholder="Grilled chicken breast (150g)\nBrown rice (200g)\nSteamed broccoli"></textarea></div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:12px">
            <div><label>Calories</label><input type="number" name="calories" step="0.1"></div>
            <div><label>Protein (g)</label><input type="number" name="protein" step="0.1"></div>
            <div><label>Carbs (g)</label><input type="number" name="carbs" step="0.1"></div>
            <div><label>Fats (g)</label><input type="number" name="fats" step="0.1"></div>
            <div><label>Fiber (g)</label><input type="number" name="fiber" step="0.1"></div>
          </div>
          <div style="margin-top:12px"><label>Rating</label>
            <select name="rating">
              <option value="5">⭐⭐⭐⭐⭐ Excellent</option><option value="4">⭐⭐⭐⭐ Good</option>
              <option value="3">⭐⭐⭐ Average</option><option value="2">⭐⭐ Below Average</option>
              <option value="1">⭐ Poor</option>
            </select>
          </div>
          <button type="submit" class="btn" style="margin-top:12px;background:#059669">Save Meal Record</button>
        </form>
      </div>
      <a href="/school/nutrition-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/nutrition-ai/log-meal', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, date, meal_type, foods, calories, protein, carbs, fats, fiber, rating } = req.body;
    if (!student_id || !meal_type) return res.status(400).send('Student ID and meal type required');
    const foodsArr = foods ? foods.split('\n').map(f => f.trim()).filter(Boolean) : [];
    await pool.query(
      'INSERT INTO nutritional_records (tenant_id, student_id, date, meal_type, foods, calories, protein, carbs, fats, fiber) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), date || new Date().toISOString().split('T')[0], meal_type, JSON.stringify(foodsArr),
       parseFloat(calories) || 0, parseFloat(protein) || 0, parseFloat(carbs) || 0, parseFloat(fats) || 0, parseFloat(fiber) || 0]);
    audit(req, 'meal_logged', { student_id, meal_type, calories });
    res.redirect('/school/nutrition-ai/log-meal');
  }));

  // ===== ROUTE 6: Dietary Restrictions =====
  app.get('/school/nutrition-ai/restrictions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM dietary_restrictions WHERE tenant_id=? ORDER BY id DESC LIMIT 100', [tid]);
      const sevColors = { mild: '#22c55e', moderate: '#eab308', severe: '#f97316', critical: '#ef4444' };
      let rows = list.map(r => `<tr>
        <td>${r.id}</td><td>#${r.student_id}</td>
        <td>${esc(r.restriction_type)}</td>
        <td><span style="color:${sevColors[r.severity] || GRAY};font-weight:bold">${r.severity}</span></td>
        <td>${esc((r.description || '').substring(0, 50))}</td>
        <td><a href="/school/nutrition-ai/restrictions/${r.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Dietary Restrictions</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">⚠️ Dietary Restrictions</h2>
        <a href="/school/nutrition-ai/restrictions/new" class="btn" style="margin-bottom:16px;display:inline-block;background:#f97316">+ Add Restriction</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Type</th><th>Severity</th><th>Description</th><th></th></tr>
          ${rows || '<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No dietary restrictions</td></tr>'}
        </table></div>
        <a href="/school/nutrition-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/nutrition-ai/restrictions/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Add Dietary Restriction</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">⚠️ Add Dietary Restriction</h2>
      <div class="card">
        <form method="POST" action="/school/nutrition-ai/restrictions/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Restriction Type *</label>
              <select name="restriction_type" required>
                <option value="allergy">Food Allergy</option><option value="intolerance">Food Intolerance</option>
                <option value="religious">Religious Dietary</option><option value="vegetarian">Vegetarian</option>
                <option value="vegan">Vegan</option><option value="medical">Medical Condition</option>
                <option value="preference">Personal Preference</option>
              </select>
            </div>
            <div><label>Severity</label>
              <select name="severity">
                <option value="mild">Mild</option><option value="moderate">Moderate</option>
                <option value="severe">Severe</option><option value="critical">Critical (Life-threatening)</option>
              </select>
            </div>
            <div><label>Specific Allergen/Item</label>
              <input name="description" placeholder="e.g., Peanuts, Shellfish, Lactose"></div>
          </div>
          <div style="margin-top:12px"><label>Doctor's Note</label>
            <textarea name="doctor_note" rows="2" placeholder="Any medical documentation or notes"></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px">Save Restriction</button>
        </form>
      </div>
      <a href="/school/nutrition-ai/restrictions" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/nutrition-ai/restrictions/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, restriction_type, severity, description, doctor_note } = req.body;
    if (!student_id || !restriction_type) return res.status(400).send('Student ID and restriction type required');
    await pool.query(
      'INSERT INTO dietary_restrictions (tenant_id, student_id, restriction_type, description, severity, doctor_note) VALUES (?,?,?,?,?,?)',
      [tid, parseInt(student_id), restriction_type, description || '', severity || 'moderate', doctor_note || '']);
    audit(req, 'dietary_restriction_added', { student_id, restriction_type, severity });
    res.redirect('/school/nutrition-ai/restrictions');
  }));

  app.get('/school/nutrition-ai/restrictions/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM dietary_restrictions WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/nutrition-ai/restrictions');
  }));

  // ===== ROUTE 7: Nutritional Reports =====
  app.get('/school/nutrition-ai/reports', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [dailyAvg] = await pool.query(
        'SELECT date, AVG(calories)::int as avg_cal, AVG(protein)::numeric(5,1) as avg_pro, AVG(carbs)::numeric(5,1) as avg_carb FROM nutritional_records WHERE tenant_id=? AND date >= CURRENT_DATE - INTERVAL \'14 days\' GROUP BY date ORDER BY date', [tid]);
      const [mealTypeDist] = await pool.query(
        'SELECT meal_type, COUNT(*)::int as cnt, AVG(calories)::int as avg_cal FROM nutritional_records WHERE tenant_id=? GROUP BY meal_type ORDER BY cnt DESC', [tid]);
      const [topStudents] = await pool.query(
        'SELECT student_id, AVG(calories)::int as avg_cal FROM nutritional_records WHERE tenant_id=? AND date >= CURRENT_DATE - INTERVAL \'7 days\' GROUP BY student_id ORDER BY avg_cal DESC LIMIT 10', [tid]);

      const calTrend = dailyAvg.map(d => ({ label: d.date.toISOString().split('T')[0].substring(5), value: d.avg_cal, color: P }));
      const proTrend = dailyAvg.map(d => ({ label: d.date.toISOString().split('T')[0].substring(5), value: parseFloat(d.avg_pro) || 0, color: '#ef4444' }));
      const typeData = mealTypeDist.map(m => ({ label: m.meal_type, value: m.cnt, color: '#059669' }));
      const studentData = topStudents.map(s => ({ label: '#' + s.student_id, value: s.avg_cal, color: '#8b5cf6' }));

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Nutrition Reports</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📊 Nutrition Reports</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgLineChart(calTrend, 500, 220, 'Avg Daily Calories (14 days)')}</div>
          <div class="card">${svgLineChart(proTrend, 500, 220, 'Avg Daily Protein (g)')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div class="card">${svgBarChart(typeData, 400, 200, 'Records by Meal Type')}</div>
          <div class="card">${svgBarChart(studentData, 400, 200, 'Top Students by Avg Calories')}</div>
        </div>
        <a href="/school/nutrition-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 8: Student Nutrition View (for parents/students) =====
  app.get('/school/nutrition-ai/student/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [records] = await pool.query(
        'SELECT * FROM nutritional_records WHERE tenant_id=? AND student_id=? ORDER BY date DESC, CASE meal_type WHEN \'breakfast\' THEN 1 WHEN \'snack1\' THEN 2 WHEN \'lunch\' THEN 3 WHEN \'snack2\' THEN 4 WHEN \'dinner\' THEN 5 END LIMIT 50', [tid, sid]);
      const [restrictions] = await pool.query(
        'SELECT * FROM dietary_restrictions WHERE tenant_id=? AND student_id=?', [tid, sid]);
      const [dailyTotals] = await pool.query(
        'SELECT date, SUM(calories)::int as total_cal, SUM(protein)::numeric(5,1) as total_pro, SUM(carbs)::numeric(5,1) as total_carb, SUM(fats)::numeric(5,1) as total_fat FROM nutritional_records WHERE tenant_id=? AND student_id=? AND date >= CURRENT_DATE - INTERVAL \'7 days\' GROUP BY date ORDER BY date', [tid, sid]);
      const calData = dailyTotals.map(d => ({ label: d.date.toISOString().split('T')[0].substring(5), value: d.total_cal, color: P }));
      let recRows = records.map(r => {
        const foods = typeof r.foods === 'string' ? JSON.parse(r.foods) : (r.foods || []);
        return `<tr>
          <td>${r.date?.toISOString().split('T')[0]}</td><td>${esc(r.meal_type)}</td>
          <td>${r.calories}</td><td>${r.protein}g</td><td>${r.carbs}g</td><td>${r.fats}g</td>
          <td style="max-width:200px;font-size:12px">${esc(foods.join(', '))}</td>
        </tr>`;
      }).join('');
      let restRows = restrictions.map(r => `<tr>
        <td>${esc(r.restriction_type)}</td><td>${r.severity}</td><td>${esc(r.description || '')}</td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Student Nutrition - #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🍽️ Student Nutrition — #${sid}</h2>
        ${restrictions.length ? '<div class="card" style="border-left:4px solid #f97316"><h4>⚠️ Dietary Restrictions</h4><table><tr><th>Type</th><th>Severity</th><th>Details</th></tr>' + restRows + '</table></div>' : ''}
        <div class="card">${svgLineChart(calData, 600, 200, 'Daily Calorie Intake (7 days)')}</div>
        <div class="card" style="overflow-x:auto"><h4>Recent Meal Records</h4>
          <table><tr><th>Date</th><th>Meal</th><th>Cal</th><th>Pro</th><th>Carb</th><th>Fat</th><th>Foods</th></tr>
          ${recRows || '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No meal records</td></tr>'}
          </table>
        </div>
        <a href="/school/nutrition-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 9: AI Nutritional Analysis API =====
  app.post('/school/nutrition-ai/api/analyze', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { foods, calories, protein, carbs, fats, fiber } = req.body;
    const nutrition = { protein: parseFloat(protein) || 0, carbs: parseFloat(carbs) || 0, fats: parseFloat(fats) || 0, fiber: parseFloat(fiber) || 0 };
    const result = aiMealOptimize(nutrition);
    const cal = parseFloat(calories) || 0;
    let calAdvice = 'Calorie intake is within normal range.';
    if (cal < 1200) calAdvice = 'Calorie intake is below recommended minimum. Consider adding more nutrient-dense foods.';
    else if (cal > 2500) calAdvice = 'Calorie intake exceeds typical daily needs. Consider portion adjustments.';
    result.suggestions.unshift(calAdvice);
    res.json(result);
  }));

};
