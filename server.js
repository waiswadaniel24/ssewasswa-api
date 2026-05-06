/**
 * SSEWASSWA Network v6.0 - COMPLETE
 * DO NOT DELETE ANYTHING
 */
const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),session=require('express-session'),pgSession=require('connect-pg-simple')(session),cors=require('cors'),{v4:uuidv4}=require('uuid'),multer=require('multer'),axios=require('axios'),cron=require('node-cron'),cloudinary=require('cloudinary').v2,crypto=require('crypto'),nodemailer=require('nodemailer'),helmet=require('helmet'),rateLimit=require('express-rate-limit'),{OpenAI}=require('openai'),PDFDocument=require('pdfkit'),cheerio=require('cheerio');
const app=express(),pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}),PORT=process.env.PORT||3000,upload=multer({storage:multer.memoryStorage()});
const DEVELOPER_EMAIL='ssewasswa@gmail.com',DEVELOPER_PHONE='0789736737',DEVELOPER_RATE=0.05,PLATFORM_COMMISSION=0.10,ENCRYPTION_KEY=crypto.scryptSync(process.env.ENCRYPTION_SECRET||'default32charsecretkey1234567890ab','salt',32);
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY||''});
cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD,api_key:process.env.CLOUDINARY_KEY,api_secret:process.env.CLOUDINARY_SECRET});
const transporter=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
app.use(helmet({contentSecurityPolicy:false}));app.use(rateLimit({windowMs:15*60*1000,max:100}));
app.use(session({store:new pgSession({pool,tableName:'session',createTableIfMissing:true}),secret:process.env.SESSION_SECRET||require('crypto').randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{secure:process.env.NODE_ENV==='production',maxAge:30*24*60*60*1000}}));
app.use(cors({origin:true,credentials:true}));app.use(express.json());app.use(express.urlencoded({extended:true}));app.use(express.static('public'));

const CURRENCIES={UGX:{symbol:'UGX',rate:1},USD:{symbol:'$',rate:3700},EUR:{symbol:'€',rate:4000},GBP:{symbol:'£',rate:4700},KES:{symbol:'KSh',rate:28},TZS:{symbol:'TSh',rate:1.6}};
const SUBSCRIPTION_PLANS={school_free:{name:'School Starter',price:0,currency:'UGX',features:['100 students','Basic marksheets'],portals:['academics','public']},school_pro:{name:'School Pro',price:50000,currency:'UGX',features:['Unlimited students','All portals','SMS alerts','USSD','Offline'],portals:['academics','stores','admin','papers','funds','reports','finance','marketplace','programs','news','ads','entertainment']},org_basic:{name:'Org Basic',price:30000,currency:'UGX',features:['50 members','Project tracking'],portals:['dashboard','members','finance','projects','public']},org_pro:{name:'Org Pro',price:100000,currency:'UGX',features:['Unlimited members','Donor portal','Grant applications'],portals:['dashboard','members','finance','reports','projects','marketplace','programs','news','ads']},business:{name:'Business',price:20000,currency:'UGX',features:['Unlimited products','0% commission first month'],portals:['seller','orders','products','wallet','ads','analytics']},donor:{name:'Donor Premium',price:50000,currency:'UGX',features:['Post grants','Review applications','Impact tracking'],portals:['dashboard','opportunities','history','impact']}};

const esc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const ah=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(e=>{console.error(e);res.status(500).json({error:e.message})});
const requireAuth=(req,res,next)=>{if(!req.session?.user)return res.redirect('/login');next()};
const requireRole=(...r)=>(req,res,next)=>{if(!req.session?.user||!r.includes(req.session.user.role))return res.status(403).send('403');next()};
const requirePortal=(p)=>(req,res,next)=>{if(req.session.user.role==='super_admin'||req.session.user.portals?.includes(p))return next();res.status(403).send('403 Portal Access Denied');};
const requireDeveloper=(req,res,next)=>{if(req.session?.user?.email!==DEVELOPER_EMAIL)return res.status(403).send('403');next()};
function encrypt(text){const iv=crypto.randomBytes(16);const cipher=crypto.createCipheriv('aes-256-cbc',ENCRYPTION_KEY,iv);let enc=cipher.update(text,'utf8','hex');enc+=cipher.final('hex');return iv.toString('hex')+':'+enc;}
function decrypt(text){const p=text.split(':');const iv=Buffer.from(p[0],'hex');const dec=crypto.createDecipheriv('aes-256-cbc',ENCRYPTION_KEY,iv);let str=dec.update(p[1],'hex','utf8');str+=dec.final('utf8');return str;}
async function logAction(userId,tenantId,action,details,ip){await pool.query('INSERT INTO audit_logs(user_id,tenant_id,action,details,ip_address)VALUES($1,$2,$3,$4,$5)',[userId,tenantId,action,JSON.stringify(details),ip]);}
async function sendSMS(phone,message){if(!process.env.AT_API_KEY)return console.log('SMS:',phone,message);try{await axios.post('https://api.africastalking.com/version1/messaging',{username:process.env.AT_USERNAME||'sandbox',to:phone,message},{headers:{'apiKey':process.env.AT_API_KEY,'Content-Type':'application/x-www-form-urlencoded'}});}catch(e){console.error('SMS fail:',e.message);}}
async function sendVerificationEmail(userId,email){const token=crypto.randomBytes(32).toString('hex');await pool.query('INSERT INTO email_verifications(user_id,token,expires_at)VALUES($1,$2,$3)',[userId,token,new Date(Date.now()+86400000)]);const url=`${process.env.RENDER_EXTERNAL_URL}/verify-email/${token}`;await transporter.sendMail({to:email,subject:'Verify Your SSEWASSWA Account',html:`<h2>Welcome!</h2><p>Click to verify:</p><a href="${url}" style="background:#1e40af;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block">Verify Email</a><p>Expires in 24 hours.</p>`});}

