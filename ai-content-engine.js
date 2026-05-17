// ============================================================
// === AI CONTENT ENGINE — Template-Based Content Generation ===
// ============================================================
// Blog generator, social media posts, bulk report comments,
// recommendations engine, auto-tagging, content summarizer,
// smart search, trending topics, admin dashboard, insights & alerts.
// Self-executing module — uses globals: app, pool, ah, esc,
// renderPage, requireAuth, migrations, VALID_TABLES, notify.

'use strict';

// ─── MIGRATIONS ──────────────────────────────────────────────
const AI_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS ai_generated_content (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, content_type TEXT,
    title TEXT, content TEXT, summary TEXT, tags TEXT[],
    status TEXT DEFAULT 'draft', published_at TIMESTAMPTZ,
    created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
    generation_metadata JSONB DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS social_posts (
    id SERIAL PRIMARY KEY, tenant_id INTEGER, platform TEXT,
    content TEXT, hashtags TEXT[], scheduled_at TIMESTAMPTZ,
    status TEXT DEFAULT 'draft', created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS recommendations (
    id SERIAL PRIMARY KEY, user_email TEXT, tenant_id INTEGER,
    item_type TEXT, item_id INTEGER, score NUMERIC,
    reason TEXT, shown_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS search_suggestions (
    id SERIAL PRIMARY KEY, query TEXT, count INTEGER DEFAULT 1,
    tenant_id INTEGER, last_searched TIMESTAMPTZ DEFAULT NOW()
  )`,
];
AI_MIGRATIONS.forEach(m => migrations.push(m));
['ai_generated_content', 'social_posts', 'recommendations', 'search_suggestions'].forEach(t => VALID_TABLES.add(t));

// ─── INTERNAL HELPERS ────────────────────────────────────────
const _fmt = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Keyword dictionaries for auto-tagging
const CATEGORY_KEYWORDS = {
  Education: ['school','student','teacher','learn','curriculum','exam','grade','classroom','lesson','university','academic','course','study','teaching'],
  Business: ['revenue','profit','startup','marketing','company','growth','strategy','enterprise','sales','management','corporate','brand'],
  Health: ['wellness','fitness','medical','doctor','patient','nutrition','exercise','mental','health','hospital','disease','treatment','therapy'],
  Technology: ['software','ai','app','data','cloud','digital','code','programming','algorithm','machine learning','automation','iot','cybersecurity'],
  Finance: ['investment','budget','tax','savings','loan','banking','financial','income','expense','portfolio','stock','crypto','mortgage'],
  Church: ['worship','prayer','ministry','gospel','faith','bible','church','sermon','fellowship','pastor','community','devotion'],
  Sports: ['football','soccer','basketball','athletics','tournament','championship','team','league','coach','player','match','fitness'],
  Entertainment: ['music','movie','film','celebrity','concert','entertainment','show','streaming','gaming','artist','album','theater'],
};

const TONE_TEMPLATES = {
  professional: { intro: 'In today\'s landscape,', connector: 'Furthermore,', closer: 'It is evident that' },
  casual: { intro: 'Let\'s talk about', connector: 'Plus,', closer: 'At the end of the day' },
  academic: { intro: 'This article examines', connector: 'Moreover,', closer: 'The findings suggest' },
};

const BLOG_SECTIONS = {
  Education: [
    { h2: 'Understanding the Fundamentals', body: 'Education forms the cornerstone of personal and societal development. Whether in formal classrooms or through self-directed learning, the pursuit of knowledge empowers individuals to reach their full potential and contribute meaningfully to their communities.' },
    { h2: 'Key Strategies for Success', body: 'Effective educational strategies include setting clear learning objectives, maintaining consistent study habits, and leveraging technology to enhance understanding. Collaborative learning environments foster critical thinking and problem-solving skills essential for the modern world.' },
    { h2: 'Looking Ahead', body: 'The future of education lies in adaptive, student-centered approaches that embrace innovation while maintaining high academic standards. Institutions that prioritize both technology integration and human connection will lead the way forward.' },
  ],
  Business: [
    { h2: 'Market Landscape and Trends', body: 'The business environment continues to evolve rapidly, driven by technological innovation and changing consumer expectations. Organizations that stay agile and responsive to market shifts position themselves for sustainable long-term growth.' },
    { h2: 'Strategic Approaches for Growth', body: 'Successful businesses employ data-driven decision making, invest in customer relationships, and continuously optimize their operations. Building a strong brand identity while maintaining operational excellence creates a competitive advantage that is difficult to replicate.' },
    { h2: 'Building for the Future', body: 'Forward-thinking companies invest in talent development, digital transformation, and sustainable practices. The most resilient organizations balance short-term performance with long-term strategic vision.' },
  ],
  Technology: [
    { h2: 'The Current Technological Landscape', body: 'Technology continues to reshape every aspect of our lives, from how we communicate and work to how we learn and entertain ourselves. Staying informed about emerging trends is essential for individuals and organizations alike.' },
    { h2: 'Practical Applications and Benefits', body: 'From artificial intelligence and cloud computing to blockchain and the Internet of Things, modern technologies offer transformative potential. Understanding these tools and their practical applications enables smarter decisions and more efficient workflows.' },
    { h2: 'What Lies Ahead', body: 'The pace of technological change shows no signs of slowing. Organizations that embrace experimentation, continuous learning, and ethical innovation will be best positioned to thrive in an increasingly digital world.' },
  ],
  Health: [
    { h2: 'Understanding Health and Wellness', body: 'Health and wellness encompass physical, mental, and emotional well-being. A holistic approach to health considers nutrition, exercise, stress management, and preventive care as interconnected pillars of a fulfilling life.' },
    { h2: 'Evidence-Based Strategies', body: 'Research consistently shows that regular physical activity, balanced nutrition, adequate sleep, and social connection are the foundation of good health. Small, consistent changes in daily habits can produce significant long-term benefits.' },
    { h2: 'Building Healthy Habits', body: 'The key to lasting health improvements is building sustainable habits rather than pursuing quick fixes. Setting realistic goals, tracking progress, and seeking professional guidance when needed are all strategies that support long-term wellness.' },
  ],
  Finance: [
    { h2: 'Financial Fundamentals', body: 'Sound financial management begins with understanding core principles: budgeting, saving, investing, and managing debt. Regardless of income level, these fundamentals form the basis of financial stability and growth.' },
    { h2: 'Strategies for Financial Growth', body: 'Building wealth requires a combination of disciplined saving, smart investing, and informed decision-making. Diversification, regular portfolio review, and staying educated about market trends are essential practices for long-term financial success.' },
    { h2: 'Planning for the Future', body: 'Whether planning for retirement, education, or major purchases, having a clear financial plan is essential. Setting specific goals, creating emergency funds, and seeking professional financial advice can help secure a stable financial future.' },
  ],
  Church: [
    { h2: 'Faith and Community', body: 'The church serves as a cornerstone of spiritual growth and community connection. Through worship, fellowship, and service, faith communities provide support, guidance, and a sense of belonging that enriches the lives of their members.' },
    { h2: 'Ministry in Action', body: 'Effective ministry combines spiritual leadership with practical service. From youth programs and outreach initiatives to counseling and community development, churches play a vital role in addressing both spiritual and practical needs.' },
    { h2: 'Strengthening the Faith Community', body: 'Building a vibrant church community requires intentional effort in areas of discipleship, volunteer engagement, and inclusive outreach. Technology and modern communication tools offer new opportunities for connection and ministry expansion.' },
  ],
  General: [
    { h2: 'Key Insights and Perspectives', body: 'Understanding this topic requires examining it from multiple angles. By considering different viewpoints and gathering relevant information, we can form a well-rounded perspective that informs better decisions and actions.' },
    { h2: 'Practical Steps Forward', body: 'Taking actionable steps is essential for making meaningful progress. Breaking down complex challenges into manageable tasks, setting realistic goals, and maintaining consistent effort are proven approaches to achieving desired outcomes.' },
    { h2: 'Summary and Recommendations', body: 'The key takeaway is that informed action, combined with adaptability and persistence, leads to the best results. Whether you are just starting out or looking to deepen your understanding, continuous improvement should always be the goal.' },
  ],
};

// ─── BLOG GENERATOR ──────────────────────────────────────────
function generateBlogPost(topic, keywords, tone, length, category) {
  const t = TONE_TEMPLATES[tone] || TONE_TEMPLATES.professional;
  const sections = BLOG_SECTIONS[category] || BLOG_SECTIONS.General;
  const sectionCount = length === 'short' ? 1 : length === 'long' ? 3 : 2;
  const selectedSections = sections.slice(0, sectionCount);
  const kw = keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [];
  const title = `${topic}: A Comprehensive ${category || 'General'} Guide`;
  const metaDesc = `Explore ${topic.toLowerCase()} with our in-depth guide covering key insights, practical strategies, and expert recommendations for ${category ? category.toLowerCase() : 'success'}.`;
  let intro = `${t.intro} ${topic} has become increasingly important in the realm of ${category || 'modern society'}.`;
  if (kw.length) intro += ` Key areas of focus include ${kw.slice(0, 3).join(', ')}.`;
  intro += ' This article explores the essential aspects and provides actionable insights for readers at all levels.';
  let bodyContent = intro;
  for (const sec of selectedSections) {
    bodyContent += `\n\n## ${sec.h2}\n\n${sec.body}`;
    if (kw.length > 0) bodyContent += ` Specifically, topics such as ${kw.join(', ')} play a significant role in shaping outcomes.`;
  }
  const conclusion = `\n\n## Conclusion\n\n${t.closer}, ${topic.toLowerCase()} represents a vital area of focus for anyone interested in ${category ? category.toLowerCase() + ' and beyond' : 'personal and professional development'}. By applying the insights shared in this article, readers can take confident steps toward achieving their goals.`;
  bodyContent += conclusion;
  const tags = [category || 'General', topic.split(' ').slice(0, 2).join('-').toLowerCase(), ...kw.slice(0, 3)];
  const summary = `${topic} — This article examines the key aspects of ${category || 'general'} interest, covering ${selectedSections.map(s => s.h2.toLowerCase()).join(', ')}. Designed for readers seeking practical, actionable insights.`;
  return { title, content: bodyContent, summary, tags: [...new Set(tags)] };
}

// ─── SOCIAL MEDIA GENERATOR ──────────────────────────────────
function generateSocialPosts(topic, platform) {
  const posts = {
    twitter: {
      platform: 'Twitter/X', content: `🚀 ${topic}\n\nKey insights you need to know:\n\n1. Stay informed\n2. Take action\n3. Share with others\n\n#Trending #Insights #MustRead`, hashtags: ['#Trending', '#Insights', '#MustRead', '#' + topic.replace(/\s+/g, '')],
    },
    facebook: {
      platform: 'Facebook', content: `📢 ${topic}\n\nWe've put together essential insights on this important topic. Whether you're just getting started or looking to deepen your understanding, this is a must-read.\n\nHere are the key takeaways:\n✅ Understanding the fundamentals\n✅ Practical strategies you can apply today\n✅ Expert recommendations for success\n\nWhat are your thoughts? Drop a comment below! 👇\n\n${'.'.repeat(20)}\n#Community #Knowledge #Growth`, hashtags: ['#Community', '#Knowledge', '#Growth'],
    },
    linkedin: {
      platform: 'LinkedIn', content: `${topic}\n\nIn my experience working in this space, I've observed several key trends:\n\n🔹 The landscape is evolving rapidly\n🔹 Adaptability is no longer optional — it's essential\n🔹 Those who invest in continuous learning lead the way\n\nHere's what professionals should focus on:\n\n1. Stay current with emerging developments\n2. Build strong professional networks\n3. Apply practical knowledge consistently\n4. Share insights with your community\n\nI'd love to hear your perspective. What has been your experience?\n\n#${topic.replace(/\s+/g, '')} #ProfessionalDevelopment #Leadership #Innovation`, hashtags: ['#ProfessionalDevelopment', '#Leadership', '#Innovation'],
    },
    instagram: {
      platform: 'Instagram', content: `✨ ${topic} ✨\n\nSwipe through for the key insights 👉\n\n📌 Save this post for later\n📌 Share with someone who needs this\n📌 Double tap if you agree!\n\nFollow for more valuable content 💡`, hashtags: ['#Inspiration', '#Motivation', '#Knowledge', '#GrowthMindset', '#DailyInsight', '#SuccessTips'],
    },
    whatsapp: {
      platform: 'WhatsApp', content: `*${topic}*\n\nKey points to note:\n\n▸ Understanding the basics is crucial\n▸ Consistent effort yields results\n▸ Stay updated and adaptable\n\nShare this with your network! 📲`, hashtags: [],
    },
  };
  return posts[platform] || posts.twitter;
}

// ─── REPORT CARD COMMENT GENERATOR ───────────────────────────
function generateReportComment(student, subject, tone) {
  const pct = student.score != null ? student.score : (student.grade ? gradeToPct(student.grade) : 70);
  const name = student.name || 'the student';
  let comment = '';
  if (pct >= 90) {
    comment = `${name} has demonstrated outstanding performance in ${subject}. Their dedication to excellence is evident in consistently high-quality work and active class participation. They show exceptional understanding of concepts and often go above and beyond expectations. Keep up the excellent work!`;
  } else if (pct >= 75) {
    comment = `${name} shows strong performance in ${subject} with a commendable grasp of the material. They participate actively and consistently submit well-prepared assignments. With continued focus and effort, ${name} has the potential to achieve even greater results.`;
  } else if (pct >= 60) {
    comment = `${name} demonstrates satisfactory progress in ${subject}. They show understanding of the core concepts and complete required tasks adequately. I encourage ${name} to engage more actively in class discussions and seek additional practice to strengthen weaker areas.`;
  } else if (pct >= 45) {
    comment = `${name} is making progress in ${subject} though there is room for improvement. I recommend additional study time, completing all homework assignments, and seeking help when needed. With consistent effort and support, ${name} can achieve better results.`;
  } else {
    comment = `${name} faces challenges in ${subject} and requires additional support. I strongly recommend extra tutoring sessions, consistent homework completion, and regular communication between home and school. With the right support structure, improvement is achievable.`;
  }
  if (tone === 'encouraging') comment += ' We believe in your potential and are here to support your journey!';
  if (tone === 'academic') comment = comment.replace(/!/g, '.');
  return comment;
}

function gradeToPct(grade) {
  if (typeof grade === 'number') return grade;
  const g = String(grade).charAt(0).toUpperCase();
  const map = { A: 90, B: 78, C: 65, D: 50, E: 40, F: 25 };
  return map[g] || 60;
}

// ─── CONTENT SUMMARIZER ──────────────────────────────────────
function summarizeText(text, length) {
  if (!text || text.trim().length === 0) return 'No content to summarize.';
  const sentences = text.replace(/\n+/g, '. ').split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  if (sentences.length === 0) return text.substring(0, 200);
  if (length === 'brief') return sentences[0] + '.';
  if (length === 'detailed') {
    const intro = sentences[0];
    const bullets = sentences.slice(1, 8).map(s => `• ${s}.`).join('\n');
    const conclusion = sentences.length > 2 ? sentences[sentences.length - 1] + '.' : '';
    return `${intro}.\n\nKey Points:\n${bullets}\n\n${conclusion}`.trim();
  }
  // medium (3-5 bullets)
  const step = Math.max(1, Math.floor(sentences.length / 5));
  const picked = [];
  for (let i = 0; i < sentences.length && picked.length < 5; i += step) picked.push(sentences[i]);
  return picked.map(s => `• ${s}.`).join('\n');
}

// ─── AUTO-TAGGING ───────────────────────────────────────────
function autoTag(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[cat] = 0;
    for (const kw of kws) {
      const regex = new RegExp('\\b' + kw.replace(/\s+/g, '\\s+') + '\\b', 'gi');
      const matches = lower.match(regex);
      if (matches) scores[cat] += matches.length;
    }
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, e) => s + e[1], 0) || 1;
  const primary = sorted[0][1] > 0 ? sorted[0][0] : 'General';
  const secondary = sorted.filter(e => e[1] > 0 && e[0] !== primary).slice(0, 2).map(e => e[0]);
  const results = sorted.filter(e => e[1] > 0).map(e => ({ category: e[0], confidence: Math.round((e[1] / total) * 100), count: e[1] }));
  const suggestedTags = [];
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (scores[cat] > 0) {
      for (const kw of kws) {
        if (lower.includes(kw.toLowerCase()) && !suggestedTags.includes(kw) && suggestedTags.length < 8) suggestedTags.push(kw);
      }
    }
  }
  return { primary, secondary, results, tags: suggestedTags };
}

