/**
 * AI Lesson Plan Module — SaaS School Portal
 * Features: AI Lesson Plan Generator, Library CRUD, Weekly Planner,
 *   Template Gallery, Standards Alignment, Export/Print, Feedback, Reflection
 */

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const P = '#4f46e5';
  const S = '#059669';
  const W = '#f59e0b';
  const D = '#dc2626';
  const GRAY = '#6b7280';
  const BG = '#f9fafb';
  const SKIP = '<a href="#main-content" style="position:absolute;left:-9999px;top:0;z-index:999" tabindex="0">Skip to content</a>';

  // ─── Template-based AI Lesson Plan Generator ───
  const SUBJECT_DATA = {
    Mathematics: {
      topics: ['Algebra', 'Geometry', 'Calculus', 'Statistics', 'Trigonometry', 'Number Theory', 'Fractions', 'Probability'],
      materials: ['Graphing calculator', 'Ruler and protractor', 'Graph paper', 'Whiteboard markers', 'Manipulatives (blocks/cubes)', 'Worksheets', 'Digital math tools'],
      activities: [
        'Guided problem-solving on the board (5 min)',
        'Small group collaborative practice (10 min)',
        'Real-world application exercise (10 min)',
        'Peer tutoring with mixed-ability pairs (8 min)',
        'Interactive math game or puzzle (7 min)'
      ],
      assessments: ['Exit ticket with 3 problems', 'Homework worksheet', 'Group presentation of solutions', 'Quiz with word problems'],
      extensions: ['Challenge problems for advanced students', 'Math journal writing prompt', 'Cross-curricular connection to science'],
      differentiation: 'Provide visual aids and step-by-step scaffolds for struggling learners. Offer enrichment puzzles and real-world data analysis for advanced students.'
    },
    English: {
      topics: ['Essay Writing', 'Poetry Analysis', 'Grammar Rules', 'Reading Comprehension', 'Creative Writing', 'Public Speaking', 'Vocabulary Building', 'Literary Devices'],
      materials: ['Textbooks and novels', 'Writing journals', 'Dictionaries and thesauri', 'Projector for examples', 'Handouts with writing prompts', 'Peer review rubrics'],
      activities: [
        'Read-aloud and discussion of model text (7 min)',
        'Think-Pair-Share on key concepts (6 min)',
        'Individual writing practice (15 min)',
        'Peer review and feedback exchange (10 min)',
        'Share-out and class discussion (7 min)'
      ],
      assessments: ['Written essay or paragraph', 'Reading comprehension quiz', 'Oral presentation rubric', 'Portfolio entry'],
      extensions: ['Creative writing challenge', 'Compare/contrast with another genre', 'Publish work on class blog'],
      differentiation: 'Offer sentence starters and graphic organizers for ELL students. Provide advanced vocabulary lists and analytical frameworks for gifted writers.'
    },
    Science: {
      topics: ['The Scientific Method', 'Chemical Reactions', 'Cell Biology', 'Physics Forces', 'Ecosystems', 'The Solar System', 'Genetics', 'Climate Change'],
      materials: ['Lab equipment and safety goggles', 'Microscopes', 'Science textbooks', 'Lab notebooks', 'Digital simulations', 'Specimen samples', 'Measuring instruments'],
      activities: [
        'Demonstration or video introduction (5 min)',
        'Hands-on lab experiment or investigation (20 min)',
        'Data collection and analysis (10 min)',
        'Group discussion of findings (8 min)',
        'Connection to real-world applications (7 min)'
      ],
      assessments: ['Lab report with hypothesis and conclusions', 'Multiple choice quiz', 'Diagram labeling exercise', 'Science journal reflection'],
      extensions: ['Design your own experiment', 'Research a related current event', 'Build a model or prototype'],
      differentiation: 'Provide pre-lab vocabulary sheets and step-by-step instructions. Allow advanced students to design independent variables and extended investigations.'
    },
    History: {
      topics: ['Ancient Civilizations', 'World Wars', 'The Renaissance', 'Civil Rights Movement', 'Colonial Era', 'Industrial Revolution', 'The Cold War', 'Government Systems'],
      materials: ['Historical maps', 'Primary source documents', 'Documentary clips', 'Timeline posters', 'Textbook chapters', 'Biography cards', 'Discussion question cards'],
      activities: [
        'Primary source analysis in pairs (10 min)',
        'Timeline construction activity (8 min)',
        'Role-play or debate on historical perspectives (12 min)',
        'Map analysis and geographical context (7 min)',
        'Reflection writing: "What if...?" scenarios (8 min)'
      ],
      assessments: ['Essay on historical significance', 'Document-based question (DBQ)', 'Timeline quiz', 'Group presentation'],
      extensions: ['Research project on a historical figure', 'Visit a virtual museum tour', 'Create a historical newspaper'],
      differentiation: 'Provide adapted primary sources with simplified language. Offer extension research topics for students with deep historical interest.'
    },
    'Foreign Language': {
      topics: ['Greetings and Introductions', 'Food and Dining', 'Travel Vocabulary', 'Grammar Conjugation', 'Cultural Traditions', 'Daily Routines', 'Shopping and Money', 'Weather and Seasons'],
      materials: ['Flashcards', 'Audio recordings', 'Cultural artifacts', 'Language textbooks', 'Online language apps', 'Worksheets', 'Conversation cue cards'],
      activities: [
        'Vocabulary drill with flashcards (5 min)',
        'Listening comprehension exercise (8 min)',
        'Partner conversation practice (12 min)',
        'Cultural mini-lesson with media (8 min)',
        'Interactive language game (7 min)'
      ],
      assessments: ['Oral conversation test', 'Written vocabulary quiz', 'Listening comprehension exercise', 'Cultural presentation'],
      extensions: ['Watch a foreign language film clip', 'Write a pen-pal letter in target language', 'Cook a cultural dish and present in target language'],
      differentiation: 'Provide vocabulary sheets with images for visual learners. Offer native-speaker podcasts for advanced listening practice.'
    },
    Art: {
      topics: ['Color Theory', 'Perspective Drawing', 'Sculpture Basics', 'Art History', 'Digital Art', 'Printmaking', 'Mixed Media', 'Portrait Drawing'],
      materials: ['Drawing paper and pencils', 'Paints and brushes', 'Clay or sculpting materials', 'Art prints for reference', 'Scissors and glue', 'Digital tablets (if available)', 'Smocks'],
      activities: [
        'Art history slide discussion (5 min)',
        'Technique demonstration by teacher (8 min)',
        'Guided practice activity (15 min)',
        'Independent creative work (10 min)',
        'Gallery walk and peer feedback (7 min)'
      ],
      assessments: ['Finished artwork with artist statement', 'Sketchbook review', 'Technique demonstration', 'Group critique participation'],
      extensions: ['Research an artist and emulate their style', 'Create art using recycled materials', 'Design a class mural'],
      differentiation: 'Provide traced outlines for students with fine motor challenges. Offer advanced composition and color theory challenges for gifted artists.'
    },
    'Physical Education': {
      topics: ['Team Sports', 'Fitness Testing', 'Yoga and Mindfulness', 'Dance and Movement', 'Sportsmanship', 'Nutrition and Health', 'Track and Field', 'Swimming Basics'],
      materials: ['Sports equipment (balls, cones, ropes)', 'Whistle and stopwatch', 'Mats for stretching', 'Music player for dance', 'Heart rate monitors (optional)', 'Water bottles', 'First aid kit'],
      activities: [
        'Warm-up and stretching routine (5 min)',
        'Skill demonstration and practice (10 min)',
        'Modified game or activity (15 min)',
        'Cool-down and reflection (5 min)',
        'Health tip of the day discussion (5 min)'
      ],
      assessments: ['Skill observation checklist', 'Fitness improvement tracking', 'Participation and effort rubric', 'Student self-assessment'],
      extensions: ['Lead a warm-up routine', 'Research a sport from another culture', 'Create a personal fitness plan'],
      differentiation: 'Modify activities for different ability levels. Offer leadership roles for skilled athletes and adaptive equipment for students with disabilities.'
    },
    'Computer Science': {
      topics: ['Programming Basics', 'Algorithms', 'Web Development', 'Data Structures', 'Cybersecurity', 'Robotics', 'App Development', 'Digital Citizenship'],
      materials: ['Computers or laptops', 'Internet access', 'Coding platform accounts', 'Robotics kits (if available)', 'Projector for demos', 'Sticky notes for planning', 'Debugging worksheets'],
      activities: [
        'Code-along demonstration (8 min)',
        'Independent coding challenge (15 min)',
        'Pair programming exercise (10 min)',
        'Debugging practice with sample code (7 min)',
        'Showcase and code review (5 min)'
      ],
      assessments: ['Working code submission', 'Debugging challenge', 'Algorithm design problem', 'Project presentation'],
      extensions: ['Build a personal project', 'Participate in a coding competition', 'Contribute to an open-source project'],
      differentiation: 'Provide starter code templates for beginners. Offer advanced algorithm challenges and system design tasks for experienced students.'
    }
  };

  const TEMPLATE_TYPES = [
    { key: 'direct_instruction', name: 'Direct Instruction', desc: 'Teacher-led explicit instruction with guided and independent practice', icon: '📋' },
    { key: 'inquiry_based', name: 'Inquiry-Based Learning', desc: 'Student-driven questioning and investigation approach', icon: '🔍' },
    { key: 'flipped_classroom', name: 'Flipped Classroom', desc: 'Pre-class content delivery with in-class application activities', icon: '🔄' },
    { key: 'project_based', name: 'Project-Based Learning', desc: 'Extended project work with real-world connections', icon: '🏗️' },
    { key: 'cooperative', name: 'Cooperative Learning', desc: 'Structured group work with individual accountability', icon: '👥' },
    { key: 'jigsaw', name: 'Jigsaw Method', desc: 'Expert groups teach peers in home groups', icon: '🧩' },
    { key: 'think_pair_share', name: 'Think-Pair-Share', desc: 'Individual thinking, partner discussion, whole-class sharing', icon: '💭' }
  ];

  function generateLessonPlan(subject, topic, className, duration, difficulty, templateType) {
    const data = SUBJECT_DATA[subject] || SUBJECT_DATA['English'];
    const diff = difficulty || 'medium';
    const dur = parseInt(duration) || 45;

    // Objectives (3-5)
    const objectiveTemplates = {
      low: [
        `Students will be able to identify the key components of ${topic}.`,
        `Students will be able to describe the basic concepts related to ${topic}.`,
        `Students will be able to recognize examples of ${topic} in context.`
      ],
      medium: [
        `Students will be able to explain the core principles of ${topic} with supporting details.`,
        `Students will be able to apply ${topic} concepts to solve problems or analyze situations.`,
        `Students will be able to compare and contrast different aspects of ${topic}.`,
        `Students will be able to create examples that demonstrate understanding of ${topic}.`
      ],
      high: [
        `Students will critically evaluate ${topic} and defend their analysis with evidence.`,
        `Students will synthesize information about ${topic} to form original conclusions.`,
        `Students will design and execute a complex task related to ${topic}.`,
        `Students will analyze ${topic} from multiple perspectives and identify connections to broader themes.`,
        `Students will create original work that demonstrates mastery of ${topic} principles.`
      ]
    };
    const objectives = objectiveTemplates[diff] || objectiveTemplates.medium;

    // Materials
    const materials = data.materials.slice(0, 4 + Math.floor(Math.random() * 3)).join(', ');

    // Introduction
    const intros = {
      direct_instruction: `Begin with a brief overview of ${topic}. Use a real-world hook or question to engage students: "Have you ever wondered how ${topic.toLowerCase()} affects your daily life?" Present key vocabulary on the board and check for prior knowledge with a quick show of hands poll.`,
      inquiry_based: `Present a thought-provoking question or phenomenon related to ${topic}: "What would happen if...?" Allow students 2 minutes to write their initial hypotheses. Collect 3-4 student predictions on the board without confirming or denying.`,
      flipped_classroom: `Quick review quiz (3 questions) on the pre-class video/reading about ${topic}. Address common misconceptions identified from pre-class responses. Clarify any questions students noted from their at-home preparation.`,
      project_based: `Review the project driving question: "How can we use ${topic} to solve a real-world problem?" Show examples of past projects. Review project rubric and timeline. Form project teams and begin brainstorming.`,
      cooperative: `Assign students to heterogeneous groups of 3-4. Each group receives a task card related to ${topic}. Review group roles: Facilitator, Recorder, Reporter, Timekeeper. Set clear expectations for collaborative work.`,
      jigsaw: `Assign each student an "expert topic" within ${topic}. Students move to expert groups to learn their specific sub-topic. Provide expert group materials and guided reading questions. Set 10-minute timer for expert group work.`,
      think_pair_share: `Pose an essential question about ${topic}: "What is the most important thing to understand about ${topic.toLowerCase()}?" Students think independently for 1 minute, then discuss with a partner for 2 minutes. Prepare to share with the whole class.`
    };

    // Main activities based on template
    const templateActivities = {
      direct_instruction: [
        { name: 'Explicit Instruction', desc: `Teacher presents key concepts of ${topic} using visual aids and examples. Use "I do, We do, You do" gradual release model. Check for understanding every 5 minutes with thumbs up/down or mini-whiteboards.`, time: Math.round(dur * 0.3) },
        { name: 'Guided Practice', desc: `Work through 3-4 examples together as a class. Students practice with teacher support. Circulate to identify struggling students and provide immediate scaffolding.`, time: Math.round(dur * 0.25) },
        { name: 'Independent Practice', desc: `Students complete practice problems or tasks independently. Differentiated worksheets available: Level 1 (guided steps), Level 2 (standard), Level 3 (challenge).`, time: Math.round(dur * 0.25) },
        { name: 'Closure and Review', desc: `Review key concepts with a class discussion. Students complete an exit ticket demonstrating understanding of ${topic}. Preview next lesson connection.`, time: Math.round(dur * 0.2) }
      ],
      inquiry_based: [
        { name: 'Question Formulation', desc: `Students generate their own questions about ${topic} using the Question Focus Technique. Categorize questions into "closed" and "open-ended." Select 2-3 priority questions for investigation.`, time: Math.round(dur * 0.2) },
        { name: 'Investigation', desc: `Students research and investigate their selected questions using provided resources. Teacher circulates as facilitator, asking probing questions and guiding without giving direct answers.`, time: Math.round(dur * 0.35) },
        { name: 'Evidence Sharing', desc: `Groups present their findings to the class. Students compare evidence and note patterns or discrepancies. Teacher helps connect findings to ${topic} concepts.`, time: Math.round(dur * 0.25) },
        { name: 'Reflection', desc: `Students write a brief reflection answering: "What did I learn? What questions do I still have?" Class discusses remaining questions and plans next steps.`, time: Math.round(dur * 0.2) }
      ],
      flipped_classroom: [
        { name: 'Pre-Class Review', desc: `Quick assessment of pre-class material on ${topic}. Address questions and misconceptions. Brief review of key concepts from the video/reading (3-5 minutes).`, time: Math.round(dur * 0.15) },
        { name: 'Application Activity', desc: `Students apply pre-class knowledge through hands-on activities. Work in pairs to solve problems or complete tasks related to ${topic}. Teacher provides targeted support to groups.`, time: Math.round(dur * 0.4) },
        { name: 'Extension and Challenge', desc: `Differentiated extension tasks: applied problems, creative projects, or peer teaching. Advanced students tackle challenge problems while teacher works with struggling learners.`, time: Math.round(dur * 0.25) },
        { name: 'Consolidation', desc: `Class discussion connecting application activities to broader ${topic} concepts. Students update their notes with key insights. Assign next pre-class material.`, time: Math.round(dur * 0.2) }
      ],
      project_based: [
        { name: 'Project Launch', desc: `Introduce the project driving question related to ${topic}. Show exemplars and review the project rubric. Teams finalize their project proposals and begin research planning.`, time: Math.round(dur * 0.2) },
        { name: 'Research and Planning', desc: `Teams conduct research, assign roles, and create project timelines. Teacher provides resource links and research guidance. Checkpoint: Each team submits a brief plan.`, time: Math.round(dur * 0.35) },
        { name: 'Creation and Iteration', desc: `Teams work on creating their project deliverables. Peer feedback sessions between teams. Teacher conferences with each group to monitor progress and provide guidance.`, time: Math.round(dur * 0.3) },
        { name: 'Progress Share', desc: `Teams share progress with the class (2-minute updates). Class provides constructive feedback using the project rubric. Set goals for next session.`, time: Math.round(dur * 0.15) }
      ],
      cooperative: [
        { name: 'Team Building', desc: `Quick team-building activity. Review group roles and expectations. Distribute task cards related to ${topic}. Each member has a specific responsibility.`, time: Math.round(dur * 0.1) },
        { name: 'Expert Collaboration', desc: `Teams work together to solve problems or complete tasks related to ${topic}. Each member contributes their assigned role component. Positive interdependence built into task design.`, time: Math.round(dur * 0.4) },
        { name: 'Individual Accountability', desc: `Each student completes an individual quiz or task related to the group work. This ensures personal accountability alongside group learning.`, time: Math.round(dur * 0.2) },
        { name: 'Group Processing', desc: `Teams reflect on their collaboration: "What went well? What can we improve?" Groups share their solutions with the class. Teacher provides feedback on both content and teamwork.`, time: Math.round(dur * 0.3) }
      ],
      jigsaw: [
        { name: 'Expert Group Work', desc: `Students meet in expert groups to master their specific sub-topic of ${topic}. Provide structured reading materials and guided questions. Expert groups discuss and prepare teaching notes.`, time: Math.round(dur * 0.3) },
        { name: 'Home Group Teaching', desc: `Students return to home groups. Each expert teaches their sub-topic to their group members. Others take notes and ask clarifying questions.`, time: Math.round(dur * 0.35) },
        { name: 'Integration Activity', desc: `Home groups complete an activity that requires knowledge from ALL expert topics. This creates interdependence and ensures all content is learned.`, time: Math.round(dur * 0.2) },
        { name: 'Assessment and Reflection', desc: `Individual assessment covering all sub-topics. Students reflect on what they learned as both expert and learner. Preview how topics connect to future lessons.`, time: Math.round(dur * 0.15) }
      ],
      think_pair_share: [
        { name: 'Think (Individual)', desc: `Present a provocative question or problem about ${topic}. Students think independently for 1-2 minutes, recording their ideas. No discussion yet—focus on personal reasoning.`, time: Math.round(dur * 0.1) },
        { name: 'Pair (Partner Discussion)', desc: `Students discuss their thinking with a partner for 3-4 minutes. Partners should: share ideas, ask questions, find common ground, note differences. Provide structured discussion prompts.`, time: Math.round(dur * 0.25) },
        { name: 'Share (Whole Class)', desc: `Selected pairs share their discussion with the class. Teacher records key ideas on the board. Facilitate class discussion connecting different perspectives on ${topic}.`, time: Math.round(dur * 0.3) },
        { name: 'Application and Extension', desc: `Students apply insights from discussions to complete a task related to ${topic}. Could be writing, problem-solving, or creative work. Exit ticket: "One thing I learned from my partner..."`, time: Math.round(dur * 0.35) }
      ]
    };

    const activities = templateActivities[templateType] || templateActivities.direct_instruction;

    // Assessment
    const assessments = data.assessments;
    const assessment = assessments[Math.floor(Math.random() * assessments.length)] + ' aligned to learning objectives.';

    // Homework
    const homeworkOptions = [
      `Complete the practice worksheet on ${topic} (10 problems). Write a brief summary of key concepts learned today.`,
      `Research a real-world application of ${topic} and write a one-paragraph reflection connecting it to class learning.`,
      `Create 5 original practice problems related to ${topic} with answer key. Be prepared to share one with the class.`,
      `Read the assigned textbook section on ${topic} and answer the end-of-section review questions.`,
      `Complete the online quiz on ${topic} through the learning management system. Review incorrect answers before next class.`
    ];
    const homework = homeworkOptions[Math.floor(Math.random() * homeworkOptions.length)];

    // Extension
    const extensions = data.extensions;
    const extension = extensions.slice(0, 2).join('. ') + '.';

    // Differentiation
    const diffNotes = data.differentiation + (diff === 'high'
      ? ' For this advanced lesson, incorporate Socratic questioning and require evidence-based responses. Consider assigning a mentor role to top performers.'
      : diff === 'low'
        ? ' For this foundational lesson, use concrete examples and frequent checks for understanding. Break complex tasks into smaller, manageable steps.'
        : ' For this intermediate lesson, balance direct instruction with discovery learning. Use flexible grouping based on formative assessment data.');

    return {
      objectives,
      materials,
      introduction: intros[templateType] || intros.direct_instruction,
      main_activities: activities,
      assessment,
      homework,
      extension,
      differentiation: diffNotes
    };
  }

  // ─── SVG Chart Helpers ───
  function coverageBarChart(subjects) {
    const w = 600, h = 260;
    const barW = 50, gap = 30;
    const startX = 80, baseY = 220;
    const colors = [P, S, W, '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#10b981'];
    let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Standards coverage by subject">`;
    svg += `<rect width="${w}" height="${h}" fill="${BG}" rx="8"/>`;
    svg += `<text x="${w/2}" y="24" font-size="14" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">Standards Coverage by Subject</text>`;
    // Y-axis
    for (let i = 0; i <= 4; i++) {
      const y = baseY - (i * 45);
      svg += `<text x="${startX - 8}" y="${y + 4}" font-size="10" fill="${GRAY}" text-anchor="end" font-family="sans-serif">${i * 25}%</text>`;
      svg += `<line x1="${startX}" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
    }
    subjects.forEach((s, i) => {
      const x = startX + i * (barW + gap);
      if (x + barW > w - 20) return;
      const pct = Math.min(100, s.pct || 0);
      const barH = (pct / 100) * 180;
      const color = colors[i % colors.length];
      svg += `<rect x="${x}" y="${baseY - barH}" width="${barW}" height="${barH}" fill="${color}" rx="4"/>`;
      svg += `<text x="${x + barW/2}" y="${baseY - barH - 6}" font-size="11" fill="${color}" text-anchor="middle" font-family="sans-serif" font-weight="bold">${pct}%</text>`;
      const label = (s.subject || 'Subj').length > 8 ? (s.subject || 'Subj').substring(0, 7) + '.' : (s.subject || 'Subj');
      svg += `<text x="${x + barW/2}" y="${baseY + 16}" font-size="10" fill="#374151" text-anchor="middle" font-family="sans-serif">${esc(label)}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  function subjectDonutChart(data) {
    const cx = 100, cy = 100, r = 70, inner = 45;
    const total = data.reduce((a, d) => a + d.count, 0) || 1;
    const colors = [P, S, W, '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#10b981'];
    let startAngle = -Math.PI / 2;
    let svg = `<svg width="220" height="220" role="img" aria-label="Lesson plans by subject">`;
    svg += `<rect width="220" height="220" fill="${BG}" rx="8"/>`;
    data.forEach((d, i) => {
      const pct = d.count / total;
      if (pct === 0) return;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const ix1 = cx + inner * Math.cos(endAngle);
      const iy1 = cy + inner * Math.sin(endAngle);
      const ix2 = cx + inner * Math.cos(startAngle);
      const iy2 = cy + inner * Math.sin(startAngle);
      const large = angle > Math.PI ? 1 : 0;
      svg += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large},0 ${ix2},${iy2} Z" fill="${colors[i % colors.length]}"/>`;
      startAngle = endAngle;
    });
    svg += `<text x="${cx}" y="${cy + 5}" font-size="16" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">${total}</text>`;
    svg += `<text x="${cx}" y="${cy + 18}" font-size="9" fill="${GRAY}" text-anchor="middle" font-family="sans-serif">Plans</text>`;
    return svg + '</svg>';
  }

  function weeklyHeatmap(days, periods) {
    const w = 700, h = 200;
    const cellW = 80, cellH = 30, startX = 90, startY = 40;
    let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Weekly lesson plan schedule">`;
    svg += `<rect width="${w}" height="${h}" fill="${BG}" rx="8"/>`;
    days.forEach((d, di) => {
      svg += `<text x="${startX + di * (cellW + 5) + cellW/2}" y="${startY - 10}" font-size="11" fill="#374151" text-anchor="middle" font-family="sans-serif" font-weight="bold">${esc(d)}</text>`;
    });
    periods.forEach((p, pi) => {
      svg += `<text x="${startX - 8}" y="${startY + pi * (cellH + 5) + cellH/2 + 4}" font-size="10" fill="${GRAY}" text-anchor="end" font-family="sans-serif">${esc(p)}</text>`;
      days.forEach((d, di) => {
        const x = startX + di * (cellW + 5);
        const y = startY + pi * (cellH + 5);
        svg += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="#e5e7eb" rx="4" stroke="#d1d5db" stroke-width="0.5"/>`;
      });
    });
    svg += '</svg>';
    return svg;
  }

  // ─── Database Setup ───
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_plans_ai (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        subject VARCHAR(200) NOT NULL DEFAULT '',
        topic VARCHAR(300) NOT NULL DEFAULT '',
        class_name VARCHAR(100) NOT NULL DEFAULT '',
        duration INTEGER NOT NULL DEFAULT 45,
        difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
        objectives JSONB DEFAULT '[]',
        materials TEXT DEFAULT '',
        introduction TEXT DEFAULT '',
        main_activities JSONB DEFAULT '[]',
        assessment TEXT DEFAULT '',
        homework TEXT DEFAULT '',
        extension TEXT DEFAULT '',
        differentiation TEXT DEFAULT '',
        template_type VARCHAR(50) DEFAULT 'direct_instruction',
        shared BOOLEAN DEFAULT false,
        share_token VARCHAR(100) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lpa_tenant ON lesson_plans_ai(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_lpa_teacher ON lesson_plans_ai(teacher_id);
      CREATE INDEX IF NOT EXISTS idx_lpa_subject ON lesson_plans_ai(subject);
      CREATE INDEX IF NOT EXISTS idx_lpa_shared ON lesson_plans_ai(shared);
      CREATE INDEX IF NOT EXISTS idx_lpa_token ON lesson_plans_ai(share_token);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_plan_schedule (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        lesson_plan_id INTEGER NOT NULL REFERENCES lesson_plans_ai(id) ON DELETE CASCADE,
        scheduled_date DATE NOT NULL,
        period INTEGER DEFAULT 1,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lps_tenant ON lesson_plan_schedule(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_lps_teacher ON lesson_plan_schedule(teacher_id);
      CREATE INDEX IF NOT EXISTS idx_lps_date ON lesson_plan_schedule(scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_lps_plan ON lesson_plan_schedule(lesson_plan_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_plan_comments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lesson_plan_id INTEGER NOT NULL REFERENCES lesson_plans_ai(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        comment TEXT NOT NULL DEFAULT '',
        rating INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lpc_tenant ON lesson_plan_comments(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_lpc_plan ON lesson_plan_comments(lesson_plan_id);
      CREATE INDEX IF NOT EXISTS idx_lpc_user ON lesson_plan_comments(user_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_standards (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        standard_code VARCHAR(100) NOT NULL DEFAULT '',
        standard_desc TEXT NOT NULL DEFAULT '',
        subject VARCHAR(200) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ls_tenant ON lesson_standards(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ls_subject ON lesson_standards(subject);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ls_code_tenant ON lesson_standards(standard_code, tenant_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_standards_map (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lesson_plan_id INTEGER NOT NULL REFERENCES lesson_plans_ai(id) ON DELETE CASCADE,
        standard_id INTEGER NOT NULL REFERENCES lesson_standards(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lsm_tenant ON lesson_standards_map(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_lsm_plan ON lesson_standards_map(lesson_plan_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lsm_unique ON lesson_standards_map(lesson_plan_id, standard_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_reflections (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lesson_plan_id INTEGER NOT NULL REFERENCES lesson_plans_ai(id) ON DELETE CASCADE,
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        what_worked TEXT DEFAULT '',
        what_didnt TEXT DEFAULT '',
        improvements TEXT DEFAULT '',
        student_engagement INTEGER DEFAULT 3,
        goal_achievement INTEGER DEFAULT 3,
        overall_rating INTEGER DEFAULT 3,
        reflection_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lr_tenant ON lesson_reflections(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_lr_plan ON lesson_reflections(lesson_plan_id);
      CREATE INDEX IF NOT EXISTS idx_lr_teacher ON lesson_reflections(teacher_id);
    `);
  })();

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans — Library Dashboard
  // ══════════════════════════════════════════════
  app.get('/lesson-plans', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { search, subject, cls, shared } = req.query;
    let where = 'WHERE lp.tenant_id = $1';
    const params = [tid];
    if (!shared) {
      where += ' AND (lp.teacher_id = $2 OR lp.shared = true)';
      params.push(uid);
    } else {
      where += ' AND lp.shared = true';
    }
    if (search) { where += ' AND (lp.topic ILIKE $' + (params.length + 1) + ' OR lp.subject ILIKE $' + (params.length + 1) + ')'; params.push('%' + search + '%'); }
    if (subject) { where += ' AND lp.subject = $' + (params.length + 1); params.push(subject); }
    if (cls) { where += ' AND lp.class_name = $' + (params.length + 1); params.push(cls); }

    const { rows } = await pool.query(
      `SELECT lp.*, u.name AS teacher_name FROM lesson_plans_api lp LEFT JOIN users u ON u.id = lp.teacher_id ${where} ORDER BY lp.created_at DESC LIMIT 100`.replace('lesson_plans_api', 'lesson_plans_ai'),
      params
    );
    const subjects = (await pool.query(`SELECT DISTINCT subject FROM lesson_plans_ai WHERE tenant_id = $1 ORDER BY subject`, [tid])).rows.map(r => r.subject);
    const classes = (await pool.query(`SELECT DISTINCT class_name FROM lesson_plans_ai WHERE tenant_id = $1 ORDER BY class_name`, [tid])).rows.map(r => r.class_name);
    const totalPlans = (await pool.query(`SELECT COUNT(*)::int AS n FROM lesson_plans_ai WHERE tenant_id = $1`, [tid])).rows[0].n;
    const sharedCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM lesson_plans_ai WHERE tenant_id = $1 AND shared = true`, [tid])).rows[0].n;
    const subjectData = (await pool.query(`SELECT subject, COUNT(*)::int AS count FROM lesson_plans_ai WHERE tenant_id = $1 GROUP BY subject ORDER BY count DESC`, [tid])).rows;

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px">
        <div>
          <h1 style="color:${P};font-size:1.8em;margin:0 0 4px">AI Lesson Plans</h1>
          <p style="color:${GRAY};margin:0">Generate, manage, and share lesson plans powered by AI</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="/lesson-plans/generate" style="display:inline-flex;align-items:center;padding:10px 20px;background:${P};color:white;border-radius:8px;text-decoration:none;font-weight:600">+ Generate Plan</a>
          <a href="/lesson-plans/templates" style="display:inline-flex;align-items:center;padding:10px 20px;background:${S};color:white;border-radius:8px;text-decoration:none;font-weight:600">Templates</a>
          <a href="/lesson-plans/weekly" style="display:inline-flex;align-items:center;padding:10px 20px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;font-weight:600">Weekly Planner</a>
          <a href="/lesson-plans/standards" style="display:inline-flex;align-items:center;padding:10px 20px;background:#7c3aed;color:white;border-radius:8px;text-decoration:none;font-weight:600">Standards</a>
        </div>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;align-items:stretch">
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${P}">${totalPlans}</div>
          <div style="color:${GRAY};font-size:0.9em">Total Plans</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${S}">${sharedCount}</div>
          <div style="color:${GRAY};font-size:0.9em">Shared Plans</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${W}">${subjects.length}</div>
          <div style="color:${GRAY};font-size:0.9em">Subjects</div>
        </div>
        <div style="background:white;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
          ${subjectData.length > 0 ? subjectDonutChart(subjectData) : '<p style="color:'+GRAY+';font-size:0.9em;text-align:center">No data yet</p>'}
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <form method="get" action="/lesson-plans" style="flex:1;min-width:200px;display:flex;gap:8px">
          <input type="text" name="search" placeholder="Search topics..." value="${esc(search||'')}" aria-label="Search lesson plans"
            style="flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">
          <select name="subject" aria-label="Filter by subject" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
            <option value="">All Subjects</option>
            ${subjects.map(s => `<option value="${esc(s)}" ${subject===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
          <select name="cls" aria-label="Filter by class" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
            <option value="">All Classes</option>
            ${classes.map(c => `<option value="${esc(c)}" ${cls===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
          <button type="submit" style="padding:10px 16px;background:${P};color:white;border:none;border-radius:8px;cursor:pointer">Search</button>
        </form>
        <a href="/lesson-plans?shared=1" style="color:${P};text-decoration:none;font-weight:600">View Shared</a>
      </div>

      <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#f3f4f6">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Subject</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Topic</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Class</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Duration</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Template</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Shared</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${GRAY}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="7" style="padding:40px;text-align:center;color:${GRAY}">No lesson plans yet. Generate your first AI lesson plan!</td></tr>` :
              rows.map(r => {
                const tmpl = TEMPLATE_TYPES.find(t => t.key === r.template_type);
                return `<tr style="border-top:1px solid #f3f4f6">
                  <td style="padding:12px 16px;font-weight:600;color:${P}">${esc(r.subject)}</td>
                  <td style="padding:12px 16px">${esc(r.topic)}</td>
                  <td style="padding:12px 16px">${esc(r.class_name)}</td>
                  <td style="padding:12px 16px">${r.duration} min</td>
                  <td style="padding:12px 16px"><span style="background:#eff6ff;color:${P};padding:2px 8px;border-radius:4px;font-size:0.8em">${esc((tmpl?tmpl.icon:'')+' '+(tmpl?tmpl.name:r.template_type))}</span></td>
                  <td style="padding:12px 16px">${r.shared ? '<span style="color:'+S+';font-weight:bold">&#10003;</span>' : '<span style="color:#9ca3af">—</span>'}</td>
                  <td style="padding:12px 16px;text-align:center;white-space:nowrap">
                    <a href="/lesson-plans/${r.id}" style="color:${P};text-decoration:none;margin-right:6px" aria-label="View plan ${r.id}">View</a>
                    <a href="/lesson-plans/${r.id}/edit" style="color:#6366f1;text-decoration:none;margin-right:6px" aria-label="Edit plan ${r.id}">Edit</a>
                    <a href="/lesson-plans/print/${r.id}" target="_blank" style="color:${W};text-decoration:none;margin-right:6px" aria-label="Print plan ${r.id}">Print</a>
                    <a href="/lesson-plans/${r.id}/export" style="color:${S};text-decoration:none;margin-right:6px" aria-label="Export plan ${r.id}">Export</a>
                    <button onclick="deletePlan(${r.id})" style="color:${D};background:none;border:none;cursor:pointer;font-size:1em" aria-label="Delete plan ${r.id}">Delete</button>
                  </td>
                </tr>`;
              }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>
    <script>
    async function deletePlan(id){if(!confirm('Delete this lesson plan?'))return;await fetch('/lesson-plans/'+id+'/delete',{method:'POST'});location.reload();}
    </script>`;
    res.send(renderPage('AI Lesson Plans', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/generate — AI Generator
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/generate', requireAuth, ah(async (req, res) => {
    const subjects = Object.keys(SUBJECT_DATA);
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:4px">Generate AI Lesson Plan</h1>
      <p style="color:${GRAY};margin-bottom:24px">Enter your lesson details and our AI will generate a complete plan</p>
      <form id="genForm" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="subject" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Subject *</label>
            <select id="subject" name="subject" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
              <option value="">Select subject...</option>
              ${subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="class_name" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Class *</label>
            <input type="text" id="class_name" name="class_name" required placeholder="e.g. Grade 10, Year 8" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="topic" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Topic *</label>
          <input type="text" id="topic" name="topic" required placeholder="e.g. Photosynthesis, World War II, Algebraic Equations" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="duration" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Duration (min) *</label>
            <input type="number" id="duration" name="duration" required value="45" min="15" max="180" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
          </div>
          <div>
            <label for="difficulty" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Difficulty *</label>
            <select id="difficulty" name="difficulty" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
              <option value="low">Beginner</option>
              <option value="medium" selected>Intermediate</option>
              <option value="high">Advanced</option>
            </select>
          </div>
          <div>
            <label for="template_type" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Template</label>
            <select id="template_type" name="template_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              ${TEMPLATE_TYPES.map(t => `<option value="${t.key}">${t.icon} ${esc(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <button type="submit" style="padding:12px 32px;background:${P};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Generate Lesson Plan</button>
      </form>
      <div id="result" style="margin-top:24px"></div>
    </div>
    <script>
    document.getElementById('genForm').addEventListener('submit',async function(e){
      e.preventDefault();
      const fd=new FormData(this);const data=Object.fromEntries(fd);
      document.getElementById('result').innerHTML='<p style="text-align:center;color:'+GRAY+'">Generating lesson plan...</p>';
      try{
        const r=await fetch('/lesson-plans/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        const d=await r.json();
        if(d.error){document.getElementById('result').innerHTML='<p style="color:'+D+'">'+d.error+'</p>';return;}
        if(d.id){window.location.href='/lesson-plans/'+d.id;}
      }catch(ex){document.getElementById('result').innerHTML='<p style="color:'+D+'">Error: '+ex.message+'</p>';}
    });
    </script>`;
    res.send(renderPage('Generate Lesson Plan', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/generate — AI Generator API
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/generate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { subject, topic, class_name, duration, difficulty, template_type } = req.body;
    if (!subject || !topic || !class_name) return res.json({ error: 'Subject, topic, and class are required.' });
    const tmpl = template_type || 'direct_instruction';
    const plan = generateLessonPlan(subject, topic, class_name, duration, difficulty, tmpl);
    const { rows } = await pool.query(
      `INSERT INTO lesson_plans_ai (tenant_id, teacher_id, subject, topic, class_name, duration, difficulty, objectives, materials, introduction, main_activities, assessment, homework, extension, differentiation, template_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [tid, uid, subject, topic, class_name, parseInt(duration)||45, difficulty||'medium',
        JSON.stringify(plan.objectives), plan.materials, plan.introduction,
        JSON.stringify(plan.main_activities), plan.assessment, plan.homework,
        plan.extension, plan.differentiation, tmpl]
    );
    audit(req, 'lesson_plan_generate', { id: rows[0].id, subject, topic });
    res.json({ id: rows[0].id });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/:id — View Lesson Plan
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [lp] } = await pool.query(
      `SELECT lp.*, u.name AS teacher_name FROM lesson_plans_ai lp LEFT JOIN users u ON u.id = lp.teacher_id WHERE lp.id = $1 AND lp.tenant_id = $2`,
      [req.params.id, tid]
    );
    if (!lp) return res.status(404).send('Lesson plan not found.');
    const objectives = typeof lp.objectives === 'string' ? JSON.parse(lp.objectives) : (lp.objectives || []);
    const activities = typeof lp.main_activities === 'string' ? JSON.parse(lp.main_activities) : (lp.main_activities || []);
    const comments = (await pool.query(
      `SELECT c.*, u.name AS commenter_name FROM lesson_plan_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.lesson_plan_id = $1 AND c.tenant_id = $2 ORDER BY c.created_at DESC LIMIT 50`,
      [lp.id, tid]
    )).rows;
    const reflections = (await pool.query(
      `SELECT * FROM lesson_reflections WHERE lesson_plan_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 10`,
      [lp.id, tid]
    )).rows;
    const mappedStandards = (await pool.query(
      `SELECT ls.* FROM lesson_standards_map lsm JOIN lesson_standards ls ON ls.id = lsm.standard_id WHERE lsm.lesson_plan_id = $1 AND lsm.tenant_id = $2`,
      [lp.id, tid]
    )).rows;
    const tmpl = TEMPLATE_TYPES.find(t => t.key === lp.template_type);

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:24px;flex-wrap:wrap">
        <a href="/lesson-plans" style="color:${P};text-decoration:none;font-size:0.9em">&larr; Back to Library</a>
        <span style="flex:1"></span>
        <button onclick="toggleShare(${lp.id},${lp.shared?'true':'false'})" style="padding:8px 16px;background:${lp.shared?W:S};color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">${lp.shared ? 'Unshare' : 'Share'}</button>
        <a href="/lesson-plans/${lp.id}/edit" style="padding:8px 16px;background:#6366f1;color:white;border-radius:8px;text-decoration:none;font-weight:600">Edit</a>
        <a href="/lesson-plans/print/${lp.id}" target="_blank" style="padding:8px 16px;background:${W};color:white;border-radius:8px;text-decoration:none;font-weight:600">Print</a>
        <a href="/lesson-plans/${lp.id}/export" style="padding:8px 16px;background:${S};color:white;border-radius:8px;text-decoration:none;font-weight:600">Export HTML</a>
      </div>

      <div style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,${P},#7c3aed);padding:24px;color:white">
          <h1 style="margin:0 0 8px;font-size:1.6em">${esc(lp.topic)}</h1>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.9em;opacity:0.9">
            <span>${esc(lp.subject)}</span>
            <span>|</span>
            <span>${esc(lp.class_name)}</span>
            <span>|</span>
            <span>${lp.duration} min</span>
            <span>|</span>
            <span>${esc(lp.difficulty)}</span>
            <span>|</span>
            <span>${tmpl?tmpl.icon+' '+esc(tmpl.name):esc(lp.template_type)}</span>
          </div>
          <div style="font-size:0.8em;opacity:0.7;margin-top:8px">By ${esc(lp.teacher_name||'Unknown')} &middot; ${new Date(lp.created_at).toLocaleDateString()}</div>
        </div>

        <div style="padding:24px">
          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Learning Objectives</h2>
            <ul style="margin:0;padding-left:20px;color:#374151;line-height:1.8">
              ${objectives.map(o => `<li>${esc(o)}</li>`).join('')}
            </ul>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Materials Needed</h2>
            <p style="color:#374151;margin:0">${esc(lp.materials)}</p>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Introduction</h2>
            <div style="background:#eff6ff;border-left:4px solid ${P};padding:16px;border-radius:0 8px 8px 0;color:#374151;line-height:1.7">${esc(lp.introduction)}</div>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Main Activities</h2>
            <div style="display:flex;flex-direction:column;gap:12px">
              ${activities.map((a, i) => `
                <div style="background:${i%2===0?'#f9fafb':'white'};border:1px solid #e5e7eb;border-radius:10px;padding:16px;display:flex;gap:16px">
                  <div style="background:${P};color:white;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0">${i+1}</div>
                  <div style="flex:1">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                      <h3 style="margin:0;color:#1f2937;font-size:1em">${esc(a.name||'Activity '+(i+1))}</h3>
                      <span style="background:#e0e7ff;color:${P};padding:2px 10px;border-radius:12px;font-size:0.8em;font-weight:600">${a.time||''} min</span>
                    </div>
                    <p style="margin:0;color:#4b5563;line-height:1.6;font-size:0.9em">${esc(a.desc||'')}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Assessment</h2>
            <p style="color:#374151;margin:0">${esc(lp.assessment)}</p>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Homework Assignment</h2>
            <p style="color:#374151;margin:0">${esc(lp.homework)}</p>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Extension Activities</h2>
            <p style="color:#374151;margin:0">${esc(lp.extension)}</p>
          </section>

          <section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Differentiation Notes</h2>
            <p style="color:#374151;margin:0">${esc(lp.differentiation)}</p>
          </section>

          ${mappedStandards.length > 0 ? `<section style="margin-bottom:24px">
            <h2 style="color:${P};font-size:1.2em;margin:0 0 12px;border-bottom:2px solid #e0e7ff;padding-bottom:8px">Aligned Standards</h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap">${mappedStandards.map(s =>
              `<span style="background:#dbeafe;color:#1e40af;padding:4px 12px;border-radius:6px;font-size:0.85em" title="${esc(s.standard_desc)}">${esc(s.standard_code)}</span>`
            ).join('')}</div>
          </section>` : ''}
        </div>
      </div>

      <!-- Reflections -->
      <div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P};margin:0">Lesson Reflections</h2>
          <a href="/lesson-plans/${lp.id}/reflection" style="padding:8px 16px;background:#7c3aed;color:white;border-radius:8px;text-decoration:none;font-weight:600">+ Add Reflection</a>
        </div>
        ${reflections.length === 0 ? `<p style="color:${GRAY};text-align:center;padding:20px">No reflections yet. Add one after teaching this lesson.</p>` :
          reflections.map(r => `
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px">
              <div style="display:flex;gap:12px;margin-bottom:10px;font-size:0.85em;color:${GRAY}">
                <span>${new Date(r.created_at).toLocaleDateString()}</span>
                <span>Engagement: ${'★'.repeat(r.student_engagement||0)}${'☆'.repeat(5-(r.student_engagement||0))}</span>
                <span>Goals: ${'★'.repeat(r.goal_achievement||0)}${'☆'.repeat(5-(r.goal_achievement||0))}</span>
              </div>
              ${r.what_worked ? `<p style="margin:4px 0"><strong style="color:${S}">What worked:</strong> ${esc(r.what_worked)}</p>` : ''}
              ${r.what_didnt ? `<p style="margin:4px 0"><strong style="color:${D}">What didn't:</strong> ${esc(r.what_didnt)}</p>` : ''}
              ${r.improvements ? `<p style="margin:4px 0"><strong style="color:${W}">Improvements:</strong> ${esc(r.improvements)}</p>` : ''}
            </div>
          `).join('')}
      </div>

      <!-- Comments -->
      <div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <h2 style="color:${P};margin:0 0 16px">Feedback &amp; Comments (${comments.length})</h2>
        <form id="commentForm" style="margin-bottom:16px;display:flex;gap:10px">
          <textarea id="commentText" rows="2" placeholder="Add your feedback..." style="flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;resize:vertical;box-sizing:border-box" aria-label="Add a comment"></textarea>
          <select id="commentRating" style="padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-label="Rating">
            <option value="0">No rating</option>
            <option value="1">1 - Poor</option><option value="2">2 - Fair</option><option value="3">3 - Good</option>
            <option value="4">4 - Very Good</option><option value="5">5 - Excellent</option>
          </select>
          <button type="submit" style="padding:10px 20px;background:${P};color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;align-self:flex-end">Post</button>
        </form>
        <div id="commentsList">
          ${comments.length === 0 ? `<p style="color:${GRAY};text-align:center;padding:16px">No comments yet. Be the first to provide feedback!</p>` :
            comments.map(c => `
              <div style="border:1px solid #f3f4f6;border-radius:8px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                  <strong style="color:#374151;font-size:0.9em">${esc(c.commenter_name||'Teacher')}</strong>
                  <span style="color:${GRAY};font-size:0.8em">${new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p style="margin:0;color:#4b5563;font-size:0.9em">${esc(c.comment)}</p>
                ${c.rating > 0 ? `<div style="margin-top:6px;color:${W};font-size:0.85em">${'★'.repeat(c.rating)}${'☆'.repeat(5-c.rating)}</div>` : ''}
              </div>
            `).join('')}
        </div>
      </div>
    </div>
    <script>
    async function toggleShare(id,isShared){
      await fetch('/lesson-plans/'+id+'/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shared:!isShared})});
      location.reload();
    }
    document.getElementById('commentForm').addEventListener('submit',async function(e){
      e.preventDefault();
      const comment=document.getElementById('commentText').value.trim();
      const rating=parseInt(document.getElementById('commentRating').value)||0;
      if(!comment)return;
      const r=await fetch('/lesson-plans/${lp.id}/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment,rating})});
      if(r.ok){document.getElementById('commentText').value='';location.reload();}
    });
    </script>`;
    res.send(renderPage('Lesson Plan: ' + lp.topic, body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/:id/share — Toggle Share
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/:id/share', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { shared } = req.body;
    const token = shared ? require('crypto').randomBytes(16).toString('hex') : '';
    await pool.query(
      `UPDATE lesson_plans_ai SET shared = $1, share_token = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 AND teacher_id = $5`,
      [!!shared, token, req.params.id, tid, uid]
    );
    audit(req, 'lesson_plan_share', { id: req.params.id, shared });
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/:id/comments — Add Comment
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/:id/comments', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { comment, rating } = req.body;
    if (!comment || !comment.trim()) return res.status(400).json({ error: 'Comment required.' });
    await pool.query(
      `INSERT INTO lesson_plan_comments (tenant_id, lesson_plan_id, user_id, comment, rating) VALUES ($1, $2, $3, $4, $5)`,
      [tid, req.params.id, req.session.user.id, comment.trim(), parseInt(rating) || 0]
    );
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/:id/delete — Delete Plan
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM lesson_plans_ai WHERE id = $1 AND tenant_id = $2 AND teacher_id = $3`,
      [req.params.id, tid, req.session.user.id]);
    audit(req, 'lesson_plan_delete', { id: req.params.id });
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/:id/edit — Edit Plan
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [lp] } = await pool.query(
      `SELECT * FROM lesson_plans_ai WHERE id = $1 AND tenant_id = $2 AND teacher_id = $3`,
      [req.params.id, tid, req.session.user.id]
    );
    if (!lp) return res.status(404).send('Lesson plan not found.');
    const objectives = typeof lp.objectives === 'string' ? JSON.parse(lp.objectives) : (lp.objectives || []);
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:900px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">Edit Lesson Plan: ${esc(lp.topic)}</h1>
      <form method="post" action="/lesson-plans/${lp.id}/edit" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="subject" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Subject</label>
            <select id="subject" name="subject" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              ${Object.keys(SUBJECT_DATA).map(s => `<option value="${esc(s)}" ${lp.subject===s?'selected':''}>${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="class_name" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Class</label>
            <input type="text" id="class_name" name="class_name" value="${esc(lp.class_name)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="topic" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Topic</label>
          <input type="text" id="topic" name="topic" value="${esc(lp.topic)}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="duration" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Duration (min)</label>
            <input type="number" id="duration" name="duration" value="${lp.duration}" min="15" max="180" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
          <div>
            <label for="difficulty" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Difficulty</label>
            <select id="difficulty" name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="low" ${lp.difficulty==='low'?'selected':''}>Beginner</option>
              <option value="medium" ${lp.difficulty==='medium'?'selected':''}>Intermediate</option>
              <option value="high" ${lp.difficulty==='high'?'selected':''}>Advanced</option>
            </select>
          </div>
          <div>
            <label for="template_type" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Template</label>
            <select id="template_type" name="template_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              ${TEMPLATE_TYPES.map(t => `<option value="${t.key}" ${lp.template_type===t.key?'selected':''}>${t.icon} ${esc(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="objectives" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Objectives (one per line)</label>
          <textarea id="objectives" name="objectives" rows="5" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${objectives.map(o => esc(o)).join('\n')}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="materials" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Materials</label>
          <textarea id="materials" name="materials" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(lp.materials)}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="introduction" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Introduction</label>
          <textarea id="introduction" name="introduction" rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(lp.introduction)}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="assessment" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Assessment</label>
          <textarea id="assessment" name="assessment" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(lp.assessment)}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="homework" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Homework</label>
          <textarea id="homework" name="homework" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(lp.homework)}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="extension" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Extension Activities</label>
          <textarea id="extension" name="extension" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(lp.extension)}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="differentiation" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Differentiation</label>
          <textarea id="differentiation" name="differentiation" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box">${esc(lp.differentiation)}</textarea>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" style="padding:12px 32px;background:${P};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Save Changes</button>
          <a href="/lesson-plans/${lp.id}" style="padding:12px 24px;background:#e5e7eb;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('Edit Lesson Plan', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/:id/edit — Save Edit
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { subject, topic, class_name, duration, difficulty, template_type, objectives, materials, introduction, assessment, homework, extension, differentiation } = req.body;
    const objectivesArr = (objectives || '').split('\n').map(o => o.trim()).filter(o => o);
    await pool.query(
      `UPDATE lesson_plans_ai SET subject=$1, topic=$2, class_name=$3, duration=$4, difficulty=$5, template_type=$6, objectives=$7, materials=$8, introduction=$9, assessment=$10, homework=$11, extension=$12, differentiation=$13, updated_at=NOW() WHERE id=$14 AND tenant_id=$15 AND teacher_id=$16`,
      [subject, topic, class_name, parseInt(duration)||45, difficulty, template_type, JSON.stringify(objectivesArr), materials, introduction, assessment, homework, extension, differentiation, req.params.id, tid, uid]
    );
    audit(req, 'lesson_plan_edit', { id: req.params.id });
    res.redirect('/lesson-plans/' + req.params.id);
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/templates — Template Gallery
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/templates', requireAuth, ah(async (req, res) => {
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1100px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:4px">Template Gallery</h1>
      <p style="color:${GRAY};margin-bottom:24px">Choose a teaching template and generate a customized lesson plan</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px">
        ${TEMPLATE_TYPES.map(t => `
          <div style="background:white;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border:2px solid transparent;transition:border-color .2s;cursor:pointer" onmouseover="this.style.borderColor='${P}'" onmouseout="this.style.borderColor='transparent'" onclick="location.href='/lesson-plans/templates/${t.key}'">
            <div style="font-size:2.5em;margin-bottom:12px">${t.icon}</div>
            <h3 style="margin:0 0 8px;color:#1f2937;font-size:1.1em">${esc(t.name)}</h3>
            <p style="margin:0;color:${GRAY};font-size:0.9em;line-height:1.5">${esc(t.desc)}</p>
            <div style="margin-top:16px;padding-top:12px;border-top:1px solid #f3f4f6">
              <span style="color:${P};font-weight:600;font-size:0.9em">Use Template &rarr;</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
    res.send(renderPage('Template Gallery', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/templates/:type — Template Form
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/templates/:type', requireAuth, ah(async (req, res) => {
    const tmpl = TEMPLATE_TYPES.find(t => t.key === req.params.type);
    if (!tmpl) return res.status(404).send('Template not found.');
    const subjects = Object.keys(SUBJECT_DATA);
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:700px;margin:0 auto;padding:20px">
      <a href="/lesson-plans/templates" style="color:${P};text-decoration:none;font-size:0.9em">&larr; Back to Gallery</a>
      <h1 style="color:${P};margin:12px 0 4px">${tmpl.icon} ${esc(tmpl.name)}</h1>
      <p style="color:${GRAY};margin-bottom:24px">${esc(tmpl.desc)}</p>
      <form id="templateForm" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="subject" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Subject *</label>
            <select id="subject" name="subject" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
              <option value="">Select subject...</option>
              ${subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="class_name" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Class *</label>
            <input type="text" id="class_name" name="class_name" required placeholder="e.g. Grade 10" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="topic" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Topic *</label>
          <input type="text" id="topic" name="topic" required placeholder="e.g. Photosynthesis" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="duration" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Duration (min)</label>
            <input type="number" id="duration" name="duration" value="45" min="15" max="180" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
          <div>
            <label for="difficulty" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Difficulty</label>
            <select id="difficulty" name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              <option value="low">Beginner</option><option value="medium" selected>Intermediate</option><option value="high">Advanced</option>
            </select>
          </div>
        </div>
        <input type="hidden" name="template_type" value="${esc(tmpl.key)}">
        <button type="submit" style="padding:12px 32px;background:${P};color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Generate with ${esc(tmpl.name)}</button>
      </form>
    </div>
    <script>
    document.getElementById('templateForm').addEventListener('submit',async function(e){
      e.preventDefault();const fd=new FormData(this);const data=Object.fromEntries(fd);
      const r=await fetch('/lesson-plans/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      const d=await r.json();if(d.id){window.location.href='/lesson-plans/'+d.id;}
      else{alert(d.error||'Generation failed');}
    });
    </script>`;
    res.send(renderPage('Template: ' + tmpl.name, body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/weekly — Weekly Planner
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/weekly', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { week } = req.query;
    let baseDate;
    if (week) {
      baseDate = new Date(week);
    } else {
      baseDate = new Date();
      const day = baseDate.getDay();
      baseDate.setDate(baseDate.getDate() - day + 1);
    }
    const weekStart = new Date(baseDate);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayDates = days.map((d, i) => {
      const dt = new Date(weekStart);
      dt.setDate(dt.getDate() + i);
      return dt;
    });

    const schedules = (await pool.query(
      `SELECT lps.*, lp.subject, lp.topic, lp.duration, lp.template_type FROM lesson_plan_schedule lps
       JOIN lesson_plans_ai lp ON lp.id = lps.lesson_plan_id
       WHERE lps.tenant_id = $1 AND lps.teacher_id = $2 AND lps.scheduled_date BETWEEN $3 AND $4
       ORDER BY lps.scheduled_date, lps.period`,
      [tid, uid, weekStart, weekEnd]
    )).rows;

    const allPlans = (await pool.query(
      `SELECT id, subject, topic, duration FROM lesson_plans_ai WHERE tenant_id = $1 AND teacher_id = $2 ORDER BY topic`,
      [tid, uid]
    )).rows;

    const prevWeek = new Date(weekStart);
    prevWeek.setDate(prevWeek.getDate() - 7);
    const nextWeek = new Date(weekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const scheduleByDay = {};
    dayDates.forEach(dt => {
      const key = dt.toISOString().split('T')[0];
      scheduleByDay[key] = schedules.filter(s => s.scheduled_date.toISOString().split('T')[0] === key);
    });

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="color:${P};margin:0 0 4px">Weekly Planner</h1>
          <p style="color:${GRAY};margin:0">${weekStart.toLocaleDateString('en-US',{month:'long',day:'numeric'})} - ${weekEnd.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <a href="/lesson-plans/weekly?week=${prevWeek.toISOString().split('T')[0]}" style="padding:8px 16px;background:#e5e7eb;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">&larr; Prev</a>
          <a href="/lesson-plans/weekly" style="padding:8px 16px;background:${P};color:white;border-radius:8px;text-decoration:none;font-weight:600">Today</a>
          <a href="/lesson-plans/weekly?week=${nextWeek.toISOString().split('T')[0]}" style="padding:8px 16px;background:#e5e7eb;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">Next &rarr;</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;min-height:400px">
        ${dayDates.map((dt, i) => {
          const key = dt.toISOString().split('T')[0];
          const isToday = dt.toDateString() === new Date().toDateString();
          const dayPlans = scheduleByDay[key] || [];
          return `<div style="background:${isToday?'#eff6ff':'white'};border-radius:10px;border:2px solid ${isToday?P:'#e5e7eb'};padding:12px;display:flex;flex-direction:column">
            <div style="text-align:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">
              <div style="font-size:0.8em;color:${GRAY};font-weight:600">${days[i]}</div>
              <div style="font-size:1.2em;font-weight:bold;color:${isToday?P:'#374151'}">${dt.getDate()}</div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px">
              ${dayPlans.map(s => {
                const tmpl = TEMPLATE_TYPES.find(t => t.key === s.template_type);
                return `<div style="background:#f9fafb;border-radius:6px;padding:8px;border-left:3px solid ${P};font-size:0.78em">
                  <div style="font-weight:600;color:${P};margin-bottom:2px">P${s.period}: ${esc(s.subject)}</div>
                  <div style="color:#374151">${esc(s.topic)}</div>
                  <div style="color:${GRAY};margin-top:2px">${s.duration}min ${tmpl?'('+esc(tmpl.name)+')':''}</div>
                  ${s.notes ? `<div style="color:${GRAY};font-style:italic;margin-top:2px">${esc(s.notes)}</div>` : ''}
                  <button onclick="unschedule(${s.id})" style="color:${D};background:none;border:none;cursor:pointer;font-size:0.85em;margin-top:4px;padding:0">Remove</button>
                </div>`;
              }).join('')}
            </div>
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb">
              <button onclick="openScheduleModal('${key}')" style="width:100%;padding:6px;background:${P};color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.8em">+ Add</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div id="scheduleModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center">
      <div style="background:white;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
        <h3 style="color:${P};margin:0 0 16px">Schedule Lesson Plan</h3>
        <form id="scheduleForm">
          <input type="hidden" id="schedDate" name="scheduled_date">
          <div style="margin-bottom:12px">
            <label style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Lesson Plan *</label>
            <select id="schedPlan" name="lesson_plan_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em" aria-required="true">
              <option value="">Select plan...</option>
              ${allPlans.map(p => `<option value="${p.id}">${esc(p.subject)}: ${esc(p.topic)} (${p.duration}min)</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Period</label>
            <input type="number" id="schedPeriod" name="period" value="1" min="1" max="10" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Notes</label>
            <textarea id="schedNotes" name="notes" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box" placeholder="Optional notes..."></textarea>
          </div>
          <div style="display:flex;gap:10px">
            <button type="submit" style="padding:10px 20px;background:${P};color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">Schedule</button>
            <button type="button" onclick="closeScheduleModal()" style="padding:10px 20px;background:#e5e7eb;color:#374151;border:none;border-radius:8px;cursor:pointer">Cancel</button>
          </div>
        </form>
      </div>
    </div>
    <script>
    function openScheduleModal(date){
      document.getElementById('schedDate').value=date;
      document.getElementById('scheduleModal').style.display='flex';
    }
    function closeScheduleModal(){document.getElementById('scheduleModal').style.display='none';}
    document.getElementById('scheduleForm').addEventListener('submit',async function(e){
      e.preventDefault();const fd=new FormData(this);const data=Object.fromEntries(fd);
      await fetch('/lesson-plans/weekly/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      closeScheduleModal();location.reload();
    });
    async function unschedule(id){await fetch('/lesson-plans/weekly/schedule/'+id,{method:'DELETE'});location.reload();}
    </script>`;
    res.send(renderPage('Weekly Planner', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/weekly/schedule
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/weekly/schedule', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { lesson_plan_id, scheduled_date, period, notes } = req.body;
    if (!lesson_plan_id || !scheduled_date) return res.json({ error: 'Plan and date required.' });
    await pool.query(
      `INSERT INTO lesson_plan_schedule (tenant_id, teacher_id, lesson_plan_id, scheduled_date, period, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, uid, parseInt(lesson_plan_id), scheduled_date, parseInt(period) || 1, notes || '']
    );
    audit(req, 'lesson_schedule', { lesson_plan_id, scheduled_date });
    res.json({ ok: true });
  }));

  app.delete('/lesson-plans/weekly/schedule/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM lesson_plan_schedule WHERE id = $1 AND tenant_id = $2 AND teacher_id = $3`,
      [req.params.id, req.session.user.tenant_id, req.session.user.id]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/standards — Standards Alignment
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/standards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { subject: subFilter } = req.query;
    const standards = (await pool.query(
      `SELECT ls.*, COUNT(lsm.lesson_plan_id)::int AS mapped_count FROM lesson_standards ls
       LEFT JOIN lesson_standards_map lsm ON lsm.standard_id = ls.id AND lsm.tenant_id = ls.tenant_id
       WHERE ls.tenant_id = $1 ${subFilter ? 'AND ls.subject = $2' : ''}
       GROUP BY ls.id ORDER BY ls.subject, ls.standard_code`,
      subFilter ? [tid, subFilter] : [tid]
    )).rows;
    const subjects = (await pool.query(`SELECT DISTINCT subject FROM lesson_standards WHERE tenant_id = $1 ORDER BY subject`, [tid])).rows.map(r => r.subject);
    const planSubjects = (await pool.query(
      `SELECT subject, COUNT(*)::int AS plan_count FROM lesson_plans_ai WHERE tenant_id = $1 GROUP BY subject ORDER BY subject`, [tid]
    )).rows;
    const totalStandards = standards.length;
    const mappedStandards = standards.filter(s => s.mapped_count > 0).length;
    const coveragePct = totalStandards > 0 ? Math.round((mappedStandards / totalStandards) * 100) : 0;

    const subjectCoverage = subjects.map(s => {
      const subStandards = standards.filter(st => st.subject === s);
      const subMapped = subStandards.filter(st => st.mapped_count > 0).length;
      return { subject: s, pct: subStandards.length > 0 ? Math.round((subMapped / subStandards.length) * 100) : 0 };
    });

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="color:${P};font-size:1.8em;margin:0 0 4px">Standards Alignment</h1>
          <p style="color:${GRAY};margin:0">Map curriculum standards to lesson plans and track coverage</p>
        </div>
        <button onclick="document.getElementById('addStdForm').style.display=document.getElementById('addStdForm').style.display==='none'?'block':'none'" style="padding:10px 20px;background:${P};color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">+ Add Standard</button>
      </div>

      <div id="addStdForm" style="display:none;background:white;padding:20px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-bottom:24px">
        <h3 style="margin:0 0 12px;color:#374151">Add Curriculum Standard</h3>
        <form id="stdForm" style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:12px;align-items:end">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;color:#374151;font-size:0.9em">Subject</label>
            <select id="stdSubject" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9em">
              ${Object.keys(SUBJECT_DATA).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;color:#374151;font-size:0.9em">Code</label>
            <input type="text" id="stdCode" placeholder="e.g. CCSS.MATH.8.EE.A.1" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9em">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;color:#374151;font-size:0.9em">Description</label>
            <input type="text" id="stdDesc" placeholder="Standard description..." style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:0.9em">
          </div>
          <div style="grid-column:span 3">
            <button type="submit" style="padding:8px 20px;background:${S};color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">Save Standard</button>
          </div>
        </form>
      </div>

      <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${P}">${totalStandards}</div>
          <div style="color:${GRAY};font-size:0.9em">Total Standards</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${S}">${mappedStandards}</div>
          <div style="color:${GRAY};font-size:0.9em">Mapped Standards</div>
        </div>
        <div style="background:white;border-radius:10px;padding:16px 24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex:1;min-width:140px">
          <div style="font-size:2em;font-weight:bold;color:${W}">${coveragePct}%</div>
          <div style="color:${GRAY};font-size:0.9em">Coverage</div>
        </div>
      </div>

      ${subjectCoverage.length > 0 ? `<div style="margin-bottom:24px">${coverageBarChart(subjectCoverage)}</div>` : ''}

      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <a href="/lesson-plans/standards" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:0.9em;${!subFilter?'background:'+P+';color:white':'background:#e5e7eb;color:#374151'}">All</a>
        ${subjects.map(s => `<a href="/lesson-plans/standards?subject=${encodeURIComponent(s)}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:0.9em;${subFilter===s?'background:'+P+';color:white':'background:#e5e7eb;color:#374151'}">${esc(s)}</a>`).join('')}
      </div>

      <div style="background:white;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <table style="width:100%;border-collapse:collapse" role="table">
          <thead>
            <tr style="background:#f3f4f6">
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Code</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Description</th>
              <th scope="col" style="padding:12px 16px;text-align:left;font-size:0.85em;color:${GRAY}">Subject</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${GRAY}">Mapped Plans</th>
              <th scope="col" style="padding:12px 16px;text-align:center;font-size:0.85em;color:${GRAY}">Status</th>
            </tr>
          </thead>
          <tbody>
            ${standards.length === 0 ? `<tr><td colspan="5" style="padding:40px;text-align:center;color:${GRAY}">No standards added yet. Add curriculum standards to begin tracking coverage.</td></tr>` :
              standards.map(s => `<tr style="border-top:1px solid #f3f4f6">
                <td style="padding:12px 16px;font-weight:600;color:${P}">${esc(s.standard_code)}</td>
                <td style="padding:12px 16px;font-size:0.9em;color:#374151">${esc(s.standard_desc)}</td>
                <td style="padding:12px 16px">${esc(s.subject)}</td>
                <td style="padding:12px 16px;text-align:center;font-weight:600">${s.mapped_count}</td>
                <td style="padding:12px 16px;text-align:center">${s.mapped_count > 0
                  ? '<span style="background:#d1fae5;color:#065f46;padding:2px 10px;border-radius:12px;font-size:0.8em">Covered</span>'
                  : '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:12px;font-size:0.8em">Uncovered</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <script>
    document.getElementById('stdForm').addEventListener('submit',async function(e){
      e.preventDefault();
      const data={subject:document.getElementById('stdSubject').value,standard_code:document.getElementById('stdCode').value,standard_desc:document.getElementById('stdDesc').value};
      if(!data.standard_code||!data.standard_desc){alert('Code and description required.');return;}
      await fetch('/lesson-plans/standards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      location.reload();
    });
    </script>`;
    res.send(renderPage('Standards Alignment', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/standards — Add Standard
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/standards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { subject, standard_code, standard_desc } = req.body;
    if (!standard_code || !standard_desc) return res.json({ error: 'Code and description required.' });
    await pool.query(
      `INSERT INTO lesson_standards (tenant_id, standard_code, standard_desc, subject) VALUES ($1, $2, $3, $4) ON CONFLICT (standard_code, tenant_id) DO NOTHING`,
      [tid, standard_code.trim(), standard_desc.trim(), subject || 'General']
    );
    audit(req, 'standard_create', { standard_code });
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/:id/standards — Map Standard
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/:id/standards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { standard_id } = req.body;
    if (!standard_id) return res.json({ error: 'Standard ID required.' });
    await pool.query(
      `INSERT INTO lesson_standards_map (tenant_id, lesson_plan_id, standard_id) VALUES ($1, $2, $3) ON CONFLICT (lesson_plan_id, standard_id) DO NOTHING`,
      [tid, req.params.id, parseInt(standard_id)]
    );
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/print/:id — Print View
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/print/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [lp] } = await pool.query(
      `SELECT lp.*, u.name AS teacher_name FROM lesson_plans_ai lp LEFT JOIN users u ON u.id = lp.teacher_id WHERE lp.id = $1 AND lp.tenant_id = $2`,
      [req.params.id, tid]
    );
    if (!lp) return res.status(404).send('Lesson plan not found.');
    const objectives = typeof lp.objectives === 'string' ? JSON.parse(lp.objectives) : (lp.objectives || []);
    const activities = typeof lp.main_activities === 'string' ? JSON.parse(lp.main_activities) : (lp.main_activities || []);
    const mappedStandards = (await pool.query(
      `SELECT ls.* FROM lesson_standards_map lsm JOIN lesson_standards ls ON ls.id = lsm.standard_id WHERE lsm.lesson_plan_id = $1 AND lsm.tenant_id = $2`,
      [lp.id, tid]
    )).rows;
    const tmpl = TEMPLATE_TYPES.find(t => t.key === lp.template_type);

    const body = `<!DOCTYPE html><html><head><title>Lesson Plan: ${esc(lp.topic)}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Georgia,serif;color:#1a1a1a;padding:40px;font-size:11pt;line-height:1.6}
        h1{font-size:20pt;color:#1a1a1a;margin-bottom:4px;border-bottom:3px solid #333;padding-bottom:8px}
        .meta{font-size:10pt;color:#555;margin-bottom:20px;display:flex;gap:16px;flex-wrap:wrap}
        .meta span{background:#f0f0f0;padding:2px 8px;border-radius:4px}
        h2{font-size:13pt;color:#333;margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
        ul{padding-left:20px;margin:6px 0}
        li{margin-bottom:4px}
        .activity{border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:10px;page-break-inside:avoid}
        .activity-header{display:flex;justify-content:space-between;font-weight:bold;margin-bottom:4px}
        .activity-time{background:#e8e8e8;padding:1px 8px;border-radius:10px;font-size:9pt}
        .intro-box{background:#f5f5f5;padding:12px;border-left:4px solid #333;border-radius:0 6px 6px 0}
        .footer{margin-top:30px;padding-top:12px;border-top:1px solid #ddd;font-size:8pt;color:#999;text-align:center}
        @media print{body{padding:20px} .no-print{display:none}}
      </style></head><body>
      <h1>${esc(lp.topic)}</h1>
      <div class="meta">
        <span>${esc(lp.subject)}</span><span>${esc(lp.class_name)}</span>
        <span>${lp.duration} minutes</span><span>${esc(lp.difficulty)}</span>
        <span>${tmpl?esc(tmpl.name):esc(lp.template_type)}</span>
        <span>By ${esc(lp.teacher_name||'')}</span>
        <span>${new Date(lp.created_at).toLocaleDateString()}</span>
      </div>
      <h2>Learning Objectives</h2>
      <ul>${objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      <h2>Materials Needed</h2>
      <p>${esc(lp.materials)}</p>
      <h2>Introduction</h2>
      <div class="intro-box">${esc(lp.introduction)}</div>
      <h2>Main Activities</h2>
      ${activities.map((a, i) => `<div class="activity">
        <div class="activity-header"><span>${i+1}. ${esc(a.name||'Activity')}</span><span class="activity-time">${a.time||''} min</span></div>
        <p>${esc(a.desc||'')}</p>
      </div>`).join('')}
      <h2>Assessment</h2><p>${esc(lp.assessment)}</p>
      <h2>Homework</h2><p>${esc(lp.homework)}</p>
      <h2>Extension Activities</h2><p>${esc(lp.extension)}</p>
      <h2>Differentiation</h2><p>${esc(lp.differentiation)}</p>
      ${mappedStandards.length > 0 ? `<h2>Aligned Standards</h2><p>${mappedStandards.map(s => esc(s.standard_code + ': ' + s.standard_desc)).join('; ')}</p>` : ''}
      <div class="footer">Generated by AI Lesson Plan Module &middot; ${new Date().toLocaleDateString()}</div>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`;
    res.send(body);
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/:id/export — Export HTML
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/:id/export', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [lp] } = await pool.query(
      `SELECT * FROM lesson_plans_ai WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tid]
    );
    if (!lp) return res.status(404).send('Lesson plan not found.');
    const objectives = typeof lp.objectives === 'string' ? JSON.parse(lp.objectives) : (lp.objectives || []);
    const activities = typeof lp.main_activities === 'string' ? JSON.parse(lp.main_activities) : (lp.main_activities || []);

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Lesson Plan - ${esc(lp.topic)}</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1a1a1a;background:#fff;line-height:1.7}
        .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:32px;border-radius:12px;margin-bottom:24px}
        .header h1{margin:0 0 8px;font-size:1.5em}
        .header .meta{display:flex;gap:12px;flex-wrap:wrap;font-size:0.85em;opacity:0.9}
        .section{margin-bottom:20px}
        .section h2{color:#4f46e5;font-size:1.1em;border-bottom:2px solid #e0e7ff;padding-bottom:6px;margin-bottom:8px}
        .activity{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px}
        .activity h3{margin:0 0 4px;color:#1f2937;font-size:0.95em}
        .intro-box{background:#eff6ff;border-left:4px solid #4f46e5;padding:12px;border-radius:0 8px 8px 0}
        ul{padding-left:20px}
        .footer{text-align:center;color:#999;font-size:0.8em;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb}
      </style></head><body>
      <div class="header">
        <h1>${esc(lp.topic)}</h1>
        <div class="meta">
          <span>${esc(lp.subject)}</span><span>${esc(lp.class_name)}</span>
          <span>${lp.duration} min</span><span>${esc(lp.difficulty)}</span>
          <span>${esc(lp.template_type)}</span>
          <span>Created: ${new Date(lp.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="section"><h2>Learning Objectives</h2><ul>${objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>
      <div class="section"><h2>Materials</h2><p>${esc(lp.materials)}</p></div>
      <div class="section"><h2>Introduction</h2><div class="intro-box">${esc(lp.introduction)}</div></div>
      <div class="section"><h2>Main Activities</h2>
        ${activities.map((a,i) => `<div class="activity"><h3>${i+1}. ${esc(a.name||'Activity')}</h3><p style="margin:4px 0 0;font-size:0.9em">${esc(a.desc||'')}</p></div>`).join('')}
      </div>
      <div class="section"><h2>Assessment</h2><p>${esc(lp.assessment)}</p></div>
      <div class="section"><h2>Homework</h2><p>${esc(lp.homework)}</p></div>
      <div class="section"><h2>Extensions</h2><p>${esc(lp.extension)}</p></div>
      <div class="section"><h2>Differentiation</h2><p>${esc(lp.differentiation)}</p></div>
      <div class="footer">AI Lesson Plan &middot; Exported ${new Date().toLocaleDateString()}</div>
    </body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', 'attachment; filename="lesson-plan-' + lp.id + '.html"');
    res.send(html);
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/shared/:token — Shared Link View
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/shared/:token', ah(async (req, res) => {
    const { rows: [lp] } = await pool.query(
      `SELECT lp.*, u.name AS teacher_name FROM lesson_plans_ai lp LEFT JOIN users u ON u.id = lp.teacher_id WHERE lp.share_token = $1 AND lp.shared = true`,
      [req.params.token]
    );
    if (!lp) return res.status(404).send('Shared lesson plan not found or link has expired.');
    const objectives = typeof lp.objectives === 'string' ? JSON.parse(lp.objectives) : (lp.objectives || []);
    const activities = typeof lp.main_activities === 'string' ? JSON.parse(lp.main_activities) : (lp.main_activities || []);
    const tmpl = TEMPLATE_TYPES.find(t => t.key === lp.template_type);
    const body = `${SKIP}<div role="main" id="main-content" style="max-width:900px;margin:0 auto;padding:20px">
      <div style="text-align:center;margin-bottom:24px">
        <p style="color:${GRAY};font-size:0.9em">Shared Lesson Plan</p>
      </div>
      <div style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;margin-bottom:24px">
        <div style="background:linear-gradient(135deg,${P},#7c3aed);padding:24px;color:white">
          <h1 style="margin:0 0 8px;font-size:1.6em">${esc(lp.topic)}</h1>
          <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.9em;opacity:0.9">
            <span>${esc(lp.subject)}</span><span>|</span><span>${esc(lp.class_name)}</span>
            <span>|</span><span>${lp.duration} min</span><span>|</span><span>${esc(lp.difficulty)}</span>
            <span>|</span><span>${tmpl?tmpl.icon+' '+esc(tmpl.name):esc(lp.template_type)}</span>
          </div>
          <div style="font-size:0.8em;opacity:0.7;margin-top:8px">By ${esc(lp.teacher_name||'Teacher')}</div>
        </div>
        <div style="padding:24px">
          <h2 style="color:${P};margin:0 0 8px">Learning Objectives</h2>
          <ul style="margin:0 0 16px;padding-left:20px">${objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
          <h2 style="color:${P};margin:0 0 8px">Materials</h2><p style="margin:0 0 16px">${esc(lp.materials)}</p>
          <h2 style="color:${P};margin:0 0 8px">Introduction</h2><div style="background:#eff6ff;border-left:4px solid ${P};padding:12px;border-radius:0 8px 8px 0;margin-bottom:16px">${esc(lp.introduction)}</div>
          <h2 style="color:${P};margin:0 0 8px">Activities</h2>
          ${activities.map((a,i) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px"><strong>${i+1}. ${esc(a.name||'Activity')}</strong> (${a.time||''} min)<br><span style="font-size:0.9em;color:#4b5563">${esc(a.desc||'')}</span></div>`).join('')}
          <h2 style="color:${P};margin:16px 0 8px">Assessment</h2><p style="margin:0 0 16px">${esc(lp.assessment)}</p>
          <h2 style="color:${P};margin:0 0 8px">Homework</h2><p style="margin:0 0 16px">${esc(lp.homework)}</p>
          <h2 style="color:${P};margin:0 0 8px">Extensions</h2><p style="margin:0 0 16px">${esc(lp.extension)}</p>
          <h2 style="color:${P};margin:0 0 8px">Differentiation</h2><p>${esc(lp.differentiation)}</p>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Shared: ' + lp.topic, body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: GET /lesson-plans/:id/reflection — Reflection Form
  // ══════════════════════════════════════════════
  app.get('/lesson-plans/:id/reflection', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [lp] } = await pool.query(
      `SELECT * FROM lesson_plans_ai WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tid]
    );
    if (!lp) return res.status(404).send('Lesson plan not found.');
    const existing = (await pool.query(
      `SELECT * FROM lesson_reflections WHERE lesson_plan_id = $1 AND tenant_id = $2 AND teacher_id = $3 ORDER BY created_at DESC LIMIT 1`,
      [lp.id, tid, req.session.user.id]
    )).rows[0];

    const body = `${SKIP}<div role="main" id="main-content" style="max-width:700px;margin:0 auto;padding:20px">
      <a href="/lesson-plans/${lp.id}" style="color:${P};text-decoration:none;font-size:0.9em">&larr; Back to Plan</a>
      <h1 style="color:${P};margin:12px 0 4px">Lesson Reflection</h1>
      <p style="color:${GRAY};margin-bottom:24px">Reflect on how the lesson went: ${esc(lp.topic)}</p>
      <form method="post" action="/lesson-plans/${lp.id}/reflection" style="background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
        <div style="margin-bottom:16px">
          <label for="what_worked" style="display:block;font-weight:600;margin-bottom:4px;color:${S}">What went well? *</label>
          <textarea id="what_worked" name="what_worked" required rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box" aria-required="true" placeholder="Describe the activities, strategies, or moments that were most effective...">${esc(existing?.what_worked||'')}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="what_didnt" style="display:block;font-weight:600;margin-bottom:4px;color:${D}">What didn't work well? *</label>
          <textarea id="what_didnt" name="what_didnt" required rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box" aria-required="true" placeholder="Describe challenges, student confusion, or activities that fell flat...">${esc(existing?.what_didnt||'')}</textarea>
        </div>
        <div style="margin-bottom:16px">
          <label for="improvements" style="display:block;font-weight:600;margin-bottom:4px;color:${W}">Improvements for next time</label>
          <textarea id="improvements" name="improvements" rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em;box-sizing:border-box" placeholder="What changes would you make before teaching this again?">${esc(existing?.improvements||'')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label for="student_engagement" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Student Engagement</label>
            <select id="student_engagement" name="student_engagement" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              ${[1,2,3,4,5].map(v => `<option value="${v}" ${existing?.student_engagement===v?'selected':''}>${'★'.repeat(v)}${'☆'.repeat(5-v)} (${v}/5)</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="goal_achievement" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Goal Achievement</label>
            <select id="goal_achievement" name="goal_achievement" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              ${[1,2,3,4,5].map(v => `<option value="${v}" ${existing?.goal_achievement===v?'selected':''}>${'★'.repeat(v)}${'☆'.repeat(5-v)} (${v}/5)</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="overall_rating" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Overall Rating</label>
            <select id="overall_rating" name="overall_rating" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
              ${[1,2,3,4,5].map(v => `<option value="${v}" ${existing?.overall_rating===v?'selected':''}>${'★'.repeat(v)}${'☆'.repeat(5-v)} (${v}/5)</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-bottom:16px">
          <label for="reflection_date" style="display:block;font-weight:600;margin-bottom:4px;color:#374151">Lesson Date</label>
          <input type="date" id="reflection_date" name="reflection_date" value="${existing?.reflection_date || new Date().toISOString().split('T')[0]}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1em">
        </div>
        <button type="submit" style="padding:12px 32px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:1em;font-weight:600;cursor:pointer">Save Reflection</button>
      </form>
    </div>`;
    res.send(renderPage('Lesson Reflection', body, req.session.user));
  }));

  // ══════════════════════════════════════════════
  //  ROUTE: POST /lesson-plans/:id/reflection — Save Reflection
  // ══════════════════════════════════════════════
  app.post('/lesson-plans/:id/reflection', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { what_worked, what_didnt, improvements, student_engagement, goal_achievement, overall_rating, reflection_date } = req.body;
    if (!what_worked || !what_didnt) return res.status(400).send('What worked and what did not are required.');
    const existing = (await pool.query(
      `SELECT id FROM lesson_reflections WHERE lesson_plan_id = $1 AND tenant_id = $2 AND teacher_id = $3 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, tid, uid]
    )).rows[0];

    if (existing) {
      await pool.query(
        `UPDATE lesson_reflections SET what_worked=$1, what_didnt=$2, improvements=$3, student_engagement=$4, goal_achievement=$5, overall_rating=$6, reflection_date=$7 WHERE id=$8`,
        [what_worked, what_didnt, improvements || '', parseInt(student_engagement) || 3, parseInt(goal_achievement) || 3, parseInt(overall_rating) || 3, reflection_date || new Date().toISOString().split('T')[0], existing.id]
      );
    } else {
      await pool.query(
        `INSERT INTO lesson_reflections (tenant_id, lesson_plan_id, teacher_id, what_worked, what_didnt, improvements, student_engagement, goal_achievement, overall_rating, reflection_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tid, req.params.id, uid, what_worked, what_didnt, improvements || '', parseInt(student_engagement) || 3, parseInt(goal_achievement) || 3, parseInt(overall_rating) || 3, reflection_date || new Date().toISOString().split('T')[0]]
      );
    }
    audit(req, 'lesson_reflection', { lesson_plan_id: req.params.id });
    res.redirect('/lesson-plans/' + req.params.id);
  }));
};