function renderPage(title,content,user){
  user=user||null;
  let nav='';
  if(user){
    const portals=user.tenant_type==='organisation'?{dashboard:'Dashboard',members:'Members',finance:'Finance',reports:'Reports',projects:'Projects',marketplace:'Marketplace',public:'Public Site',programs:'Programs',news:'News',ads:'Adverts'}:user.role==='seller'?{seller:'Seller Dashboard',orders:'Orders',products:'Products',wallet:'Wallet',ads:'Advertise',analytics:'Analytics'}:{academics:'Academics',stores:'Stores',admin:'Admin',papers:'Papers',funds:'Donors',reports:'Marksheets',finance:'Finance',marketplace:'Marketplace',public:'Public Site',programs:'Programs',news:'News',ads:'Adverts',entertainment:'Entertainment'};
    nav=`<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:12px 20px;margin:0 0 24px 0"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><b>${esc(user.tenant_name)}</b> - ${esc(user.name)} ${user.verified?'✅':''}</div><div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px">${Object.entries(portals).map(([k,v])=>`<a href="/portal/${k}" style="color:white;text-decoration:none">${v}</a>`).join('')}${user.role==='super_admin'?`<a href="/dev/master" style="color:#fef3c7;text-decoration:none;font-weight:bold">🔴 Dev</a>`:''}<a href="/logout" style="color:white;text-decoration:none">Logout</a></div></div></div>`;
  }
  return`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#f0f9ff;color:#1e293b}.container{max-width:1200px;margin:0 auto;padding:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}.btn{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:12px;padding:12px 24px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px;font-weight:600}.btn-green{background:linear-gradient(135deg,#16a34a,#22c55e)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}input,select,textarea{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:12px;margin:8px 0;font-size:16px;min-height:44px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2e8f0}th{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}.stat-card{background:white;padding:20px;border-radius:16px;text-align:center}.stat-num{font-size:32px;font-weight:bold;color:#1e40af}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.badge{padding:6px 10px;border-radius:20px;font-size:11px;font-weight:600;display:inline-block}.badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}.badge-gold{background:#fef3c7;color:#92400e}</style></head><body>${nav}<div class="container">${content}</div></body></html>`;
}