// ─── SHARED CSS ──────────────────────────────────────────────
const AI_CSS = `<style>
  .ai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
  .ai-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.2s}
  .ai-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08);transform:translateY(-2px)}
  .ai-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center}
  .ai-stat .num{font-size:28px;font-weight:700;color:#6366f1}
  .ai-stat .lbl{font-size:12px;color:#94a3b8;margin-top:2px}
  .ai-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .ai-form input,.ai-form select,.ai-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
  .ai-form input:focus,.ai-form select:focus,.ai-form textarea:focus{outline:none;border-color:#6366f1}
  .ai-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
  .ai-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
  .ai-nav a:hover{background:#e2e8f0}.ai-nav a.active{background:#6366f1;color:#fff}
  .ai-tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#ede9fe;color:#6366f1;margin:2px}
  .ai-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .ai-content-body{font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap}
  @media(max-width:768px){.ai-grid{grid-template-columns:1fr}}
</style>`;

function aiNav(active) {
  return `<div class="ai-nav">
    <a href="/admin/ai" class="${active === 'dashboard' ? 'active' : ''}">🤖 AI Dashboard</a>
    <a href="/admin/ai-content" class="${active === 'content' ? 'active' : ''}">📝 AI Content</a>
    <a href="/admin/ai-reports" class="${active === 'reports' ? 'active' : ''}">📊 Report Comments</a>
    <a href="/discover/for-you" class="${active === 'foryou' ? 'active' : ''}">🎯 For You</a>
  </div>`;
}

