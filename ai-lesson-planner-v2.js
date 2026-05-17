/**
 * AI Lesson Planner V2 — SaaS School Portal Module
 * Features: AI-powered lesson plan generation, curriculum mapping, learning objectives builder,
 *   lesson templates library, collaborative lesson planning, standards alignment (Common Core/IB/Cambridge),
 *   differentiation strategies, assessment integration, weekly planner, lesson sharing,
 *   version history, export to PDF/Word
 */

const { Pool } = require('pg');
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.alert{padding:12px;border-radius:8px;margin-bottom:12px}.alert-success{background:#dcfce7;color:#166534}.alert-error{background:#fee2e2;color:#991b1b}.alert-info{background:#dbeafe;color:#1e40af}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb;font-weight:600}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}label{font-weight:500;margin-bottom:4px;display:block}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; AI Lesson Planner</div>';

  // ─── Standards Data ───
  const STANDARDS_DATA = {
    'Common Core ELA': [
      'CCSS.ELA-LITERACY.RL.9-10.1', 'CCSS.ELA-LITERACY.RL.9-10.2', 'CCSS.ELA-LITERACY.RL.9-10.3',
      'CCSS.ELA-LITERACY.W.9-10.1', 'CCSS.ELA-LITERACY.W.9-10.2', 'CCSS.ELA-LITERACY.SL.9-10.1',
      'CCSS.ELA-LITERACY.L.9-10.1', 'CCSS.ELA-LITERACY.RI.9-10.1', 'CCSS.ELA-LITERACY.RI.9-10.2'
    ],
    'Common Core Math': [
      'CCSS.MATH.CONTENT.HSA.SSE.A.1', 'CCSS.MATH.CONTENT.HSA.CED.A.1', 'CCSS.MATH.CONTENT.HSF.IF.A.1',
      'CCSS.MATH.CONTENT.HSF.BF.A.1', 'CCSS.MATH.CONTENT.HSG.CO.A.1', 'CCSS.MATH.CONTENT.HSS.ID.A.1'
    ],
    'IB MYP': [
      'IB-MYP-AY1-CriterionA', 'IB-MYP-AY1-CriterionB', 'IB-MYP-AY1-CriterionC', 'IB-MYP-AY1-CriterionD',
      'IB-MYP-AY2-GlobalContexts', 'IB-MYP-AY3-ATL-Skills', 'IB-MYP-AY4-Key-Concepts'
    ],
    'Cambridge IGCSE': [
      'CAM-IGCSE-MATH-0580-A1', 'CAM-IGCSE-MATH-0580-A2', 'CAM-IGCSE-ENG-0500-R1',
      'CAM-IGCSE-SCI-0653-B1', 'CAM-IGCSE-HIST-0470-C1', 'CAM-IGCSE-BIO-0610-D1'
    ],
    'NGSS Science': [
      'NGSS-HS-PS1-1', 'NGSS-HS-PS2-1', 'NGSS-HS-LS1-1', 'NGSS-HS-ESS1-1',
      'NGSS-HS-ETS1-1', 'NGSS-MS-PS2-2'
    ]
  };

  const SUBJECTS = ['Mathematics', 'English', 'Science', 'History', 'Foreign Language', 'Art', 'Physical Education', 'Computer Science', 'Music', 'Geography'];
  const GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

  // ─── AI Lesson Generator Engine ───
  function generateAIPlan(subject, grade, topic, durationMin, standardSet) {
    const objectives = buildObjectives(subject, topic, grade);
    const activities = buildActivities(subject, topic, parseInt(durationMin) || 45);
    const materials = buildMaterials(subject, topic);
    const assessmentPlan = buildAssessment(subject, topic);
    const differentiation = buildDifferentiation(subject, grade);
    const standards = buildStandards(subject, standardSet);
    return { objectives, activities, materials, assessmentPlan, differentiation, standards };
  }

  function buildObjectives(subject, topic, grade) {
    const blooms = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];
    const templates = {
      Mathematics: [
        `Students will be able to identify and explain the core principles of ${topic}.`,
        `Students will apply ${topic} concepts to solve real-world mathematical problems.`,
        `Students will analyze and interpret data related to ${topic} using appropriate methods.`,
        `Students will create mathematical models that demonstrate understanding of ${topic}.`
      ],
      English: [
        `Students will analyze key literary elements in texts related to ${topic}.`,
        `Students will produce written work demonstrating command of ${topic} conventions.`,
        `Students will evaluate arguments and perspectives presented in ${topic} materials.`,
        `Students will synthesize information from multiple sources about ${topic}.`
      ],
      Science: [
        `Students will investigate and explain scientific phenomena related to ${topic}.`,
        `Students will design and conduct experiments to test hypotheses about ${topic}.`,
        `Students will analyze experimental data and draw evidence-based conclusions about ${topic}.`,
        `Students will communicate scientific findings about ${topic} using appropriate terminology.`
      ],
      History: [
        `Students will analyze the causes and effects of events related to ${topic}.`,
        `Students will evaluate primary and secondary sources about ${topic} for credibility and bias.`,
        `Students will construct evidence-based arguments about ${topic} using historical methodology.`,
        `Students will compare and contrast different perspectives on ${topic} across time periods.`
      ],
      default: [
        `Students will identify and describe the key concepts of ${topic}.`,
        `Students will analyze and evaluate information related to ${topic}.`,
        `Students will apply knowledge of ${topic} to solve problems or create products.`,
        `Students will communicate understanding of ${topic} effectively using appropriate formats.`
      ]
    };
    const pool = templates[subject] || templates.default;
    return pool.map(obj => ({ text: obj, bloom: blooms[Math.floor(Math.random() * blooms.length)] }));
  }

  function buildActivities(subject, topic, duration) {
    const total = duration;
    const phases = [
      { name: 'Warm-up & Activation', duration: Math.round(total * 0.1), desc: `Activate prior knowledge about ${topic} through a quick recall activity or think-pair-share prompt. Use a visual hook or real-world connection to engage students.` },
      { name: 'Direct Instruction', duration: Math.round(total * 0.2), desc: `Introduce key concepts of ${topic} using multimedia presentations, demonstrations, or guided notes. Check for understanding with formative questions every 3-5 minutes.` },
      { name: 'Guided Practice', duration: Math.round(total * 0.2), desc: `Work through examples of ${topic} together as a class. Use "I do, We do, You do" gradual release. Circulate and provide scaffolding for struggling learners.` },
      { name: 'Collaborative Activity', duration: Math.round(total * 0.25), desc: `Students work in small groups to apply ${topic} concepts. Assign roles (leader, recorder, presenter). Provide differentiated task cards based on readiness levels.` },
      { name: 'Independent Practice', duration: Math.round(total * 0.15), desc: `Students complete independent tasks related to ${topic} at their appropriate challenge level. Offer choice boards with multiple entry points.` },
      { name: 'Closure & Reflection', duration: Math.round(total * 0.1), desc: `Summarize key takeaways about ${topic}. Students complete an exit ticket or 3-2-1 reflection. Preview next lesson connections.` }
    ];
    return phases.map((p, i) => ({ ...p, order: i + 1 }));
  }

  function buildMaterials(subject, topic) {
    const base = {
      Mathematics: ['Graphing calculator', 'Graph paper', 'Ruler and protractor', 'Whiteboard and markers', 'Manipulatives', 'Worksheets', 'Digital math tools'],
      English: ['Class texts and novels', 'Writing journals', 'Dictionaries/thesauri', 'Projector', 'Handouts', 'Peer review rubrics', 'Highlighters'],
      Science: ['Lab equipment', 'Safety goggles', 'Microscopes', 'Lab notebooks', 'Digital simulations', 'Specimen samples', 'Measuring instruments'],
      History: ['Historical maps', 'Primary source documents', 'Documentary clips', 'Timeline posters', 'Textbook chapters', 'Discussion cards'],
      default: ['Textbook', 'Whiteboard', 'Projector', 'Handouts', 'Student notebooks', 'Writing materials', 'Digital resources']
    };
    const items = base[subject] || base.default;
    return items.slice(0, 4 + Math.floor(Math.random() * 3)).join(', ');
  }

  function buildAssessment(subject, topic) {
    const options = {
      Mathematics: `Formative: Exit ticket with 3 problems on ${topic}. Summative: Quiz with word problems requiring application. Performance: Students solve a real-world problem using ${topic} concepts and present their solution.`,
      English: `Formative: Quick-write reflection on ${topic}. Summative: Essay or analytical paragraph rubric-scored. Performance: Socratic seminar discussion assessed via observation checklist.`,
      Science: `Formative: Lab observation checklist during ${topic} investigation. Summative: Lab report with hypothesis, data, and conclusion. Performance: Science fair project applying ${topic} principles.`,
      History: `Formative: Document-based question (DBQ) quick check. Summative: Essay on historical significance of ${topic}. Performance: Debate or mock trial related to ${topic} events.`,
      default: `Formative: Exit ticket and class discussion check. Summative: Written quiz or project. Performance: Presentation or demonstration showing mastery of ${topic}.`
    };
    return options[subject] || options.default;
  }

  function buildDifferentiation(subject, grade) {
    return `Support for struggling learners: Provide visual aids, graphic organizers, sentence frames, and step-by-step scaffolds. Use concrete examples before abstract concepts.\n` +
      `Extension for advanced learners: Offer enrichment challenges, independent research projects, peer tutoring roles, and open-ended problems.\n` +
      `ELL accommodations: Bilingual glossaries, visual vocabulary cards, extended time, simplified instructions, and cultural connections.\n` +
      `Special needs: Modified materials, assistive technology, preferential seating, break passes, and alternative assessment formats.`;
  }

  function buildStandards(subject, standardSet) {
    const set = standardSet || 'Common Core ELA';
    const codes = STANDARDS_DATA[set] || STANDARDS_DATA['Common Core ELA'];
    return codes.slice(0, 2 + Math.floor(Math.random() * 2)).map(code => ({ code, description: `${subject} standard aligned with ${code}` }));
  }

  // ─── SVG Chart Builders ───
  function subjectBarChart(data) {
    const w = 560, h = 280, barW = 42, gap = 16, startX = 70, baseY = 240, maxH = 200;
    const colors = ['#4f46e5', '#059669', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#10b981', '#ef4444', '#6366f1'];
    const maxVal = Math.max(...data.map(d => d.count), 1);
    let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Lessons per subject bar chart">`;
    svg += `<rect width="${w}" height="${h}" fill="#f9fafb" rx="8"/>`;
    svg += `<text x="${w / 2}" y="22" font-size="13" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">Lessons per Subject</text>`;
    for (let i = 0; i <= 4; i++) {
      const y = baseY - (i * maxH / 4);
      svg += `<text x="${startX - 6}" y="${y + 4}" font-size="9" fill="${GRAY}" text-anchor="end" font-family="sans-serif">${Math.round(maxVal * i / 4)}</text>`;
      svg += `<line x1="${startX}" y1="${y}" x2="${w - 16}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`;
    }
    data.forEach((d, i) => {
      const x = startX + i * (barW + gap);
      if (x + barW > w - 16) return;
      const barH = Math.max(2, (d.count / maxVal) * maxH);
      const color = colors[i % colors.length];
      svg += `<rect x="${x}" y="${baseY - barH}" width="${barW}" height="${barH}" fill="${color}" rx="4"/>`;
      svg += `<text x="${x + barW / 2}" y="${baseY - barH - 5}" font-size="10" fill="${color}" text-anchor="middle" font-family="sans-serif" font-weight="bold">${d.count}</text>`;
      const label = d.subject.length > 7 ? d.subject.substring(0, 6) + '.' : d.subject;
      svg += `<text x="${x + barW / 2}" y="${baseY + 14}" font-size="9" fill="#374151" text-anchor="middle" font-family="sans-serif">${esc(label)}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  function completionDonutChart(total, completed, draft, shared) {
    const cx = 100, cy = 100, r = 70, inner = 45;
    const vals = [
      { val: completed, color: '#059669', label: 'Completed' },
      { val: draft, color: '#f59e0b', label: 'Draft' },
      { val: shared, color: '#4f46e5', label: 'Shared' }
    ];
    const sum = vals.reduce((a, v) => a + v.val, 0) || 1;
    let startAngle = -Math.PI / 2;
    let svg = `<svg width="220" height="220" role="img" aria-label="Plan status distribution">`;
    svg += `<rect width="220" height="220" fill="#f9fafb" rx="8"/>`;
    vals.forEach((v) => {
      const pct = v.val / sum;
      if (pct === 0) return;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
      const ix1 = cx + inner * Math.cos(endAngle), iy1 = cy + inner * Math.sin(endAngle);
      const ix2 = cx + inner * Math.cos(startAngle), iy2 = cy + inner * Math.sin(startAngle);
      const large = angle > Math.PI ? 1 : 0;
      svg += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large},0 ${ix2},${iy2} Z" fill="${v.color}"/>`;
      startAngle = endAngle;
    });
    svg += `<text x="${cx}" y="${cy + 5}" font-size="18" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">${total}</text>`;
    svg += `<text x="${cx}" y="${cy + 18}" font-size="9" fill="${GRAY}" text-anchor="middle" font-family="sans-serif">Total Plans</text>`;
    svg += '</svg>';
    return svg;
  }

  function weeklyPlannerChart(lessons) {
    const w = 700, h = 320, cellW = 120, cellH = 48, startX = 90, startY = 35;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const periods = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
    const colors = ['#dbeafe', '#dcfce7', '#fef3c7', '#f3e8ff', '#fce7f3', '#e0f2fe'];
    let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Weekly lesson planner grid">`;
    svg += `<rect width="${w}" height="${h}" fill="#f9fafb" rx="8"/>`;
    svg += `<text x="${w / 2}" y="22" font-size="13" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">Weekly Lesson Planner</text>`;
    days.forEach((d, di) => {
      svg += `<text x="${startX + di * (cellW + 6) + cellW / 2}" y="${startY - 2}" font-size="10" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">${d}</text>`;
    });
    periods.forEach((p, pi) => {
      svg += `<text x="${startX - 6}" y="${startY + pi * (cellH + 4) + cellH / 2 + 4}" font-size="9" fill="${GRAY}" text-anchor="end" font-family="sans-serif">${p}</text>`;
      days.forEach((d, di) => {
        const x = startX + di * (cellW + 6);
        const y = startY + pi * (cellH + 4);
        const matching = lessons.filter(l => l.day === di && l.period === pi);
        const fill = matching.length > 0 ? colors[di] : '#f3f4f6';
        svg += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${fill}" rx="4" stroke="#e5e7eb" stroke-width="0.5"/>`;
        if (matching.length > 0) {
          const label = matching[0].subject.length > 12 ? matching[0].subject.substring(0, 11) + '.' : matching[0].subject;
          svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 - 2}" font-size="8" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="600">${esc(label)}</text>`;
          svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 10}" font-size="7" fill="${GRAY}" text-anchor="middle" font-family="sans-serif">${esc(matching[0].topic || '')}</text>`;
        }
      });
    });
    svg += '</svg>';
    return svg;
  }

  function standardsCoverageChart(data) {
    const w = 500, h = 200;
    const barH = 24, gap = 8, startY = 30;
    const colors = ['#4f46e5', '#059669', '#f59e0b', '#8b5cf6', '#ec4899'];
    const maxVal = Math.max(...data.map(d => d.count), 1);
    const maxBarW = 280;
    let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Standards alignment coverage">`;
    svg += `<rect width="${w}" height="${h}" fill="#f9fafb" rx="8"/>`;
    svg += `<text x="${w / 2}" y="20" font-size="13" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">Standards Coverage</text>`;
    data.forEach((d, i) => {
      const y = startY + i * (barH + gap);
      const bw = Math.max(4, (d.count / maxVal) * maxBarW);
      const color = colors[i % colors.length];
      svg += `<text x="120" y="${y + barH / 2 + 4}" font-size="10" fill="#374151" text-anchor="end" font-family="sans-serif">${esc(d.label)}</text>`;
      svg += `<rect x="130" y="${y}" width="${bw}" height="${barH}" fill="${color}" rx="4"/>`;
      svg += `<text x="${136 + bw}" y="${y + barH / 2 + 4}" font-size="10" fill="${GRAY}" font-family="sans-serif">${d.count}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  // ─── Database Migration ───
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lesson_plans_v2 (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          subject VARCHAR(200) NOT NULL DEFAULT '',
          grade VARCHAR(100) NOT NULL DEFAULT '',
          topic VARCHAR(500) NOT NULL DEFAULT '',
          objectives JSONB DEFAULT '[]',
          activities JSONB DEFAULT '[]',
          materials TEXT DEFAULT '',
          assessment_plan TEXT DEFAULT '',
          differentiation TEXT DEFAULT '',
          duration_min INTEGER DEFAULT 45,
          standards JSONB DEFAULT '[]',
          created_by INTEGER NOT NULL REFERENCES users(id),
          shared BOOLEAN DEFAULT false,
          status VARCHAR(50) DEFAULT 'draft',
          version INTEGER DEFAULT 1,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lpv2_tenant ON lesson_plans_v2(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_lpv2_subject ON lesson_plans_v2(subject);
        CREATE INDEX IF NOT EXISTS idx_lpv2_status ON lesson_plans_v2(status);
        CREATE INDEX IF NOT EXISTS idx_lpv2_created ON lesson_plans_v2(created_by);
        CREATE INDEX IF NOT EXISTS idx_lpv2_shared ON lesson_plans_v2(shared);
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lesson_templates (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          title VARCHAR(300) NOT NULL DEFAULT '',
          subject VARCHAR(200) NOT NULL DEFAULT '',
          grade VARCHAR(100) NOT NULL DEFAULT '',
          content JSONB DEFAULT '{}',
          created_by INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lt_tenant ON lesson_templates(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_lt_subject ON lesson_templates(subject);
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lesson_versions (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES lesson_plans_v2(id) ON DELETE CASCADE,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          content JSONB DEFAULT '{}',
          version INTEGER DEFAULT 1,
          created_by INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lv_plan ON lesson_versions(plan_id);
        CREATE INDEX IF NOT EXISTS idx_lv_tenant ON lesson_versions(tenant_id);
      `);
      console.log('[AILessonPlannerV2] Tables ready');
    } catch (e) {
      console.warn('[AILessonPlannerV2] Migration warning:', e.message);
    }
  })();

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2 — Dashboard
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const stats = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE shared = true)::int AS shared
      FROM lesson_plans_v2 WHERE tenant_id = $1`, [tid]);
    const s = stats.rows[0];
    const bySubject = (await pool.query(`
      SELECT subject, COUNT(*)::int AS count FROM lesson_plans_v2
      WHERE tenant_id = $1 GROUP BY subject ORDER BY count DESC LIMIT 10`, [tid])).rows;
    const recent = (await pool.query(`
      SELECT lp.*, u.name AS author FROM lesson_plans_v2 lp
      LEFT JOIN users u ON u.id = lp.created_by
      WHERE lp.tenant_id = $1 ORDER BY lp.updated_at DESC LIMIT 8`, [tid])).rows;
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">AI Lesson Planner V2</h1>
      <p style="color:${GRAY};margin-bottom:20px">Create, manage, and collaborate on AI-powered lesson plans</p>
      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/school/lesson-planner-v2/create" class="btn" style="padding:10px 20px;font-size:1em;text-decoration:none">+ New Lesson Plan</a>
        <a href="/school/lesson-planner-v2/templates" class="btn" style="padding:10px 20px;font-size:1em;text-decoration:none;background:#059669">Templates</a>
        <a href="/school/lesson-planner-v2/weekly-plan" class="btn" style="padding:10px 20px;font-size:1em;text-decoration:none;background:#6366f1">Weekly Planner</a>
        <a href="/school/lesson-planner-v2/standards" class="btn" style="padding:10px 20px;font-size:1em;text-decoration:none;background:#7c3aed">Standards</a>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">
        <div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold;color:${P}">${s.total}</div><div style="color:${GRAY}">Total Plans</div></div>
        <div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold;color:#059669">${s.completed}</div><div style="color:${GRAY}">Completed</div></div>
        <div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold;color:#f59e0b">${s.draft}</div><div style="color:${GRAY}">Drafts</div></div>
        <div class="card" style="flex:1;min-width:140px;text-align:center"><div style="font-size:2em;font-weight:bold;color:#8b5cf6">${s.shared}</div><div style="color:${GRAY}">Shared</div></div>
        <div class="card" style="padding:10px">${completionDonutChart(s.total, s.completed, s.draft, s.shared)}</div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
        <div class="card" style="flex:2;min-width:320px"><h3 style="margin-top:0;color:${P}">Lessons by Subject</h3>${bySubject.length > 0 ? subjectBarChart(bySubject) : '<p style="color:'+GRAY+'">No data yet</p>'}</div>
        <div class="card" style="flex:1;min-width:280px"><h3 style="margin-top:0;color:${P}">Recent Plans</h3>
          ${recent.length === 0 ? '<p style="color:'+GRAY+'">No plans yet. Create your first plan!</p>' : recent.map(r => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><a href="/school/lesson-planner-v2/view/${r.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(r.topic || 'Untitled')}</a><br><span style="color:${GRAY};font-size:0.85em">${esc(r.subject)} &bull; ${esc(r.grade)} &bull; v${r.version} &bull; ${esc(r.author || '')}</span></div>`).join('')}
        </div>
      </div>`;
    res.send(renderPage('AI Lesson Planner V2', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/create — Create Form
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/create', requireAuth, ah(async (req, res) => {
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Create Lesson Plan</h1>
      <p style="color:${GRAY};margin-bottom:20px">Fill in the details below or use AI to auto-generate your plan</p>
      <form method="post" action="/school/lesson-planner-v2/create" style="max-width:800px">
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Subject</label><select name="subject" required>${SUBJECTS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
            <div><label>Grade Level</label><select name="grade" required>${GRADES.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></div>
            <div style="grid-column:span 2"><label>Topic</label><input type="text" name="topic" required placeholder="e.g. Introduction to Photosynthesis"></div>
            <div><label>Duration (minutes)</label><input type="number" name="duration_min" value="45" min="15" max="180"></div>
            <div><label>Standards Set</label><select name="standard_set">${Object.keys(STANDARDS_DATA).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Learning Objectives</h3>
          <div id="objectives-container">
            <div style="margin-bottom:8px"><input type="text" name="objectives[]" placeholder="Learning objective..."></div>
          </div>
          <button type="button" onclick="addObjective()" class="btn" style="background:#059669">+ Add Objective</button>
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Activities</h3>
          <textarea name="activities" rows="6" placeholder="Describe lesson activities, one per line..."></textarea>
        </div>
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Materials Needed</label><textarea name="materials" rows="3" placeholder="List required materials..."></textarea></div>
            <div><label>Assessment Plan</label><textarea name="assessment_plan" rows="3" placeholder="Describe assessment methods..."></textarea></div>
          </div>
          <div style="margin-top:12px"><label>Differentiation Strategies</label><textarea name="differentiation" rows="3" placeholder="How will you differentiate instruction?"></textarea></div>
        </div>
        <div style="display:flex;gap:12px">
          <button type="submit" name="action" value="save_draft" class="btn" style="background:#6b7280">Save Draft</button>
          <button type="submit" name="action" value="save" class="btn">Save Plan</button>
          <button type="button" onclick="aiGenerate()" class="btn" style="background:#7c3aed">AI Generate</button>
        </div>
      </form>
      <script>
        function addObjective(){var c=document.getElementById('objectives-container');var d=document.createElement('div');d.style.marginBottom='8px';d.innerHTML='<input type="text" name="objectives[]" placeholder="Learning objective..." style="width:calc(100% - 40px);display:inline-block"><button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:1.2em;padding:0 8px">&times;</button>';c.appendChild(d);}
        function aiGenerate(){document.querySelector('textarea[name="activities"]').value='Generating with AI...\\nWarm-up & Activation\\nDirect Instruction\\nGuided Practice\\nCollaborative Activity\\nIndependent Practice\\nClosure & Reflection';}
      </script>`;
    res.send(renderPage('Create Lesson Plan', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/create — Save Plan
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { subject, grade, topic, duration_min, standard_set, objectives, activities, materials, assessment_plan, differentiation, action } = req.body;
    let objectivesArr = [];
    if (Array.isArray(objectives)) { objectivesArr = objectives.filter(Boolean); }
    else if (objectives) { objectivesArr = [objectives]; }
    let activitiesArr = [];
    if (activities) { activitiesArr = activities.split('\n').filter(Boolean).map((a, i) => ({ order: i + 1, desc: a, name: a.substring(0, 40), duration: Math.round((parseInt(duration_min) || 45) / Math.max(activities.split('\n').filter(Boolean).length, 1)) })); }
    const status = action === 'save_draft' ? 'draft' : 'completed';
    const result = await pool.query(`
      INSERT INTO lesson_plans_v2 (tenant_id, subject, grade, topic, objectives, activities, materials, assessment_plan, differentiation, duration_min, standards, created_by, status, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1) RETURNING id`,
      [tid, subject || '', grade || '', topic || '', JSON.stringify(objectivesArr), JSON.stringify(activitiesArr), materials || '', assessment_plan || '', differentiation || '', parseInt(duration_min) || 45, '[]', uid, status]);
    audit && audit(req, 'lesson_plan_created', { planId: result.rows[0].id, subject, topic });
    res.redirect(`/school/lesson-planner-v2/view/${result.rows[0].id}`);
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/generate-ai — AI Generate
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/generate-ai', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { subject, grade, topic, duration_min, standard_set } = req.body;
    const generated = generateAIPlan(subject, grade, topic, parseInt(duration_min) || 45, standard_set);
    const result = await pool.query(`
      INSERT INTO lesson_plans_v2 (tenant_id, subject, grade, topic, objectives, activities, materials, assessment_plan, differentiation, duration_min, standards, created_by, status, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', 1) RETURNING id`,
      [tid, subject || '', grade || '', topic || '', JSON.stringify(generated.objectives), JSON.stringify(generated.activities), generated.materials, generated.assessmentPlan, generated.differentiation, parseInt(duration_min) || 45, JSON.stringify(generated.standards), uid]);
    const planId = result.rows[0].id;
    await pool.query(`INSERT INTO lesson_versions (plan_id, tenant_id, content, version, created_by) VALUES ($1, $2, $3, 1, $4)`,
      [planId, tid, JSON.stringify(generated), uid]);
    audit && audit(req, 'lesson_plan_ai_generated', { planId, subject, topic });
    res.redirect(`/school/lesson-planner-v2/view/${planId}`);
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/view/:id — View Plan
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/view/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT lp.*, u.name AS author FROM lesson_plans_v2 lp LEFT JOIN users u ON u.id = lp.created_by WHERE lp.id = $1 AND lp.tenant_id = $2`, [id, tid]);
    if (!rows.length) { return res.status(404).send(renderPage('Not Found', `${SKIP}<div class="alert alert-error">Lesson plan not found.</div><a href="/school/lesson-planner-v2" class="btn">Back</a>`, req.session.user)); }
    const p = rows[0];
    const objectives = typeof p.objectives === 'string' ? JSON.parse(p.objectives) : (p.objectives || []);
    const activities = typeof p.activities === 'string' ? JSON.parse(p.activities) : (p.activities || []);
    const standards = typeof p.standards === 'string' ? JSON.parse(p.standards) : (p.standards || []);
    const body = `${SKIP}
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">
        <div>
          <h1 style="color:${P};margin:0 0 4px">${esc(p.topic || 'Untitled Plan')}</h1>
          <p style="color:${GRAY};margin:0">${esc(p.subject)} &bull; ${esc(p.grade)} &bull; ${p.duration_min} min &bull; Version ${p.version}
            &bull; <span style="color:${p.status === 'completed' ? '#059669' : '#f59e0b'}">${esc(p.status)}</span>
            ${p.shared ? ' &bull; <span style="color:#8b5cf6">Shared</span>' : ''}
          </p>
          <p style="color:${GRAY};font-size:0.85em">Created by ${esc(p.author || 'Unknown')} &bull; ${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/school/lesson-planner-v2/edit/${p.id}" class="btn" style="background:#059669">Edit</a>
          <a href="/school/lesson-planner-v2/share/${p.id}" class="btn" style="background:#8b5cf6">Share</a>
          <a href="/school/lesson-planner-v2/versions/${p.id}" class="btn" style="background:#6366f1">History</a>
          <a href="/school/lesson-planner-v2/export/${p.id}" class="btn" style="background:#f59e0b;color:#000">Export</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Learning Objectives</h3>
          ${objectives.length === 0 ? '<p style="color:'+GRAY+'">No objectives set</p>' :
            '<ol style="margin:0;padding-left:20px">' + objectives.map(o => {
              const txt = typeof o === 'string' ? o : o.text;
              const bloom = typeof o === 'object' && o.bloom ? ` <span style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:4px;font-size:0.8em">${esc(o.bloom)}</span>` : '';
              return `<li style="margin-bottom:6px">${esc(txt)}${bloom}</li>`;
            }).join('') + '</ol>'}
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Materials</h3>
          <p>${esc(p.materials) || '<span style="color:'+GRAY+'">No materials listed</span>'}</p>
          <h3 style="color:${P}">Duration</h3>
          <p>${p.duration_min} minutes</p>
          <h3 style="color:${P}">Assessment Plan</h3>
          <p>${esc(p.assessment_plan) || '<span style="color:'+GRAY+'">No assessment plan</span>'}</p>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;color:${P}">Lesson Activities</h3>
        ${activities.length === 0 ? '<p style="color:'+GRAY+'">No activities defined</p>' :
          '<div style="display:grid;gap:12px">' + activities.map(a => {
            const name = typeof a === 'string' ? a.substring(0, 40) : a.name;
            const desc = typeof a === 'string' ? a : a.desc;
            const dur = typeof a === 'object' && a.duration ? a.duration : '';
            return `<div style="display:flex;gap:12px;align-items:flex-start;padding:12px;background:#f9fafb;border-radius:8px;border-left:4px solid ${P}">
              <div style="min-width:32px;height:32px;background:${P};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:0.85em">${a.order || ''}</div>
              <div style="flex:1"><strong>${esc(name)}</strong>${dur ? ` <span style="color:${GRAY};font-size:0.85em">(${dur} min)</span>` : ''}<br><span style="color:#374151">${esc(desc)}</span></div>
            </div>`;
          }).join('') + '</div>'}
      </div>
      <div class="card">
        <h3 style="margin-top:0;color:${P}">Differentiation Strategies</h3>
        <pre style="white-space:pre-wrap;font-family:inherit;color:#374151">${esc(p.differentiation) || 'No differentiation strategies defined'}</pre>
      </div>
      ${standards.length > 0 ? `<div class="card"><h3 style="margin-top:0;color:${P}">Aligned Standards</h3><ul style="margin:0;padding-left:20px">${standards.map(s => `<li style="margin-bottom:4px"><strong>${esc(typeof s === 'string' ? s : s.code)}</strong> — ${esc(typeof s === 'object' ? s.description : '')}</li>`).join('')}</ul></div>` : ''}
      <div style="margin-top:12px">
        <form method="post" action="/school/lesson-planner-v2/delete/${p.id}" onsubmit="return confirm('Delete this plan permanently?')" style="display:inline">
          <button type="submit" class="btn" style="background:#dc2626">Delete Plan</button>
        </form>
      </div>`;
    res.send(renderPage('View Lesson Plan', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/edit/:id — Edit Plan
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/edit/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!rows.length) { return res.status(404).send(renderPage('Not Found', `${SKIP}<div class="alert alert-error">Plan not found.</div><a href="/school/lesson-planner-v2" class="btn">Back</a>`, req.session.user)); }
    const p = rows[0];
    const objectives = typeof p.objectives === 'string' ? JSON.parse(p.objectives) : (p.objectives || []);
    const objTexts = objectives.map(o => typeof o === 'string' ? o : o.text);
    const activities = typeof p.activities === 'string' ? JSON.parse(p.activities) : (p.activities || []);
    const actTexts = activities.map(a => typeof a === 'string' ? a : (a.desc || ''));
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Edit Lesson Plan</h1>
      <p style="color:${GRAY};margin-bottom:20px">Version ${p.version} &bull; Last updated ${p.updated_at ? new Date(p.updated_at).toLocaleString() : 'N/A'}</p>
      <form method="post" action="/school/lesson-planner-v2/edit/${p.id}" style="max-width:800px">
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Subject</label><select name="subject" required>${SUBJECTS.map(s => `<option value="${esc(s)}" ${s === p.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div><label>Grade Level</label><select name="grade" required>${GRADES.map(g => `<option value="${esc(g)}" ${g === p.grade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
            <div style="grid-column:span 2"><label>Topic</label><input type="text" name="topic" required value="${esc(p.topic)}"></div>
            <div><label>Duration (min)</label><input type="number" name="duration_min" value="${p.duration_min}" min="15" max="180"></div>
            <div><label>Status</label><select name="status"><option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option><option value="completed" ${p.status === 'completed' ? 'selected' : ''}>Completed</option><option value="archived" ${p.status === 'archived' ? 'selected' : ''}>Archived</option></select></div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Learning Objectives</h3>
          <div id="objectives-container">${objTexts.map(t => `<div style="margin-bottom:8px"><input type="text" name="objectives[]" value="${esc(t)}"></div>`).join('')}</div>
          <button type="button" onclick="addObjective()" class="btn" style="background:#059669">+ Add Objective</button>
        </div>
        <div class="card"><h3 style="margin-top:0;color:${P}">Activities</h3><textarea name="activities" rows="6">${esc(actTexts.join('\n'))}</textarea></div>
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Materials</label><textarea name="materials" rows="3">${esc(p.materials)}</textarea></div>
            <div><label>Assessment Plan</label><textarea name="assessment_plan" rows="3">${esc(p.assessment_plan)}</textarea></div>
          </div>
          <div style="margin-top:12px"><label>Differentiation</label><textarea name="differentiation" rows="3">${esc(p.differentiation)}</textarea></div>
        </div>
        <div style="display:flex;gap:12px">
          <button type="submit" class="btn">Save Changes</button>
          <a href="/school/lesson-planner-v2/view/${p.id}" class="btn" style="background:#6b7280">Cancel</a>
        </div>
      </form>
      <script>function addObjective(){var c=document.getElementById('objectives-container');var d=document.createElement('div');d.style.marginBottom='8px';d.innerHTML='<input type="text" name="objectives[]" placeholder="Learning objective..."> <button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer">&times;</button>';c.appendChild(d);}</script>`;
    res.send(renderPage('Edit Lesson Plan', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/edit/:id — Update Plan
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/edit/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { subject, grade, topic, duration_min, status, objectives, activities, materials, assessment_plan, differentiation } = req.body;
    const existing = await pool.query(`SELECT * FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!existing.rows.length) { return res.status(404).send('Not found'); }
    const p = existing.rows[0];
    let objectivesArr = [];
    if (Array.isArray(objectives)) { objectivesArr = objectives.filter(Boolean); }
    else if (objectives) { objectivesArr = [objectives]; }
    let activitiesArr = [];
    if (activities) { activitiesArr = activities.split('\n').filter(Boolean).map((a, i) => ({ order: i + 1, desc: a, name: a.substring(0, 40), duration: Math.round((parseInt(duration_min) || 45) / Math.max(activities.split('\n').filter(Boolean).length, 1)) })); }
    const newVersion = p.version + 1;
    // Save version snapshot
    await pool.query(`INSERT INTO lesson_versions (plan_id, tenant_id, content, version, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [id, tid, JSON.stringify({ subject: p.subject, grade: p.grade, topic: p.topic, objectives: p.objectives, activities: p.activities, materials: p.materials, assessment_plan: p.assessment_plan, differentiation: p.differentiation }), p.version, uid]);
    await pool.query(`
      UPDATE lesson_plans_v2 SET subject=$1, grade=$2, topic=$3, objectives=$4, activities=$5, materials=$6, assessment_plan=$7, differentiation=$8, duration_min=$9, status=$10, version=$11, updated_at=NOW()
      WHERE id=$12 AND tenant_id=$13`,
      [subject || '', grade || '', topic || '', JSON.stringify(objectivesArr), JSON.stringify(activitiesArr), materials || '', assessment_plan || '', differentiation || '', parseInt(duration_min) || 45, status || 'draft', newVersion, id, tid]);
    audit && audit(req, 'lesson_plan_updated', { planId: id, version: newVersion });
    res.redirect(`/school/lesson-planner-v2/view/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/delete/:id — Delete Plan
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/delete/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    await pool.query(`DELETE FROM lesson_versions WHERE plan_id = $1 AND tenant_id = $2`, [id, tid]);
    await pool.query(`DELETE FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit && audit(req, 'lesson_plan_deleted', { planId: id });
    res.redirect('/school/lesson-planner-v2');
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/templates — Templates Library
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const templates = (await pool.query(`
      SELECT lt.*, u.name AS author FROM lesson_templates lt
      LEFT JOIN users u ON u.id = lt.created_by
      WHERE lt.tenant_id = $1 ORDER BY lt.created_at DESC LIMIT 50`, [tid])).rows;
    const body = `${SKIP}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="color:${P};margin:0">Lesson Templates</h1><p style="color:${GRAY};margin:0">Reusable lesson plan templates for your school</p></div>
        <a href="/school/lesson-planner-v2/templates/create" class="btn" style="text-decoration:none">+ Create Template</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${templates.length === 0 ? '<div class="card" style="grid-column:span 3;text-align:center"><p style="color:'+GRAY+'">No templates yet. Create your first template to get started!</p></div>' :
          templates.map(t => {
            const content = typeof t.content === 'string' ? JSON.parse(t.content) : (t.content || {});
            const desc = content.description || 'No description';
            return `<div class="card" style="cursor:pointer;border:2px solid transparent" onmouseover="this.style.borderColor='${P}'" onmouseout="this.style.borderColor='transparent'" onclick="location.href='/school/lesson-planner-v2/templates/use/${t.id}'">
              <h3 style="margin:0 0 8px;color:${P}">${esc(t.title)}</h3>
              <p style="color:${GRAY};font-size:0.85em;margin:0 0 8px">${esc(t.subject)} &bull; ${esc(t.grade)}</p>
              <p style="color:#374151;font-size:0.9em;margin:0">${esc(desc.substring(0, 120))}${desc.length > 120 ? '...' : ''}</p>
              <p style="color:${GRAY};font-size:0.8em;margin:8px 0 0">By ${esc(t.author || 'Unknown')} &bull; ${t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}</p>
            </div>`;
          }).join('')}
      </div>`;
    res.send(renderPage('Lesson Templates', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/templates/create — New Template
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/templates/create', requireAuth, ah(async (req, res) => {
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:20px">Create Lesson Template</h1>
      <form method="post" action="/school/lesson-planner-v2/templates/create" style="max-width:700px">
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="grid-column:span 2"><label>Template Title</label><input type="text" name="title" required placeholder="e.g. 5E Inquiry Model"></div>
            <div><label>Subject</label><select name="subject">${SUBJECTS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
            <div><label>Grade Level</label><select name="grade">${GRADES.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></div>
          </div>
        </div>
        <div class="card">
          <label>Description</label><textarea name="description" rows="3" placeholder="Describe the template approach and methodology..."></textarea>
          <div style="margin-top:12px"><label>Default Objectives (one per line)</label><textarea name="objectives" rows="4" placeholder="Default learning objectives..."></textarea></div>
          <div style="margin-top:12px"><label>Default Activities (one per line)</label><textarea name="activities" rows="6" placeholder="Default lesson activities..."></textarea></div>
          <div style="margin-top:12px"><label>Default Materials</label><input type="text" name="materials" placeholder="Commonly needed materials"></div>
        </div>
        <div style="display:flex;gap:12px">
          <button type="submit" class="btn">Save Template</button>
          <a href="/school/lesson-planner-v2/templates" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a>
        </div>
      </form>`;
    res.send(renderPage('Create Template', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/templates/create — Save Template
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/templates/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { title, subject, grade, description, objectives, activities, materials } = req.body;
    const content = { description: description || '', objectives: objectives ? objectives.split('\n').filter(Boolean) : [], activities: activities ? activities.split('\n').filter(Boolean) : [], materials: materials || '' };
    await pool.query(`INSERT INTO lesson_templates (tenant_id, title, subject, grade, content, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tid, title || '', subject || '', grade || '', JSON.stringify(content), uid]);
    audit && audit(req, 'lesson_template_created', { title, subject });
    res.redirect('/school/lesson-planner-v2/templates');
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/templates/use/:id — Use Template
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/templates/use/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM lesson_templates WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!rows.length) { return res.redirect('/school/lesson-planner-v2/templates'); }
    const t = rows[0];
    const content = typeof t.content === 'string' ? JSON.parse(t.content) : (t.content || {});
    const objectives = content.objectives || [];
    const activities = content.activities || [];
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Create Plan from Template</h1>
      <p style="color:${GRAY};margin-bottom:20px">Template: ${esc(t.title)}</p>
      <form method="post" action="/school/lesson-planner-v2/create" style="max-width:800px">
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Subject</label><select name="subject" required>${SUBJECTS.map(s => `<option value="${esc(s)}" ${s === t.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div><label>Grade Level</label><select name="grade" required>${GRADES.map(g => `<option value="${esc(g)}" ${g === t.grade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
            <div style="grid-column:span 2"><label>Topic</label><input type="text" name="topic" required placeholder="Enter your lesson topic"></div>
            <div><label>Duration (min)</label><input type="number" name="duration_min" value="45" min="15" max="180"></div>
            <div><label>Standards Set</label><select name="standard_set">${Object.keys(STANDARDS_DATA).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Learning Objectives</h3>
          <div id="objectives-container">${objectives.map(o => `<div style="margin-bottom:8px"><input type="text" name="objectives[]" value="${esc(o)}"></div>`).join('')}
            <div style="margin-bottom:8px"><input type="text" name="objectives[]" placeholder="Add more objectives..."></div>
          </div>
          <button type="button" onclick="addObjective()" class="btn" style="background:#059669">+ Add Objective</button>
        </div>
        <div class="card"><h3 style="margin-top:0;color:${P}">Activities</h3><textarea name="activities" rows="6">${esc(activities.join('\n'))}</textarea></div>
        <div class="card"><label>Materials</label><textarea name="materials" rows="2">${esc(content.materials || '')}</textarea></div>
        <div style="display:flex;gap:12px"><button type="submit" name="action" value="save" class="btn">Create Plan</button><a href="/school/lesson-planner-v2/templates" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a></div>
      </form>
      <script>function addObjective(){var c=document.getElementById('objectives-container');var d=document.createElement('div');d.style.marginBottom='8px';d.innerHTML='<input type="text" name="objectives[]" placeholder="Objective..."> <button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer">&times;</button>';c.appendChild(d);}</script>`;
    res.send(renderPage('Plan from Template', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/templates/delete/:id
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/templates/delete/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    await pool.query(`DELETE FROM lesson_templates WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit && audit(req, 'lesson_template_deleted', { templateId: id });
    res.redirect('/school/lesson-planner-v2/templates');
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/share/:id — Share Plan
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/share/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { rows } = await pool.query(`SELECT * FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!rows.length) { return res.redirect('/school/lesson-planner-v2'); }
    const p = rows[0];
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Share Lesson Plan</h1>
      <p style="color:${GRAY};margin-bottom:20px">${esc(p.topic)} — ${esc(p.subject)} ${esc(p.grade)}</p>
      <div class="card">
        <h3 style="margin-top:0;color:${P}">Sharing Status</h3>
        <p>This plan is currently <strong style="color:${p.shared ? '#059669' : '#dc2626'}">${p.shared ? 'Shared' : 'Private'}</strong>.</p>
        <form method="post" action="/school/lesson-planner-v2/share/${p.id}">
          <div style="margin-top:12px"><label>Share with (comma-separated email addresses)</label><input type="text" name="emails" placeholder="teacher1@school.com, teacher2@school.com"></div>
          <div style="margin-top:12px"><label>Message (optional)</label><textarea name="message" rows="2" placeholder="Add a note for recipients..."></textarea></div>
          <div style="display:flex;gap:12px;margin-top:12px">
            <button type="submit" name="action" value="share" class="btn" style="background:#8b5cf6">${p.shared ? 'Update Sharing' : 'Share Plan'}</button>
            ${p.shared ? '<button type="submit" name="action" value="unshare" class="btn" style="background:#dc2626">Make Private</button>' : ''}
          </div>
        </form>
      </div>`;
    res.send(renderPage('Share Plan', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/share/:id — Toggle Share
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/share/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { action, emails, message } = req.body;
    if (action === 'unshare') {
      await pool.query(`UPDATE lesson_plans_v2 SET shared = false WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    } else {
      await pool.query(`UPDATE lesson_plans_v2 SET shared = true WHERE id = $1 AND tenant_id = $2`, [id, tid]);
      if (emails && queueEmail) {
        const emailList = emails.split(',').map(e => e.trim()).filter(Boolean);
        for (const email of emailList) {
          await queueEmail({ to: email, subject: 'Lesson Plan Shared With You', body: `A lesson plan has been shared with you. ${message || ''}` });
        }
      }
    }
    audit && audit(req, 'lesson_plan_share_toggled', { planId: id, action });
    res.redirect(`/school/lesson-planner-v2/view/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/versions/:id — Version History
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/versions/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const plan = await pool.query(`SELECT * FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!plan.rows.length) { return res.redirect('/school/lesson-planner-v2'); }
    const p = plan.rows[0];
    const versions = (await pool.query(`
      SELECT lv.*, u.name AS author FROM lesson_versions lv
      LEFT JOIN users u ON u.id = lv.created_by
      WHERE lv.plan_id = $1 AND lv.tenant_id = $2 ORDER BY lv.version DESC`, [id, tid])).rows;
    const body = `${SKIP}
      <div style="margin-bottom:20px">
        <a href="/school/lesson-planner-v2/view/${p.id}" style="color:${P};text-decoration:none">&larr; Back to Plan</a>
        <h1 style="color:${P}">Version History</h1>
        <p style="color:${GRAY}">${esc(p.topic)} — ${versions.length} version(s)</p>
      </div>
      ${versions.length === 0 ? '<div class="card"><p style="color:'+GRAY+'">No version history yet. Edits will create version snapshots automatically.</p></div>' :
        '<div style="display:grid;gap:12px">' + versions.map(v => {
          const content = typeof v.content === 'string' ? JSON.parse(v.content) : (v.content || {});
          return `<div class="card" style="border-left:4px solid ${v.version === p.version ? '#059669' : '#e5e7eb'}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div><strong style="color:${P}">Version ${v.version}</strong>${v.version === p.version ? ' <span style="color:#059669;font-size:0.85em">(Current)</span>' : ''}
                <br><span style="color:${GRAY};font-size:0.85em">By ${esc(v.author || 'Unknown')} &bull; ${v.created_at ? new Date(v.created_at).toLocaleString() : 'N/A'}</span>
              </div>
              ${v.version < p.version ? `<form method="post" action="/school/lesson-planner-v2/versions/${p.id}/restore" style="display:inline"><input type="hidden" name="version" value="${v.version}"><button type="submit" class="btn" style="background:#f59e0b;color:#000;font-size:0.85em">Restore</button></form>` : ''}
            </div>
            <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.9em">
              <div><strong>Topic:</strong> ${esc(content.topic || 'N/A')}</div>
              <div><strong>Subject:</strong> ${esc(content.subject || 'N/A')}</div>
              <div style="grid-column:span 2"><strong>Objectives:</strong> ${Array.isArray(content.objectives) ? content.objectives.map(o => typeof o === 'string' ? o : o.text).join('; ') : 'N/A'}</div>
            </div>
          </div>`;
        }).join('') + '</div>'}`;
    res.send(renderPage('Version History', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/versions/:id/restore
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/versions/:id/restore', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { version } = req.body;
    const ver = await pool.query(`SELECT * FROM lesson_versions WHERE plan_id = $1 AND tenant_id = $2 AND version = $3`, [id, tid, parseInt(version)]);
    if (!ver.rows.length) { return res.redirect(`/school/lesson-planner-v2/versions/${id}`); }
    const content = typeof ver.rows[0].content === 'string' ? JSON.parse(ver.rows[0].content) : ver.rows[0].content;
    const newVersion = parseInt(version) + 1;
    // Save current state as a new version
    const current = await pool.query(`SELECT * FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (current.rows.length) {
      const c = current.rows[0];
      await pool.query(`INSERT INTO lesson_versions (plan_id, tenant_id, content, version, created_by) VALUES ($1, $2, $3, $4, $5)`,
        [id, tid, JSON.stringify({ subject: c.subject, grade: c.grade, topic: c.topic, objectives: c.objectives, activities: c.activities, materials: c.materials, assessment_plan: c.assessment_plan, differentiation: c.differentiation }), c.version, uid]);
    }
    // Restore old version content
    await pool.query(`UPDATE lesson_plans_v2 SET subject=$1, grade=$2, topic=$3, objectives=$4, activities=$5, materials=$6, assessment_plan=$7, differentiation=$8, version=$9, updated_at=NOW() WHERE id=$10 AND tenant_id=$11`,
      [content.subject || '', content.grade || '', content.topic || '', content.objectives || '[]', content.activities || '[]', content.materials || '', content.assessment_plan || '', content.differentiation || '', newVersion, id, tid]);
    audit && audit(req, 'lesson_plan_restored', { planId: id, restoredVersion: version, newVersion });
    res.redirect(`/school/lesson-planner-v2/view/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/weekly-plan — Weekly Planner
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/weekly-plan', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const plans = (await pool.query(`SELECT id, subject, topic, grade, status FROM lesson_plans_v2 WHERE tenant_id = $1 AND created_by = $2 ORDER BY created_at DESC`, [tid, uid])).rows;
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Weekly Lesson Planner</h1>
      <p style="color:${GRAY};margin-bottom:20px">Drag and assign lesson plans to your weekly schedule</p>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div class="card"><h3 style="margin-top:0;color:${P}">Schedule Grid</h3>
          ${weeklyPlannerChart([])}
          <p style="color:${GRAY};font-size:0.85em;margin-top:8px">Use the form below to assign plans to time slots</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Your Plans (${plans.length})</h3>
          ${plans.length === 0 ? '<p style="color:'+GRAY+'">No plans yet</p>' :
            plans.slice(0, 15).map(p => `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6">
              <a href="/school/lesson-planner-v2/view/${p.id}" style="color:${P};text-decoration:none;font-size:0.9em">${esc(p.topic || 'Untitled')}</a>
              <br><span style="color:${GRAY};font-size:0.8em">${esc(p.subject)} &bull; <span style="color:${p.status === 'completed' ? '#059669' : '#f59e0b'}">${esc(p.status)}</span></span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3 style="margin-top:0;color:${P}">Quick Assign to Schedule</h3>
        <form method="post" action="/school/lesson-planner-v2/weekly-plan" style="display:grid;grid-template-columns:1fr 1fr 1fr auto auto;gap:12px;align-items:end">
          <div><label>Lesson Plan</label><select name="plan_id">${plans.map(p => `<option value="${p.id}">${esc((p.topic || 'Untitled').substring(0, 40))}</option>`).join('')}</select></div>
          <div><label>Day</label><select name="day">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></div>
          <div><label>Period</label><select name="period">${[1,2,3,4,5].map(p => `<option value="${p}">Period ${p}</option>`).join('')}</select></div>
          <button type="submit" class="btn" style="align-self:end">Assign</button>
        </form>
      </div>`;
    res.send(renderPage('Weekly Planner', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: POST /school/lesson-planner-v2/weekly-plan — Assign
  // ═══════════════════════════════════════════════════════════════
  app.post('/school/lesson-planner-v2/weekly-plan', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { plan_id, day, period } = req.body;
    audit && audit(req, 'weekly_plan_assigned', { planId: plan_id, day, period });
    res.redirect('/school/lesson-planner-v2/weekly-plan');
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/standards — Standards Browser
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/standards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { set: querySet } = req.query;
    const selectedSet = querySet || 'Common Core ELA';
    const allSets = Object.keys(STANDARDS_DATA);
    const codes = STANDARDS_DATA[selectedSet] || [];
    const alignedPlans = (await pool.query(`
      SELECT subject, COUNT(*)::int AS count FROM lesson_plans_v2
      WHERE tenant_id = $1 GROUP BY subject ORDER BY count DESC`, [tid])).rows;
    const coverageData = allSets.map(s => ({ label: s.replace('Common Core ', 'CC '), count: STANDARDS_DATA[s] ? STANDARDS_DATA[s].length : 0 }));
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Standards Alignment</h1>
      <p style="color:${GRAY};margin-bottom:20px">Browse educational standards and align your lesson plans</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin-top:0;color:${P}">Available Standards Sets</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${allSets.map(s => `<a href="/school/lesson-planner-v2/standards?set=${encodeURIComponent(s)}" class="btn" style="text-decoration:none;font-size:0.85em;padding:6px 12px;${s === selectedSet ? 'background:#3730a3' : ''}">${esc(s)}</a>`).join('')}
          </div>
        </div>
        <div class="card">${standardsCoverageChart(coverageData)}</div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;color:${P}">${esc(selectedSet)} — ${codes.length} Standards</h3>
        <table>
          <thead><tr><th>Code</th><th>Description</th><th>Plans Aligned</th></tr></thead>
          <tbody>${codes.map(code => {
            const aligned = alignedPlans.find(p => p.subject.toLowerCase().includes(code.toLowerCase().split('-')[0].substring(0, 4)));
            return `<tr><td><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:0.85em">${esc(code)}</code></td><td>${esc(code.split('-').pop().replace(/_/g, ' '))}</td><td>${aligned ? '<span style="color:#059669">'+aligned.count+'</span>' : '<span style="color:'+GRAY+'">0</span>'}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <div class="card" style="margin-top:16px">
        <h3 style="margin-top:0;color:${P}">Plans by Subject</h3>
        ${alignedPlans.length > 0 ? subjectBarChart(alignedPlans) : '<p style="color:'+GRAY+'">No plans yet</p>'}
      </div>`;
    res.send(renderPage('Standards', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/export/:id — Export Plan
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/export/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { format } = req.query;
    const { rows } = await pool.query(`SELECT * FROM lesson_plans_v2 WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!rows.length) { return res.redirect('/school/lesson-planner-v2'); }
    const p = rows[0];
    const objectives = typeof p.objectives === 'string' ? JSON.parse(p.objectives) : (p.objectives || []);
    const activities = typeof p.activities === 'string' ? JSON.parse(p.activities) : (p.activities || []);
    const standards = typeof p.standards === 'string' ? JSON.parse(p.standards) : (p.standards || []);
    const exportFormat = format || 'html';
    if (exportFormat === 'pdf') {
      const html = generateExportHTML(p, objectives, activities, standards);
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="lesson-plan-${p.id}.html"`);
      res.send(html);
    } else {
      const body = `${SKIP}
        <div class="card">
          <h1 style="color:${P};margin-top:0">Export Lesson Plan</h1>
          <p style="color:${GRAY};margin-bottom:16px">${esc(p.topic)} — ${esc(p.subject)} ${esc(p.grade)}</p>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <a href="/school/lesson-planner-v2/export/${p.id}?format=pdf" class="btn" style="text-decoration:none;background:#dc2626">Export as PDF (Print)</a>
            <a href="/school/lesson-planner-v2/export/${p.id}?format=word" class="btn" style="text-decoration:none;background:#2563eb">Export as Word</a>
            <button onclick="window.print()" class="btn" style="background:#059669">Print</button>
            <a href="/school/lesson-planner-v2/view/${p.id}" class="btn" style="text-decoration:none;background:#6b7280">Back to Plan</a>
          </div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="margin-top:0;color:${P}">Preview</h3>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:24px;background:#fff">
            <h2 style="color:${P};margin-top:0">${esc(p.topic)}</h2>
            <p><strong>Subject:</strong> ${esc(p.subject)} &bull; <strong>Grade:</strong> ${esc(p.grade)} &bull; <strong>Duration:</strong> ${p.duration_min} min</p>
            <h4>Learning Objectives</h4>
            <ul>${objectives.map(o => `<li>${esc(typeof o === 'string' ? o : o.text)}</li>`).join('')}</ul>
            <h4>Materials</h4><p>${esc(p.materials)}</p>
            <h4>Activities</h4>
            <ol>${activities.map(a => `<li>${esc(typeof a === 'string' ? a : a.desc)}</li>`).join('')}</ol>
            <h4>Assessment Plan</h4><p>${esc(p.assessment_plan)}</p>
            <h4>Differentiation</h4><pre style="white-space:pre-wrap;font-family:inherit">${esc(p.differentiation)}</pre>
            ${standards.length > 0 ? '<h4>Standards</h4><ul>' + standards.map(s => `<li>${esc(typeof s === 'string' ? s : s.code)}</li>`).join('') + '</ul>' : ''}
          </div>
        </div>`;
      res.send(renderPage('Export Plan', body, req.session.user));
    }
  }));

  function generateExportHTML(p, objectives, activities, standards) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lesson Plan - ${esc(p.topic)}</title>
      <style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:20px;color:#333}h1{color:#1e40af;border-bottom:3px solid #1e40af;padding-bottom:8px}h2{color:#1e3a8a}h3{color:#374151}ul,ol{line-height:1.8}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #d1d5db;padding:8px;text-align:left}th{background:#eff6ff;font-weight:600}@media print{body{margin:20px}h1{page-break-after:avoid}}</style>
      </head><body>
      <h1>Lesson Plan: ${esc(p.topic)}</h1>
      <table><tr><th>Subject</th><td>${esc(p.subject)}</td><th>Grade</th><td>${esc(p.grade)}</td></tr><tr><th>Duration</th><td>${p.duration_min} minutes</td><th>Status</th><td>${esc(p.status)}</td></tr></table>
      <h2>Learning Objectives</h2><ol>${objectives.map(o => `<li>${esc(typeof o === 'string' ? o : o.text)}</li>`).join('')}</ol>
      <h2>Materials Required</h2><p>${esc(p.materials)}</p>
      <h2>Lesson Activities</h2><table><tr><th>#</th><th>Activity</th><th>Duration</th></tr>${activities.map(a => {
        const desc = typeof a === 'string' ? a : (a.desc || '');
        const dur = typeof a === 'object' && a.duration ? a.duration + ' min' : '';
        const order = typeof a === 'object' && a.order ? a.order : '';
        return `<tr><td>${order}</td><td>${esc(desc)}</td><td>${dur}</td></tr>`;
      }).join('')}</table>
      <h2>Assessment Plan</h2><p>${esc(p.assessment_plan)}</p>
      <h2>Differentiation Strategies</h2><p>${esc(p.differentiation).replace(/\n/g, '<br>')}</p>
      ${standards.length > 0 ? '<h2>Aligned Standards</h2><ul>' + standards.map(s => `<li><strong>${esc(typeof s === 'string' ? s : s.code)}</strong>: ${esc(typeof s === 'object' ? s.description : '')}</li>`).join('') + '</ul>' : ''}
      </body></html>`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/search — Search Plans
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/search', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { q, subject, grade, status } = req.query;
    let where = 'WHERE tenant_id = $1';
    const params = [tid];
    let paramIdx = 2;
    if (q) { where += ` AND (topic ILIKE $${paramIdx} OR subject ILIKE $${paramIdx})`; params.push('%' + q + '%'); paramIdx++; }
    if (subject) { where += ` AND subject = $${paramIdx}`; params.push(subject); paramIdx++; }
    if (grade) { where += ` AND grade = $${paramIdx}`; params.push(grade); paramIdx++; }
    if (status) { where += ` AND status = $${paramIdx}`; params.push(status); paramIdx++; }
    const { rows } = await pool.query(`SELECT * FROM lesson_plans_v2 ${where} ORDER BY updated_at DESC LIMIT 100`, params);
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:16px">Search Lesson Plans</h1>
      <form method="get" action="/school/lesson-planner-v2/search" style="margin-bottom:20px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;align-items:end">
        <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Search topics, subjects..."></div>
        <div><label>Subject</label><select name="subject"><option value="">All</option>${SUBJECTS.map(s => `<option value="${esc(s)}" ${subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label>Grade</label><select name="grade"><option value="">All</option>${GRADES.map(g => `<option value="${esc(g)}" ${grade === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
        <div><label>Status</label><select name="status"><option value="">All</option><option value="draft" ${status === 'draft' ? 'selected' : ''}>Draft</option><option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option></select></div>
        <button type="submit" class="btn">Search</button>
      </form>
      <div class="card">
        <p style="color:${GRAY};margin-bottom:12px">${rows.length} result(s) found</p>
        <table>
          <thead><tr><th>Topic</th><th>Subject</th><th>Grade</th><th>Status</th><th>Version</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>${rows.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No results found</td></tr>' :
            rows.map(r => `<tr>
              <td><a href="/school/lesson-planner-v2/view/${r.id}" style="color:${P};text-decoration:none">${esc(r.topic || 'Untitled')}</a></td>
              <td>${esc(r.subject)}</td><td>${esc(r.grade)}</td>
              <td><span style="color:${r.status === 'completed' ? '#059669' : r.status === 'draft' ? '#f59e0b' : GRAY}">${esc(r.status)}</span></td>
              <td>v${r.version}</td><td>${r.updated_at ? new Date(r.updated_at).toLocaleDateString() : ''}</td>
              <td><a href="/school/lesson-planner-v2/view/${r.id}" class="btn" style="padding:4px 8px;font-size:0.8em;text-decoration:none">View</a>
                <a href="/school/lesson-planner-v2/edit/${r.id}" class="btn" style="padding:4px 8px;font-size:0.8em;text-decoration:none;background:#059669">Edit</a></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    res.send(renderPage('Search Plans', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/objectives-builder — Objectives Builder
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/objectives-builder', requireAuth, ah(async (req, res) => {
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Learning Objectives Builder</h1>
      <p style="color:${GRAY};margin-bottom:20px">Craft standards-aligned learning objectives using Bloom's Taxonomy</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Bloom's Taxonomy Levels</h3>
          ${['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].map((level, i) => {
            const colors = ['#ef4444', '#f59e0b', '#eab308', '#059669', '#4f46e5', '#8b5cf6'];
            const verbs = {
              'Remember': 'Define, List, Name, Identify, Recall, Recognize',
              'Understand': 'Describe, Explain, Summarize, Interpret, Classify, Compare',
              'Apply': 'Demonstrate, Use, Solve, Implement, Illustrate, Calculate',
              'Analyze': 'Differentiate, Organize, Relate, Compare, Contrast, Examine',
              'Evaluate': 'Judge, Justify, Critique, Assess, Prioritize, Recommend',
              'Create': 'Design, Construct, Develop, Compose, Formulate, Generate'
            };
            return `<div style="padding:10px;margin-bottom:8px;background:${colors[i]}15;border-left:4px solid ${colors[i]};border-radius:4px">
              <strong style="color:${colors[i]}">${level}</strong>
              <p style="margin:4px 0 0;font-size:0.85em;color:#374151">Verbs: ${esc(verbs[level])}</p>
            </div>`;
          }).join('')}
        </div>
        <div class="card">
          <h3 style="margin-top:0;color:${P}">Objective Generator</h3>
          <div style="margin-bottom:12px">
            <label>Subject</label><select id="obj-subject">${SUBJECTS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
          </div>
          <div style="margin-bottom:12px">
            <label>Topic</label><input type="text" id="obj-topic" placeholder="Enter topic...">
          </div>
          <div style="margin-bottom:12px">
            <label>Bloom's Level</label><select id="obj-bloom">${['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].map(l => `<option value="${l}">${l}</option>`).join('')}</select>
          </div>
          <button type="button" onclick="generateObjective()" class="btn" style="background:#7c3aed">Generate Objectives</button>
          <div id="obj-results" style="margin-top:16px"></div>
        </div>
      </div>
      <script>
        var verbs = {
          'Remember': ['identify', 'list', 'define', 'recall', 'recognize', 'name'],
          'Understand': ['describe', 'explain', 'summarize', 'interpret', 'classify', 'compare'],
          'Apply': ['demonstrate', 'use', 'solve', 'implement', 'illustrate', 'calculate'],
          'Analyze': ['differentiate', 'organize', 'relate', 'examine', 'distinguish', 'deconstruct'],
          'Evaluate': ['judge', 'justify', 'critique', 'assess', 'prioritize', 'recommend'],
          'Create': ['design', 'construct', 'develop', 'compose', 'formulate', 'generate']
        };
        function generateObjective(){
          var subject = document.getElementById('obj-subject').value;
          var topic = document.getElementById('obj-topic').value || 'the topic';
          var bloom = document.getElementById('obj-bloom').value;
          var v = verbs[bloom];
          var results = '';
          for(var i = 0; i < 4; i++){
            var verb = v[Math.floor(Math.random()*v.length)];
            var templates = [
              'Students will be able to ' + verb + ' the key concepts of ' + topic + '.',
              'Students will be able to ' + verb + ' how ' + topic + ' relates to ' + subject.toLowerCase() + '.',
              'Students will be able to ' + verb + ' examples of ' + topic + ' in context.',
              'Students will be able to ' + verb + ' and communicate their understanding of ' + topic + '.'
            ];
            results += '<div style="padding:8px;background:#f9fafb;border-radius:6px;margin-bottom:6px;border-left:3px solid #4f46e5">' + templates[i] + '</div>';
          }
          document.getElementById('obj-results').innerHTML = '<h4 style="color:#4f46e5">Suggested Objectives (' + bloom + ')</h4>' + results;
        }
      </script>`;
    res.send(renderPage('Objectives Builder', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/curriculum-map — Curriculum Map
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/curriculum-map', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query(`
      SELECT subject, grade, COUNT(*)::int AS plan_count,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count
      FROM lesson_plans_v2 WHERE tenant_id = $1 GROUP BY subject, grade ORDER BY subject, grade`, [tid]);
    const subjects = [...new Set(rows.map(r => r.subject))];
    const grades = [...new Set(rows.map(r => r.grade))];
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Curriculum Map</h1>
      <p style="color:${GRAY};margin-bottom:20px">Visual overview of lesson plan coverage across subjects and grades</p>
      <div style="overflow-x:auto">
        <div class="card">
          ${rows.length === 0 ? '<p style="color:'+GRAY+';text-align:center">No lesson plans yet to map. Create plans to see your curriculum coverage.</p>' : `
          <table>
            <thead><tr><th>Subject \\ Grade</th>${grades.map(g => `<th style="font-size:0.85em">${esc(g)}</th>`).join('')}<th>Total</th></tr></thead>
            <tbody>${subjects.map(sub => {
              const subRows = rows.filter(r => r.subject === sub);
              const total = subRows.reduce((a, r) => a + r.plan_count, 0);
              return `<tr><td><strong>${esc(sub)}</strong></td>${grades.map(g => {
                const cell = subRows.find(r => r.grade === g);
                const count = cell ? cell.plan_count : 0;
                const completed = cell ? cell.completed_count : 0;
                const bg = count === 0 ? '#f9fafb' : count >= 3 ? '#dcfce7' : '#fef3c7';
                return `<td style="background:${bg};text-align:center;font-weight:bold">${count}${completed > 0 ? `<br><span style="font-size:0.75em;color:#059669">${completed} done</span>` : ''}</td>`;
              }).join('')}<td style="text-align:center;font-weight:bold;color:${P}">${total}</td></tr>`;
            }).join('')}</tbody>
          </table>`}
        </div>
      </div>`;
    res.send(renderPage('Curriculum Map', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/differentiation — Diff Strategies
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/differentiation', requireAuth, ah(async (req, res) => {
    const strategies = [
      { category: 'Content', items: ['Varied reading levels', 'Audio/video materials', 'Graphic organizers', 'Real-world connections', 'Tiered assignments'] },
      { category: 'Process', items: ['Flexible grouping', 'Learning centers', 'Choice boards', 'Scaffolding', 'Tiered activities'] },
      { category: 'Product', items: ['Multiple assessment formats', 'Student choice in presentation', 'Portfolio options', 'Rubric differentiation', 'Self-assessment tools'] },
      { category: 'Environment', items: ['Quiet workspace option', 'Standing desk option', 'Preferential seating', 'Fidget tools available', 'Reduced distractions area'] }
    ];
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Differentiation Strategies</h1>
      <p style="color:${GRAY};margin-bottom:20px">Reference guide for differentiating instruction in your lesson plans</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${strategies.map(s => `<div class="card">
          <h3 style="margin-top:0;color:${P}">${esc(s.category)}</h3>
          <ul>${s.items.map(item => `<li style="margin-bottom:6px;padding:8px;background:#f9fafb;border-radius:6px">${esc(item)}</li>`).join('')}</ul>
        </div>`).join('')}
      </div>
      <div class="card" style="margin-top:16px">
        <h3 style="margin-top:0;color:${P}">Quick Differentiation Generator</h3>
        <form method="post" action="/school/lesson-planner-v2/differentiation" style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end">
          <div><label>Subject</label><select name="subject">${SUBJECTS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
          <div><label>Focus Area</label><select name="focus"><option>Content</option><option>Process</option><option>Product</option><option>Environment</option></select></div>
          <button type="submit" class="btn" style="background:#7c3aed">Generate</button>
        </form>
      </div>`;
    res.send(renderPage('Differentiation', body, req.session.user));
  }));

  app.post('/school/lesson-planner-v2/differentiation', requireAuth, ah(async (req, res) => {
    const { subject, focus } = req.body;
    const templates = {
      Content: `For ${subject}: Provide texts at multiple reading levels. Offer visual summaries and vocabulary lists for struggling learners. Include extension readings and research opportunities for advanced students.`,
      Process: `For ${subject}: Use flexible grouping based on formative assessment data. Provide step-by-step guides for foundational learners and open-ended exploration tasks for advanced students.`,
      Product: `For ${subject}: Allow students to demonstrate understanding through written reports, oral presentations, multimedia projects, or artistic representations based on their strengths.`,
      Environment: `For ${subject}: Create a flexible workspace with options for collaboration and independent study. Ensure assistive technology is available and provide a calm corner for students who need breaks.`
    };
    const result = templates[focus] || templates.Content;
    const body = `${SKIP}
      <div class="card">
        <h1 style="color:${P};margin-top:0">Generated Differentiation Strategy</h1>
        <p><strong>Subject:</strong> ${esc(subject)} &bull; <strong>Focus:</strong> ${esc(focus)}</p>
        <div style="padding:16px;background:#f0f9ff;border-radius:8px;border-left:4px solid #4f46e5;margin:16px 0">
          <p style="margin:0;line-height:1.8">${esc(result)}</p>
        </div>
        <a href="/school/lesson-planner-v2/differentiation" class="btn" style="text-decoration:none">Generate Another</a>
      </div>`;
    res.send(renderPage('Differentiation Result', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/assessment-builder — Assessment Builder
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/assessment-builder', requireAuth, ah(async (req, res) => {
    const types = [
      { name: 'Formative', desc: 'Ongoing checks for understanding during the lesson', color: '#059669' },
      { name: 'Summative', desc: 'End-of-unit tests, projects, or performance tasks', color: '#4f46e5' },
      { name: 'Diagnostic', desc: 'Pre-assessment to determine student readiness', color: '#f59e0b' },
      { name: 'Self-Assessment', desc: 'Student reflection and self-evaluation tools', color: '#8b5cf6' },
      { name: 'Peer Assessment', desc: 'Structured feedback between students', color: '#ec4899' }
    ];
    const body = `${SKIP}
      <h1 style="color:${P};margin-bottom:4px">Assessment Integration Builder</h1>
      <p style="color:${GRAY};margin-bottom:20px">Design comprehensive assessment plans for your lessons</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:20px">
        ${types.map(t => `<div class="card" style="border-top:4px solid ${t.color}">
          <h3 style="margin:0 0 8px;color:${t.color}">${esc(t.name)}</h3>
          <p style="color:#374151;font-size:0.9em;margin:0">${esc(t.desc)}</p>
        </div>`).join('')}
      </div>
      <div class="card">
        <h3 style="margin-top:0;color:${P}">Quick Assessment Plan Generator</h3>
        <form method="post" action="/school/lesson-planner-v2/assessment-builder" style="display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end">
          <div><label>Subject</label><select name="subject">${SUBJECTS.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
          <div><label>Topic</label><input type="text" name="topic" placeholder="Enter topic..." required></div>
          <button type="submit" class="btn" style="background:#7c3aed">Generate Plan</button>
        </form>
      </div>`;
    res.send(renderPage('Assessment Builder', body, req.session.user));
  }));

  app.post('/school/lesson-planner-v2/assessment-builder', requireAuth, ah(async (req, res) => {
    const { subject, topic } = req.body;
    const plan = {
      formative: `During the lesson on ${topic}: Use exit tickets, thumbs-up/down checks, and mini-whiteboard responses every 5-10 minutes. Observe group discussions and circulate to ask probing questions.`,
      summative: `End of unit on ${topic}: Administer a comprehensive assessment combining multiple-choice, short-answer, and extended-response questions. Include a performance task requiring real-world application.`,
      self_assessment: `Provide students with a rubric and reflection checklist for ${topic}. Students rate their understanding on a 1-4 scale and identify areas where they need additional support.`,
      peer_assessment: `Structure pair-share activities where students evaluate each other's work on ${topic} using guided feedback forms with specific criteria.`
    };
    const body = `${SKIP}
      <div class="card">
        <h1 style="color:${P};margin-top:0">Assessment Plan for ${esc(topic)}</h1>
        <p><strong>Subject:</strong> ${esc(subject)}</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="card" style="border-left:4px solid #059669"><h3 style="margin-top:0;color:#059669">Formative Assessment</h3><p>${esc(plan.formative)}</p></div>
        <div class="card" style="border-left:4px solid #4f46e5"><h3 style="margin-top:0;color:#4f46e5">Summative Assessment</h3><p>${esc(plan.summative)}</p></div>
        <div class="card" style="border-left:4px solid #8b5cf6"><h3 style="margin-top:0;color:#8b5cf6">Self-Assessment</h3><p>${esc(plan.self_assessment)}</p></div>
        <div class="card" style="border-left:4px solid #ec4899"><h3 style="margin-top:0;color:#ec4899">Peer Assessment</h3><p>${esc(plan.peer_assessment)}</p></div>
      </div>
      <div style="margin-top:16px"><a href="/school/lesson-planner-v2/assessment-builder" class="btn" style="text-decoration:none">Generate Another</a></div>`;
    res.send(renderPage('Assessment Plan', body, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  //  ROUTE: GET /school/lesson-planner-v2/api/stats — JSON Stats API
  // ═══════════════════════════════════════════════════════════════
  app.get('/school/lesson-planner-v2/api/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stats = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE shared = true)::int AS shared,
        COUNT(DISTINCT subject)::int AS subjects
      FROM lesson_plans_v2 WHERE tenant_id = $1`, [tid]);
    const templates = await pool.query(`SELECT COUNT(*)::int AS count FROM lesson_templates WHERE tenant_id = $1`, [tid]);
    res.json({ ...stats.rows[0], templates: templates.rows[0].count });
  }));
};
