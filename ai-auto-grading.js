/**
 * AI Auto-Grading Module — SaaS School Portal
 * Features: AI Auto-Grading, Plagiarism Detection, AI Exam Question Generator
 */

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const requireNotBanned = opts.requireNotBanned || ((req,res,next) => { next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = global.trackRevenue || opts.trackRevenue || (() => {});

  const P = '#4f46e5';
  const S = '#059669';
  const W = '#f59e0b';
  const D = '#dc2626';
  const GRAY = '#6b7280';
  const BG = '#f9fafb';
  const SKIP = '<a href="#main-content" style="position:absolute;left:-9999px;top:0;z-index:999" tabindex="0">Skip to content</a>';

  // ─── AI Grading Engine (no external API) ───
  function scoreSubmission(text, rubricKeywords) {
    if (!text || text.trim().length === 0) return { grade: 'F', score: 0, rubric: { content: 0, grammar: 0, organization: 0, creativity: 0 }, feedback: 'No submission text provided.' };
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCount = Math.max(sentences.length, 1);
    const avgWordsPerSentence = wordCount / sentenceCount;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const paragraphCount = Math.max(paragraphs.length, 1);
    const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
    const vocabularyRichness = uniqueWords.size / Math.max(wordCount, 1);

    // Content (40%) — length, keyword presence, depth
    let contentScore = 0;
    if (wordCount >= 500) contentScore += 35;
    else if (wordCount >= 300) contentScore += 28;
    else if (wordCount >= 150) contentScore += 20;
    else if (wordCount >= 50) contentScore += 12;
    else contentScore += 5;
    if (rubricKeywords && Array.isArray(rubricKeywords)) {
      const lowerText = text.toLowerCase();
      const kwFound = rubricKeywords.filter(kw => lowerText.includes(kw.toLowerCase()));
      contentScore += Math.min(5, kwFound.length);
    }
    contentScore = Math.min(40, contentScore);

    // Grammar (20%) — capitalization, punctuation, sentence structure
    let grammarScore = 0;
    const capsStart = sentences.filter(s => /^[A-Z]/.test(s.trim())).length;
    grammarScore += Math.min(8, (capsStart / sentenceCount) * 8);
    const punctEnd = sentences.filter(s => /[.!?]$/.test(s.trim())).length;
    grammarScore += Math.min(6, (punctEnd / sentenceCount) * 6);
    const tooLong = sentences.filter(s => s.trim().split(/\s+/).length > 30).length;
    if (tooLong === 0) grammarScore += 4;
    else if (tooLong <= 2) grammarScore += 2;
    const noRunOn = sentences.filter(s => s.trim().split(/\s+/).length < 5).length;
    if (noRunOn === 0 || noRunOn <= 1) grammarScore += 2;
    grammarScore = Math.min(20, grammarScore);

    // Organization (20%) — paragraphs, structure, transitions
    let orgScore = 0;
    if (paragraphCount >= 4) orgScore += 8;
    else if (paragraphCount >= 3) orgScore += 6;
    else if (paragraphCount >= 2) orgScore += 4;
    else orgScore += 1;
    const transitions = ['however', 'therefore', 'moreover', 'furthermore', 'additionally', 'consequently', 'nevertheless', 'meanwhile', 'similarly', 'in contrast', 'for example', 'in conclusion', 'firstly', 'secondly', 'finally', 'on the other hand', 'as a result', 'in addition'];
    const transLower = text.toLowerCase();
    const transFound = transitions.filter(t => transLower.includes(t));
    orgScore += Math.min(6, transFound.length * 2);
    const hasIntro = text.length > 0 && text.trim()[0] === text.trim()[0].toUpperCase();
    if (hasIntro) orgScore += 3;
    if (paragraphCount > 0 && text.trim().slice(-1) === '.') orgScore += 3;
    orgScore = Math.min(20, orgScore);

    // Creativity (20%) — vocabulary, sentence variety, unique phrasing
    let creatScore = 0;
    creatScore += Math.min(8, vocabularyRichness * 20);
    const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);
    const stdDev = Math.sqrt(sentenceLengths.reduce((acc, len) => acc + Math.pow(len - avgWordsPerSentence, 2), 0) / sentenceCount);
    creatScore += Math.min(6, stdDev * 1.5);
    if (wordCount > 0 && (text.includes('"') || text.includes("'"))) creatScore += 3;
    if (text.includes('?') && sentences.filter(s => s.trim().endsWith('?')).length >= 1) creatScore += 3;
    creatScore = Math.min(20, creatScore);

    const totalScore = Math.round(contentScore + grammarScore + orgScore + creatScore);
    let grade = 'F';
    if (totalScore >= 90) grade = 'A';
    else if (totalScore >= 80) grade = 'B';
    else if (totalScore >= 70) grade = 'C';
    else if (totalScore >= 60) grade = 'D';
    else grade = 'F';

    const feedback = generateFeedback(grade, contentScore, grammarScore, orgScore, creatScore, wordCount, sentenceCount, paragraphCount);
    return {
      grade,
      score: totalScore,
      rubric: { content: Math.round(contentScore), grammar: Math.round(grammarScore), organization: Math.round(orgScore), creativity: Math.round(creatScore) },
      feedback
    };
  }

  function generateFeedback(grade, content, grammar, org, creat, wc, sc, pc) {
    const lines = [];
    lines.push(`Overall Grade: ${grade} (${content + grammar + org + creat}/100)`);
    lines.push(`Word count: ${wc} across ${sc} sentences in ${pc} paragraph(s).`);
    if (content >= 32) lines.push('Content: Excellent depth and coverage of the topic.');
    else if (content >= 24) lines.push('Content: Good coverage, but could explore the topic more deeply.');
    else lines.push('Content: Needs more detail, examples, and supporting arguments.');
    if (grammar >= 16) lines.push('Grammar: Well-structured sentences with proper punctuation.');
    else if (grammar >= 12) lines.push('Grammar: Generally good, but check for punctuation and run-on sentences.');
    else lines.push('Grammar: Multiple issues detected. Review sentence structure and punctuation rules.');
    if (org >= 16) lines.push('Organization: Well-organized with clear transitions and structure.');
    else if (org >= 12) lines.push('Organization: Structure is present but transitions could be improved.');
    else lines.push('Organization: Consider using paragraphs and transitional phrases more effectively.');
    if (creat >= 16) lines.push('Creativity: Demonstrates strong vocabulary and varied expression.');
    else if (creat >= 12) lines.push('Creativity: Shows some variety; try using more diverse vocabulary.');
    else lines.push('Creativity: Writing could benefit from more varied sentence structures and vocabulary.');
    return lines.join(' ');
  }

  // ─── Plagiarism Engine (n-gram comparison) ───
  function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  }

  function generateNgrams(tokens, n) {
    const ngrams = new Set();
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.add(tokens.slice(i, i + n).join(' '));
    }
    return ngrams;
  }

  function calculateSimilarity(text1, text2) {
    const t1 = tokenize(text1);
    const t2 = tokenize(text2);
    if (t1.length < 3 || t2.length < 3) return 0;
    const n3a = generateNgrams(t1, 3);
    const n3b = generateNgrams(t2, 3);
    let common = 0;
    n3a.forEach(ng => { if (n3b.has(ng)) common++; });
    const union = new Set([...n3a, ...n3b]).size;
    return union === 0 ? 0 : Math.round((common / union) * 10000) / 100;
  }

  function findMatchingPhrases(text1, text2) {
    const t1 = tokenize(text1);
    const t2 = tokenize(text2);
    const matches = [];
    for (let len = 5; len >= 3; len--) {
      for (let i = 0; i <= t1.length - len; i++) {
        const phrase = t1.slice(i, i + len).join(' ');
        const idx = t2.join(' ').indexOf(phrase);
        if (idx !== -1) {
          const before = t1.slice(Math.max(0, i - 2), i).join(' ');
          const after = t1.slice(i + len, i + len + 2).join(' ');
          matches.push({ phrase: (before ? before + ' ' : '') + phrase + (after ? ' ' + after : ''), length: len });
        }
      }
    }
    const unique = [];
    const seen = new Set();
    matches.forEach(m => {
      if (!seen.has(m.phrase)) { seen.add(m.phrase); unique.push(m); }
    });
    return unique.sort((a, b) => b.length - a.length).slice(0, 5);
  }

  // ─── SVG Chart Helpers ───
  function rubricBarChart(rubric) {
    const labels = ['Content', 'Grammar', 'Organization', 'Creativity'];
    const maxes = [40, 20, 20, 20];
    const vals = [rubric.content || 0, rubric.grammar || 0, rubric.organization || 0, rubric.creativity || 0];
    const colors = [P, S, W, '#8b5cf6'];
    let svg = `<svg width="320" height="200" role="img" aria-label="Rubric scores bar chart">`;
    svg += `<rect width="320" height="200" fill="${BG}" rx="8"/>`;
    vals.forEach((v, i) => {
      const pct = Math.min(100, (v / maxes[i]) * 100);
      const y = 15 + i * 46;
      svg += `<text x="8" y="${y + 18}" font-size="12" fill="#374151" font-family="sans-serif">${labels[i]}</text>`;
      svg += `<rect x="120" y="${y + 4}" width="180" height="22" fill="#e5e7eb" rx="4"/>`;
      svg += `<rect x="120" y="${y + 4}" width="${Math.round(pct * 1.8)}" height="22" fill="${colors[i]}" rx="4"/>`;
      svg += `<text x="306" y="${y + 19}" font-size="11" fill="#374151" text-anchor="end" font-family="sans-serif">${v}/${maxes[i]}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  function gradeDistributionChart(grades) {
    const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    grades.forEach(g => { if (counts.hasOwnProperty(g)) counts[g]++; });
    const total = grades.length || 1;
    const colors = { A: S, B: P, C: W, D: '#f97316', F: D };
    let cx = 130, cy = 80, r = 60;
    let startAngle = 0;
    let svg = `<svg width="260" height="180" role="img" aria-label="Grade distribution pie chart">`;
    svg += `<rect width="260" height="180" fill="${BG}" rx="8"/>`;
    Object.keys(counts).forEach(letter => {
      const pct = counts[letter] / total;
      if (pct === 0) return;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle - Math.PI / 2);
      const y1 = cy + r * Math.sin(startAngle - Math.PI / 2);
      const x2 = cx + r * Math.cos(endAngle - Math.PI / 2);
      const y2 = cy + r * Math.sin(endAngle - Math.PI / 2);
      const largeArc = angle > Math.PI ? 1 : 0;
      const lx = cx + (r * 0.65) * Math.cos((startAngle + endAngle) / 2 - Math.PI / 2);
      const ly = cy + (r * 0.65) * Math.sin((startAngle + endAngle) / 2 - Math.PI / 2);
      svg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${colors[letter]}"/>`;
      if (pct > 0.05) svg += `<text x="${lx}" y="${ly}" font-size="11" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">${letter}</text>`;
      startAngle = endAngle;
    });
    let legendX = 210;
    Object.keys(counts).forEach((letter, i) => {
      svg += `<rect x="${legendX}" y="${10 + i * 20}" width="10" height="10" fill="${colors[letter]}" rx="2"/>`;
      svg += `<text x="${legendX + 14}" y="${19 + i * 20}" font-size="11" fill="#374151" font-family="sans-serif">${letter}: ${counts[letter]}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  function similarityGauge(pct) {
    const angle = (Math.min(pct, 100) / 100) * 180;
    const rad = (angle - 90) * Math.PI / 180;
    const r = 55;
    const cx = 80, cy = 80;
    const ex = cx + r * Math.cos(rad);
    const ey = cy + r * Math.sin(rad);
    const color = pct >= 50 ? D : pct >= 30 ? W : S;
    let svg = `<svg width="160" height="100" role="img" aria-label="Similarity gauge: ${pct}%">`;
    svg += `<rect width="160" height="100" fill="${BG}" rx="8"/>`;
    svg += `<path d="M25,75 A55,55 0 0,1 135,75" fill="none" stroke="#e5e7eb" stroke-width="12" stroke-linecap="round"/>`;
    svg += `<path d="M25,75 A55,55 0 ${angle > 90 ? 1 : 0},1 ${ex},${ey}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"/>`;
    svg += `<text x="${cx}" y="${cy - 5}" font-size="20" fill="${color}" text-anchor="middle" font-weight="bold" font-family="sans-serif">${pct}%</text>`;
    svg += `<text x="${cx}" y="${cy + 12}" font-size="10" fill="${GRAY}" text-anchor="middle" font-family="sans-serif">Similarity</text>`;
    svg += '</svg>';
    return svg;
  }

  // ─── Database Setup ───
  (async () => {
    try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_grading_results (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        student_id INTEGER NOT NULL,
        assignment_id INTEGER,
        submission_text TEXT NOT NULL,
        ai_grade VARCHAR(2) NOT NULL DEFAULT 'F',
        ai_score INTEGER NOT NULL DEFAULT 0,
        rubric_scores JSONB DEFAULT '{}',
        feedback TEXT DEFAULT '',
        teacher_override_grade VARCHAR(2),
        teacher_override_notes TEXT DEFAULT '',
        rubric_keywords JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_agr_tenant ON ai_grading_results(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_agr_assignment ON ai_grading_results(assignment_id);
      CREATE INDEX IF NOT EXISTS idx_agr_student ON ai_grading_results(student_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS plagiarism_checks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        submission_id INTEGER NOT NULL REFERENCES ai_grading_results(id),
        text_submitted TEXT NOT NULL,
        similarity_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
        matched_sources JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'pending',
        checked_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pc_tenant ON plagiarism_checks(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_pc_submission ON plagiarism_checks(submission_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_generated_questions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        subject VARCHAR(200) NOT NULL DEFAULT '',
        topic VARCHAR(300) NOT NULL DEFAULT '',
        difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
        question_type VARCHAR(30) NOT NULL DEFAULT 'mcq',
        question_text TEXT NOT NULL DEFAULT '',
        options JSONB DEFAULT '[]',
        answer TEXT NOT NULL DEFAULT '',
        marks INTEGER NOT NULL DEFAULT 5,
        tags JSONB DEFAULT '[]',
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_agq_tenant ON ai_generated_questions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_agq_subject ON ai_generated_questions(subject);
      CREATE INDEX IF NOT EXISTS idx_agq_difficulty ON ai_generated_questions(difficulty);
    `);
    } catch(e) { /* migration error */ }
  })();

  // ══════════════════════════════════════════════
  //  SECTION 1: AI AUTO-GRADING
  // ══════════════════════════════════════════════

  // Landing page
  app.get('/school/ai-grading', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { search, assignment_id } = req.query;
    let where = 'WHERE r.tenant_id = $1';
    const params = [tid];
    if (search) { where += ' AND (r.feedback ILIKE $2 OR r.submission_text ILIKE $2)'; params.push(`%${search}%`); }
    if (assignment_id) { where += ' AND r.assignment_id = $' + (params.length + 1); params.push(assignment_id); }
    const { rows } = await pool.query(
      `SELECT r.*, s.name as student_name FROM ai_grading_results r LEFT JOIN users s ON s.id = r.student_id ${where} ORDER BY r.created_at DESC LIMIT 100`,
      params
    );
    const allGrades = await pool.query(`SELECT ai_grade FROM ai_grading_results WHERE tenant_id = $1`, [tid]);
    const gradeList = allGrades.rows.map(r => r.ai_grade);
    const avgScore = await pool.query(`SELECT ROUND(AVG(ai_score),1) as avg FROM ai_grading_results WHERE tenant_id = $1`, [tid]);

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1100px;margin:0 auto;padding:20px">
      <h1 style="color:${P};font-size:1.8em;margin-bottom:4px">AI Auto-Grading</h1>
      <p style="color:${GRAY};margin-bottom:20px">Intelligent rubric-based essay and homework grading powered by heuristic AI analysis</p>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${P}">${rows.length}</div>
          <div style="color:${GRAY};font-size:0.9em">Total Graded</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${S}">${avgScore.rows[0]?.avg || 0}</div>
          <div style="color:${GRAY};font-size:0.9em">Average Score</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${W}">${rows.filter(r => r.teacher_override_grade).length}</div>
          <div style="color:${GRAY};font-size:0.9em">Teacher Overrides</div>
        </div>
      </div>

      ${gradeList.length > 0 ? `<div style="margin-bottom:24px">${gradeDistributionChart(gradeList)}</div>` : ''}

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <form method="get" action="/school/ai-grading" style="flex:1;min-width:200px">
          <input type="text" name="search" placeholder="Search submissions..." value="${esc(search)}" aria-label="Search grading results"
            style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">
        </form>
        <a href="/school/ai-grading/new" style="display:inline-flex;align-items:center;padding:10px 20px;background:${P};color:white;border-radius:8px;text-decoration:none;font-weight:600;white-space:nowrap">
          + New Submission
        </a>
        <a href="/school/ai-grading/batch" style="display:inline-flex;align-items:center;padding:10px 20px;background:${S};color:white;border-radius:8px;text-decoration:none;font-weight:600;white-space:nowrap">
          Batch Grade
        </a>
      </div>

      <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#f3f4f6">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Student</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Grade</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Score</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Override</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Date</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${GRAY}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="6" style="padding:40px;text-align:center;color:${GRAY}">No grading results yet. Submit an essay to begin.</td></tr>` :
              rows.map(r => {
                const gc = r.ai_grade === 'A' ? S : r.ai_grade === 'B' ? P : r.ai_grade === 'C' ? W : D;
                return `<tr style="border-top:1px solid #f3f4f6">
                  <td style="padding:12px 16px">${esc(r.student_name || 'Student #' + r.student_id)}</td>
                  <td style="padding:12px 16px"><span style="background:${gc};color:white;padding:4px 12px;border-radius:12px;font-weight:bold;font-size:0.85em">${esc(r.ai_grade)}</span></td>
                  <td style="padding:12px 16px;font-weight:600">${r.ai_score}/100</td>
                  <td style="padding:12px 16px">${r.teacher_override_grade ? `<span style="color:${W};font-weight:600">${esc(r.teacher_override_grade)}</span>` : '<span style="color:#9ca3af">—</span>'}</td>
                  <td style="padding:12px 16px;color:${GRAY};font-size:0.85em">${new Date(r.created_at).toLocaleDateString()}</td>
                  <td style="padding:12px 16px;text-align:center">
                    <a href="/school/ai-grading/${r.id}" style="color:${P};text-decoration:none;margin-right:8px" aria-label="View result ${r.id}">View</a>
                    <a href="/school/ai-grading/${r.id}/override" style="color:${W};text-decoration:none" aria-label="Override grade ${r.id}">Override</a>
                  </td>
                </tr>`;
              }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('AI Auto-Grading', body, req.session.user));
  }));

  // New submission form
  app.get('/school/ai-grading/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: students } = await pool.query(`SELECT id, name FROM users WHERE tenant_id = $1 AND role = 'student' ORDER BY name LIMIT 500`, [tid]);
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">New AI Grading Submission</h1>
      <form method="post" action="/school/ai-grading/new" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="margin-bottom:16px">
          <label for="student_id" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Student *</label>
          <select id="student_id" name="student_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
            <option value="">Select student...</option>
            ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:16px">
          <label for="assignment_id" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Assignment ID (optional)</label>
          <input type="number" id="assignment_id" name="assignment_id" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. 42">
        </div>
        <div style="margin-bottom:16px">
          <label for="submission_text" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Essay / Homework Text *</label>
          <textarea id="submission_text" name="submission_text" required rows="12" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;font-family:monospace;resize:vertical;box-sizing:border-box" aria-required="true" placeholder="Paste the student's submission here..."></textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="rubric_keywords" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Rubric Keywords (comma-separated)</label>
          <input type="text" id="rubric_keywords" name="rubric_keywords" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. photosynthesis, chloroplast, light energy">
        </div>
        <button type="submit" style="padding:12px 32px;background:${P};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">
          Submit &amp; Grade with AI
        </button>
      </form>
    </div>`;
    res.send(renderPage('New AI Grading Submission', body, req.session.user));
  }));

  // Process new submission
  app.post('/school/ai-grading/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { student_id, assignment_id, submission_text, rubric_keywords } = req.body;
    if (!student_id || !submission_text || !submission_text.trim()) {
      return res.status(400).send('Student and submission text are required.');
    }
    const keywords = rubric_keywords ? rubric_keywords.split(',').map(k => k.trim()).filter(k => k) : [];
    const result = scoreSubmission(submission_text, keywords);
    const { rows } = await pool.query(
      `INSERT INTO ai_grading_results (tenant_id, student_id, assignment_id, submission_text, ai_grade, ai_score, rubric_scores, feedback, rubric_keywords)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tid, student_id, assignment_id || null, submission_text, result.grade, result.score, JSON.stringify(result.rubric), result.feedback, JSON.stringify(keywords)]
    );
    audit(req, 'ai_grading_create', { id: rows[0].id, grade: result.grade, score: result.score });
    res.redirect(`/school/ai-grading/${rows[0].id}`);
  }));

  // View single grading result
  app.get('/school/ai-grading/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [r] } = await pool.query(
      `SELECT r.*, s.name as student_name FROM ai_grading_results r LEFT JOIN users s ON s.id = r.student_id WHERE r.id = $1 AND r.tenant_id = $2`,
      [req.params.id, tid]
    );
    if (!r) return res.status(404).send('Grading result not found.');
    const rubric = typeof r.rubric_scores === 'string' ? JSON.parse(r.rubric_scores) : (r.rubric_scores || {});
    const gc = r.ai_grade === 'A' ? S : r.ai_grade === 'B' ? P : r.ai_grade === 'C' ? W : D;
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <a href="/school/ai-grading" style="color:${P};text-decoration:none;font-size:0.9em">&larr; Back to Results</a>
        <h1 style="color:${P};margin:0">Grading Result #${r.id}</h1>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
        <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:260px">
          <div style="margin-bottom:12px"><strong>Student:</strong> ${esc(r.student_name || 'Student #' + r.student_id)}</div>
          <div style="margin-bottom:12px"><strong>Assignment:</strong> ${r.assignment_id ? esc(String(r.assignment_id)) : 'N/A'}</div>
          <div style="margin-bottom:12px"><strong>Date:</strong> ${new Date(r.created_at).toLocaleString()}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <strong>AI Grade:</strong>
            <span style="background:${gc};color:white;padding:6px 18px;border-radius:14px;font-weight:bold;font-size:1.2em">${esc(r.ai_grade)}</span>
            <span style="font-size:1.2em;font-weight:600">${r.ai_score}/100</span>
          </div>
          ${r.teacher_override_grade ? `<div style="color:${W};font-weight:600">Teacher Override: ${esc(r.teacher_override_grade)}${r.teacher_override_notes ? ' — ' + esc(r.teacher_override_notes) : ''}</div>` : ''}
        </div>
        <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:260px">
          ${rubricBarChart(rubric)}
        </div>
      </div>

      <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px">
        <h2 style="color:#374151;margin-bottom:10px">AI Feedback</h2>
        <p style="color:#4b5563;line-height:1.7;white-space:pre-wrap">${esc(r.feedback)}</p>
      </div>

      <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px">
        <h2 style="color:#374151;margin-bottom:10px">Submission Text</h2>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;max-height:400px;overflow-y:auto;white-space:pre-wrap;font-family:monospace;font-size:0.9em;color:#374151">${esc(r.submission_text)}</div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/school/ai-grading/${r.id}/override" style="display:inline-flex;align-items:center;padding:10px 20px;background:${W};color:white;border-radius:8px;text-decoration:none;font-weight:600">Override Grade</a>
        <a href="/school/plagiarism/check?submission_id=${r.id}" style="display:inline-flex;align-items:center;padding:10px 20px;background:${D};color:white;border-radius:8px;text-decoration:none;font-weight:600">Check Plagiarism</a>
      </div>
    </div>`;
    res.send(renderPage('Grading Result #' + r.id, body, req.session.user));
  }));

  // Override grade form
  app.get('/school/ai-grading/:id/override', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [r] } = await pool.query(`SELECT * FROM ai_grading_results WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (!r) return res.status(404).send('Result not found.');
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:600px;margin:0 auto;padding:20px">
      <h1 style="color:${W};margin-bottom:20px">Override AI Grade for Result #${r.id}</h1>
      <div style="background:#fef3c7;border:1px solid ${W};border-radius:8px;padding:16px;margin-bottom:20px">
        <strong>Current AI Grade:</strong> ${esc(r.ai_grade)} (${r.ai_score}/100)
      </div>
      <form method="post" action="/school/ai-grading/${r.id}/override" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="margin-bottom:16px">
          <label for="override_grade" style="display:block;font-weight:600;margin-bottom:4px">New Grade *</label>
          <select id="override_grade" name="override_grade" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
            <option value="">Select grade...</option>
            <option value="A" ${r.teacher_override_grade === 'A' ? 'selected' : ''}>A</option>
            <option value="B" ${r.teacher_override_grade === 'B' ? 'selected' : ''}>B</option>
            <option value="C" ${r.teacher_override_grade === 'C' ? 'selected' : ''}>C</option>
            <option value="D" ${r.teacher_override_grade === 'D' ? 'selected' : ''}>D</option>
            <option value="F" ${r.teacher_override_grade === 'F' ? 'selected' : ''}>F</option>
          </select>
        </div>
        <div style="margin-bottom:16px">
          <label for="override_notes" style="display:block;font-weight:600;margin-bottom:4px">Override Reason / Notes</label>
          <textarea id="override_notes" name="override_notes" rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box" placeholder="Explain why you are overriding the AI grade...">${esc(r.teacher_override_notes || '')}</textarea>
        </div>
        <button type="submit" style="padding:12px 32px;background:${W};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Save Override</button>
      </form>
    </div>`;
    res.send(renderPage('Override Grade', body, req.session.user));
  }));

  app.post('/school/ai-grading/:id/override', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { override_grade, override_notes } = req.body;
    if (!override_grade) return res.status(400).send('Grade is required.');
    await pool.query(
      `UPDATE ai_grading_results SET teacher_override_grade = $1, teacher_override_notes = $2 WHERE id = $3 AND tenant_id = $4`,
      [override_grade, override_notes || '', req.params.id, tid]
    );
    audit(req, 'ai_grading_override', { id: req.params.id, override_grade });
    res.redirect(`/school/ai-grading/${req.params.id}`);
  }));

  // Batch grading page
  app.get('/school/ai-grading/batch', requireAuth, requireNotBanned, ah(async (req, res) => {
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:8px">Batch AI Grading</h1>
      <p style="color:${GRAY};margin-bottom:20px">Grade all submissions for an assignment at once. Paste each submission separated by a blank line with the format: <code>Student Name | Submission Text</code></p>
      <form method="post" action="/school/ai-grading/batch" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="margin-bottom:16px">
          <label for="assignment_id" style="display:block;font-weight:600;margin-bottom:4px">Assignment ID *</label>
          <input type="number" id="assignment_id" name="assignment_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="Enter assignment ID">
        </div>
        <div style="margin-bottom:16px">
          <label for="batch_text" style="display:block;font-weight:600;margin-bottom:4px">Batch Submissions *</label>
          <textarea id="batch_text" name="batch_text" required rows="15" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:0.95em;font-family:monospace;resize:vertical;box-sizing:border-box"
            aria-required="true"
            placeholder="Student Name | Essay text here...
Another Student | Their essay here...

Format: Student Name | Submission text (one per paragraph)"></textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="rubric_keywords" style="display:block;font-weight:600;margin-bottom:4px">Rubric Keywords (comma-separated)</label>
          <input type="text" id="rubric_keywords" name="rubric_keywords" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. climate change, greenhouse gases, carbon footprint">
        </div>
        <button type="submit" style="padding:12px 32px;background:${S};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Grade All Submissions</button>
      </form>
    </div>`;
    res.send(renderPage('Batch AI Grading', body, req.session.user));
  }));

  app.post('/school/ai-grading/batch', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { assignment_id, batch_text, rubric_keywords } = req.body;
    if (!assignment_id || !batch_text) return res.status(400).send('Assignment ID and batch text are required.');
    const keywords = rubric_keywords ? rubric_keywords.split(',').map(k => k.trim()).filter(k => k) : [];
    const blocks = batch_text.split(/\n\s*\n/).filter(b => b.trim());
    let processed = 0;
    for (const block of blocks) {
      const sepIdx = block.indexOf('|');
      if (sepIdx === -1) continue;
      const studentName = block.substring(0, sepIdx).trim();
      const text = block.substring(sepIdx + 1).trim();
      if (!studentName || !text) continue;
      // Find student by name
      const { rows: [student] } = await pool.query(`SELECT id FROM users WHERE tenant_id = $1 AND name ILIKE $2 LIMIT 1`, [tid, studentName]);
      const studentId = student ? student.id : null;
      const result = scoreSubmission(text, keywords);
      await pool.query(
        `INSERT INTO ai_grading_results (tenant_id, student_id, assignment_id, submission_text, ai_grade, ai_score, rubric_scores, feedback, rubric_keywords) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tid, studentId, assignment_id, text, result.grade, result.score, JSON.stringify(result.rubric), result.feedback, JSON.stringify(keywords)]
      );
      processed++;
    }
    audit(req, 'ai_grading_batch', { assignment_id, count: processed });
    res.redirect('/school/ai-grading?batch_done=' + processed);
  }));

  // ══════════════════════════════════════════════
  //  SECTION 2: PLAGIARISM DETECTION
  // ══════════════════════════════════════════════

  // Plagiarism dashboard
  app.get('/school/plagiarism', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: checks } = await pool.query(
      `SELECT pc.*, r.student_id, s.name as student_name FROM plagiarism_checks pc
       LEFT JOIN ai_grading_results r ON r.id = pc.submission_id
       LEFT JOIN users s ON s.id = r.student_id
       WHERE pc.tenant_id = $1 ORDER BY pc.checked_at DESC LIMIT 100`, [tid]
    );
    const flagged = checks.filter(c => c.similarity_pct >= 30).length;
    const avgSim = checks.length > 0 ? (checks.reduce((a, c) => a + parseFloat(c.similarity_pct || 0), 0) / checks.length).toFixed(1) : 0;

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1100px;margin:0 auto;padding:20px">
      <h1 style="color:${P};font-size:1.8em;margin-bottom:4px">Plagiarism Detection</h1>
      <p style="color:${GRAY};margin-bottom:20px">Check submissions for similarity against previously submitted work using n-gram analysis</p>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${P}">${checks.length}</div>
          <div style="color:${GRAY};font-size:0.9em">Total Checks</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${D}">${flagged}</div>
          <div style="color:${GRAY};font-size:0.9em">Flagged (&ge;30%)</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${W}">${avgSim}%</div>
          <div style="color:${GRAY};font-size:0.9em">Avg Similarity</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/school/plagiarism/new" style="display:inline-flex;align-items:center;padding:10px 20px;background:${P};color:white;border-radius:8px;text-decoration:none;font-weight:600">+ New Check</a>
        <a href="/school/plagiarism/report" style="display:inline-flex;align-items:center;padding:10px 20px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;font-weight:600">View Report</a>
      </div>

      <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#f3f4f6">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Student</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Similarity</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Status</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Matches</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Checked</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${GRAY}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${checks.length === 0 ? `<tr><td colspan="6" style="padding:40px;text-align:center;color:${GRAY}">No plagiarism checks yet.</td></tr>` :
              checks.map(c => {
                const pct = parseFloat(c.similarity_pct || 0);
                const color = pct >= 50 ? D : pct >= 30 ? W : S;
                const sources = typeof c.matched_sources === 'string' ? JSON.parse(c.matched_sources) : (c.matched_sources || []);
                return `<tr style="border-top:1px solid #f3f4f6">
                  <td style="padding:12px 16px">${esc(c.student_name || 'Student #' + c.student_id)}</td>
                  <td style="padding:12px 16px"><span style="color:${color};font-weight:bold">${pct}%</span></td>
                  <td style="padding:12px 16px">
                    <span style="background:${c.status === 'flagged' ? '#fef2f2' : c.status === 'passed' ? '#ecfdf5' : '#f9fafb'};color:${c.status === 'flagged' ? D : c.status === 'passed' ? S : GRAY};padding:3px 10px;border-radius:10px;font-size:0.8em;font-weight:600">${esc(c.status || 'pending')}</span>
                  </td>
                  <td style="padding:12px 16px;font-size:0.85em">${sources.length} source(s)</td>
                  <td style="padding:12px 16px;color:${GRAY};font-size:0.85em">${new Date(c.checked_at).toLocaleDateString()}</td>
                  <td style="padding:12px 16px;text-align:center">
                    <a href="/school/plagiarism/${c.id}" style="color:${P};text-decoration:none" aria-label="View check ${c.id}">Details</a>
                  </td>
                </tr>`;
              }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('Plagiarism Detection', body, req.session.user));
  }));

  // Quick check from grading result
  app.get('/school/plagiarism/check', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { submission_id } = req.query;
    if (!submission_id) return res.redirect('/school/plagiarism/new');
    res.redirect(`/school/plagiarism/new?submission_id=${submission_id}`);
  }));

  // New plagiarism check
  app.get('/school/plagiarism/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { submission_id } = req.query;
    let prefillText = '';
    if (submission_id) {
      const { rows: [sub] } = await pool.query(`SELECT submission_text FROM ai_grading_results WHERE id = $1 AND tenant_id = $2`, [submission_id, tid]);
      if (sub) prefillText = sub.submission_text;
    }
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">New Plagiarism Check</h1>
      <form method="post" action="/school/plagiarism/new" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        ${submission_id ? `<input type="hidden" name="submission_id" value="${esc(submission_id)}">` : ''}
        <div style="margin-bottom:16px">
          <label for="text_submitted" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Text to Check *</label>
          <textarea id="text_submitted" name="text_submitted" required rows="12" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:0.95em;font-family:monospace;resize:vertical;box-sizing:border-box" aria-required="true"
            placeholder="Paste the text to check for plagiarism...">${esc(prefillText)}</textarea>
        </div>
        <button type="submit" style="padding:12px 32px;background:${D};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">
          Run Plagiarism Check
        </button>
      </form>
    </div>`;
    res.send(renderPage('New Plagiarism Check', body, req.session.user));
  }));

  app.post('/school/plagiarism/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { text_submitted, submission_id } = req.body;
    if (!text_submitted || !text_submitted.trim()) return res.status(400).send('Text is required.');

    // Fetch all previous submissions to compare against
    const { rows: previous } = await pool.query(
      `SELECT id, student_id, submission_text, created_at FROM ai_grading_results WHERE tenant_id = $1 AND id != $2 ORDER BY created_at DESC`,
      [tid, submission_id || 0]
    );

    // Also check the submission against itself if submission_id is given (skip it)
    const matchedSources = [];
    let maxSimilarity = 0;
    for (const prev of previous) {
      if (submission_id && String(prev.id) === String(submission_id)) continue;
      const sim = calculateSimilarity(text_submitted, prev.submission_text);
      if (sim > 5) {
        const phrases = findMatchingPhrases(text_submitted, prev.submission_text);
        matchedSources.push({
          source_id: prev.id,
          student_id: prev.student_id,
          similarity: sim,
          phrases: phrases.map(p => p.phrase)
        });
        if (sim > maxSimilarity) maxSimilarity = sim;
      }
    }
    matchedSources.sort((a, b) => b.similarity - a.similarity);
    const status = maxSimilarity >= 50 ? 'flagged' : maxSimilarity >= 30 ? 'review' : 'passed';

    const { rows } = await pool.query(
      `INSERT INTO plagiarism_checks (tenant_id, submission_id, text_submitted, similarity_pct, matched_sources, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tid, submission_id || null, text_submitted, maxSimilarity, JSON.stringify(matchedSources.slice(0, 10)), status]
    );
    audit(req, 'plagiarism_check', { id: rows[0].id, similarity: maxSimilarity, status, sources: matchedSources.length });
    res.redirect(`/school/plagiarism/${rows[0].id}`);
  }));

  // Plagiarism check details
  app.get('/school/plagiarism/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [c] } = await pool.query(`SELECT * FROM plagiarism_checks WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (!c) return res.status(404).send('Check not found.');
    const pct = parseFloat(c.similarity_pct || 0);
    const sources = typeof c.matched_sources === 'string' ? JSON.parse(c.matched_sources) : (c.matched_sources || []);
    const color = pct >= 50 ? D : pct >= 30 ? W : S;
    const statusColor = c.status === 'flagged' ? D : c.status === 'review' ? W : S;

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <a href="/school/plagiarism" style="color:${P};text-decoration:none;font-size:0.9em">&larr; Back to Checks</a>
        <h1 style="color:${P};margin:0">Plagiarism Report #${c.id}</h1>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;align-items:center">
        <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
          ${similarityGauge(pct)}
        </div>
        <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1">
          <div style="font-size:0.9em;color:${GRAY};margin-bottom:4px">Status</div>
          <span style="background:${c.status === 'flagged' ? '#fef2f2' : c.status === 'passed' ? '#ecfdf5' : '#fffbeb'};color:${statusColor};padding:6px 16px;border-radius:10px;font-weight:700;font-size:1.1em;text-transform:uppercase">${esc(c.status)}</span>
          <div style="margin-top:12px;font-size:0.9em;color:${GRAY}">
            <strong>Max Similarity:</strong> <span style="color:${color};font-weight:bold">${pct}%</span> &nbsp;|&nbsp;
            <strong>Matched Sources:</strong> ${sources.length} &nbsp;|&nbsp;
            <strong>Checked:</strong> ${new Date(c.checked_at).toLocaleString()}
          </div>
        </div>
      </div>

      ${pct >= 30 ? `<div style="background:#fef2f2;border:1px solid ${D};border-radius:8px;padding:16px;margin-bottom:20px">
        <strong style="color:${D}">&#9888; High Similarity Detected</strong>
        <p style="margin:8px 0 0;color:#991b1b">This submission has ${pct}% similarity to existing work. Please review the matched sources below.</p>
      </div>` : pct >= 15 ? `<div style="background:#fffbeb;border:1px solid ${W};border-radius:8px;padding:16px;margin-bottom:20px">
        <strong style="color:${W}">Moderate Similarity</strong>
        <p style="margin:8px 0 0;color:#92400e">This submission has ${pct}% similarity. Some common phrases detected.</p>
      </div>` : `<div style="background:#ecfdf5;border:1px solid ${S};border-radius:8px;padding:16px;margin-bottom:20px">
        <strong style="color:${S}">Low Similarity</strong>
        <p style="margin:8px 0 0;color:#065f46">This submission appears to be original work (${pct}% similarity).</p>
      </div>`}

      ${sources.length > 0 ? `
      <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px">
        <h2 style="color:#374151;margin-bottom:12px">Matched Sources</h2>
        ${sources.map((s, i) => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="color:#374151">Source #${i + 1} — Student ID: ${s.student_id || 'Unknown'}</strong>
              <span style="color:${s.similarity >= 50 ? D : s.similarity >= 30 ? W : GRAY};font-weight:bold">${s.similarity}%</span>
            </div>
            ${s.phrases && s.phrases.length > 0 ? `<div style="background:#fef2f2;border-radius:6px;padding:10px;margin-top:8px">
              <div style="font-size:0.8em;color:${GRAY};margin-bottom:4px">Matched Phrases:</div>
              ${s.phrases.map(p => `<span style="background:${D};color:white;padding:2px 8px;border-radius:4px;font-size:0.85em;margin:2px;display:inline-block">${esc(p)}</span>`).join('')}
            </div>` : ''}
          </div>
        `).join('')}
      </div>` : `
      <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px;text-align:center;color:${GRAY}">
        No significant matches found. This submission appears to be original.
      </div>`}

      <div style="background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <h2 style="color:#374151;margin-bottom:10px">Checked Text</h2>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;max-height:300px;overflow-y:auto;white-space:pre-wrap;font-family:monospace;font-size:0.9em;color:#374151">${esc(c.text_submitted)}</div>
      </div>
    </div>`;
    res.send(renderPage('Plagiarism Report #' + c.id, body, req.session.user));
  }));

  // Plagiarism student report
  app.get('/school/plagiarism/report', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows } = await pool.query(
      `SELECT pc.*, r.student_id, s.name as student_name
       FROM plagiarism_checks pc
       LEFT JOIN ai_grading_results r ON r.id = pc.submission_id
       LEFT JOIN users s ON s.id = r.student_id
       WHERE pc.tenant_id = $1 AND pc.similarity_pct >= 30
       ORDER BY pc.similarity_pct DESC`,
      [tid]
    );
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1000px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">Plagiarism Report &mdash; Flagged Submissions</h1>
      <p style="color:${GRAY};margin-bottom:20px">${rows.length} submission(s) flagged with 30% or higher similarity</p>

      ${rows.length === 0 ? `<div style="background:white;padding:40px;border-radius:12px;text-align:center;color:${S};font-size:1.2em;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="font-size:2em;margin-bottom:8px">&#10003;</div>
        No flagged submissions found. All checks are below the 30% threshold.
      </div>` : `
      <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#fef2f2">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${D}">Student</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${D}">Similarity</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${D}">Status</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${D}">Date</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${D}">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `<tr style="border-top:1px solid #fecaca">
              <td style="padding:12px 16px">${esc(r.student_name || 'Student #' + r.student_id)}</td>
              <td style="padding:12px 16px;font-weight:bold;color:${parseFloat(r.similarity_pct) >= 50 ? D : W}">${r.similarity_pct}%</td>
              <td style="padding:12px 16px"><span style="background:#fef2f2;color:${D};padding:3px 10px;border-radius:10px;font-size:0.8em;font-weight:600">${esc(r.status)}</span></td>
              <td style="padding:12px 16px;color:${GRAY};font-size:0.85em">${new Date(r.checked_at).toLocaleDateString()}</td>
              <td style="padding:12px 16px;text-align:center"><a href="/school/plagiarism/${r.id}" style="color:${P};text-decoration:none">View Details</a></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;
    res.send(renderPage('Plagiarism Report', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  SECTION 3: AI EXAM QUESTION GENERATOR
  // ══════════════════════════════════════════════

  // Simple question generation engine
  function generateQuestions(subject, topic, difficulty, count, type) {
    const questions = [];
    const easyMCQ = [
      { q: `Which of the following best describes ${topic}?`, opts: [`A key concept in ${subject}`, `An unrelated principle`, `A deprecated theory`, `A mathematical constant`], ans: 0 },
      { q: `What is the primary purpose of studying ${topic}?`, opts: [`To understand fundamentals of ${subject}`, `To memorize formulas only`, `To avoid the topic entirely`, `None of the above`], ans: 0 },
      { q: `Which statement about ${topic} is correct?`, opts: [`It is essential to ${subject}`, `It is only theoretical`, `It has no practical applications`, `It is a modern invention`], ans: 0 },
      { q: `${topic} in ${subject} is best characterized as:`, opts: [`A fundamental building block`, `An optional extra`, `An outdated concept`, `A minor detail`], ans: 0 },
      { q: `Who is most associated with the development of ${topic}?`, opts: [`Pioneering researchers in ${subject}`, `A politician`, `A chef`, `An athlete`], ans: 0 },
    ];
    const mediumMCQ = [
      { q: `Analyze the relationship between ${topic} and the broader field of ${subject}. Which factor is most significant?`, opts: [`Interdependence with related concepts`, `Isolation from other fields`, `Sole reliance on memorization`, `Complete independence`], ans: 0 },
      { q: `Which methodology is most effective when applying ${topic} in ${subject}?`, opts: [`Systematic analysis and evidence-based approach`, `Random guessing`, `Ignoring prior knowledge`, `Rote memorization only`], ans: 0 },
      { q: `What distinguishes ${topic} from other concepts in ${subject}?`, opts: [`Its unique theoretical framework`, `Its lack of importance`, `Its simplicity only`, `Its age`], ans: 0 },
      { q: `When implementing ${topic} in real-world ${subject} scenarios, which challenge is most common?`, opts: [`Balancing theory with practice`, `Having too much data`, `The topic being too easy`, `Lack of interest`], ans: 0 },
      { q: `Which advancement has most impacted the modern understanding of ${topic}?`, opts: [`Research innovations and technology`, `Social media`, `Ancient texts alone`, `None — it hasn't changed`], ans: 0 },
    ];
    const hardMCQ = [
      { q: `Critically evaluate how ${topic} challenges existing paradigms within ${subject}. Which argument is most compelling?`, opts: [`It introduces new frameworks that supplant older models`, `It confirms all existing theories unchanged`, `It has no impact on the field`, `It only affects beginners`], ans: 0 },
      { q: `In advanced applications of ${topic}, which synthesis of methods yields the most robust results in ${subject}?`, opts: [`Mixed-method approaches with quantitative and qualitative analysis`, `Only qualitative methods`, `Only one specific method`, `No methodology at all`], ans: 0 },
      { q: `Which emerging trend related to ${topic} is likely to have the greatest impact on ${subject} over the next decade?`, opts: [`Integration with computational and AI-driven analysis`, `Abandoning the topic entirely`, `Reverting to historical methods`, `No future impact`], ans: 0 },
      { q: `What is the most significant criticism of current approaches to ${topic} within ${subject}?`, opts: [`Over-reliance on established methodologies without innovation`, `Too much innovation`, `Excessive testing`, `Under-funding`], ans: 0 },
      { q: `How does ${topic} intersect with ethical considerations in ${subject}?`, opts: [`Through responsible application and equitable access`, `Ethics are irrelevant`, `Only in rare cases`, `Through regulation only`], ans: 0 },
    ];
    const shortAnswerTemplates = [
      `Define ${topic} and explain its significance in the field of ${subject}.`,
      `Describe three key characteristics of ${topic} and how they relate to ${subject}.`,
      `Explain the main differences between ${topic} and other related concepts in ${subject}.`,
      `How has the understanding of ${topic} evolved within ${subject} over time?`,
      `What are the practical applications of ${topic} in modern ${subject}? Provide examples.`,
      `Compare and contrast two major perspectives on ${topic} in ${subject}.`,
      `Identify the main challenges in studying ${topic} and suggest potential solutions.`,
      `How does ${topic} connect to broader themes in ${subject}?`,
    ];
    const essayTemplates = [
      `Write a comprehensive essay discussing the role of ${topic} in ${subject}. Include historical context, current applications, and future implications. Support your arguments with examples and evidence.`,
      `Critically analyze the impact of ${topic} on the development of ${subject}. Consider multiple perspectives and provide a balanced argument with supporting evidence.`,
      `Discuss the evolution of ${topic} within ${subject}. How have advances in research and technology changed our understanding? What are the implications for future study?`,
      `Evaluate the statement: "${topic} is the most important concept in ${subject}." Do you agree or disagree? Provide detailed reasoning and examples to support your position.`,
      `Explore the ethical dimensions of ${topic} in ${subject}. How should practitioners balance innovation with responsibility? Discuss with reference to real-world cases.`,
    ];

    const mcqPool = difficulty === 'easy' ? easyMCQ : difficulty === 'hard' ? hardMCQ : mediumMCQ;

    for (let i = 0; i < count; i++) {
      if (type === 'mcq' || type === 'mixed') {
        if (type === 'mixed' && i >= Math.ceil(count / 2)) {
          const tmpl = shortAnswerTemplates[i % shortAnswerTemplates.length];
          questions.push({ type: 'short_answer', text: tmpl, answer: `A thorough response should address the core concepts of ${topic} within ${subject}, providing clear definitions, relevant examples, and logical reasoning.`, marks: 10 });
          continue;
        }
        const mcq = mcqPool[i % mcqPool.length];
        questions.push({
          type: 'mcq',
          text: mcq.q,
          options: mcq.opts,
          answer: mcq.opts[mcq.ans],
          marks: difficulty === 'hard' ? 5 : difficulty === 'easy' ? 2 : 3
        });
      } else if (type === 'short_answer') {
        questions.push({
          type: 'short_answer',
          text: shortAnswerTemplates[i % shortAnswerTemplates.length],
          answer: `Key points should include: definition of ${topic}, its relevance to ${subject}, supporting examples, and a clear conclusion.`,
          marks: 10
        });
      } else if (type === 'essay') {
        questions.push({
          type: 'essay',
          text: essayTemplates[i % essayTemplates.length],
          answer: `A strong essay would include: an introduction defining ${topic}, body paragraphs with evidence and analysis, discussion of implications for ${subject}, and a conclusion with original insights.`,
          marks: 25
        });
      }
    }
    return questions;
  }

  // Question bank dashboard
  app.get('/school/ai-exam-gen', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { subject, difficulty, type } = req.query;
    let where = 'WHERE tenant_id = $1';
    const params = [tid];
    let pIdx = 2;
    if (subject) { where += ` AND subject ILIKE $${pIdx++}`; params.push(`%${subject}%`); }
    if (difficulty) { where += ` AND difficulty = $${pIdx++}`; params.push(difficulty); }
    if (type) { where += ` AND question_type = $${pIdx++}`; params.push(type); }

    const { rows: questions } = await pool.query(`SELECT * FROM ai_generated_questions ${where} ORDER BY created_at DESC LIMIT 200`, params);
    const { rows: stats } = await pool.query(
      `SELECT question_type, difficulty, COUNT(*) as cnt FROM ai_generated_questions WHERE tenant_id = $1 GROUP BY question_type, difficulty`, [tid]
    );

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1100px;margin:0 auto;padding:20px">
      <h1 style="color:${P};font-size:1.8em;margin-bottom:4px">AI Exam Question Generator</h1>
      <p style="color:${GRAY};margin-bottom:20px">Generate exam questions using AI-powered template engine. Build and manage your question bank.</p>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:120px">
          <div style="font-size:2em;font-weight:bold;color:${P}">${questions.length}</div>
          <div style="color:${GRAY};font-size:0.9em">Questions</div>
        </div>
        ${['mcq','short_answer','essay'].map(t => {
          const cnt = questions.filter(q => q.question_type === t).length;
          const labels = { mcq: 'MCQ', short_answer: 'Short Answer', essay: 'Essay' };
          const colors = { mcq: P, short_answer: S, essay: '#8b5cf6' };
          return `<div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:120px">
            <div style="font-size:2em;font-weight:bold;color:${colors[t]}">${cnt}</div>
            <div style="color:${GRAY};font-size:0.9em">${labels[t]}</div>
          </div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <form method="get" action="/school/ai-exam-gen" style="display:flex;gap:8px;flex-wrap:wrap;flex:1">
          <input type="text" name="subject" placeholder="Filter subject..." value="${esc(subject)}" aria-label="Filter by subject" style="padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:0.95em;min-width:140px">
          <select name="difficulty" aria-label="Filter by difficulty" style="padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:0.95em">
            <option value="">All Levels</option>
            <option value="easy" ${difficulty === 'easy' ? 'selected' : ''}>Easy</option>
            <option value="medium" ${difficulty === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="hard" ${difficulty === 'hard' ? 'selected' : ''}>Hard</option>
          </select>
          <select name="type" aria-label="Filter by type" style="padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:0.95em">
            <option value="">All Types</option>
            <option value="mcq" ${type === 'mcq' ? 'selected' : ''}>MCQ</option>
            <option value="short_answer" ${type === 'short_answer' ? 'selected' : ''}>Short Answer</option>
            <option value="essay" ${type === 'essay' ? 'selected' : ''}>Essay</option>
          </select>
          <button type="submit" style="padding:10px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;cursor:pointer;font-size:0.95em">Filter</button>
        </form>
        <a href="/school/ai-exam-gen/generate" style="display:inline-flex;align-items:center;padding:10px 20px;background:${P};color:white;border-radius:8px;text-decoration:none;font-weight:600;white-space:nowrap">+ Generate Questions</a>
        <a href="/school/ai-exam-gen/exam-paper" style="display:inline-flex;align-items:center;padding:10px 20px;background:${S};color:white;border-radius:8px;text-decoration:none;font-weight:600;white-space:nowrap">Create Exam Paper</a>
      </div>

      <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#f3f4f6">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Type</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Subject</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Topic</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Difficulty</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Marks</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${GRAY}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${questions.length === 0 ? `<tr><td colspan="6" style="padding:40px;text-align:center;color:${GRAY}">No questions generated yet. Click "Generate Questions" to start.</td></tr>` :
              questions.map(q => {
                const typeBadge = q.question_type === 'mcq' ? P : q.question_type === 'essay' ? '#8b5cf6' : S;
                const diffBadge = q.difficulty === 'hard' ? D : q.difficulty === 'medium' ? W : S;
                return `<tr style="border-top:1px solid #f3f4f6">
                  <td style="padding:12px 16px"><span style="background:${typeBadge};color:white;padding:3px 10px;border-radius:10px;font-size:0.8em;font-weight:600">${esc(q.question_type)}</span></td>
                  <td style="padding:12px 16px">${esc(q.subject)}</td>
                  <td style="padding:12px 16px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.topic)}</td>
                  <td style="padding:12px 16px"><span style="color:${diffBadge};font-weight:600;text-transform:capitalize">${esc(q.difficulty)}</span></td>
                  <td style="padding:12px 16px;font-weight:600">${q.marks}</td>
                  <td style="padding:12px 16px;text-align:center">
                    <a href="/school/ai-exam-gen/${q.id}/edit" style="color:${P};text-decoration:none;margin-right:6px" aria-label="Edit question ${q.id}">Edit</a>
                    <a href="/school/ai-exam-gen/${q.id}/delete" style="color:${D};text-decoration:none" aria-label="Delete question ${q.id}" onclick="return confirm('Delete this question?')">Delete</a>
                  </td>
                </tr>`;
              }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('AI Exam Question Generator', body, req.session.user));
  }));

  // Generate questions form
  app.get('/school/ai-exam-gen/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">Generate Exam Questions</h1>
      <form method="post" action="/school/ai-exam-gen/generate" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="margin-bottom:16px">
          <label for="subject" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Subject *</label>
          <input type="text" id="subject" name="subject" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. Biology, Mathematics, History" aria-required="true">
        </div>
        <div style="margin-bottom:16px">
          <label for="topic" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Topic *</label>
          <input type="text" id="topic" name="topic" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. Photosynthesis, Quadratic Equations, World War II" aria-required="true">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label for="difficulty" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Difficulty *</label>
            <select id="difficulty" name="difficulty" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="easy">Easy</option>
              <option value="medium" selected>Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label for="question_type" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Type *</label>
            <select id="question_type" name="question_type" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="mcq">Multiple Choice (MCQ)</option>
              <option value="short_answer">Short Answer</option>
              <option value="essay">Essay</option>
              <option value="mixed">Mixed (MCQ + Short Answer)</option>
            </select>
          </div>
          <div>
            <label for="count" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Count *</label>
            <input type="number" id="count" name="count" required min="1" max="50" value="5" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="tags" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Tags (comma-separated, optional)</label>
          <input type="text" id="tags" name="tags" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. midterm, chapter3, 2024">
        </div>
        <button type="submit" style="padding:12px 32px;background:${P};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Generate Questions</button>
      </form>
    </div>`;
    res.send(renderPage('Generate Exam Questions', body, req.session.user));
  }));

  app.post('/school/ai-exam-gen/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { subject, topic, difficulty, question_type, count, tags } = req.body;
    if (!subject || !topic || !difficulty || !question_type || !count) {
      return res.status(400).send('All required fields must be provided.');
    }
    const numCount = Math.min(50, Math.max(1, parseInt(count)));
    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
    const questions = generateQuestions(subject, topic, difficulty, numCount, question_type);
    let inserted = 0;
    for (const q of questions) {
      const opts = q.options ? JSON.stringify(q.options) : null;
      await pool.query(
        `INSERT INTO ai_generated_questions (tenant_id, subject, topic, difficulty, question_type, question_text, options, answer, marks, tags, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [tid, subject, topic, difficulty, q.type, q.text, opts, q.answer, q.marks, JSON.stringify(tagList), uid]
      );
      inserted++;
    }
    audit(req, 'ai_exam_gen', { subject, topic, difficulty, type: question_type, count: inserted });
    res.redirect(`/school/ai-exam-gen?generated=${inserted}`);
  }));

  // Edit question
  app.get('/school/ai-exam-gen/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [q] } = await pool.query(`SELECT * FROM ai_generated_questions WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (!q) return res.status(404).send('Question not found.');
    const options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
    const tags = (typeof q.tags === 'string' ? JSON.parse(q.tags) : (q.tags || [])).join(', ');
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">Edit Question #${q.id}</h1>
      <form method="post" action="/school/ai-exam-gen/${q.id}/edit" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label for="subject" style="display:block;font-weight:600;margin-bottom:4px">Subject</label>
            <input type="text" id="subject" name="subject" value="${esc(q.subject)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
          <div>
            <label for="topic" style="display:block;font-weight:600;margin-bottom:4px">Topic</label>
            <input type="text" id="topic" name="topic" value="${esc(q.topic)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label for="difficulty" style="display:block;font-weight:600;margin-bottom:4px">Difficulty</label>
            <select id="difficulty" name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="easy" ${q.difficulty === 'easy' ? 'selected' : ''}>Easy</option>
              <option value="medium" ${q.difficulty === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="hard" ${q.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
            </select>
          </div>
          <div>
            <label for="question_type" style="display:block;font-weight:600;margin-bottom:4px">Type</label>
            <select id="question_type" name="question_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="mcq" ${q.question_type === 'mcq' ? 'selected' : ''}>MCQ</option>
              <option value="short_answer" ${q.question_type === 'short_answer' ? 'selected' : ''}>Short Answer</option>
              <option value="essay" ${q.question_type === 'essay' ? 'selected' : ''}>Essay</option>
            </select>
          </div>
          <div>
            <label for="marks" style="display:block;font-weight:600;margin-bottom:4px">Marks</label>
            <input type="number" id="marks" name="marks" value="${q.marks}" min="1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="question_text" style="display:block;font-weight:600;margin-bottom:4px">Question Text *</label>
          <textarea id="question_text" name="question_text" required rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(q.question_text)}</textarea>
        </div>
        ${q.question_type === 'mcq' ? `
        <div style="margin-bottom:16px">
          <label style="display:block;font-weight:600;margin-bottom:4px">Options (one per line)</label>
          ${options.map((o, i) => `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
            <span style="font-weight:600;color:${GRAY};min-width:20px">${String.fromCharCode(65 + i)}.</span>
            <input type="text" name="option_${i}" value="${esc(o)}" style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.95em">
          </div>`).join('')}
          <div style="display:flex;gap:8px;margin-top:8px">
            <span style="font-weight:600;color:${GRAY};min-width:20px">E.</span>
            <input type="text" name="option_4" placeholder="Add option E..." style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.95em">
          </div>
        </div>` : ''}
        <div style="margin-bottom:16px">
          <label for="answer" style="display:block;font-weight:600;margin-bottom:4px">Correct Answer / Model Answer</label>
          <textarea id="answer" name="answer" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(q.answer)}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="tags" style="display:block;font-weight:600;margin-bottom:4px">Tags (comma-separated)</label>
          <input type="text" id="tags" name="tags" value="${esc(tags)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
        </div>
        <button type="submit" style="padding:12px 32px;background:${P};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Save Changes</button>
      </form>
    </div>`;
    res.send(renderPage('Edit Question', body, req.session.user));
  }));

  app.post('/school/ai-exam-gen/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { subject, topic, difficulty, question_type, question_text, answer, marks, tags } = req.body;
    if (!question_text) return res.status(400).send('Question text is required.');
    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
    // Collect options for MCQ
    let opts = [];
    if (question_type === 'mcq') {
      for (let i = 0; i <= 4; i++) {
        const val = req.body[`option_${i}`];
        if (val && val.trim()) opts.push(val.trim());
      }
    }
    await pool.query(
      `UPDATE ai_generated_questions SET subject=$1, topic=$2, difficulty=$3, question_type=$4, question_text=$5, options=$6, answer=$7, marks=$8, tags=$9 WHERE id=$10 AND tenant_id=$11`,
      [subject || '', topic || '', difficulty || 'medium', question_type || 'mcq', question_text, JSON.stringify(opts), answer || '', parseInt(marks) || 5, JSON.stringify(tagList), req.params.id, tid]
    );
    audit(req, 'ai_exam_edit', { id: req.params.id });
    res.redirect('/school/ai-exam-gen');
  }));

  // Delete question
  app.get('/school/ai-exam-gen/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM ai_generated_questions WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    audit(req, 'ai_exam_delete', { id: req.params.id });
    res.redirect('/school/ai-exam-gen');
  }));

  // Exam paper generator
  app.get('/school/ai-exam-gen/exam-paper', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: subjects } = await pool.query(`SELECT DISTINCT subject FROM ai_generated_questions WHERE tenant_id = $1 ORDER BY subject`, [tid]);
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:${S};margin-bottom:20px">Create Exam Paper</h1>
      <p style="color:${GRAY};margin-bottom:20px">Auto-generate a printable exam paper from your question bank</p>
      <form method="post" action="/school/ai-exam-gen/exam-paper" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="margin-bottom:16px">
          <label for="exam_title" style="display:block;font-weight:600;margin-bottom:4px">Exam Title *</label>
          <input type="text" id="exam_title" name="exam_title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. Midterm Examination — Biology" aria-required="true">
        </div>
        <div style="margin-bottom:16px">
          <label for="subject" style="display:block;font-weight:600;margin-bottom:4px">Subject Filter</label>
          <select id="subject" name="subject" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
            <option value="">All Subjects</option>
            ${subjects.map(s => `<option value="${esc(s.subject)}">${esc(s.subject)}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label for="difficulty" style="display:block;font-weight:600;margin-bottom:4px">Difficulty</label>
            <select id="difficulty" name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="">All Levels</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div>
            <label for="max_questions" style="display:block;font-weight:600;margin-bottom:4px">Max Questions</label>
            <input type="number" id="max_questions" name="max_questions" value="20" min="1" max="100" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="duration" style="display:block;font-weight:600;margin-bottom:4px">Duration</label>
          <input type="text" id="duration" name="duration" value="2 hours" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" placeholder="e.g. 1 hour 30 minutes">
        </div>
        <div style="margin-bottom:16px">
          <label for="instructions" style="display:block;font-weight:600;margin-bottom:4px">Special Instructions</label>
          <textarea id="instructions" name="instructions" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box" placeholder="e.g. Answer all questions. No electronic devices allowed.">Answer all questions. Write legibly.</textarea>
        </div>
        <button type="submit" style="padding:12px 32px;background:${S};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Generate Exam Paper</button>
      </form>
    </div>`;
    res.send(renderPage('Create Exam Paper', body, req.session.user));
  }));

  app.post('/school/ai-exam-gen/exam-paper', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { exam_title, subject, difficulty, max_questions, duration, instructions } = req.body;
    if (!exam_title) return res.status(400).send('Exam title is required.');
    let where = 'WHERE tenant_id = $1';
    const params = [tid];
    let pIdx = 2;
    if (subject) { where += ` AND subject = $${pIdx++}`; params.push(subject); }
    if (difficulty) { where += ` AND difficulty = $${pIdx++}`; params.push(difficulty); }
    params.push(parseInt(max_questions) || 20);
    const { rows: questions } = await pool.query(
      `SELECT * FROM ai_generated_questions ${where} ORDER BY RANDOM() LIMIT $${pIdx}`, params
    );

    const totalMarks = questions.reduce((a, q) => a + q.marks, 0);
    // Build printable HTML
    let paper = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(exam_title)}</title>
      <style>
        @media print { body { margin: 0; } .no-print { display: none; } }
        body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 40px 30px; color: #1a1a1a; line-height: 1.6; }
        .header { text-align: center; border-bottom: 3px double #333; padding-bottom: 20px; margin-bottom: 20px; }
        .header h1 { font-size: 1.6em; margin: 0 0 8px 0; }
        .header .meta { font-size: 0.9em; color: #555; }
        .instructions { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 14px; margin-bottom: 24px; font-size: 0.9em; }
        .question-section { margin-bottom: 30px; }
        .section-title { font-size: 1.1em; font-weight: bold; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 12px; }
        .question { margin-bottom: 18px; padding-left: 8px; }
        .question .q-num { font-weight: bold; }
        .question .q-text { margin: 4px 0; }
        .question .marks { font-size: 0.85em; color: #666; font-style: italic; }
        .options { margin: 6px 0 6px 20px; }
        .options label { display: block; margin: 3px 0; }
        .options input { margin-right: 6px; }
        .answer-lines { border-bottom: 1px dotted #ccc; height: 80px; margin-top: 8px; }
        .footer { margin-top: 40px; text-align: center; font-size: 0.85em; color: #888; border-top: 1px solid #ddd; padding-top: 12px; }
        .no-print { margin-bottom: 20px; }
        .btn { display: inline-block; padding: 10px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-right: 10px; }
      </style></head><body>
      <div class="no-print"><a href="/school/ai-exam-gen" class="btn">&larr; Back to Question Bank</a>
        <button onclick="window.print()" class="btn" style="background:#059669">Print Exam Paper</button></div>
      <div class="header">
        <h1>${esc(exam_title)}</h1>
        <div class="meta">Total Marks: ${totalMarks} &nbsp;|&nbsp; Duration: ${esc(duration || 'N/A')} &nbsp;|&nbsp; Questions: ${questions.length}</div>
        <div class="meta" style="margin-top:8px">
          Student Name: ________________________ &nbsp;&nbsp; Roll No: ____________ &nbsp;&nbsp; Date: ____________
        </div>
      </div>
      ${instructions ? `<div class="instructions"><strong>Instructions:</strong> ${esc(instructions)}</div>` : ''}
    `;

    // Group by type
    const mcqs = questions.filter(q => q.question_type === 'mcq');
    const shortAns = questions.filter(q => q.question_type === 'short_answer');
    const essays = questions.filter(q => q.question_type === 'essay');
    let qNum = 1;

    if (mcqs.length > 0) {
      paper += `<div class="question-section"><div class="section-title">Section A: Multiple Choice Questions (${mcqs.reduce((a, q) => a + q.marks, 0)} marks)</div>`;
      mcqs.forEach(q => {
        const opts = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
        paper += `<div class="question"><span class="q-num">${qNum}.</span> <span class="q-text">${esc(q.question_text)}</span> <span class="marks">[${q.marks} marks]</span>
          <div class="options">${opts.map((o, i) => `<label><input type="radio" name="q${qNum}"> ${String.fromCharCode(65 + i)}) ${esc(o)}</label>`).join('')}</div></div>`;
        qNum++;
      });
      paper += `</div>`;
    }
    if (shortAns.length > 0) {
      paper += `<div class="question-section"><div class="section-title">Section B: Short Answer Questions (${shortAns.reduce((a, q) => a + q.marks, 0)} marks)</div>`;
      shortAns.forEach(q => {
        paper += `<div class="question"><span class="q-num">${qNum}.</span> <span class="q-text">${esc(q.question_text)}</span> <span class="marks">[${q.marks} marks]</span><div class="answer-lines"></div></div>`;
        qNum++;
      });
      paper += `</div>`;
    }
    if (essays.length > 0) {
      paper += `<div class="question-section"><div class="section-title">Section C: Essay Questions (${essays.reduce((a, q) => a + q.marks, 0)} marks)</div>`;
      essays.forEach(q => {
        paper += `<div class="question"><span class="q-num">${qNum}.</span> <span class="q-text">${esc(q.question_text)}</span> <span class="marks">[${q.marks} marks]</span><div class="answer-lines" style="height:200px"></div></div>`;
        qNum++;
      });
      paper += `</div>`;
    }

    paper += `<div class="footer">--- End of Paper ---<br>Generated by AI Exam Question Generator</div></body></html>`;
    audit(req, 'exam_paper_gen', { title: exam_title, questions: questions.length, totalMarks });
    res.type('html').send(paper);
  }));

  // ─── Student view: My grades ───
  app.get('/school/my-grades', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { rows } = await pool.query(
      `SELECT * FROM ai_grading_results WHERE tenant_id = $1 AND student_id = $2 ORDER BY created_at DESC`,
      [tid, uid]
    );
    const avgScore = rows.length > 0 ? Math.round(rows.reduce((a, r) => a + r.ai_score, 0) / rows.length) : 0;
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};font-size:1.8em;margin-bottom:4px">My Grades</h1>
      <p style="color:${GRAY};margin-bottom:20px">View all your AI-graded submissions and feedback</p>

      <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1">
          <div style="font-size:2em;font-weight:bold;color:${P}">${rows.length}</div>
          <div style="color:${GRAY};font-size:0.9em">Submissions</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1">
          <div style="font-size:2em;font-weight:bold;color:${S}">${avgScore}</div>
          <div style="color:${GRAY};font-size:0.9em">Average Score</div>
        </div>
      </div>

      ${rows.length > 0 ? gradeDistributionChart(rows.map(r => r.ai_grade)) : ''}

      <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:20px">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#f3f4f6">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Date</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Grade</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Score</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Feedback</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const gc = r.ai_grade === 'A' ? S : r.ai_grade === 'B' ? P : r.ai_grade === 'C' ? W : D;
              return `<tr style="border-top:1px solid #f3f4f6">
                <td style="padding:12px 16px;font-size:0.85em;color:${GRAY}">${new Date(r.created_at).toLocaleDateString()}</td>
                <td style="padding:12px 16px"><span style="background:${gc};color:white;padding:4px 12px;border-radius:12px;font-weight:bold;font-size:0.85em">${esc(r.ai_grade)}</span></td>
                <td style="padding:12px 16px;font-weight:600">${r.teacher_override_grade ? esc(r.teacher_override_grade) + ' (override)' : r.ai_score + '/100'}</td>
                <td style="padding:12px 16px;font-size:0.85em;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.feedback)}">${esc(r.feedback.substring(0, 80))}...</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('My Grades', body, req.session.user));
  }));

  // ─── API: Grade a submission (JSON) ───
  app.post('/api/ai-grading/grade', requireAuth, ah(async (req, res) => {
    const { text, keywords } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const kws = keywords ? (Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim())) : [];
    const result = scoreSubmission(text, kws);
    res.json(result);
  }));

  // ─── API: Check plagiarism (JSON) ───
  app.post('/api/plagiarism/check', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    const { rows: previous } = await pool.query(
      `SELECT id, student_id, submission_text FROM ai_grading_results WHERE tenant_id = $1`, [tid]
    );
    const matchedSources = [];
    let maxSim = 0;
    for (const prev of previous) {
      const sim = calculateSimilarity(text, prev.submission_text);
      if (sim > 5) {
        const phrases = findMatchingPhrases(text, prev.submission_text);
        matchedSources.push({ source_id: prev.id, student_id: prev.student_id, similarity: sim, phrases: phrases.map(p => p.phrase) });
        if (sim > maxSim) maxSim = sim;
      }
    }
    matchedSources.sort((a, b) => b.similarity - a.similarity);
    res.json({ similarity_pct: maxSim, matched_sources: matchedSources.slice(0, 10), status: maxSim >= 50 ? 'flagged' : maxSim >= 30 ? 'review' : 'passed' });
  }));

};