// =============================================================
// === ROUTE: POST /api/ai/generate-blog ===
// =============================================================
app.post('/api/ai/generate-blog', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { topic, keywords, tone, length, category } = req.body;
  if (!topic || !topic.trim()) return res.status(400).json({ error: 'Topic is required' });
  const post = generateBlogPost(topic.trim(), keywords || '', tone || 'professional', length || 'medium', category || 'General');
  const meta = { topic: topic.trim(), tone, length, category, generated_at: new Date().toISOString() };
  const result = await pool.query(
    `INSERT INTO ai_generated_content (tenant_id,content_type,title,content,summary,tags,status,created_by,generation_metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING id`,
    [user.tenant_id, 'blog', post.title, post.content, post.summary, post.tags, user.email || user.name, JSON.stringify(meta)]
  );
  res.json({ id: result.rows[0].id, ...post, status: 'draft' });
}));

// =============================================================
// === ROUTE: GET /admin/ai-content — AI Content Management ===
// =============================================================
app.get('/admin/ai-content', requireAuth, ah(async (req, res) => {
  const user = req.session.user, tid = user.tenant_id;
  const contents = (await pool.query(
    `SELECT * FROM ai_generated_content WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]
  )).rows;
  const rows = contents.map(c => {
    const statusColor = c.status === 'published' ? '#dcfce7;color:#16a34a' : '#fef9c3;color:#a16207';
    const tagsHtml = (c.tags || []).map(t => `<span class="ai-tag">${esc(t)}</span>`).join('');
    return `<div class="ai-card">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <span class="ai-badge" style="background:${statusColor}">${c.status}</span>
        <span style="font-size:11px;color:#94a3b8">${_fmt(c.created_at)}</span>
      </div>
      <h4 style="margin:0 0 6px;font-size:15px;color:#1e293b">${esc(c.title || 'Untitled')}</h4>
      <p style="font-size:12px;color:#64748b;margin:0 0 8px;line-height:1.5">${esc((c.summary || '').substring(0, 120))}</p>
      <div style="margin-bottom:10px">${tagsHtml}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${c.status === 'draft' ? `<button class="btn btn-sm btn-green" onclick="publishContent(${c.id})">Publish</button>` : ''}
        <button class="btn btn-sm btn-blue" onclick="editContent(${c.id})">Edit</button>
        <button class="btn btn-sm" style="background:#fee2e2;color:#dc2626" onclick="deleteContent(${c.id})">Delete</button>
      </div>
    </div>`;
  }).join('') || '<p style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px">No AI-generated content yet. Create your first post!</p>';

  const html = AI_CSS + `<div style="max-width:1200px;margin:0 auto">
    ${aiNav('content')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <div><h1 style="font-size:24px;color:#1e293b">📝 AI Content Studio</h1><p style="font-size:13px;color:#94a3b8">Generate, manage, and publish AI-created content</p></div>
    </div>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <h3 style="margin:0 0 12px;font-size:16px">✨ Generate New Blog Post</h3>
      <form id="genForm" class="ai-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="grid-column:1/-1"><label>Topic *</label><input id="genTopic" placeholder="e.g. Digital Transformation in Education" required></div>
        <div><label>Keywords</label><input id="genKeywords" placeholder="comma-separated"></div>
        <div><label>Tone</label><select id="genTone"><option value="professional">Professional</option><option value="casual">Casual</option><option value="academic">Academic</option></select></div>
        <div><label>Length</label><select id="genLength"><option value="short">Short</option><option value="medium" selected>Medium</option><option value="long">Long</option></select></div>
        <div><label>Category</label><select id="genCategory"><option value="Education">Education</option><option value="Business">Business</option><option value="Technology">Technology</option><option value="Health">Health</option><option value="Finance">Finance</option><option value="Church">Church</option><option value="General">General</option></select></div>
        <div style="grid-column:1/-1"><button type="submit" class="btn btn-green" style="padding:12px 28px">🚀 Generate Blog Post</button></div>
      </form>
      <div id="genPreview" style="display:none;margin-top:16px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px"></div>
    </div>
    <h3 style="font-size:16px;color:#1e293b;margin-bottom:12px">📄 Generated Content (${contents.length})</h3>
    <div class="ai-grid">${rows}</div>
  </div>
  <script>
    document.getElementById('genForm').addEventListener('submit', async function(e){
      e.preventDefault(); const btn=this.querySelector('button'); btn.disabled=true; btn.textContent='Generating...';
      try {
        const r=await fetch('/api/ai/generate-blog',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({topic:document.getElementById('genTopic').value,keywords:document.getElementById('genKeywords').value,
          tone:document.getElementById('genTone').value,length:document.getElementById('genLength').value,category:document.getElementById('genCategory').value})});
        const d=await r.json(); if(d.error){alert(d.error);return;}
        document.getElementById('genPreview').style.display='block';
        document.getElementById('genPreview').innerHTML='<h4 style="margin:0 0 8px;color:#16a34a">✅ Post Generated!</h4><strong>'+d.title+'</strong><p style="font-size:13px;color:#64748b;margin:8px 0">Tags: '+(d.tags||[]).join(', ')+'</p><button class="btn btn-sm btn-blue" onclick="location.reload()">View All Content</button>';
      }catch(e){alert('Generation failed');}finally{btn.disabled=false;btn.textContent='🚀 Generate Blog Post';}
    });
    async function publishContent(id){await fetch('/api/ai/content/'+id+'/publish',{method:'POST'});location.reload();}
    async function editContent(id){const content=prompt('Edit content (paste new content):');if(content)await fetch('/api/ai/content/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});location.reload();}
    async function deleteContent(id){if(!confirm('Delete this content?'))return;await fetch('/api/ai/content/'+id+'/delete',{method:'POST'});location.reload();}
  </script>`;
  res.send(renderPage('AI Content Studio', html, user, req));
}));

// =============================================================
// === ROUTE: POST /api/ai/content/:id/publish ===
// =============================================================
app.post('/api/ai/content/:id/publish', requireAuth, ah(async (req, res) => {
  await pool.query(`UPDATE ai_generated_content SET status='published', published_at=NOW() WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// =============================================================
// === ROUTE: POST /api/ai/content/:id/edit ===
// =============================================================
app.post('/api/ai/content/:id/edit', requireAuth, ah(async (req, res) => {
  const { title, content, summary, tags } = req.body;
  await pool.query(`UPDATE ai_generated_content SET title=COALESCE($2,title), content=COALESCE($3,content), summary=COALESCE($4,summary), tags=COALESCE($5,tags) WHERE id=$1`,
    [req.params.id, title || null, content || null, summary || null, tags || null]);
  res.json({ ok: true });
}));

// =============================================================
// === ROUTE: POST /api/ai/content/:id/delete ===
// =============================================================
app.post('/api/ai/content/:id/delete', requireAuth, ah(async (req, res) => {
  await pool.query(`DELETE FROM ai_generated_content WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// =============================================================
// === ROUTE: POST /api/ai/generate-social ===
// =============================================================
app.post('/api/ai/generate-social', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { topic, platform } = req.body;
  if (!topic || !topic.trim()) return res.status(400).json({ error: 'Topic required' });
  const platforms = platform ? [platform] : ['twitter', 'facebook', 'linkedin', 'instagram', 'whatsapp'];
  const results = [];
  for (const p of platforms) {
    const post = generateSocialPosts(topic.trim(), p);
    const r = await pool.query(
      `INSERT INTO social_posts (tenant_id,platform,content,hashtags,status,created_by) VALUES ($1,$2,$3,$4,'draft',$5) RETURNING id`,
      [user.tenant_id, post.platform, post.content, post.hashtags, user.email || user.name]
    );
    results.push({ id: r.rows[0].id, ...post, status: 'draft' });
  }
  res.json(results);
}));

// =============================================================
// === ROUTE: GET /api/ai/social-calendar ===
// =============================================================
app.get('/api/ai/social-calendar', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const posts = (await pool.query(
    `SELECT * FROM social_posts WHERE tenant_id=$1 ORDER BY scheduled_at DESC NULLS LAST, created_at DESC LIMIT 50`, [tid]
  )).rows;
  res.json(posts);
}));

// =============================================================
// === ROUTE: POST /api/ai/report-comments ===
// =============================================================
app.post('/api/ai/report-comments', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { subject, tone, students } = req.body;
  if (!subject || !students || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'Subject and students array required' });
  }
  const comments = students.map(s => ({
    name: s.name,
    comment: generateReportComment(s, subject, tone || 'professional')
  }));
  res.json({ subject, comments, count: comments.length });
}));

// =============================================================
// === ROUTE: GET /admin/ai-reports — AI Report Generator ===
// =============================================================
app.get('/admin/ai-reports', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const html = AI_CSS + `<div style="max-width:900px;margin:0 auto">
    ${aiNav('reports')}
    <h1 style="font-size:24px;color:#1e293b">📊 AI Report Card Comments</h1>
    <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Generate professional, individualized report card comments for your students</p>
    <div class="card" style="padding:24px;margin-bottom:20px">
      <h3 style="margin:0 0 16px;font-size:16px">⚙️ Configuration</h3>
      <div class="ai-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label>Subject *</label><input id="rptSubject" placeholder="e.g. Mathematics" required></div>
        <div><label>Tone</label><select id="rptTone"><option value="professional">Professional</option><option value="encouraging">Encouraging</option><option value="academic">Academic</option></select></div>
      </div>
    </div>
    <div class="card" style="padding:24px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px">👨‍🎓 Students</h3>
        <button class="btn btn-sm btn-blue" onclick="addStudentRow()">+ Add Student</button>
      </div>
      <div id="studentRows"></div>
      <div style="margin-top:16px">
        <button class="btn btn-green" style="padding:12px 28px" onclick="generateComments()">🤖 Generate Comments</button>
      </div>
    </div>
    <div id="commentResults" style="display:none">
      <div class="card" style="padding:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;font-size:16px">✅ Generated Comments</h3>
          <button class="btn btn-sm btn-blue" onclick="copyAllComments()">📋 Copy All</button>
        </div>
        <div id="commentList"></div>
      </div>
    </div>
  </div>
  <script>
    let rowIdx=0;
    function addStudentRow(name='',score=''){
      const d=document.createElement('div');d.style.cssText='display:flex;gap:10px;margin-bottom:8px;align-items:center';
      d.innerHTML='<input placeholder="Student Name" value="'+name+'" class="sname" style="flex:1;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"><input type="number" placeholder="Score %" value="'+score+'" class="sscore" style="width:100px;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px" min="0" max="100"><button class="btn btn-sm" style="background:#fee2e2;color:#dc2626" onclick="this.parentElement.remove()">✕</button>';
      document.getElementById('studentRows').appendChild(d);
    }
    addStudentRow();addStudentRow();addStudentRow();
    async function generateComments(){
      const rows=document.querySelectorAll('#studentRows > div');
      const students=[];rows.forEach(r=>{const n=r.querySelector('.sname').value.trim();const s=r.querySelector('.sscore').value;if(n)students.push({name:n,score:s?parseInt(s):null});});
      if(!students.length){alert('Add at least one student');return;}
      const btn=event.target;btn.disabled=true;btn.textContent='Generating...';
      try{
        const r=await fetch('/api/ai/report-comments',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({subject:document.getElementById('rptSubject').value||'General Studies',tone:document.getElementById('rptTone').value,students})});
        const d=await r.json();
        document.getElementById('commentResults').style.display='block';
        document.getElementById('commentList').innerHTML=d.comments.map(c=>'<div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px"><strong style="color:#1e293b">'+c.name+'</strong><p style="font-size:13px;color:#475569;margin:6px 0 0;line-height:1.6">'+c.comment+'</p></div>').join('');
      }catch(e){alert('Failed to generate');}finally{btn.disabled=false;btn.textContent='🤖 Generate Comments';}
    }
    function copyAllComments(){const el=document.getElementById('commentList');navigator.clipboard.writeText(el.innerText);alert('Copied!');}
  </script>`;
  res.send(renderPage('AI Report Comments', html, user, req));
}));

// =============================================================
// === ROUTE: GET /api/ai/recommendations — Personalized ===
// =============================================================
app.get('/api/ai/recommendations', requireAuth, ah(async (req, res) => {
  const user = req.session.user, tid = user.tenant_id;
  const email = user.email;
  // Content-based: recommend published AI content not yet seen
  const content = (await pool.query(
    `SELECT id, title, summary, tags, content_type, created_at FROM ai_generated_content
     WHERE tenant_id=$1 AND status='published' ORDER BY created_at DESC LIMIT 20`, [tid]
  )).rows;
  // Track shown
  for (const item of content.slice(0, 10)) {
    try { await pool.query(
      `INSERT INTO recommendations (user_email,tenant_id,item_type,item_id,score,reason,shown_at)
       VALUES ($1,$2,'content',$3,$4,$5,NOW()) ON CONFLICT DO NOTHING`,
      [email, tid, item.id, Math.random() * 0.5 + 0.5, 'Based on trending content']
    ); } catch(e) {}
  }
  // Get previous clicks to avoid repeats
  const clicked = new Set((await pool.query(
    `SELECT item_id FROM recommendations WHERE user_email=$1 AND tenant_id=$2 AND clicked_at IS NOT NULL`, [email, tid]
  )).rows.map(r => r.item_id));
  const fresh = content.filter(c => !clicked.has(c.id)).slice(0, 5);
  res.json({ recommendations: fresh.map(c => ({ ...c, reason: 'Recommended for you' })) });
}));

// =============================================================
// === ROUTE: POST /api/ai/recommendations/feedback ===
// =============================================================
app.post('/api/ai/recommendations/feedback', requireAuth, ah(async (req, res) => {
  const { item_id, action } = req.body;
  const user = req.session.user;
  if (action === 'click') {
    await pool.query(`UPDATE recommendations SET clicked_at=NOW() WHERE user_email=$1 AND tenant_id=$2 AND item_id=$3`,
      [user.email, user.tenant_id, item_id]);
  } else if (action === 'dismiss') {
    await pool.query(`UPDATE recommendations SET score=-1 WHERE user_email=$1 AND tenant_id=$2 AND item_id=$3`,
      [user.email, user.tenant_id, item_id]);
  }
  res.json({ ok: true });
}));

// =============================================================
// === ROUTE: GET /discover/for-you — Personalized Discovery ===
// =============================================================
app.get('/discover/for-you', requireAuth, ah(async (req, res) => {
  const user = req.session.user, tid = user.tenant_id;
  const [content, social] = await Promise.all([
    pool.query(`SELECT id, title, summary, tags, 'article' as type FROM ai_generated_content WHERE tenant_id=$1 AND status='published' ORDER BY created_at DESC LIMIT 10`, [tid]),
    pool.query(`SELECT id, platform, content, 'social' as type FROM social_posts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]),
  ]);
  const cards = content.rows.map(c => `<div class="ai-card">
    <span class="ai-badge" style="background:#ede9fe;color:#6366f1;margin-bottom:8px;display:inline-block">${c.type}</span>
    <h4 style="margin:0 0 6px;font-size:15px;color:#1e293b">${esc(c.title)}</h4>
    <p style="font-size:12px;color:#64748b;margin:0 0 8px;line-height:1.5">${esc((c.summary || '').substring(0, 140))}</p>
    <div>${(c.tags || []).map(t => `<span class="ai-tag">${esc(t)}</span>`).join('')}</div>
  </div>`).join('');
  const socialCards = social.rows.map(s => `<div class="ai-card">
    <span class="ai-badge" style="background:#dbeafe;color:#2563eb;margin-bottom:8px;display:inline-block">${esc(s.platform)}</span>
    <p style="font-size:13px;color:#475569;line-height:1.6;margin:0;white-space:pre-wrap">${esc((s.content || '').substring(0, 200))}</p>
  </div>`).join('');

  const html = AI_CSS + `<div style="max-width:1100px;margin:0 auto">
    ${aiNav('foryou')}
    <div style="text-align:center;padding:24px 0 20px">
      <h1 style="font-size:28px;color:#1e293b;margin:0">🎯 Curated For You</h1>
      <p style="font-size:14px;color:#94a3b8;margin-top:4px">Personalized content and recommendations</p>
    </div>
    ${content.rows.length ? `<h3 style="font-size:16px;color:#1e293b;margin-bottom:12px">📰 Articles & Content</h3><div class="ai-grid">${cards}</div>` : ''}
    ${social.rows.length ? `<h3 style="font-size:16px;color:#1e293b;margin:20px 0 12px">📱 Social Posts</h3><div class="ai-grid">${socialCards}</div>` : ''}
    ${!content.rows.length && !social.rows.length ? '<div class="card" style="text-align:center;padding:48px"><p style="color:#94a3b8">No content yet. Start by generating blog posts and social media content!</p></div>' : ''}
  </div>`;
  res.send(renderPage('For You', html, user, req));
}));

// =============================================================
// === ROUTE: POST /api/ai/auto-tag — Auto-Tag Text ===
// =============================================================
app.post('/api/ai/auto-tag', ah(async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 10) return res.status(400).json({ error: 'Text too short (min 10 chars)' });
  const result = autoTag(text);
  res.json(result);
}));

// =============================================================
// === ROUTE: POST /api/ai/categorize — Categorize Content ===
// =============================================================
app.post('/api/ai/categorize', ah(async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 10) return res.status(400).json({ error: 'Text too short' });
  const result = autoTag(text);
  res.json({
    primary_category: result.primary,
    secondary_categories: result.secondary,
    confidence_scores: result.results,
    suggested_tags: result.tags,
  });
}));