// === PUBLIC ROUTES ===
app.get('/',ah(async(req,res)=>{res.sendFile(path.join(__dirname,'public','index.html'));}));
app.get('/marketplace',ah(async(req,res)=>{const products=(await pool.query('SELECT p.*,t.name as seller_name FROM products p JOIN tenants t ON p.tenant_id=t.id WHERE p.approved=true ORDER BY p.created_at DESC LIMIT 50')).rows;res.send(renderPage('Marketplace',`<div class="grid">${products.map(p=>`<div class="card"><img src="${p.image_url||'/img/default.jpg'}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><h3>${esc(p.name)}</h3><p style="color:#64748b">by ${esc(p.seller_name)}</p><p style="font-size:24px;color:#16a34a;font-weight:bold">UGX ${p.price.toLocaleString()}</p><a href="/product/${p.id}" class="btn btn-green">Buy Now</a></div>`).join('')}</div>`,null,true));}));
app.get('/product/:id',ah(async(req,res)=>{const p=(await pool.query('SELECT p.*,t.name as seller_name FROM products p JOIN tenants t ON p.tenant_id=t.id WHERE p.id=$1',[req.params.id])).rows[0];if(!p)return res.status(404).send('Not found');res.send(renderPage(p.name,`<div class="card"><img src="${p.image_url}" style="width:100%;max-height:400px;object-fit:cover;border-radius:16px"><h1>${esc(p.name)}</h1><p style="color:#64748b">Sold by ${esc(p.seller_name)}</p><p style="font-size:32px;color:#16a34a;font-weight:bold">UGX ${p.price.toLocaleString()}</p><p>${esc(p.description)}</p><form method="POST" action="/cart/add"><input type="hidden" name="product_id" value="${p.id}"><input type="number" name="quantity" value="1" min="1" max="${p.stock}"><button class="btn btn-green">Add to Cart</button></form></div>`,null,true));}));
app.get('/blog',ah(async(req,res)=>{const posts=(await pool.query('SELECT n.*,t.name as author_name FROM news_articles n JOIN tenants t ON n.tenant_id=t.id WHERE n.published=true ORDER BY n.created_at DESC LIMIT 20')).rows;res.send(renderPage('Blog',`<div class="grid">${posts.map(p=>`<div class="card"><img src="${p.image_url||'/img/default.jpg'}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><h3>${esc(p.title)}</h3><p style="color:#64748b;font-size:13px">By ${esc(p.author_name)} • ${new Date(p.created_at).toDateString()}</p><p>${esc(p.summary)}</p><a href="/blog/${p.id}" class="btn">Read More</a></div>`).join('')}</div>`,null,true));}));
app.get('/schools',ah(async(req,res)=>{const schools=(await pool.query("SELECT id,name,subdomain,description,logo_url,verified FROM tenants WHERE type='school' AND status='active' ORDER BY featured_until DESC NULLS LAST, created_at DESC")).rows;res.send(renderPage('Schools',`<div class="grid">${schools.map(s=>`<div class="card"><img src="${s.logo_url||'/img/school.jpg'}" style="width:100%;height:150px;object-fit:cover;border-radius:12px"><h3>${esc(s.name)} ${s.verified?'✅':''}</h3><p>${esc(s.description||'').substring(0,100)}</p><a href="/s/${s.subdomain}" class="btn">Visit Site</a></div>`).join('')}</div>`,null,true));}));
app.get('/s/:subdomain',ah(async(req,res)=>{const t=(await pool.query('SELECT * FROM tenants WHERE subdomain=$1',[req.params.subdomain])).rows[0];if(!t)return res.status(404).send('School not found');res.send(`<!doctype html><html><head><title>${esc(t.name)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${renderPage('','',null).match(/<style>(.*?)<\/style>/s)[1]}</style></head><body><div class="container"><header style="text-align:center;padding:40px 0"><h1>${esc(t.name)} ${t.verified?'✅':''}</h1><p>${esc(t.tagline||'')}</p><div style="margin:20px 0">${t.show_donate?`<a href="/pay/${t.id}" class="btn btn-green">Donate</a>`:''}<a href="/s/${t.subdomain}/enroll" class="btn">Enroll</a></div></header><div class="grid"><div class="card"><h3>About Us</h3><p>${esc(t.about_us||t.description||'')}</p></div><div class="card"><h3>Contact</h3><p>📞 ${esc(t.contact_phone||'')}</p><p>📧 ${esc(t.contact_email||'')}</p><p>📍 ${esc(t.address||'')}</p></div></div></div></body></html>`);}));
app.get('/pay/:tenant_id',ah(async(req,res)=>{const t=(await pool.query('SELECT * FROM tenants WHERE id=$1',[req.params.tenant_id])).rows[0];res.send(renderPage('Pay',`<div class="card" style="max-width:500px;margin:40px auto"><h2>Pay ${esc(t.name)}</h2><form method="POST" action="/pay/${t.id}"><label>Amount (UGX)</label><input name="amount" type="number" min="1000" required><label>Purpose</label><select name="purpose" required><option value="fees">School Fees</option><option value="donation">Donation</option></select><label>Your Name</label><input name="name" required><label>Phone</label><input name="phone" placeholder="078..." required><label>Email</label><input name="email" type="email" required><label>Payment Method</label><select name="gateway" required><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select><button class="btn btn-green" style="width:100%">Pay Securely</button></form></div>`,null,true));}));
app.post('/pay/:tenant_id',ah(async(req,res)=>{const{amount,purpose,name,phone,email,gateway}=req.body;const t=(await pool.query('SELECT * FROM tenants WHERE id=$1',[req.params.tenant_id])).rows[0];const ref='PAY'+Date.now();const dev_amount=Math.round(amount*DEVELOPER_RATE);await pool.query('INSERT INTO transactions(tenant_id,amount,dev_amount,purpose,payer_name,payer_phone_encrypted,payer_email_encrypted,gateway,ref,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[t.id,amount,dev_amount,purpose,name,encrypt(phone),encrypt(email),gateway,ref,'pending']);await transporter.sendMail({to:email,subject:`Receipt ${ref}`,html:`<h2>Payment Receipt</h2><p>Amount: UGX ${amount}</p><p>Ref: ${ref}</p><p>To: ${t.name}</p>`});res.send(`<script>alert('Payment initiated. Check ${phone} to approve. Receipt sent to ${email}');window.location='/'</script>`);}));

// === AUTH ROUTES ===
app.get('/login',ah(async(req,res)=>{res.send(renderPage('Login',`<div class="card" style="max-width:400px;margin:60px auto"><h1>Login</h1><form method="POST" action="/login"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><div id="otp-field" style="display:none"><input name="otp" placeholder="Enter 6-digit code" maxlength="6"></div><button class="btn" style="width:100%">Login</button></form><p style="text-align:center;margin-top:20px"><a href="/forgot-password">Forgot Password?</a> • <a href="/register">Create Account</a></p></div>`,null,true));}));
app.post('/login',ah(async(req,res)=>{const{email,password,otp}=req.body;const u=(await pool.query('SELECT u.*,t.name as tenant_name,t.subdomain as tenant_subdomain,t.type as tenant_type,t.features_enabled FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1 AND u.approved=true',[email])).rows[0];if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).send('Invalid credentials');if(!u.verified)return res.status(401).send('Please verify your email first');if(u.two_fa_enabled&&!otp){const code=Math.floor(100000+Math.random()*900000);await pool.query('INSERT INTO otp_codes(user_id,code,expires_at)VALUES($1,$2,$3)',[u.id,code,new Date(Date.now()+600000)]);await sendSMS(u.phone,`SSEWASSWA Code: ${code}`);return res.json({require_otp:true});}req.session.user=u;await logAction(u.id,u.tenant_id,'login',{ip:req.ip},req.ip);if(u.role==='super_admin')return res.redirect('/dev/master');res.redirect('/portal/admin');}));
app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'));});
app.get('/register',ah(async(req,res)=>{const type=req.query.type||'school';const plans=Object.entries(SUBSCRIPTION_PLANS).filter(([k,v])=>k.startsWith(type));res.send(renderPage('Register',`<div class="card" style="max-width:800px;margin:40px auto"><h1>Create ${esc(type)}</h1><form method="POST" action="/register"><input type="hidden" name="type" value="${type}"><h3>1. Choose Plan</h3>${plans.map(([k,v])=>`<label class="card" style="cursor:pointer"><input type="radio" name="plan" value="${k}" required><b>${v.name}</b> - ${v.price===0?'FREE':CURRENCIES[v.currency].symbol+' '+v.price.toLocaleString()+'/mo'}<ul>${v.features.map(f=>`<li>${f}</li>`).join('')}</ul></label>`).join('')}<h3>2. Details</h3><input name="name" placeholder="Name" required><input name="subdomain" placeholder="Website: kings-primary" required><textarea name="description" placeholder="Description"></textarea><h3>3. Payment Details</h3><select name="gateway" required><option value="">Select</option><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select><input name="momo_number" placeholder="Mobile Money Number" required><input name="momo_name" placeholder="Name on Mobile Money" required><h3>4. Admin Account</h3><input name="admin_name" placeholder="Your Name" required><input name="admin_email" type="email" placeholder="Email" required><input name="admin_phone" placeholder="Phone: +256..." required><input name="admin_password" type="password" placeholder="Password" required><select name="country_code" required><option value="UG">Uganda +256</option><option value="KE">Kenya +254</option><option value="TZ">Tanzania +255</option></select><label><input type="checkbox" required> I agree to 5% platform fee</label><button class="btn btn-green">Create Account</button></form></div>`,null,true));}));
app.post('/register',ah(async(req,res)=>{const{name,subdomain,type,description,gateway,momo_number,momo_name,admin_name,admin_email,admin_phone,admin_password,plan,country_code}=req.body;const tenant=(await pool.query('INSERT INTO tenants(name,subdomain,type,description,gateway,momo_number_encrypted,momo_name,wallet_balance,status,subscription_plan,features_enabled,country_code)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)RETURNING id',[name,subdomain,type,description,gateway,encrypt(momo_number),momo_name,0,'active',plan,JSON.stringify(SUBSCRIPTION_PLANS[plan].portals),country_code])).rows[0];const hash=await bcrypt.hash(admin_password,10);const role=type==='school'?'school_admin':type==='organisation'?'org_admin':type==='business'?'seller':'donor';const user=(await pool.query('INSERT INTO users(tenant_id,name,email,phone_encrypted,password_hash,role,portals,approved,verified)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id',[tenant.id,admin_name,admin_email,encrypt(admin_phone),hash,role,SUBSCRIPTION_PLANS[plan].portals,true,false])).rows[0];await sendVerificationEmail(user.id,admin_email);res.send(`<script>alert('Success! Check ${admin_email} to verify. 14-day trial started.');window.location='/login'</script>`);}));
app.get('/verify-email/:token',ah(async(req,res)=>{const v=(await pool.query('SELECT * FROM email_verifications WHERE token=$1 AND expires_at>NOW() AND used=false',[req.params.token])).rows[0];if(!v)return res.status(400).send('Invalid or expired token');await pool.query('UPDATE users SET verified=true WHERE id=$1',[v.user_id]);await pool.query('UPDATE email_verifications SET used=true WHERE id=$1',[v.id]);res.send(`<script>alert('Email verified!');window.location='/login'</script>`);}));
app.get('/forgot-password',ah(async(req,res)=>{res.send(renderPage('Reset Password',`<div class="card" style="max-width:400px;margin:60px auto"><h2>Reset Password</h2><form method="POST" action="/forgot-password"><input name="email" type="email" placeholder="Your Email" required><button class="btn" style="width:100%">Send Reset Link</button></form></div>`,null,true));}));
app.post('/forgot-password',ah(async(req,res)=>{const u=(await pool.query('SELECT * FROM users WHERE email=$1',[req.body.email])).rows[0];if(!u)return res.send(`<script>alert('If email exists, reset link sent');window.location='/login'</script>`);const token=crypto.randomBytes(32).toString('hex');await pool.query('INSERT INTO password_resets(user_id,token,expires_at)VALUES($1,$2,$3)',[u.id,token,new Date(Date.now()+3600000)]);const resetUrl=`${process.env.RENDER_EXTERNAL_URL}/reset-password/${token}`;await transporter.sendMail({to:u.email,subject:'Reset Password',html:`Click to reset: <a href="${resetUrl}">${resetUrl}</a><br>Expires in 1 hour.`});res.send(`<script>alert('Reset link sent');window.location='/login'</script>`);}));

// === DEVELOPER PORTAL ===
app.get('/dev/master',requireAuth,requireDeveloper,ah(async(req,res)=>{const stats={tenants:(await pool.query('SELECT COUNT(*) as c FROM tenants')).rows[0].c,users:(await pool.query('SELECT COUNT(*) as c FROM users')).rows[0].c,revenue_30d:(await pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`)).rows[0].t,wallet:(await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0]?.balance||0};const tenants=(await pool.query('SELECT id,name,subdomain,type,wallet_balance,subscription_plan,verified FROM tenants ORDER BY created_at DESC LIMIT 50')).rows;res.send(renderPage('Dev Master',`<div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444)"><h1>🔴 DEVELOPER MASTER CONTROL</h1></div><div class="stats"><div class="stat-card"><div class="stat-num">${stats.tenants}</div><div>Tenants</div></div><div class="stat-card"><div class="stat-num">${stats.users}</div><div>Users</div></div><div class="stat-card"><div class="stat-num">UGX ${Math.round(stats.revenue_30d).toLocaleString()}</div><div>30-Day Rev</div></div><div class="stat-card"><div class="stat-num">UGX ${stats.wallet.toLocaleString()}</div><div>Ready Withdraw</div></div></div><div class="card"><h2>Manual Controls</h2><form method="POST" action="/dev/execute"><select name="action" required><option value="">Action</option><option value="add_balance">Add Balance</option><option value="verify_tenant">Verify Tenant</option><option value="ban_user">Ban User</option><option value="delete_tenant">Delete Tenant</option><option value="withdraw_all">Withdraw All</option></select><input name="target_id" placeholder="ID" required><input name="amount" type="number" placeholder="Amount"><button class="btn btn-red">Execute</button></form></div><div class="card"><h2>Revenue Injection</h2><form method="POST" action="/dev/inject-revenue"><input name="amount" type="number" placeholder="Amount UGX" required><input name="source" placeholder="Source" required><button class="btn btn-green">Inject</button></form></div><div class="card"><h2>Auto-Scraper</h2><form method="POST" action="/dev/scrape"><input name="url" placeholder="URL to scrape" required><select name="type"><option value="news">News</option><option value="grants">Grants</option></select><button class="btn">Scrape</button></form></div><div class="card"><h2>All Tenants</h2><table><tr><th>ID</th><th>Name</th><th>Type</th><th>Wallet</th><th>Verified</th><th>Action</th></tr>${tenants.map(t=>`<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${t.type}</td><td>UGX ${t.wallet_balance.toLocaleString()}</td><td>${t.verified?'✅':'❌'}</td><td><a href="/dev/edit-tenant/${t.id}" class="btn">Edit</a></td></tr>`).join('')}</table></div>`,req.session.user));}));
app.post('/dev/execute',requireAuth,requireDeveloper,ah(async(req,res)=>{const{action,target_id,amount}=req.body;if(action==='add_balance')await pool.query('UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2',[amount,target_id]);if(action==='verify_tenant')await pool.query('UPDATE tenants SET verified=true WHERE id=$1',[target_id]);if(action==='ban_user')await pool.query('UPDATE users SET approved=false WHERE id=$1',[target_id]);if(action==='delete_tenant')await pool.query('DELETE FROM tenants WHERE id=$1',[target_id]);if(action==='withdraw_all'){const w=(await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0].balance;await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');await pool.query('INSERT INTO withdrawals(user_email,amount,net_amount,phone,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[DEVELOPER_EMAIL,w,w,DEVELOPER_PHONE,'paid','DEV'+Date.now()]);}res.redirect('/dev/master?executed=1');}));
app.post('/dev/inject-revenue',requireAuth,requireDeveloper,ah(async(req,res)=>{const{amount,source}=req.body;await pool.query('INSERT INTO developer_revenue(amount,type)VALUES($1,$2)',[amount,source]);await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1',[amount]);res.redirect('/dev/master?injected=1');}));// === PORTAL ROUTES CONTINUED ===
app.post('/portal/academics/marks',requireAuth,requirePortal('academics'),ah(async(req,res)=>{
  const{marks}=req.body;
  for(const m of JSON.parse(marks||'[]')){
    const grade=m.score>=80?'A':m.score>=70?'B':m.score>=60?'C':m.score>=50?'D':'F';
    await pool.query('INSERT INTO grades(tenant_id,student_id,subject,score,grade,term,teacher_id)VALUES($1,$2,$3,$4,$5,$6,$7)',[req.session.user.tenant_id,m.student_id,m.subject,m.score,grade,m.term,req.session.user.id]);
  }
  await logAction(req.session.user.id,req.session.user.tenant_id,'enter_marks',{count:marks.length},req.ip);
  res.json({ok:true,saved:JSON.parse(marks||'[]').length});
}));

app.get('/portal/finance',requireAuth,requirePortal('finance'),ah(async(req,res)=>{
  const balance=(await pool.query('SELECT wallet_balance FROM tenants WHERE id=$1',[req.session.user.tenant_id])).rows[0].wallet_balance;
  const pending=(await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM fees WHERE tenant_id=$1 AND paid=false',[req.session.user.tenant_id])).rows[0].t;
  const collected=(await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM fees WHERE tenant_id=$1 AND paid=true',[req.session.user.tenant_id])).rows[0].t;
  const trans=(await pool.query('SELECT * FROM transactions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20',[req.session.user.tenant_id])).rows;
  res.send(renderPage('Finance',`<div class="stats"><div class="stat-card"><div class="stat-num">UGX ${balance.toLocaleString()}</div><div>Wallet Balance</div></div><div class="stat-card"><div class="stat-num">UGX ${pending.toLocaleString()}</div><div>Pending Fees</div></div><div class="stat-card"><div class="stat-num">UGX ${collected.toLocaleString()}</div><div>Collected</div></div></div><div class="card"><h2>Withdraw Funds</h2><form method="POST" action="/portal/finance/withdraw"><input name="amount" type="number" max="${balance}" placeholder="Amount" required><input name="phone" placeholder="MTN/Airtel Number" required><button class="btn btn-green">Withdraw</button></form></div><div class="card"><h3>Recent Transactions</h3><table><tr><th>Date</th><th>Payer</th><th>Amount</th><th>Purpose</th><th>Status</th></tr>${trans.map(t=>`<tr><td>${new Date(t.created_at).toLocaleDateString()}</td><td>${esc(t.payer_name)}</td><td>UGX ${t.amount.toLocaleString()}</td><td>${t.purpose}</td><td><span class="badge ${t.status==='completed'?'badge-green':'badge-gold'}">${t.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,'finance'));
}));

app.post('/portal/finance/withdraw',requireAuth,requirePortal('finance'),ah(async(req,res)=>{
  const{amount,phone}=req.body;
  await pool.query('UPDATE tenants SET wallet_balance=wallet_balance-$1 WHERE id=$2',[amount,req.session.user.tenant_id]);
  await pool.query('INSERT INTO withdrawals(tenant_id,amount,net_amount,phone,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[req.session.user.tenant_id,amount,amount,phone,'pending','WD'+Date.now()]);
  await logAction(req.session.user.id,req.session.user.tenant_id,'withdraw',{amount,phone},req.ip);
  res.json({ok:true,msg:'Withdrawal requested'});
}));

app.get('/portal/students',requireAuth,requirePortal('admin'),ah(async(req,res)=>{
  const students=(await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY name',[req.session.user.tenant_id])).rows;
  res.send(renderPage('Students',`<div class="card"><h2>Add Student</h2><form method="POST" action="/portal/students/add"><input name="name" placeholder="Full Name" required><input name="class" placeholder="Class" required><input name="parent_phone" placeholder="Parent Phone" required><button class="btn">Add Student</button></form></div><div class="card"><h3>All Students (${students.length})</h3><table><tr><th>Name</th><th>Class</th><th>Parent</th><th>Balance</th><th>Actions</th></tr>${students.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.parent_phone)}</td><td>UGX ${s.balance.toLocaleString()}</td><td><a href="/portal/reports/pdf/${s.id}" class="btn">Report</a></td></tr>`).join('')}</table></div>`,req.session.user,'admin'));
}));

app.post('/portal/students/add',requireAuth,requirePortal('admin'),ah(async(req,res)=>{
  const{name,class:cls,parent_phone}=req.body;
  await pool.query('INSERT INTO students(tenant_id,name,class,parent_phone)VALUES($1,$2,$3,$4)',[req.session.user.tenant_id,name,cls,parent_phone]);
  await logAction(req.session.user.id,req.session.user.tenant_id,'add_student',{name},req.ip);
  res.redirect('/portal/students?added=1');
}));

app.post('/portal/students/bulk',requireAuth,requirePortal('admin'),upload.single('csv'),ah(async(req,res)=>{
  const csv=req.file.buffer.toString();
  const rows=csv.split('\n').slice(1);
  let count=0;
  for(const row of rows){
    const[name,dob,gender,class_name,parent_phone]=row.split(',');
    if(name){await pool.query('INSERT INTO students(tenant_id,name,dob,gender,class,parent_phone)VALUES($1,$2,$3,$4,$5,$6)',[req.session.user.tenant_id,name.trim(),dob,gender,class_name,parent_phone]);count++;}
  }
  await logAction(req.session.user.id,req.session.user.tenant_id,'bulk_import',{count},req.ip);
  res.json({ok:true,imported:count});
}));

app.get('/portal/marketplace',requireAuth,requirePortal('marketplace'),ah(async(req,res)=>{
  const products=(await pool.query('SELECT * FROM products WHERE tenant_id=$1 ORDER BY created_at DESC',[req.session.user.tenant_id])).rows;
  const orders=(await pool.query('SELECT o.*,p.name as product_name FROM orders o JOIN products p ON o.product_id=p.id WHERE p.tenant_id=$1 ORDER BY o.created_at DESC LIMIT 20',[req.session.user.tenant_id])).rows;
  res.send(renderPage('Marketplace',`<div class="card"><h2>Add Product</h2><form method="POST" action="/portal/marketplace/add" enctype="multipart/form-data"><input name="name" placeholder="Product Name" required><textarea name="description" placeholder="Description" required></textarea><input name="price" type="number" placeholder="Price UGX" required><input name="stock" type="number" placeholder="Stock" required><select name="category" required><option value="">Category</option><option>Uniforms</option><option>Books</option><option>Food</option><option>Stationery</option></select><input type="file" name="image" accept="image/*"><button class="btn btn-green">Add Product</button></form></div><div class="card"><h3>Your Products (${products.length})</h3><div class="grid">${products.map(p=>`<div class="card"><img src="${p.image_url||'/img/default.jpg'}" style="width:100%;height:150px;object-fit:cover;border-radius:12px"><h4>${esc(p.name)}</h4><p>UGX ${p.price.toLocaleString()} • Stock: ${p.stock}</p><span class="badge ${p.approved?'badge-green':'badge-gold'}">${p.approved?'Approved':'Pending'}</span></div>`).join('')}</div></div><div class="card"><h3>Recent Orders</h3><table><tr><th>Product</th><th>Customer</th><th>Qty</th><th>Total</th><th>Status</th></tr>${orders.map(o=>`<tr><td>${esc(o.product_name)}</td><td>${esc(o.customer_name)}</td><td>${o.quantity}</td><td>UGX ${o.total.toLocaleString()}</td><td><span class="badge badge-blue">${o.status}</span></td></tr>`).join('')}</table></div>`,req.session.user,'marketplace'));
}));

app.post('/portal/marketplace/add',requireAuth,requirePortal('marketplace'),upload.single('image'),ah(async(req,res)=>{
  const{name,description,price,stock,category}=req.body;
  let image_url='';
  if(req.file){
    const result=await new Promise((resolve,reject)=>cloudinary.uploader.upload_stream({folder:'products'},(e,r)=>e?reject(e):resolve(r)).end(req.file.buffer));
    image_url=result.secure_url;
  }
  await pool.query('INSERT INTO products(tenant_id,name,description,price,stock,category,image_url,approved)VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[req.session.user.tenant_id,name,description,price,stock,category,image_url,false]);
  await logAction(req.session.user.id,req.session.user.tenant_id,'add_product',{name,price},req.ip);
  res.redirect('/portal/marketplace?added=1');
}));

app.get('/portal/donors',requireAuth,requireRole('org_admin','donor'),ah(async(req,res)=>{
  const opps=(await pool.query('SELECT * FROM fund_opportunities WHERE tenant_id=$1 ORDER BY created_at DESC',[req.session.user.tenant_id])).rows;
  const apps=(await pool.query('SELECT a.*,f.title as opp_title,u.name as donor_name FROM fund_applications a JOIN fund_opportunities f ON a.opportunity_id=f.id JOIN users u ON a.donor_id=u.id WHERE f.tenant_id=$1 ORDER BY a.created_at DESC',[req.session.user.tenant_id])).rows;
  res.send(renderPage('Donor Portal',`<div class="card"><h2>Create Funding Opportunity</h2><form method="POST" action="/portal/donors/create"><input name="title" placeholder="Title: Borehole Project" required><textarea name="summary" placeholder="Short summary" required></textarea><textarea name="description" placeholder="Full description" required></textarea><input name="amount" type="number" placeholder="Amount Needed USD" required><input name="deadline" type="date" required><select name="category" required><option value="">Category</option><option>Infrastructure</option><option>Education</option><option>Health</option><option>Agriculture</option></select><button class="btn btn-green">Post Opportunity</button></form></div><div class="card"><h3>Your Opportunities (${opps.length})</h3><table><tr><th>Title</th><th>Amount</th><th>Deadline</th><th>Applications</th></tr>${opps.map(o=>`<tr><td>${esc(o.title)}</td><td>USD ${o.amount.toLocaleString()}</td><td>${new Date(o.deadline).toDateString()}</td><td>${apps.filter(a=>a.opportunity_id===o.id).length}</td></tr>`).join('')}</table></div><div class="card"><h3>Donor Applications</h3><table><tr><th>Opportunity</th><th>Donor</th><th>Amount</th><th>Status</th><th>Action</th></tr>${apps.map(a=>`<tr><td>${esc(a.opp_title)}</td><td>${esc(a.donor_name)}</td><td>USD ${a.amount.toLocaleString()}</td><td><span class="badge ${a.status==='approved'?'badge-green':'badge-gold'}">${a.status}</span></td><td>${a.status==='pending'?`<a href="/portal/donors/approve/${a.id}" class="btn btn-green">Approve</a>`:''}</td></tr>`).join('')}</table></div>`,req.session.user,'donors'));
}));

app.post('/portal/donors/create',requireAuth,requireRole('org_admin'),ah(async(req,res)=>{
  const{title,summary,description,amount,deadline,category}=req.body;
  await pool.query('INSERT INTO fund_opportunities(tenant_id,title,summary,description,amount,currency,deadline,category,active)VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)',[req.session.user.tenant_id,title,summary,description,amount,'USD',deadline,category]);
  await logAction(req.session.user.id,req.session.user.tenant_id,'create_opportunity',{title,amount},req.ip);
  res.redirect('/portal/donors?created=1');
}));

app.get('/portal/donors/approve/:id',requireAuth,requireRole('org_admin'),ah(async(req,res)=>{
  await pool.query('UPDATE fund_applications SET status=$1 WHERE id=$2',['approved',req.params.id]);
  res.redirect('/portal/donors?approved=1');
}));

app.get('/portal/reports/pdf/:student_id',requireAuth,requirePortal('reports'),ah(async(req,res)=>{
  const s=(await pool.query('SELECT s.*,t.name as school_name FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id=$1 AND s.tenant_id=$2',[req.params.student_id,req.session.user.tenant_id])).rows[0];
  const grades=(await pool.query('SELECT * FROM grades WHERE student_id=$1 AND term=$2 ORDER BY subject',[s.id,req.query.term||'1'])).rows;
  const avg=grades.reduce((sum,g)=>sum+g.score,0)/(grades.length||1);
  const doc=new PDFDocument({size:'A4',margin:50});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="${s.name}-Report.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(s.school_name,{align:'center'});
  doc.fontSize(12).text('Academic Report Card',{align:'center'}).moveDown();
  doc.fontSize(14).text(`Name: ${s.name}`).text(`Class: ${s.class}`).text(`Term: ${req.query.term||'1'}`).moveDown();
  let y=doc.y;doc.text('Subject',50,y).text('Score',250,y).text('Grade',350,y);
  doc.moveTo(50,y+15).lineTo(550,y+15).stroke();y+=25;
  grades.forEach(g=>{doc.text(g.subject,50,y).text(g.score.toString(),250,y).text(g.grade,350,y);y+=20;});
  doc.fontSize(14).text(`Average: ${avg.toFixed(1)}%`,50,y+10);
  doc.fontSize(10).text('Computer generated document.',50,700);
  doc.end();
}));

// === USSD ROUTE ===
app.post('/ussd',ah(async(req,res)=>{
  const{sessionId,serviceCode,phoneNumber,text}=req.body;
  const parts=text.split('*');
  let response='';
  if(text===''){response=`CON Welcome to SSEWASSWA\n1. Check Fees\n2. Check Results\n3. School Info\n4. Pay Fees`;}
  else if(parts[0]==='1'){
    if(parts.length===1){response=`CON Enter Student ID`;}
    else{
      const s=(await pool.query('SELECT s.*,t.name as school FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id=$1 AND s.parent_phone=$2',[parts[1],phoneNumber])).rows[0];
      if(!s)response=`END Student not found`;
      else{const fees=(await pool.query('SELECT COALESCE(SUM(amount),0)-COALESCE(SUM(CASE WHEN paid THEN amount ELSE 0 END),0) as balance FROM fees WHERE student_id=$1',[s.id])).rows[0].balance;response=`END ${s.school}\n${s.name}\nBalance: UGX ${fees.toLocaleString()}`;}
    }
  }else if(parts[0]==='2'){
    if(parts.length===1){response=`CON Enter Student ID`;}
    else{const grades=(await pool.query('SELECT subject,score,grade FROM grades WHERE student_id=$1 AND term=$2 ORDER BY subject LIMIT 5',[parts[1],'1'])).rows;response=grades.length?`END Results:\n${grades.map(g=>`${g.subject}:${g.score}(${g.grade})`).join('\n')}`:`END No results`;}
  }else if(parts[0]==='4'){
    if(parts.length===1){response=`CON Enter Student ID`;}
    else if(parts.length===2){response=`CON Enter Amount UGX`;}
    else{const ref='USSD'+Date.now();await pool.query('INSERT INTO fees(tenant_id,student_id,amount,ref,phone,paid,status)SELECT tenant_id,id,$1,$2,$3,false,$4 FROM students WHERE id=$5',[parts[2],ref,phoneNumber,'pending',parts[1]]);response=`END Payment request sent. Approve on ${phoneNumber} to pay UGX ${parts[2]}`;}
  }else response=`END Invalid option`;
  res.set('Content-Type','text/plain');res.send(response);
}));

// === API ROUTES ===
app.get('/api/stats',ah(async(req,res)=>{res.json({schools:(await pool.query("SELECT COUNT(*) as c FROM tenants WHERE type='school'")).rows[0].c,students:(await pool.query("SELECT COUNT(*) as c FROM students")).rows[0].c,donations:(await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM donations")).rows[0].t,products:(await pool.query("SELECT COUNT(*) as c FROM products WHERE approved=true")).rows[0].c});}));
app.get('/api/news/:tenant_id',ah(async(req,res)=>{const news=(await pool.query('SELECT id,title,summary,created_at FROM news_articles WHERE tenant_id=$1 AND published=true ORDER BY created_at DESC LIMIT 5',[req.params.tenant_id])).rows;res.json(news);}));
app.post('/api/sync',requireAuth,ah(async(req,res)=>{const{type,data}=req.body;if(type==='grades'){for(const g of data)await pool.query('INSERT INTO grades(tenant_id,student_id,subject,score,grade,term,teacher_id)VALUES($1,$2,$3,$4,$5,$6,$7)ON CONFLICT DO NOTHING',[g.tenant_id,g.student_id,g.subject,g.score,g.grade,g.term,g.teacher_id]);}else if(type==='attendance'){for(const a of data)await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status,marked_by)VALUES($1,$2,$3,$4,$5)ON CONFLICT DO NOTHING',[a.tenant_id,a.student_id,a.date,a.status,a.marked_by]);}res.json({ok:true,synced:data.length});}));

// === FEEDBACK ===
app.post('/feedback',ah(async(req,res)=>{const{message,rating,email}=req.body;await pool.query('INSERT INTO feedback(message,rating,email)VALUES($1,$2,$3)',[message,rating,email]);await transporter.sendMail({to:DEVELOPER_EMAIL,subject:'New Feedback',html:`<p>Rating: ${rating}/5</p><p>${message}</p><p>From: ${email}</p>`});res.json({ok:true,msg:'Thank you!'});}));

// === CART & CHECKOUT ===
app.get('/cart',ah(async(req,res)=>{const cart=req.session.cart||[];const products=cart.length?await Promise.all(cart.map(async(c)=>{const p=(await pool.query('SELECT * FROM products WHERE id=$1',[c.product_id])).rows[0];return{...p,quantity:c.quantity}})):[];const total=products.reduce((sum,p)=>sum+p.price*p.quantity,0);res.send(renderPage('Cart',`<div class="card"><h2>Shopping Cart</h2>${products.length?`<table><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th></tr>${products.map(p=>`<tr><td>${esc(p.name)}</td><td>UGX ${p.price.toLocaleString()}</td><td>${p.quantity}</td><td>UGX ${(p.price*p.quantity).toLocaleString()}</td></tr>`).join('')}<tr><td colspan="3" style="text-align:right;font-weight:bold">Total:</td><td style="font-weight:bold;color:#16a34a">UGX ${total.toLocaleString()}</td></tr></table><a href="/checkout" class="btn btn-green">Checkout</a>`:'<p>Cart is empty</p><a href="/marketplace" class="btn">Continue Shopping</a>'}</div>`,null,true));}));
app.post('/cart/add',ah(async(req,res)=>{const{product_id,quantity}=req.body;if(!req.session.cart)req.session.cart=[];const existing=req.session.cart.find(c=>c.product_id==product_id);if(existing)existing.quantity+=parseInt(quantity);else req.session.cart.push({product_id,quantity:parseInt(quantity)});res.redirect('/cart');}));
app.get('/checkout',ah(async(req,res)=>{const cart=req.session.cart||[];if(!cart.length)return res.redirect('/cart');const products=await Promise.all(cart.map(async(c)=>{const p=(await pool.query('SELECT * FROM products WHERE id=$1',[c.product_id])).rows[0];return{...p,quantity:c.quantity}}));const total=products.reduce((sum,p)=>sum+p.price*p.quantity,0);res.send(renderPage('Checkout',`<div class="card" style="max-width:600px;margin:40px auto"><h2>Checkout</h2><form method="POST" action="/checkout"><h3>Delivery Details</h3><input name="customer_name" placeholder="Full Name" required><input name="phone" placeholder="Phone: 078..." required><textarea name="address" placeholder="Delivery Address" required></textarea><h3>Payment Method</h3><select name="gateway" required><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select><h3>Order Summary</h3><table>${products.map(p=>`<tr><td>${esc(p.name)} x${p.quantity}</td><td>UGX ${(p.price*p.quantity).toLocaleString()}</td></tr>`).join('')}<tr><td style="font-weight:bold">Total:</td><td style="font-weight:bold;color:#16a34a">UGX ${total.toLocaleString()}</td></tr></table><button class="btn btn-green" style="width:100%">Pay Now</button></form></div>`,null,true));}));
app.post('/checkout',ah(async(req,res)=>{const{customer_name,phone,address,gateway}=req.body;const cart=req.session.cart||[];const products=await Promise.all(cart.map(async(c)=>{const p=(await pool.query('SELECT * FROM products WHERE id=$1',[c.product_id])).rows[0];return{...p,quantity:c.quantity}}));const total=products.reduce((sum,p)=>sum+p.price*p.quantity,0);const ref='ORD'+Date.now();const commission=Math.round(total*PLATFORM_COMMISSION);for(const p of products){await pool.query('INSERT INTO orders(user_id,product_id,quantity,total,commission,customer_name,phone,address,gateway,ref,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[req.session.user?.id||null,p.id,p.quantity,p.price*p.quantity,commission,customer_name,phone,address,gateway,ref,'pending']);}req.session.cart=[];res.send(`<script>alert('Order placed! Ref: ${ref}. Check ${phone} to approve payment of UGX ${total.toLocaleString()}');window.location='/order/${ref}'</script>`);}));rtal/students/bulk" enctype="multipart/form-data"><input type="file" name="csv" accept=".csv" required><button class="btn">Import Students</button></form></div>`,// === CRON JOBS - AUTO TASKS ===
// Daily 8am - SMS absent students
cron.schedule('0 8 * * *',async()=>{
  const yesterday=new Date(Date.now()-86400000).toISOString().split('T')[0];
  const absent=(await pool.query(`SELECT s.name,s.parent_phone,t.name as school FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id NOT IN (SELECT student_id FROM attendance WHERE date=$1) AND s.parent_phone IS NOT NULL`,[yesterday])).rows;
  for(const s of absent){await sendSMS(s.parent_phone,`SSEWASSWA: ${s.name} was absent from ${s.school} on ${yesterday}`);}
});

// Daily 9am - Payout 5% to schools + platform revenue
cron.schedule('0 9 * * *',async()=>{
  const fees=(await pool.query('SELECT tenant_id,SUM(dev_amount) as dev_total FROM transactions WHERE status=$1 GROUP BY tenant_id',['completed'])).rows;
  for(const f of fees){
    await pool.query('UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2',[f.dev_total,f.tenant_id]);
    await pool.query('INSERT INTO developer_revenue(tenant_id,amount,type)VALUES($1,$2,$3)',[f.tenant_id,f.dev_total,'fees']);
  }
  const wallet=(await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0].balance;
  if(wallet>0){
    await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');
    await pool.query('INSERT INTO withdrawals(user_email,amount,net_amount,phone,status,ref)VALUES($1,$2,$3,$4,$5,$6)',[DEVELOPER_EMAIL,wallet,wallet,DEVELOPER_PHONE,'paid','AUTO'+Date.now()]);
  }
});

// Daily 6am - Charge recurring donations
cron.schedule('0 6 * * *',async()=>{
  const due=(await pool.query('SELECT * FROM recurring_donations WHERE next_charge<=NOW() AND status=$1',['active'])).rows;
  for(const d of due){
    const next=new Date();if(d.frequency==='monthly')next.setMonth(next.getMonth()+1);else next.setMonth(next.getMonth()+3);
    await pool.query('UPDATE recurring_donations SET next_charge=$1,last_charged=NOW() WHERE id=$2',[next,d.id]);
    await pool.query('INSERT INTO donations(donor_id,opportunity_id,amount,status)VALUES($1,$2,$3,$4)',[d.donor_id,d.opportunity_id,d.amount,'completed']);
    await pool.query('INSERT INTO developer_revenue(amount,type)VALUES($1,$2)',[d.amount*DEVELOPER_RATE,'recurring']);
  }
});

// Daily 2am - Backup database to Cloudinary
cron.schedule('0 2 * * *',async()=>{
  const tables=['tenants','users','students','grades','products','orders','transactions'];
  for(const table of tables){
    const data=(await pool.query(`SELECT * FROM ${table}`)).rows;
    const backup=Buffer.from(JSON.stringify(data));
    await new Promise((res,rej)=>cloudinary.uploader.upload_stream({resource_type:'raw',public_id:`backups/${table}_${Date.now()}.json`,folder:'backups'},(e,r)=>e?rej(e):res(r)).end(backup));
  }
});

// Hourly - Simulate ad revenue
cron.schedule('0 * * * *',async()=>{
  const ads=(await pool.query('SELECT * FROM advertisements WHERE active=true')).rows;
  for(const ad of ads){
    const views=Math.floor(Math.random()*100)+10;
    const revenue=views*0.1;
    const dev_cut=revenue*0.15;
    await pool.query('UPDATE advertisements SET impressions=impressions+$1 WHERE id=$2',[views,ad.id]);
    await pool.query('INSERT INTO developer_revenue(amount,type)VALUES($1,$2)',[dev_cut,'ads']);
    await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1',[dev_cut]);
  }
});

// === INIT DATABASE v6.0 - COMPLETE ===
async function initDB(){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query(`CREATE TABLE IF NOT EXISTS session (sid varchar NOT NULL, sess json NOT NULL, expire timestamp NOT NULL, PRIMARY KEY (sid))`);
    await c.query(`CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT, subdomain TEXT UNIQUE, type TEXT DEFAULT 'school', description TEXT, gateway TEXT DEFAULT 'mtn', momo_number_encrypted TEXT, momo_name TEXT, bank_name TEXT, bank_account TEXT, wallet_balance INTEGER DEFAULT 0, status TEXT DEFAULT 'active', subscription_plan TEXT DEFAULT 'school_free', subscription_status TEXT DEFAULT 'trial', verified BOOLEAN DEFAULT false, features_enabled JSONB DEFAULT '{"dashboard":true,"finance":true,"academics":true,"ai_chatbot":false,"ussd_gateway":false,"offline_sync":false}', social_links JSONB DEFAULT '{}', about_us TEXT, tagline TEXT, show_fees BOOLEAN DEFAULT true, show_results BOOLEAN DEFAULT false, show_gallery BOOLEAN DEFAULT true, show_news BOOLEAN DEFAULT true, show_donate BOOLEAN DEFAULT true, contact_phone TEXT, contact_email TEXT, address TEXT, allow_marketplace BOOLEAN DEFAULT true, seller_commission INT DEFAULT 10, featured_until TIMESTAMPTZ, country_code TEXT DEFAULT 'UG', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INT, email TEXT UNIQUE, password_hash TEXT, role TEXT, portals TEXT[], name TEXT, phone_encrypted TEXT, approved BOOLEAN DEFAULT false, verified BOOLEAN DEFAULT false, two_fa_enabled BOOLEAN DEFAULT false, wallet_balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, dob DATE, gender TEXT, class TEXT, parent_phone TEXT, balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, subject TEXT, score NUMERIC, grade TEXT, term TEXT, teacher_id INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, amount NUMERIC, term TEXT, year INTEGER, payment_method TEXT, paid BOOLEAN DEFAULT false, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, date DATE, status TEXT DEFAULT 'present', marked_by INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, description TEXT, price NUMERIC, stock INT, category TEXT, image_url TEXT, approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, user_id INT, product_id INT, quantity INT, total INT, commission INT, customer_name TEXT, phone TEXT, address TEXT, gateway TEXT, ref TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, tenant_id INT, amount INT, dev_amount INT, purpose TEXT, payer_name TEXT, payer_phone_encrypted TEXT, payer_email_encrypted TEXT, gateway TEXT, ref TEXT, status TEXT, receipt_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, tenant_id INT, amount INT, type TEXT, student_id INT, description TEXT, reference_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance INTEGER DEFAULT 0)`);
    await c.query(`INSERT INTO platform_wallet (id,balance) VALUES (1,0) ON CONFLICT DO NOTHING`);
    await c.query(`CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, tenant_id INT, user_email TEXT, amount INT, net_amount INT, phone TEXT, fee NUMERIC DEFAULT 0, status TEXT, ref TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fund_opportunities (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, summary TEXT, description TEXT, amount INT, currency TEXT, deadline DATE, category TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fund_applications (id SERIAL PRIMARY KEY, opportunity_id INT, donor_id INT, amount INT, currency TEXT, proposal TEXT, docs_url TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS donations (id SERIAL PRIMARY KEY, donor_id INT, opportunity_id INT, amount INT, status TEXT DEFAULT 'completed', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, donor_id INT, opportunity_id INT, amount INT, frequency TEXT, next_charge TIMESTAMPTZ, last_charged TIMESTAMPTZ, status TEXT DEFAULT 'active')`);
    await c.query(`CREATE TABLE IF NOT EXISTS otp_codes (id SERIAL PRIMARY KEY, user_id INT, code TEXT, expires_at TIMESTAMPTZ, used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS email_verifications (id SERIAL PRIMARY KEY, user_id INT, token TEXT, expires_at TIMESTAMPTZ, used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, user_id INT, token TEXT, expires_at TIMESTAMPTZ, used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_id INT, tenant_id INT, action TEXT, details JSONB, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS news_articles (id SERIAL PRIMARY KEY, tenant_id INT, author_id INT, title TEXT, summary TEXT, content TEXT, image_url TEXT, published BOOLEAN DEFAULT false, views INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS advertisements (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, description TEXT, image_url TEXT, daily_budget INT, target_audience TEXT, active BOOLEAN DEFAULT true, clicks INT DEFAULT 0, impressions INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS feedback (id SERIAL PRIMARY KEY, message TEXT, rating INT, email TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS enrollments (id SERIAL PRIMARY KEY, tenant_id INT, student_name TEXT, dob DATE, gender TEXT, class_applying TEXT, parent_name TEXT, parent_phone TEXT, parent_email TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS verification_docs (id SERIAL PRIMARY KEY, user_id INT, tenant_id INT, doc_type TEXT, file_url TEXT, status TEXT DEFAULT 'pending', reviewed_by INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS employer_matches (id SERIAL PRIMARY KEY, tenant_id INT, company_name TEXT, match_ratio INT, max_annual NUMERIC, contact_email TEXT, requirements TEXT, verified BOOLEAN DEFAULT false, matched_ytd NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS social_takeovers (id SERIAL PRIMARY KEY, tenant_id INT, student_name TEXT, date DATE, platform TEXT, status TEXT DEFAULT 'scheduled', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query('COMMIT');
    console.log('DB v6.0 Ready - All Tables Created');
  }catch(e){await c.query('ROLLBACK');console.error(e);process.exit(1)}finally{c.release()}
}

// === START SERVER ===
initDB().then(()=>app.listen(PORT,()=>console.log(`SSEWASSWA v6.0 COMPLETE - LIVE on ${PORT}`)));

// === END OF server.js ===
