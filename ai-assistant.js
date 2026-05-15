/**
 * AI Assistant Integration Module — Multi-tenant SaaS Platform
 * Provides chat interface, prompt library, usage analytics, and AI settings.
 * Uses z-ai-web-dev-sdk for LLM completions with fallback simulation.
 */
module.exports = function aiAssistant(app, db, pool, renderPage, esc) {

  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    req.tenantId = req.session.tenantId;
    req.userId = req.session.userId;
    next();
  };

  const ah = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => { console.error('[AI]', err); res.status(500).send('Internal error'); });
  };

  let ZAI;
  try { ZAI = require('z-ai-web-dev-sdk'); } catch (_) { ZAI = null; }

  /* ────────────── MIGRATIONS ────────────── */
  const migrate = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id), title VARCHAR(255),
        model VARCHAR(50) DEFAULT 'gpt-4', context_type VARCHAR(50) DEFAULT 'general',
        context_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_conv_tenant ON ai_conversations(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id)`);
    await pool.query(`
      ALTER TABLE ai_conversations ALTER COLUMN tenant_id SET NOT NULL,
        ALTER COLUMN model SET DEFAULT 'gpt-4',
        ALTER COLUMN context_type SET DEFAULT 'general'`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL, content TEXT NOT NULL,
        tokens_used INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_msg_tenant ON ai_messages(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id)`);
    await pool.query(`
      ALTER TABLE ai_messages ALTER COLUMN tenant_id SET NOT NULL,
        ALTER COLUMN role SET NOT NULL,
        ALTER COLUMN tokens_used SET DEFAULT 0`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_prompts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, category VARCHAR(50),
        prompt_text TEXT NOT NULL, description TEXT,
        variables TEXT[], usage_count INTEGER DEFAULT 0,
        is_system BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_prompts_tenant ON ai_prompts(tenant_id)`);
    await pool.query(`
      ALTER TABLE ai_prompts ALTER COLUMN tenant_id SET NOT NULL,
        ALTER COLUMN name SET NOT NULL,
        ALTER COLUMN usage_count SET DEFAULT 0,
        ALTER COLUMN is_system SET DEFAULT false,
        ALTER COLUMN is_active SET DEFAULT true`);
    await seedPrompts();
  };

  /* ────────────── SEED SYSTEM PROMPTS ────────────── */
  const seedPrompts = async () => {
    const tenants = await pool.query(`SELECT id FROM tenants`);
    const seeds = [
      { name: 'Email Writer', cat: 'writing', prompt: 'Write a professional email about {{topic}}. The tone should be {{tone}}. Include a clear subject line, greeting, body, and closing signature.',
        desc: 'Generate professional emails on any topic' },
      { name: 'Report Summarizer', cat: 'analysis', prompt: 'Summarize the following text into a concise report with key findings, executive summary (2-3 sentences), and action items:\n\n{{content}}',
        desc: 'Condense lengthy content into structured summaries' },
      { name: 'Lesson Plan Generator', cat: 'education', prompt: 'Create a detailed lesson plan for {{subject}} at the {{level}} level. Include learning objectives, materials needed, warm-up activity (5 min), main instruction (25 min), practice activity (15 min), and assessment.',
        desc: 'Generate structured lesson plans for any subject' },
      { name: 'Meeting Agenda', cat: 'business', prompt: 'Create a professional meeting agenda for "{{meeting_title}}" with {{duration}} minutes. Include: welcome, review action items, main discussion points, decisions needed, and next steps.',
        desc: 'Structure productive meeting agendas' },
      { name: 'Social Media Post', cat: 'marketing', prompt: 'Create {{count}} engaging social media posts for {{platform}} about {{topic}}. Include relevant hashtags. Tone: {{tone}}. Optimize for engagement.',
        desc: 'Generate platform-specific social media content' },
      { name: 'FAQ Generator', cat: 'support', prompt: 'Generate 10 frequently asked questions and comprehensive answers about {{topic}}. Organize by category and include troubleshooting tips where relevant.',
        desc: 'Create FAQ sections for products, services, or topics' },
      { name: 'Data Analysis Helper', cat: 'analysis', prompt: 'Analyze the following data and provide: 1) Key trends 2) Notable patterns 3) Anomalies 4) Recommendations 5) Summary statistics.\n\nData: {{data}}',
        desc: 'Interpret data and provide actionable insights' },
      { name: 'Content Rewriter', cat: 'writing', prompt: 'Rewrite the following content to be {{style}} while maintaining the core message. Improve clarity, flow, and {{improvement_focus}}:\n\n{{content}}',
        desc: 'Rephrase and improve existing content' },
    ];
    for (const t of tenants.rows) {
      for (const s of seeds) {
        await pool.query(`INSERT INTO ai_prompts (tenant_id,name,category,prompt_text,description,variables,is_system)
          VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`,
          [t.id, s.name, s.cat, s.prompt, s.desc,
            s.prompt.match(/\{\{(\w+)\}\}/g)?.map(v => v.replace(/[{}]/g, '')) || []]);
      }
    }
  };

  /* ────────────── SETTINGS HELPERS ────────────── */
  const getSettings = async (tid) => {
    const r = await pool.query(`SELECT ai_model,ai_temperature,ai_max_tokens FROM tenants WHERE id=$1`, [tid]);
    return { model: r.rows[0]?.ai_model || 'gpt-4', temperature: r.rows[0]?.ai_temperature ?? 0.7, maxTokens: r.rows[0]?.ai_max_tokens || 2048 };
  };

  const genTitle = (msg) => {
    const words = msg.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 6).join(' ');
    return words.length > 40 ? words.slice(0, 40) + '...' : words || 'New Chat';
  };

  /* ────────────── AI CHAT LOGIC ────────────── */
  const callAI = async (messages, settings) => {
    if (ZAI) {
      try {
        const zai = new ZAI();
        const resp = await zai.chat.completions.create({
          model: settings.model, messages, temperature: settings.temperature, max_tokens: settings.maxTokens
        });
        return { content: resp.choices?.[0]?.message?.content || 'I could not generate a response.', tokens: resp.usage?.total_tokens || 0 };
      } catch (e) { console.warn('[AI] SDK call failed:', e.message); }
    }
    return simulateResponse(messages);
  };

  const simulateResponse = (messages) => {
    const last = messages[messages.length - 1]?.content?.toLowerCase() || '';
    const responses = {
      email: "I'd be happy to help you draft an email! Here's a professional template:\n\n**Subject:** [Your Subject Here]\n\nDear [Recipient],\n\nI hope this message finds you well. I'm writing to [state purpose].\n\n[Main content]\n\nPlease let me know if you have any questions.\n\nBest regards,\n[Your Name]",
      summar: "**Executive Summary**\n\nBased on the content provided, here are the key takeaways:\n\n1. **Main Point** — The primary theme centers around the core objectives.\n2. **Key Findings** — Several important patterns emerged from the analysis.\n3. **Action Items** — Recommend reviewing the priorities and assigning owners.\n4. **Timeline** — Next steps should be completed within the specified timeframe.\n\nWould you like me to expand on any specific section?",
      lesson: "Here's a structured lesson plan:\n\n📚 **Lesson: [Topic]**\n\n**Learning Objectives:**\n- Students will understand the core concepts\n- Students can apply knowledge in practice\n\n**Materials:** Whiteboard, handouts, digital resources\n\n**Warm-up (5 min):** Engage students with a thought-provoking question.\n\n**Main Instruction (25 min):**\n1. Introduction to key concepts\n2. Guided examples\n3. Interactive discussion\n\n**Practice (15 min):** Hands-on activity in small groups.\n\n**Assessment:** Exit ticket with 3 key questions.",
      code: "I can help with coding! Here's a general approach:\n\n```javascript\n// Example structure\nfunction solution(input) {\n  // 1. Parse and validate input\n  // 2. Process data\n  // 3. Return result\n  return result;\n}\n```\n\n**Key principles:**\n- Keep functions focused and small\n- Add clear comments\n- Handle edge cases\n- Write tests alongside code\n\nPlease share your specific code question and I'll provide a targeted solution!",
      help: "I'm your AI assistant! I can help you with:\n\n✉️ **Writing** — Emails, reports, social posts\n📊 **Analysis** — Data interpretation, summaries\n🎓 **Education** — Lesson plans, study guides\n💼 **Business** — Meeting agendas, project plans\n💻 **Technical** — Code review, documentation\n\nJust type your request and I'll do my best to help!",
    };
    let resp = responses.help;
    if (/email|write|draft/i.test(last)) resp = responses.email;
    else if (/summar|summary|condense|overview/i.test(last)) resp = responses.summar;
    else if (/lesson|teach|curriculum|plan/i.test(last)) resp = responses.lesson;
    else if (/code|function|bug|error|javascript|python/i.test(last)) resp = responses.code;
    return { content: resp, tokens: 150 };
  };

  /* ════════════════════════════════════════════
     ROUTE 1 — GET /ai  (Chat Interface)
     ════════════════════════════════════════════ */
  app.get('/ai', requireAuth, ah(async (req, res) => {
    const convos = (await pool.query(
      `SELECT id,title,model,context_type,created_at FROM ai_conversations
       WHERE tenant_id=$1 AND user_id=$2 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 50`,
      [req.tenantId, req.userId])).rows;
    const settings = await getSettings(req.tenantId);
    const prompts = (await pool.query(
      `SELECT id,name,description,category FROM ai_prompts WHERE tenant_id=$1 AND is_active=true LIMIT 12`,
      [req.tenantId])).rows;
    res.send(renderPage('AI Assistant', `
<style>
  .ai-layout{display:grid;grid-template-columns:280px 1fr;gap:16px;height:calc(100vh - 160px);min-height:500px}
  .ai-sidebar{background:#fff;border-radius:12px;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;border:1px solid #e5e7eb}
  .ai-sidebar h3{margin:0 0 8px;font-size:15px;color:#374151}
  .convo-item{padding:10px 12px;border-radius:8px;cursor:pointer;font-size:13px;border:1px solid transparent;transition:.15s}
  .convo-item:hover,.convo-item.active{background:#f0f4ff;border-color:#c7d2fe}
  .convo-item .convo-title{font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .convo-item .convo-meta{font-size:11px;color:#9ca3af;margin-top:2px}
  .ai-main{background:#fff;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;border:1px solid #e5e7eb}
  .ai-header{padding:14px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between}
  .ai-header h2{margin:0;font-size:18px;color:#1f2937}
  .chat-messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px}
  .msg{max-width:80%;padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.6;word-wrap:break-word}
  .msg.user{align-self:flex-end;background:#3b82f6;color:#fff;border-bottom-right-radius:4px}
  .msg.ai{align-self:flex-start;background:#f3f4f6;color:#1f2937;border-bottom-left-radius:4px}
  .msg pre{background:rgba(0,0,0,.08);padding:8px 12px;border-radius:8px;overflow-x:auto;font-size:13px;margin:6px 0}
  .msg code{font-family:monospace;font-size:13px}
  .typing-indicator{align-self:flex-start;display:none;gap:4px;padding:12px 16px;background:#f3f4f6;border-radius:16px;border-bottom-left-radius:4px}
  .typing-indicator span{width:8px;height:8px;background:#9ca3af;border-radius:50%;animation:bounce 1.4s infinite}
  .typing-indicator span:nth-child(2){animation-delay:.2s}
  .typing-indicator span:nth-child(3){animation-delay:.4s}
  @keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-8px)}}
  .chat-input-area{padding:14px 20px;border-top:1px solid #e5e7eb;display:flex;gap:10px;align-items:flex-end}
  .chat-input-area textarea{flex:1;border:1px solid #d1d5db;border-radius:10px;padding:10px 14px;font-size:14px;resize:none;max-height:120px;font-family:inherit;outline:none;transition:border .2s}
  .chat-input-area textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
  .prompt-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
  .prompt-chip{padding:6px 10px;border-radius:8px;font-size:12px;background:#eff6ff;color:#1d4ed8;cursor:pointer;border:1px solid #bfdbfe;text-align:center;transition:.15s}
  .prompt-chip:hover{background:#dbeafe}
  .welcome-screen{text-align:center;padding:60px 20px;color:#6b7280}
  .welcome-screen h3{color:#1f2937;margin-bottom:8px}
  .model-select{padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;outline:none}
</style>
<div class="ai-layout">
  <div class="ai-sidebar">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3>💬 Conversations</h3>
      <button class="btn btn-sm btn-green" onclick="newChat()">+ New</button>
    </div>
    <input id="searchConvos" placeholder="Search..." style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box" oninput="filterConvos()">
    <div id="convoList">
      ${convos.map(c => `<div class="convo-item" data-id="${c.id}" onclick="loadConvo(${c.id})">
        <div class="convo-title">${esc(c.title || 'Untitled')}</div>
        <div class="convo-meta">${c.model || 'gpt-4'} · ${new Date(c.created_at).toLocaleDateString()}</div>
      </div>`).join('')}
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0">
    <h3>📋 Quick Prompts</h3>
    <div class="prompt-grid">
      ${prompts.map(p => `<div class="prompt-chip" onclick="usePrompt(${p.id},'${esc(p.name)}')">${esc(p.name)}</div>`).join('')}
    </div>
    <div style="margin-top:auto;padding-top:8px">
      <a href="/ai/settings" class="btn btn-sm" style="width:100%;text-align:center">⚙️ Settings</a>
      <a href="/ai/report" class="btn btn-sm" style="width:100%;text-align:center;margin-top:4px">📊 Analytics</a>
    </div>
  </div>
  <div class="ai-main">
    <div class="ai-header">
      <h2 id="chatTitle">🤖 AI Assistant</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="model-select" id="modelSelect">
          <option value="gpt-4" ${settings.model === 'gpt-4' ? 'selected' : ''}>GPT-4</option>
          <option value="gpt-3.5-turbo" ${settings.model === 'gpt-3.5-turbo' ? 'selected' : ''}>GPT-3.5 Turbo</option>
          <option value="gpt-4o" ${settings.model === 'gpt-4o' ? 'selected' : ''}>GPT-4o</option>
        </select>
        <button class="btn btn-sm btn-red" onclick="clearChat()" style="display:none" id="clearBtn">🗑️ Clear</button>
      </div>
    </div>
    <div class="chat-messages" id="chatMessages">
      <div class="welcome-screen" id="welcomeScreen">
        <h3>Welcome to AI Assistant</h3>
        <p>Start a conversation or use a prompt template from the sidebar.</p>
        <p style="font-size:12px;margin-top:12px">Powered by ${ZAI ? 'z-ai-web-dev-sdk' : 'built-in AI engine'}</p>
      </div>
    </div>
    <div class="typing-indicator" id="typing"><span></span><span></span><span></span></div>
    <div class="chat-input-area">
      <textarea id="msgInput" rows="1" placeholder="Type your message..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"></textarea>
      <button class="btn btn-blue" onclick="sendMessage()">Send ➤</button>
    </div>
  </div>
</div>
<script>
let currentConvo = null;
function filterConvos(){
  const q=document.getElementById('searchConvos').value.toLowerCase();
  document.querySelectorAll('.convo-item').forEach(el=>{
    el.style.display=el.querySelector('.convo-title').textContent.toLowerCase().includes(q)?'':'none';
  });
}
async function newChat(){currentConvo=null;document.getElementById('chatTitle').textContent='🤖 AI Assistant';
  document.getElementById('chatMessages').innerHTML='<div class="welcome-screen" id="welcomeScreen"><h3>Welcome to AI Assistant</h3><p>Start a new conversation.</p></div>';
  document.getElementById('clearBtn').style.display='none';
  document.querySelectorAll('.convo-item').forEach(e=>e.classList.remove('active'));
}
async function loadConvo(id){
  document.querySelectorAll('.convo-item').forEach(e=>{e.classList.toggle('active',parseInt(e.dataset.id)===id)});
  const r=await fetch('/ai/conversations');const convos=await r.json();const c=convos.find(x=>x.id===id);
  if(!c)return;currentConvo=id;document.getElementById('chatTitle').textContent='💬 '+c.title;
  document.getElementById('clearBtn').style.display='inline-block';
  const mr=await fetch('/ai/conversations');const all=await mr.json();
  const mc=all.find(x=>x.id===id);
  document.getElementById('chatMessages').innerHTML='';
  if(mc&&mc.messages){mc.messages.forEach(m=>{
    addBubble(m.role==='user'?'user':'ai',m.content,false);
  });}
  scrollToBottom();
}
function addBubble(role,content,animate=true){
  const d=document.getElementById('chatMessages');
  const ws=document.getElementById('welcomeScreen');if(ws)ws.remove();
  const div=document.createElement('div');div.className='msg '+role;
  div.innerHTML=formatMsg(content);if(animate)div.style.opacity='0';
  d.appendChild(div);if(animate)setTimeout(()=>{div.style.opacity='1';div.style.transition='opacity .3s'},10);
  scrollToBottom();
}
function formatMsg(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').replace(/\\n/g,'<br>')
  .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g,'<pre>$1</pre>').replace(/\`(.+?)\`/g,'<code>$1</code>');}
function scrollToBottom(){const c=document.getElementById('chatMessages');c.scrollTop=c.scrollHeight;}
async function sendMessage(){
  const input=document.getElementById('msgInput');const text=input.value.trim();if(!text)return;
  input.value='';input.style.height='auto';addBubble('user',text);
  document.getElementById('typing').style.display='flex';scrollToBottom();
  try{
    const r=await fetch('/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text,conversationId:currentConvo,model:document.getElementById('modelSelect').value})});
    const data=await r.json();if(data.conversationId&&data.conversationId!==currentConvo){currentConvo=data.conversationId;refreshConvos();}
    document.getElementById('typing').style.display='none';addBubble('ai',data.reply);
  }catch(e){document.getElementById('typing').style.display='none';addBubble('ai','⚠️ Failed to get response. Please try again.');}
}
async function refreshConvos(){try{const r=await fetch('/ai/conversations');const c=await r.json();
  document.getElementById('convoList').innerHTML=c.map(x=>'<div class="convo-item'+(x.id===currentConvo?' active':'')+'" data-id="'+x.id+'" onclick="loadConvo('+x.id+')"><div class="convo-title">'+x.title+'</div><div class="convo-meta">'+x.model+' · '+new Date(x.created_at).toLocaleDateString()+'</div></div>').join('');}catch(e){}}
async function usePrompt(id,name){
  const r=await fetch('/ai/prompts/'+id+'/use',{method:'POST'});
  const d=await r.json();if(d.promptText){
    if(!currentConvo)await newChat();
    document.getElementById('msgInput').value=d.promptText;
    document.getElementById('msgInput').focus();
    document.getElementById('msgInput').style.height='auto';
    document.getElementById('msgInput').style.height=document.getElementById('msgInput').scrollHeight+'px';
  }
}
async function clearChat(){if(!currentConvo)return;if(!confirm('Delete this conversation?'))return;
  await fetch('/ai/conversations/'+currentConvo,{method:'DELETE'});currentConvo=null;await newChat();await refreshConvos();}
const ta=document.getElementById('msgInput');
ta.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';});
</script>`, req.user, req));
  }));

  /* ════════════════════════════════════════════
     ROUTE 2 — POST /ai/chat
     ════════════════════════════════════════════ */
  app.post('/ai/chat', requireAuth, ah(async (req, res) => {
    const { message, conversationId, model } = req.body;
    if (!message || !message.trim()) return res.json({ error: 'Message required' });
    const settings = await getSettings(req.tenantId);
    const useModel = model || settings.model;
    let convoId = conversationId;

    if (!convoId) {
      const cr = await pool.query(
        `INSERT INTO ai_conversations (tenant_id,user_id,title,model) VALUES($1,$2,$3,$4) RETURNING id`,
        [req.tenantId, req.userId, genTitle(message), useModel]);
      convoId = cr.rows[0].id;
    }

    await pool.query(
      `INSERT INTO ai_messages (tenant_id,conversation_id,role,content) VALUES($1,$2,'user',$3)`,
      [req.tenantId, convoId, message]);

    const history = (await pool.query(
      `SELECT role,content FROM ai_messages WHERE conversation_id=$1 AND tenant_id=$2 ORDER BY created_at`,
      [convoId, req.tenantId])).rows;

    const aiMessages = [{ role: 'system', content: 'You are a helpful AI assistant for a business SaaS platform. Be concise, professional, and actionable.' }]
      .concat(history.slice(-20).map(m => ({ role: m.role, content: m.content })));

    const result = await callAI(aiMessages, { ...settings, model: useModel });

    await pool.query(
      `INSERT INTO ai_messages (tenant_id,conversation_id,role,content,tokens_used) VALUES($1,$2,'assistant',$3,$4)`,
      [req.tenantId, convoId, result.content, result.tokens]);

    await pool.query(`UPDATE ai_conversations SET title=$1,model=$2 WHERE id=$3`,
      [genTitle(message), useModel, convoId]);

    res.json({ reply: result.content, conversationId: convoId, tokens: result.tokens });
  }));

  /* ════════════════════════════════════════════
     ROUTE 3 — GET /ai/conversations
     ════════════════════════════════════════════ */
  app.get('/ai/conversations', requireAuth, ah(async (req, res) => {
    const convos = (await pool.query(
      `SELECT c.id,c.title,c.model,c.context_type,c.created_at,
        COALESCE(json_agg(json_build_object('role',m.role,'content',m.content,'created_at',m.created_at)
        ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL),'[]') AS messages
       FROM ai_conversations c LEFT JOIN ai_messages m ON m.conversation_id=c.id
       WHERE c.tenant_id=$1 AND c.user_id=$2 GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`,
      [req.tenantId, req.userId])).rows;
    res.json(convos);
  }));

  /* ════════════════════════════════════════════
     ROUTE 4 — DELETE /ai/conversations/:id
     ════════════════════════════════════════════ */
  app.delete('/ai/conversations/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM ai_conversations WHERE id=$1 AND tenant_id=$2 AND user_id=$3`,
      [req.params.id, req.tenantId, req.userId]);
    res.json({ ok: true });
  }));

  /* ════════════════════════════════════════════
     ROUTE 5 — GET /ai/prompts  (Prompt Library)
     ════════════════════════════════════════════ */
  app.get('/ai/prompts', requireAuth, ah(async (req, res) => {
    const { cat } = req.query;
    let sql = `SELECT * FROM ai_prompts WHERE tenant_id=$1 AND is_active=true`;
    const params = [req.tenantId];
    if (cat) { sql += ` AND category=$2`; params.push(cat); }
    sql += ` ORDER BY is_system DESC, usage_count DESC, name`;
    const prompts = (await pool.query(sql, params)).rows;
    const categories = (await pool.query(
      `SELECT DISTINCT category FROM ai_prompts WHERE tenant_id=$1 AND is_active=true ORDER BY category`, [req.tenantId])).rows.map(r => r.category);

    res.send(renderPage('Prompt Library', `
<style>
  .prompt-lib{max-width:960px;margin:0 auto}
  .prompt-lib h2{margin-bottom:4px}
  .prompt-filters{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap}
  .filter-chip{padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:1px solid #d1d5db;background:#fff;transition:.15s}
  .filter-chip:hover,.filter-chip.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
  .prompt-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:16px}
  .prompt-card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;transition:.2s}
  .prompt-card:hover{border-color:#93c5fd;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .prompt-card h4{margin:0 0 6px;color:#1f2937}
  .prompt-card .badge{margin-left:6px}
  .prompt-card p{font-size:13px;color:#6b7280;margin:0 0 10px;line-height:1.4}
  .prompt-card .meta{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#9ca3af}
</style>
<div class="prompt-lib">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h2>📋 Prompt Library</h2>
    <a href="/ai/prompts/new" class="btn btn-green">+ Create Prompt</a>
  </div>
  <p class="muted">Reusable prompt templates for common tasks. Click "Use" to load into chat.</p>
  <div class="prompt-filters">
    <div class="filter-chip ${!cat ? 'active' : ''}" onclick="location.href='/ai/prompts'">All</div>
    ${categories.map(c => `<div class="filter-chip ${cat === c ? 'active' : ''}" onclick="location.href='/ai/prompts?cat=${esc(c)}'">${esc(c)}</div>`).join('')}
  </div>
  <div class="prompt-cards">
    ${prompts.map(p => `<div class="card prompt-card">
      <h4>${esc(p.name)} ${p.is_system ? '<span class="badge" style="background:#dbeafe;color:#1d4ed8">System</span>' : ''}</h4>
      <p>${esc(p.description || '')}</p>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:10px;background:#f9fafb;padding:8px;border-radius:6px;max-height:60px;overflow:hidden">${esc((p.prompt_text || '').substring(0, 120))}...</div>
      <div class="meta">
        <span>Used ${p.usage_count || 0} times</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-blue" onclick="usePrompt(${p.id})">Use</button>
          ${!p.is_system ? `<button class="btn btn-sm btn-red" onclick="deletePrompt(${p.id})">Delete</button>` : ''}
        </div>
      </div>
    </div>`).join('')}
  </div>
</div>
<script>
async function usePrompt(id){const r=await fetch('/ai/prompts/'+id+'/use',{method:'POST'});const d=await r.json();
  if(d.promptText){window.location.href='/ai?prompt='+encodeURIComponent(d.promptText);}}
async function deletePrompt(id){if(!confirm('Delete this prompt?'))return;
  await fetch('/ai/prompts/'+id,{method:'DELETE'});location.reload();}
</script>`, req.user, req));
  }));

  /* ════════════════════════════════════════════
     ROUTE 6 — GET /ai/prompts/new
     ════════════════════════════════════════════ */
  app.get('/ai/prompts/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Create Prompt', `
<style>
  .prompt-form{max-width:640px;margin:0 auto}
  .prompt-form label{display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:#374151}
  .prompt-form input,.prompt-form textarea,.prompt-form select{width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;outline:none;margin-bottom:16px}
  .prompt-form textarea{min-height:160px;font-family:monospace;font-size:13px;resize:vertical}
  .prompt-form input:focus,.prompt-form textarea:focus,.prompt-form select:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
  .var-hint{font-size:12px;color:#6b7280;margin-top:-12px;margin-bottom:16px}
</style>
<div class="prompt-form card">
  <h2 style="margin-top:0">✏️ Create Custom Prompt</h2>
  <form method="POST" action="/ai/prompts/create">
    <label>Prompt Name</label>
    <input name="name" placeholder="e.g., Code Review Helper" required>
    <label>Category</label>
    <select name="category">
      <option value="writing">Writing</option><option value="analysis">Analysis</option>
      <option value="education">Education</option><option value="business">Business</option>
      <option value="marketing">Marketing</option><option value="support">Support</option>
      <option value="technical">Technical</option><option value="other">Other</option>
    </select>
    <label>Description</label>
    <input name="description" placeholder="Brief description of what this prompt does">
    <label>Prompt Template</label>
    <textarea name="prompt_text" placeholder="Write your prompt here. Use {{variable_name}} for placeholders..." required></textarea>
    <p class="var-hint">💡 Use <code>{{variable}}</code> syntax for dynamic placeholders (e.g., {{topic}}, {{tone}})</p>
    <div style="display:flex;gap:10px">
      <button type="submit" class="btn btn-green">Save Prompt</button>
      <a href="/ai/prompts" class="btn">Cancel</a>
    </div>
  </form>
</div>`, req.user, req));
  }));

  /* ════════════════════════════════════════════
     ROUTE 7 — POST /ai/prompts/create
     ════════════════════════════════════════════ */
  app.post('/ai/prompts/create', requireAuth, ah(async (req, res) => {
    const { name, category, description, prompt_text } = req.body;
    if (!name || !prompt_text) return res.redirect('/ai/prompts/new');
    const variables = (prompt_text.match(/\{\{(\w+)\}\}/g) || []).map(v => v.replace(/[{}]/g, ''));
    await pool.query(
      `INSERT INTO ai_prompts (tenant_id,name,category,description,prompt_text,variables,is_system)
       VALUES($1,$2,$3,$4,$5,$6,false)`,
      [req.tenantId, name.trim(), category, description, prompt_text, variables]);
    res.redirect('/ai/prompts');
  }));

  /* ════════════════════════════════════════════
     ROUTE 8 — DELETE /ai/prompts/:id
     ════════════════════════════════════════════ */
  app.delete('/ai/prompts/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM ai_prompts WHERE id=$1 AND tenant_id=$2 AND is_system=false`,
      [req.params.id, req.tenantId]);
    res.json({ ok: true });
  }));

  /* ════════════════════════════════════════════
     ROUTE 9 — POST /ai/prompts/:id/use
     ════════════════════════════════════════════ */
  app.post('/ai/prompts/:id/use', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT prompt_text,variables FROM ai_prompts WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, req.tenantId]);
    if (!r.rows[0]) return res.json({ error: 'Prompt not found' });
    await pool.query(`UPDATE ai_prompts SET usage_count=usage_count+1 WHERE id=$1`, [req.params.id]);
    res.json({ promptText: r.rows[0].prompt_text, variables: r.rows[0].variables });
  }));

  /* ════════════════════════════════════════════
     ROUTE 10 — GET /ai/settings
     ════════════════════════════════════════════ */
  app.get('/ai/settings', requireAuth, ah(async (req, res) => {
    const s = await getSettings(req.tenantId);
    res.send(renderPage('AI Settings', `
<style>
  .settings-form{max-width:560px;margin:0 auto}
  .settings-form .card{padding:24px}
  .setting-group{margin-bottom:20px}
  .setting-group label{display:block;font-weight:600;margin-bottom:6px;font-size:14px;color:#374151}
  .setting-group .hint{font-size:12px;color:#9ca3af;margin-top:4px}
  .setting-group select,.setting-group input[type="range"]{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box}
  .setting-group select:focus{border-color:#3b82f6}
  .range-display{text-align:center;font-size:24px;font-weight:700;color:#3b82f6;margin:8px 0}
</style>
<div class="settings-form">
  <div class="card">
    <h2 style="margin-top:0">⚙️ AI Settings</h2>
    <p class="muted" style="margin-bottom:20px">Configure AI behavior for your organization.</p>
    <form method="POST" action="/ai/settings/save">
      <div class="setting-group">
        <label>Default Model</label>
        <select name="model">
          <option value="gpt-4" ${s.model === 'gpt-4' ? 'selected' : ''}>GPT-4 (Best quality)</option>
          <option value="gpt-4o" ${s.model === 'gpt-4o' ? 'selected' : ''}>GPT-4o (Fast & smart)</option>
          <option value="gpt-3.5-turbo" ${s.model === 'gpt-3.5-turbo' ? 'selected' : ''}>GPT-3.5 Turbo (Fastest)</option>
        </select>
        <div class="hint">Higher quality models use more tokens but produce better responses.</div>
      </div>
      <div class="setting-group">
        <label>Temperature: <span id="tempVal">${s.temperature}</span></label>
        <input type="range" name="temperature" min="0" max="2" step="0.1" value="${s.temperature}"
          oninput="document.getElementById('tempVal').textContent=this.value">
        <div class="hint">0 = precise/focused, 2 = creative/random. Recommended: 0.7</div>
      </div>
      <div class="setting-group">
        <label>Max Tokens per Response</label>
        <select name="maxTokens">
          ${[256, 512, 1024, 2048, 4096].map(v => `<option value="${v}" ${s.maxTokens === v ? 'selected' : ''}>${v} tokens (~${Math.round(v / 1.3)} words)</option>`).join('')}
        </select>
        <div class="hint">Maximum length of AI responses. Higher values consume more tokens.</div>
      </div>
      <div style="display:flex;gap:10px">
        <button type="submit" class="btn btn-green">Save Settings</button>
        <a href="/ai" class="btn">Back to Chat</a>
      </div>
    </form>
  </div>
  <div class="card" style="margin-top:16px;padding:20px">
    <h4>🔧 API Status</h4>
    <table style="width:100%;margin-top:10px">
      <tr><td style="padding:6px 0;color:#6b7280">SDK Status</td><td style="text-align:right"><span class="badge" style="background:${ZAI ? '#d1fae5;color:#065f46' : '#fef3c7;color:#92400e'}">${ZAI ? '✅ Connected' : '⚠️ Fallback Mode'}</span></td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Current Model</td><td style="text-align:right;font-weight:600">${esc(s.model)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Temperature</td><td style="text-align:right">${s.temperature}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Max Tokens</td><td style="text-align:right">${s.maxTokens}</td></tr>
    </table>
  </div>
</div>`, req.user, req));
  }));

  /* ════════════════════════════════════════════
     ROUTE 11 — POST /ai/settings/save
     ════════════════════════════════════════════ */
  app.post('/ai/settings/save', requireAuth, ah(async (req, res) => {
    const { model, temperature, maxTokens } = req.body;
    await pool.query(
      `UPDATE tenants SET ai_model=$1,ai_temperature=$2,ai_max_tokens=$3 WHERE id=$4`,
      [model || 'gpt-4', parseFloat(temperature) || 0.7, parseInt(maxTokens) || 2048, req.tenantId]);
    res.redirect('/ai/settings');
  }));

  /* ════════════════════════════════════════════
     ROUTE 12 — GET /ai/report  (Analytics)
     ════════════════════════════════════════════ */
  app.get('/ai/report', requireAuth, ah(async (req, res) => {
    const tid = req.tenantId;
    const totalConvos = (await pool.query(`SELECT COUNT(*)::int AS n FROM ai_conversations WHERE tenant_id=$1`, [tid])).rows[0].n;
    const totalMsgs = (await pool.query(`SELECT COUNT(*)::int AS n FROM ai_messages WHERE tenant_id=$1`, [tid])).rows[0].n;
    const totalTokens = (await pool.query(`SELECT COALESCE(SUM(tokens_used),0)::int AS n FROM ai_messages WHERE tenant_id=$1`, [tid])).rows[0].n;
    const activeToday = (await pool.query(
      `SELECT COUNT(DISTINCT conversation_id)::int AS n FROM ai_messages WHERE tenant_id=$1 AND created_at >= CURRENT_DATE`, [tid])).rows[0].n;
    const avgMsgs = totalConvos ? Math.round(totalMsgs / totalConvos) : 0;
    const topPrompts = (await pool.query(
      `SELECT name,category,usage_count FROM ai_prompts WHERE tenant_id=$1 ORDER BY usage_count DESC LIMIT 8`, [tid])).rows;
    const recentConvos = (await pool.query(
      `SELECT c.title,c.model,c.created_at,COUNT(m.id) AS msg_count FROM ai_conversations c
       LEFT JOIN ai_messages m ON m.conversation_id=c.id WHERE c.tenant_id=$1
       GROUP BY c.id ORDER BY c.created_at DESC LIMIT 10`, [tid])).rows;
    const dailyUsage = (await pool.query(
      `SELECT DATE(created_at) AS day,COUNT(*)::int AS messages,SUM(tokens_used)::int AS tokens
       FROM ai_messages WHERE tenant_id=$1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(created_at) ORDER BY day`, [tid])).rows;

    res.send(renderPage('AI Analytics', `
<style>
  .report{max-width:1000px;margin:0 auto}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:20px 0}
  .stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center}
  .stat-num{font-size:32px;font-weight:700;color:#3b82f6;margin:4px 0}
  .stat-label{font-size:13px;color:#6b7280}
  .report-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}
  .report-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px}
  .report-card h3{margin:0 0 12px;font-size:16px;color:#1f2937}
  .mini-bar{display:flex;align-items:center;gap:8px;margin:6px 0}
  .mini-bar .label{width:120px;font-size:13px;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mini-bar .bar{flex:1;height:20px;background:#e5e7eb;border-radius:4px;overflow:hidden}
  .mini-bar .bar-fill{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:4px;transition:.5s}
  .mini-bar .count{font-size:12px;color:#9ca3af;min-width:30px;text-align:right}
</style>
<div class="report">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h2>📊 AI Usage Analytics</h2>
    <div style="display:flex;gap:8px">
      <a href="/ai" class="btn btn-blue">💬 Chat</a>
      <a href="/ai/prompts" class="btn">📋 Prompts</a>
    </div>
  </div>
  <p class="muted">Track AI usage across your organization.</p>
  <div class="stats">
    <div class="stat-card"><div class="stat-label">Total Conversations</div><div class="stat-num">${totalConvos}</div></div>
    <div class="stat-card"><div class="stat-label">Total Messages</div><div class="stat-num">${totalMsgs}</div></div>
    <div class="stat-card"><div class="stat-label">Tokens Used</div><div class="stat-num">${totalTokens.toLocaleString()}</div></div>
    <div class="stat-card"><div class="stat-label">Active Today</div><div class="stat-num">${activeToday}</div></div>
    <div class="stat-card"><div class="stat-label">Avg Msgs/Convo</div><div class="stat-num">${avgMsgs}</div></div>
  </div>
  <div class="report-grid">
    <div class="report-card">
      <h3>🔥 Popular Prompts</h3>
      ${topPrompts.length ? topPrompts.map(p => {
        const maxU = topPrompts[0].usage_count || 1;
        const pct = Math.round((p.usage_count / maxU) * 100);
        return `<div class="mini-bar"><div class="label" title="${esc(p.name)}">${esc(p.name)}</div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="count">${p.usage_count}</div></div>`;
      }).join('') : '<p class="muted">No prompt usage data yet.</p>'}
    </div>
    <div class="report-card">
      <h3>📝 Recent Conversations</h3>
      ${recentConvos.length ? `<table style="width:100%;font-size:13px">
        <tr style="color:#9ca3af;border-bottom:1px solid #e5e7eb"><th style="text-align:left;padding:6px 0">Title</th><th>Msgs</th><th>Model</th><th>Date</th></tr>
        ${recentConvos.map(c => `<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:6px 0">${esc(c.title || 'Untitled')}</td>
          <td style="text-align:center">${c.msg_count}</td>
          <td style="text-align:center"><span class="badge" style="background:#eff6ff;color:#1d4ed8">${esc(c.model)}</span></td>
          <td style="text-align:right;color:#9ca3af">${new Date(c.created_at).toLocaleDateString()}</td>
        </tr>`).join('')}
      </table>` : '<p class="muted">No conversations yet.</p>'}
    </div>
  </div>
  ${dailyUsage.length ? `<div class="report-card" style="margin-top:16px">
    <h3>📈 Daily Usage (Last 30 Days)</h3>
    <div style="display:flex;align-items:flex-end;gap:4px;height:120px;margin-top:12px;padding:0 4px">
      ${dailyUsage.map(d => {
        const maxM = Math.max(...dailyUsage.map(x => x.messages)) || 1;
        const h = Math.max(4, Math.round((d.messages / maxM) * 100));
        return `<div title="${d.day}: ${d.messages} msgs, ${d.tokens || 0} tokens" style="flex:1;height:${h}%;background:linear-gradient(180deg,#3b82f6,#93c5fd);border-radius:4px 4px 0 0;min-width:4px;transition:.3s;cursor:pointer"></div>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;margin-top:4px">
      <span>${dailyUsage[0]?.day || ''}</span><span>${dailyUsage[dailyUsage.length - 1]?.day || ''}</span>
    </div>
  </div>` : ''}
</div>`, req.user, req));
  }));

  /* ════════════════════════════════════════════
     ROUTE 13 — GET /api/ai/suggestions
     ════════════════════════════════════════════ */
  app.get('/api/ai/suggestions', requireAuth, ah(async (req, res) => {
    const { page, context } = req.query;
    const suggestions = {
      dashboard: [
        { text: 'Summarize my recent activity', icon: '📊', category: 'analysis' },
        { text: 'What should I focus on today?', icon: '🎯', category: 'planning' },
        { text: 'Generate a weekly status report', icon: '📝', category: 'writing' },
        { text: 'Identify trends in my data', icon: '📈', category: 'analysis' },
      ],
      messages: [
        { text: 'Draft a follow-up email', icon: '✉️', category: 'writing' },
        { text: 'Summarize this conversation', icon: '📋', category: 'analysis' },
        { text: 'Write a professional reply', icon: '💬', category: 'writing' },
      ],
      reports: [
        { text: 'Analyze this report data', icon: '📊', category: 'analysis' },
        { text: 'Create executive summary', icon: '📝', category: 'writing' },
        { text: 'Compare with previous period', icon: '📈', category: 'analysis' },
      ],
      general: [
        { text: 'Help me write an email', icon: '✉️', category: 'writing' },
        { text: 'Summarize a document', icon: '📋', category: 'analysis' },
        { text: 'Create a meeting agenda', icon: '📅', category: 'business' },
        { text: 'Generate social media content', icon: '📱', category: 'marketing' },
        { text: 'Help with data analysis', icon: '📊', category: 'analysis' },
        { text: 'Create a lesson plan', icon: '🎓', category: 'education' },
      ],
    };
    const pageKey = (page || 'general').toLowerCase().replace(/[^a-z]/g, '');
    let results = suggestions[pageKey] || suggestions.general;
    if (context) {
      results = [
        { text: `Help me with: ${context}`, icon: '💡', category: 'general' },
        { text: `Explain: ${context}`, icon: '📖', category: 'analysis' },
        { text: `Improve: ${context}`, icon: '✨', category: 'writing' },
        ...results.slice(0, 2),
      ];
    }
    res.json({ suggestions: results, page: page || 'general', timestamp: new Date().toISOString() });
  }));

  /* ────────────── INIT ────────────── */
  migrate().then(() => console.log('[AI] Migrations complete')).catch(e => console.error('[AI] Migration error:', e));
  console.log('[AI] AI assistant loaded');
};