// =============================================================
// === ROUTE: POST /api/ai/summarize — Summarize Text ===
// =============================================================
app.post('/api/ai/summarize', ah(async (req, res) => {
  const { text, length } = req.body;
  if (!text || text.trim().length < 20) return res.status(400).json({ error: 'Text too short (min 20 chars)' });
  const summary = summarizeText(text, length || 'medium');
  res.json({ summary });
}));

// =============================================================
// === ROUTE: GET /api/ai/tldr/:contentId ===
// =============================================================
app.get('/api/ai/tldr/:contentId', ah(async (req, res) => {
  const item = (await pool.query(`SELECT title, content FROM ai_generated_content WHERE id=$1`, [req.params.contentId])).rows[0];
  if (!item) return res.status(404).json({ error: 'Content not found' });
  const summary = summarizeText(item.content, 'brief');
  res.json({ title: item.title, tldr: summary });
}));

// =============================================================
// === ROUTE: GET /api/ai/suggestions — Search Autocomplete ===
// =============================================================
app.get('/api/ai/suggestions', ah(async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const tid = req.query.tid || 0;
  // Track the search
  try {
    await pool.query(
      `INSERT INTO search_suggestions (query, tenant_id, last_searched) VALUES ($1, $2, NOW())
       ON CONFLICT (query, tenant_id) DO UPDATE SET count = search_suggestions.count + 1, last_searched = NOW()`,
      [q, tid]
    );
  } catch(e) {}
  // Find matching suggestions
  const suggestions = (await pool.query(
    `SELECT query, count FROM search_suggestions WHERE tenant_id=$1 AND query ILIKE $2 ORDER BY count DESC LIMIT 8`,
    [tid, q + '%']
  )).rows.map(r => ({ text: r.query, count: r.count }));
  // Also match from generated content titles
  const titles = (await pool.query(
    `SELECT DISTINCT title FROM ai_generated_content WHERE tenant_id=$1 AND title ILIKE $2 LIMIT 5`,
    [tid, '%' + q + '%']
  )).rows.map(r => r.title);
  const all = [...new Set([...suggestions.map(s => s.text), ...titles])].slice(0, 10);
  res.json(all);
}));

// =============================================================
// === ROUTE: GET /api/ai/trending — Trending Topics ===
// =============================================================
app.get('/api/ai/trending', ah(async (req, res) => {
  const tid = req.query.tid || 0;
  const recentSearches = (await pool.query(
    `SELECT query, count, last_searched FROM search_suggestions
     WHERE tenant_id=$1 AND last_searched >= NOW() - INTERVAL '7 days'
     ORDER BY count DESC LIMIT 15`, [tid]
  )).rows;
  const recentContent = (await pool.query(
    `SELECT title, tags, created_at FROM ai_generated_content
     WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10`, [tid]
  )).rows;
  // Extract tag frequency
  const tagFreq = {};
  for (const c of recentContent) {
    for (const tag of (c.tags || [])) {
      tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    }
  }
  const trendingTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => ({ tag: e[0], count: e[1] }));
  res.json({ searches: recentSearches, trendingTags, recentContent: recentContent.map(c => ({ title: c.title, tags: c.tags })) });
}));

// =============================================================
// === ROUTE: GET /admin/ai — AI Admin Dashboard ===
// =============================================================
app.get('/admin/ai', requireAuth, ah(async (req, res) => {
  const user = req.session.user, tid = user.tenant_id;
  const [blogCount, publishedCount, socialCount, recCount, searchCount, recent] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int as n FROM ai_generated_content WHERE tenant_id=$1`, [tid]),
    pool.query(`SELECT COUNT(*)::int as n FROM ai_generated_content WHERE tenant_id=$1 AND status='published'`, [tid]),
    pool.query(`SELECT COUNT(*)::int as n FROM social_posts WHERE tenant_id=$1`, [tid]),
    pool.query(`SELECT COUNT(*)::int as n FROM recommendations WHERE tenant_id=$1`, [tid]),
    pool.query(`SELECT COUNT(*)::int as n FROM search_suggestions WHERE tenant_id=$1`, [tid]),
    pool.query(`SELECT content_type, COUNT(*)::int as n, TO_CHAR(created_at, 'YYYY-MM-DD') as day FROM ai_generated_content WHERE tenant_id=$1 AND created_at >= NOW()-INTERVAL '30 days' GROUP BY content_type, day ORDER BY day DESC LIMIT 30`, [tid]),
  ]);
  const totalBlogs = blogCount.rows[0].n;
  const published = publishedCount.rows[0].n;
  const totalSocial = socialCount.rows[0].n;
  const totalRecs = recCount.rows[0].n;
  const totalSearches = searchCount.rows[0].n;

  const html = AI_CSS + `<div style="max-width:1200px;margin:0 auto">
    ${aiNav('dashboard')}
    <div style="text-align:center;padding:24px 0 20px">
      <h1 style="font-size:28px;color:#1e293b;margin:0">🤖 AI Command Center</h1>
      <p style="font-size:14px;color:#94a3b8;margin-top:4px">Template-based content generation, recommendations, and smart features</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
      <div class="ai-stat"><div class="num">${totalBlogs}</div><div class="lbl">Blog Posts Generated</div></div>
      <div class="ai-stat"><div class="num" style="color:#16a34a">${published}</div><div class="lbl">Published</div></div>
      <div class="ai-stat"><div class="num" style="color:#2563eb">${totalSocial}</div><div class="lbl">Social Posts</div></div>
      <div class="ai-stat"><div class="num" style="color:#f59e0b">${totalRecs}</div><div class="lbl">Recommendations</div></div>
      <div class="ai-stat"><div class="num" style="color:#8b5cf6">${totalSearches}</div><div class="lbl">Search Queries</div></div>
    </div>
    <div class="ai-grid" style="margin-bottom:24px">
      <div class="ai-card" style="cursor:pointer;text-align:center;padding:28px" onclick="location.href='/admin/ai-content'">
        <div style="font-size:36px;margin-bottom:8px">📝</div>
        <h3 style="margin:0 0 4px;font-size:16px;color:#1e293b">Blog Generator</h3>
        <p style="font-size:12px;color:#94a3b8;margin:0">Generate articles from any topic</p>
      </div>
      <div class="ai-card" style="cursor:pointer;text-align:center;padding:28px" onclick="location.href='/admin/ai-reports'">
        <div style="font-size:36px;margin-bottom:8px">📊</div>
        <h3 style="margin:0 0 4px;font-size:16px;color:#1e293b">Report Comments</h3>
        <p style="font-size:12px;color:#94a3b8;margin:0">Bulk student report generation</p>
      </div>
      <div class="ai-card" style="cursor:pointer;text-align:center;padding:28px" onclick="location.href='/discover/for-you'">
        <div style="font-size:36px;margin-bottom:8px">🎯</div>
        <h3 style="margin:0 0 4px;font-size:16px;color:#1e293b">For You</h3>
        <p style="font-size:12px;color:#94a3b8;margin:0">Personalized recommendations</p>
      </div>
      <div class="ai-card" style="cursor:pointer;text-align:center;padding:28px" onclick="quickSocial()">
        <div style="font-size:36px;margin-bottom:8px">📱</div>
        <h3 style="margin:0 0 4px;font-size:16px;color:#1e293b">Social Posts</h3>
        <p style="font-size:12px;color:#94a3b8;margin:0">Generate platform-optimized posts</p>
      </div>
    </div>
    <div class="card" style="padding:20px">
      <h3 style="margin:0 0 12px;font-size:16px">⚡ Quick Actions</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="ai-form" style="display:flex;gap:10px;align-items:end;flex:1">
          <div style="flex:1"><label>Topic</label><input id="quickTopic" placeholder="Enter a topic..."></div>
          <button class="btn btn-green" onclick="quickGenerate()" style="white-space:nowrap">Generate Blog</button>
          <button class="btn btn-blue" onclick="quickSocial()" style="white-space:nowrap">Generate Social</button>
          <button class="btn" style="background:#ede9fe;color:#6366f1;white-space:nowrap" onclick="quickSummarize()">Summarize</button>
        </div>
      </div>
      <div id="quickResult" style="display:none;margin-top:16px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;max-height:400px;overflow-y:auto"></div>
    </div>
  </div>
  <script>
    async function quickGenerate(){
      const t=document.getElementById('quickTopic').value.trim();if(!t){alert('Enter a topic');return;}
      const r=await fetch('/api/ai/generate-blog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:t})});
      const d=await r.json();
      document.getElementById('quickResult').style.display='block';
      document.getElementById('quickResult').innerHTML='<h4 style="color:#16a34a;margin:0 0 8px">✅ Blog Generated!</h4><strong>'+d.title+'</strong><p style="font-size:13px;color:#64748b;margin:6px 0">'+(d.summary||'')+'</p><a href="/admin/ai-content" class="btn btn-sm btn-blue">Manage Content</a>';
    }
    async function quickSocial(){
      const t=document.getElementById('quickTopic').value.trim();if(!t){const t2=prompt('Enter topic for social posts:');if(!t2)return;document.getElementById('quickTopic').value=t2;}
      const topic=document.getElementById('quickTopic').value.trim();
      const r=await fetch('/api/ai/generate-social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic})});
      const d=await r.json();
      document.getElementById('quickResult').style.display='block';
      document.getElementById('quickResult').innerHTML='<h4 style="color:#2563eb;margin:0 0 8px">✅ '+d.length+' Social Posts Generated!</h4>'+d.map(p=>'<div style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px"><span class="ai-badge" style="background:#dbeafe;color:#2563eb">'+p.platform+'</span><p style="font-size:12px;color:#475569;margin:4px 0 0;white-space:pre-wrap">'+p.content.substring(0,150)+'...</p></div>').join('');
    }
    async function quickSummarize(){
      const t=document.getElementById('quickTopic').value.trim();if(!t){alert('Enter text to summarize');return;}
      const r=await fetch('/api/ai/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t,length:'medium'})});
      const d=await r.json();
      document.getElementById('quickResult').style.display='block';
      document.getElementById('quickResult').innerHTML='<h4 style="color:#8b5cf6;margin:0 0 8px">📝 Summary</h4><p style="font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap">'+(d.summary||'')+'</p>';
    }
  </script>`;
  res.send(renderPage('AI Dashboard', html, user, req));
}));

// =============================================================
// === ROUTE: GET /api/ai/insights — Platform Insights ===
// =============================================================
app.get('/api/ai/insights', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const [contentByDay, searchByDay, topSearches, recStats, socialStats] = await Promise.all([
    pool.query(`SELECT DATE(created_at) as day, COUNT(*)::int as n FROM ai_generated_content WHERE tenant_id=$1 AND created_at>=NOW()-INTERVAL '30 days' GROUP BY day ORDER BY day`, [tid]),
    pool.query(`SELECT DATE(last_searched) as day, SUM(count)::int as n FROM search_suggestions WHERE tenant_id=$1 AND last_searched>=NOW()-INTERVAL '30 days' GROUP BY day ORDER BY day`, [tid]),
    pool.query(`SELECT query, count FROM search_suggestions WHERE tenant_id=$1 ORDER BY count DESC LIMIT 10`, [tid]),
    pool.query(`SELECT COUNT(*)::int as total, COUNT(clicked_at)::int as clicked FROM recommendations WHERE tenant_id=$1`, [tid]),
    pool.query(`SELECT platform, COUNT(*)::int as n FROM social_posts WHERE tenant_id=$1 GROUP BY platform ORDER BY n DESC`, [tid]),
  ]);
  // Simple trend detection (moving average)
  const contentDays = contentByDay.rows.map(r => ({ day: r.day, n: r.n }));
  let contentTrend = 'stable';
  if (contentDays.length >= 7) {
    const first = contentDays.slice(0, 7).reduce((s, d) => s + d.n, 0) / 7;
    const last = contentDays.slice(-7).reduce((s, d) => s + d.n, 0) / 7;
    if (last > first * 1.3) contentTrend = 'growing';
    else if (last < first * 0.7) contentTrend = 'declining';
  }
  const recTotal = recStats.rows[0]?.total || 0;
  const recClicked = recStats.rows[0]?.clicked || 0;
  const ctr = recTotal > 0 ? Math.round((recClicked / recTotal) * 100) : 0;
  const insights = [
    { type: 'content', title: 'Content Generation', text: `${contentByDay.rows.length > 0 ? 'Content creation is ' + contentTrend + ' with an average of ' + Math.round(contentByDay.rows.reduce((s, r) => s + r.n, 0) / Math.max(contentByDay.rows.length, 1)) + ' posts per day over the last 30 days.' : 'No content has been generated yet. Start by creating your first AI blog post.'}` },
    { type: 'search', title: 'Search Activity', text: topSearches.rows.length > 0 ? `Top search: "${topSearches.rows[0].query}" (${topSearches.rows[0].count} queries). Total unique searches tracked: ${topSearches.rows.length}.` : 'No search activity recorded yet.' },
    { type: 'recommendations', title: 'Recommendation Performance', text: `${recTotal} recommendations shown, ${recClicked} clicked (CTR: ${ctr}%). ${ctr < 20 ? 'Consider improving content relevance to boost engagement.' : 'Good engagement! Keep producing quality content.'}` },
    { type: 'social', title: 'Social Media Activity', text: socialStats.rows.length > 0 ? socialStats.rows.map(s => `${s.platform}: ${s.n} posts`).join(', ') + '.' : 'No social posts generated yet.' },
    { type: 'action', title: 'Recommended Actions', text: contentTrend === 'declining' ? 'Content generation is declining. Consider setting up a regular content schedule to maintain consistency.' : 'Your AI content engine is performing well. Explore auto-tagging and summarization features for enhanced workflows.' },
  ];
  res.json({ insights, stats: { contentTrend, contentAvgPerDay: contentByDay.rows.length > 0 ? Math.round(contentByDay.rows.reduce((s, r) => s + r.n, 0) / contentByDay.rows.length) : 0, totalSearches: topSearches.rows.reduce((s, r) => s + r.count, 0), recCTR: ctr } });
}));

// =============================================================
// === ROUTE: GET /admin/ai-social — Social Media Manager ===
// =============================================================
app.get('/admin/ai-social', requireAuth, ah(async (req, res) => {
  const user = req.session.user, tid = user.tenant_id;
  const posts = (await pool.query(
    `SELECT * FROM social_posts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]
  )).rows;
  const platformCounts = {};
  posts.forEach(p => { platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1; });
  const rows = posts.map(p => {
    const tagsHtml = (p.hashtags || []).map(t => `<span class="ai-tag">${esc(t)}</span>`).join('');
    return `<div class="ai-card">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <span class="ai-badge" style="background:#dbeafe;color:#2563eb">${esc(p.platform)}</span>
        <span style="font-size:11px;color:#94a3b8">${_fmt(p.created_at)}</span>
      </div>
      <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 8px;white-space:pre-wrap">${esc((p.content || '').substring(0, 200))}</p>
      <div style="margin-top:8px">${tagsHtml}</div>
    </div>`;
  }).join('') || '<p style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:40px">No social posts yet.</p>';
  const statHtml = Object.entries(platformCounts).map(([p, c]) =>
    `<div class="ai-stat"><div class="num" style="color:#2563eb">${c}</div><div class="lbl">${esc(p)}</div></div>`
  ).join('');

  const html = AI_CSS + `<div style="max-width:1200px;margin:0 auto">
    ${aiNav('')}
    <h1 style="font-size:24px;color:#1e293b">📱 Social Media Manager</h1>
    <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Manage your AI-generated social media posts</p>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <h3 style="margin:0 0 12px;font-size:16px">✨ Generate Social Posts</h3>
      <div class="ai-form" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
        <div style="flex:1;min-width:200px"><label>Topic *</label><input id="socTopic" placeholder="Enter a topic..."></div>
        <div><label>Platform</label><select id="socPlatform"><option value="">All Platforms</option><option value="twitter">Twitter/X</option><option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option></select></div>
        <button class="btn btn-green" style="padding:10px 24px;white-space:nowrap" onclick="genSocial()">Generate</button>
      </div>
    </div>
    ${statHtml ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px">${statHtml}</div>` : ''}
    <h3 style="font-size:16px;color:#1e293b;margin-bottom:12px">All Posts (${posts.length})</h3>
    <div class="ai-grid">${rows}</div>
  </div>
  <script>
    async function genSocial(){
      const t=document.getElementById('socTopic').value.trim();if(!t){alert('Enter a topic');return;}
      const p=document.getElementById('socPlatform').value;
      const r=await fetch('/api/ai/generate-social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:t,platform:p||undefined})});
      if(r.ok){const d=await r.json();alert(d.length+' posts generated!');location.reload();}else alert('Failed');
    }
  </script>`;
  res.send(renderPage('Social Media Manager', html, user, req));
}));

// =============================================================
// === ROUTE: GET /admin/ai-insights — AI Insights Page ===
// =============================================================
app.get('/admin/ai-insights', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const html = AI_CSS + `<div style="max-width:900px;margin:0 auto">
    ${aiNav('')}
    <h1 style="font-size:24px;color:#1e293b">💡 AI Insights & Alerts</h1>
    <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Platform analytics and actionable recommendations</p>
    <div class="card" style="padding:20px;margin-bottom:20px">
      <h3 style="margin:0 0 12px;font-size:16px">📊 Load Insights</h3>
      <button class="btn btn-green" onclick="loadInsights()" style="padding:10px 24px">Generate Insights</button>
    </div>
    <div id="insightResults"></div>
  </div>
  <script>
    async function loadInsights(){
      const el=document.getElementById('insightResults');el.innerHTML='<p style="color:#94a3b8">Loading...</p>';
      const r=await fetch('/api/ai/insights');const d=await r.json();
      el.innerHTML=d.insights.map(i=>'<div class="card" style="padding:18px;margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:20px">'+{content:'📝',search:'🔍',recommendations:'🎯',social:'📱',action:'⚡'}[i.type]||'📊'+'</span><h4 style="margin:0;font-size:15px;color:#1e293b">'+esc(i.title)+'</h4></div><p style="font-size:13px;color:#475569;line-height:1.6;margin:0">'+esc(i.text)+'</p></div>').join('');
    }
  </script>`;
  res.send(renderPage('AI Insights', html, user, req));
}));

console.log('[AIContent] LOADED: Blog generator, social media posts, bulk report comments, recommendations engine, auto-tagging, content summarizer, smart search, trending topics, AI admin dashboard, insights & alerts');
