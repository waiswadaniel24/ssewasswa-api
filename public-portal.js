// ============================================================
// PUBLIC PORTAL — Landing page, Registration, Public pages
// Comfort Platform - Multi-tenant SaaS for African Institutions
// ============================================================
module.exports = function(app, pool, bcrypt, ah, esc, renderPage, audit, sendEmail, queueEmail, logger) {

  // === MIGRATIONS ===
  const migrations = [
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sub_type VARCHAR(100)`,
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
      phone VARCHAR(20), subject VARCHAR(255), message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  ];
  (async () => { for (const sql of migrations) { try { await pool.query(sql); } catch(e) { /* column may exist */ } } })();

  // === PORTAL TYPES ===
  const PORTAL_TYPES = [
    { type:'school', label:'School', emoji:'🏫', price:'150,000', color:'#059669', features:['Student Management','Fees & Payments','Exams & Report Cards','Attendance Tracking','Transport & Hostel','Library Management','Staff Payroll','Parent Portal'] },
    { type:'clinic', label:'Clinic', emoji:'🏥', price:'200,000', color:'#0891b2', features:['Patient Records','Doctor Consultations','Pharmacy & Dispensing','Lab Results','Prescriptions','Billing & Payments','Appointment Queue','Medical Reports'] },
    { type:'church', label:'Church', emoji:'⛪', price:'100,000', color:'#7c3aed', features:['Member Directory','Donations & Tithes','Sacrament Records','Cell Groups','Sermon Archive','Choir Management','Event Calendar','Prayer Requests'] },
    { type:'hotel', label:'Hotel & Lodge', emoji:'🏨', price:'200,000', color:'#dc2626', features:['Room Management','Guest Reservations','Check-in / Check-out','Housekeeping Tracker','In-Room Services','Guest Ledger','Revenue Reports','Online Bookings'] },
    { type:'restaurant', label:'Restaurant & Cafe', emoji:'🍽️', price:'150,000', color:'#ea580c', features:['Menu Management','Table Booking','Order System','Kitchen Display','Delivery Tracking','Daily Sales','Staff Scheduling','Recipe Costing'] },
    { type:'retail', label:'Retail Shop & Boutique', emoji:'🛍️', price:'100,000', color:'#e11d48', features:['Point of Sale','Inventory Tracking','Barcode System','Purchase Orders','Customer Loyalty','Sales Reports','Supplier Management','Stock Alerts'] },
    { type:'salon', label:'Salon & Spa', emoji:'💇', price:'80,000', color:'#db2777', features:['Appointment Booking','Service Catalog','Staff Scheduling','Commission Tracking','Client History','Daily Revenue','Inventory','Online Booking'] },
    { type:'pharmacy', label:'Pharmacy', emoji:'💊', price:'150,000', color:'#2563eb', features:['Drug Inventory','Prescription Processing','Expiry Alerts','Dispensing Records','Stock Reordering','Sales Reports','Supplier Management','Patient Records'] },
    { type:'gym', label:'Gym & Fitness', emoji:'🏋️', price:'100,000', color:'#16a34a', features:['Membership Plans','Member Check-in','Class Scheduling','Personal Training','Payment Tracking','Attendance Reports','Trainer Management','Fitness Goals'] },
    { type:'hardware', label:'Hardware Store', emoji:'🔧', price:'100,000', color:'#ca8a04', features:['Product Catalog','Quotations','Stock Management','Supplier Tracking','Sales Records','Purchase Orders','Price Lists','Project Estimation'] },
    { type:'supermarket', label:'Supermarket', emoji:'🛒', price:'150,000', color:'#0d9488', features:['Point of Sale','Perishable Tracking','Bulk Pricing','Daily Sales','Supplier Management','Stock Alerts','Category Reports','Loyalty Program'] },
    { type:'transport', label:'Transport & Logistics', emoji:'🚗', price:'120,000', color:'#4f46e5', features:['Fleet Management','Booking System','Route Planning','Schedule Management','Driver Tracking','Revenue Reports','Vehicle Maintenance','Fuel Tracking'] },
    { type:'electronics', label:'Electronics Shop', emoji:'📱', price:'100,000', color:'#6366f1', features:['Product Catalog','Serial/IMEI Tracking','Repair Service','Warranty Management','Sales Reports','Stock Management','Supplier Orders','Technician Jobs'] },
    { type:'business', label:'General Business', emoji:'🏢', price:'100,000', color:'#475569', features:['CRM & Leads','Invoicing','Payroll & HR','Expense Tracking','Project Management','Inventory','Tax Reports','Analytics'] },
    { type:'individual', label:'Individual', emoji:'👤', price:'FREE', color:'#8b5cf6', features:['Personal Notes','Goal Tracking','Finance Manager','Task Lists','Calendar','Document Storage','Contacts','Reminders'] }
  ];

  const SUB_TYPES = {
    hotel: ['Hotel','Lodge','Guest House','Hostel','Airbnb Property','Boutique Hotel','Resort'],
    restaurant: ['Restaurant','Cafe','Bar','Fast Food','Food Truck','Bakery','Catering Service'],
    retail: ['Boutique','Clothing Store','Electronics Shop','Phone Shop','Bookshop','Gift Shop','General Store'],
    salon: ['Hair Salon','Barber Shop','Spa','Nail Salon','Beauty Parlor','Massage Parlor','Unisex Salon'],
    pharmacy: ['Pharmacy','Drug Store','Chemist','Clinic Pharmacy','Hospital Pharmacy'],
    gym: ['Gym','Fitness Center','Yoga Studio','CrossFit Box','Personal Training Studio','Martial Arts Studio'],
    hardware: ['Hardware Store','Building Materials','Paint Shop','Plumbing Supply','Electrical Supply','Timber Yard'],
    supermarket: ['Supermarket','Grocery Store','Mini Market','Convenience Store','Wholesale Store','Food Market'],
    transport: ['Taxi Service','Bus Company','Boda Boda Fleet','Trucking Company','Delivery Service','Car Rental','Tour Operator'],
    electronics: ['Electronics Shop','Phone Shop','Computer Store','Appliance Store','Gadget Shop','Accessories Shop'],
    business: ['Consulting','Real Estate','Marketing Agency','Law Firm','Accounting Firm','Construction','Agriculture','Manufacturing','NGO','Other'],
    school: ['Primary School','Secondary School','University','Nursery','Vocational','Seminary','International School'],
    clinic: ['Hospital','Clinic','Health Center','Dental Clinic','Eye Clinic','Laboratory','Pharmacy','Maternity'],
    church: ['Catholic','Protestant','Pentecostal','Orthodox','Mosque','Temple','Other'],
    individual: ['Student','Professional','Freelancer','Entrepreneur','Other']
  };

  // ============================================================
  // PUBLIC LANDING PAGE (overrides launch-routes /)
  // ============================================================
  app.get('/', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comfort — The Operating System for African Institutions</title>
<meta name="description" content="All-in-one management platform for Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches and Businesses in Africa">
<meta property="og:title" content="Comfort Platform — Management Software for Africa">
<meta property="og:description" content="Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches — One Platform. Built for Uganda.">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}">
<link rel="canonical" href="${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}">
<meta name="robots" content="index, follow">
<link rel="icon" href="/favicon.png"><link rel="manifest" href="/manifest.json">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}
.nav{background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.04)}
.nav-logo{font-size:22px;font-weight:900;color:#4f46e5;display:flex;align-items:center;gap:8px}
.nav-links{display:flex;gap:20px;align-items:center}
.nav-links a{font-size:14px;font-weight:500;color:#475569;padding:8px 12px;border-radius:8px;transition:0.2s}
.nav-links a:hover{background:#f1f5f9;color:#1e293b;text-decoration:none}
.btn{display:inline-block;padding:10px 24px;border-radius:10px;font-weight:600;font-size:14px;border:none;cursor:pointer;transition:0.3s;text-decoration:none}
.btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.15);text-decoration:none}
.btn-primary{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}
.btn-green{background:linear-gradient(135deg,#059669,#0d9488);color:white}
.btn-outline{background:transparent;border:2px solid #e2e8f0;color:#475569}
.btn-outline:hover{border-color:#4f46e5;color:#4f46e5}
.container{max-width:1200px;margin:0 auto;padding:0 20px}
.hero{background:linear-gradient(135deg,#059669 0%,#0d9488 40%,#0891b2 100%);padding:80px 20px;text-align:center;color:white;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:30px 30px}
.hero h1{font-size:clamp(28px,5vw,52px);font-weight:900;margin-bottom:16px;position:relative;line-height:1.15}
.hero p{font-size:clamp(16px,2.5vw,20px);opacity:0.9;margin-bottom:8px;max-width:700px;margin-left:auto;margin-right:auto;position:relative}
.hero-buttons{display:flex;gap:16px;justify-content:center;margin-top:32px;position:relative;flex-wrap:wrap}
.trust-badges{display:flex;gap:24px;justify-content:center;margin-top:24px;position:relative;flex-wrap:wrap}
.trust-badges span{font-size:13px;opacity:0.85}
.section{padding:60px 20px}
.section-title{text-align:center;font-size:32px;font-weight:800;margin-bottom:12px}
.section-sub{text-align:center;color:#64748b;margin-bottom:48px;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.card{background:white;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;transition:0.3s;position:relative;overflow:hidden}
.card:hover{transform:translateY(-4px);box-shadow:0 8px 30px rgba(0,0,0,0.1)}
.card-top{position:absolute;top:0;left:0;right:0;height:5px}
.card-emoji{font-size:36px;margin-bottom:12px}
.card h3{font-size:20px;font-weight:700;margin-bottom:4px}
.card-price{font-size:13px;font-weight:600;margin-bottom:16px;color:#64748b}
.card ul{list-style:none;padding:0;font-size:13px;color:#475569;line-height:2}
.card ul li::before{content:'✓ ';color:#059669;font-weight:700}
.card .btn{margin-top:16px;display:block;text-align:center}
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:1000px;margin:0 auto}
.pricing-card{background:white;border-radius:16px;padding:32px;text-align:center;border:2px solid #e2e8f0;transition:0.3s}
.pricing-card:hover{border-color:#4f46e5}
.pricing-card.featured{border-color:#4f46e5;box-shadow:0 8px 30px rgba(79,70,229,0.15)}
.pricing-card h3{font-size:22px;font-weight:800;margin-bottom:4px}
.pricing-card .price{font-size:36px;font-weight:900;color:#4f46e5;margin:12px 0}
.pricing-card .price span{font-size:14px;font-weight:400;color:#64748b}
.pricing-card ul{list-style:none;text-align:left;font-size:14px;color:#475569;line-height:2.2;margin:16px 0}
.pricing-card ul li::before{content:'✓ ';color:#059669;font-weight:700}
.faq-item{background:white;border-radius:12px;padding:20px 24px;margin-bottom:12px;border:1px solid #e2e8f0;cursor:pointer}
.faq-item h4{font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.faq-item p{color:#475569;font-size:14px;margin-top:8px;display:none}
.faq-item.open p{display:block}
.faq-item h4::after{content:'+';font-size:20px;color:#94a3b8;transition:0.2s}
.faq-item.open h4::after{content:'-'}
.testimonials{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
.testimonial{background:white;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
.testimonial-stars{color:#f59e0b;font-size:16px;margin-bottom:12px}
.testimonial p{color:#475569;font-size:14px;line-height:1.8;font-style:italic;margin-bottom:16px}
.testimonial-author{font-weight:700;font-size:14px;color:#1e293b}
.testimonial-role{font-size:12px;color:#64748b}
footer{background:#1e293b;color:white;padding:48px 20px 24px}
.footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:32px;max-width:1200px;margin:0 auto}
.footer-grid h4{margin-bottom:12px;font-size:15px}
.footer-grid a{color:#94a3b8;font-size:13px;display:block;margin-bottom:8px}
.footer-grid a:hover{color:white}
.footer-bottom{text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #334155;font-size:13px;color:#64748b}
@media(max-width:768px){.nav-links{display:none}.hero{padding:40px 16px}.hero h1{font-size:28px}.section{padding:40px 16px}.section-title{font-size:24px}.grid{grid-template-columns:1fr}.hero-buttons{flex-direction:column;align-items:center}}
</style></head><body>

<nav class="nav">
  <div class="nav-logo">◆ Comfort</div>
  <div class="nav-links">
    <a href="/#features">Features</a>
    <a href="/#pricing">Pricing</a>
    <a href="/#testimonials">Testimonials</a>
    <a href="/#faq">FAQ</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
    <a href="/login" class="btn btn-outline">Login</a>
    <a href="/register" class="btn btn-primary">Start Free</a>
  </div>
</nav>

<section class="hero">
  <h1>The Operating System for<br>Schools, Hotels, Restaurants,<br>Salons, Pharmacies &amp; More</h1>
  <p>Stop juggling 12 different apps. One platform. All your operations. Built for Uganda, designed for Africa.</p>
  <div class="hero-buttons">
    <a href="/register" class="btn" style="background:white;color:#059669;padding:16px 36px;font-size:16px;font-weight:700">Start Free →</a>
    <a href="/login" class="btn" style="background:rgba(255,255,255,0.15);color:white;border:2px solid rgba(255,255,255,0.4);padding:16px 36px;font-size:16px">Login</a>
  </div>
  <div class="trust-badges">
    <span>✓ No credit card required</span>
    <span>✓ Setup in 10 minutes</span>
    <span>✓ Works offline</span>
    <span>✓ 500+ users across Africa</span>
  </div>
</section>

<section class="section" id="features">
  <div class="container">
    <h2 class="section-title">Built For Your Institution</h2>
    <p class="section-sub">Choose your sector. We handle the rest.</p>
    <div class="grid">
      ${PORTAL_TYPES.map(p => `
      <div class="card">
        <div class="card-top" style="background:${p.color}"></div>
        <div class="card-emoji">${p.emoji}</div>
        <h3 style="color:${p.color}">${p.label}</h3>
        <div class="card-price">${p.price === 'FREE' ? 'FREE Forever' : 'UGX '+p.price+'/month'}</div>
        <ul>${p.features.map(f => '<li>'+f+'</li>').join('')}</ul>
        <a href="/register?type=${p.type}" class="btn btn-primary" style="background:${p.color}">Start Free Trial</a>
      </div>`).join('')}
    </div>
  </div>
</section>

<section class="section" style="background:#f1f5f9" id="pricing">
  <div class="container">
    <h2 class="section-title">Simple, Transparent Pricing</h2>
    <p class="section-sub">Start free. Upgrade when you need more.</p>
    <div class="pricing-grid">
      <div class="pricing-card">
        <h3>Free</h3>
        <div class="price">UGX 0<span>/month</span></div>
        <ul>
          <li>Up to 100 records</li>
          <li>Up to 3 users</li>
          <li>All features included</li>
          <li>Comfort branding</li>
          <li>Email support</li>
          <li>Mobile app</li>
        </ul>
        <a href="/register" class="btn btn-outline" style="width:100%;text-align:center">Get Started Free</a>
      </div>
      <div class="pricing-card featured">
        <div style="background:#4f46e5;color:white;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block;margin-bottom:12px">POPULAR</div>
        <h3>Basic</h3>
        <div class="price">UGX 100K<span>/month</span></div>
        <ul>
          <li>Up to 1,000 records</li>
          <li>Up to 10 users</li>
          <li>All features</li>
          <li>Custom branding</li>
          <li>Priority support</li>
          <li>Advanced reports</li>
        </ul>
        <a href="/register" class="btn btn-primary" style="width:100%;text-align:center">Start 30-Day Free Trial</a>
      </div>
      <div class="pricing-card">
        <h3>Pro</h3>
        <div class="price">UGX 200K<span>/month</span></div>
        <ul>
          <li>Up to 10,000 records</li>
          <li>Up to 50 users</li>
          <li>API access</li>
          <li>White-label</li>
          <li>Dedicated support</li>
          <li>Analytics dashboard</li>
        </ul>
        <a href="/register" class="btn btn-outline" style="width:100%;text-align:center">Start Free Trial</a>
      </div>
      <div class="pricing-card">
        <h3>Enterprise</h3>
        <div class="price">UGX 500K<span>/month</span></div>
        <ul>
          <li>Unlimited records</li>
          <li>Unlimited users</li>
          <li>Custom domain</li>
          <li>Custom integrations</li>
          <li>SLA guarantee</li>
          <li>Onboarding support</li>
        </ul>
        <a href="/register" class="btn btn-outline" style="width:100%;text-align:center">Contact Sales</a>
      </div>
    </div>
  </div>
</section>

<section class="section" id="testimonials">
  <div class="container">
    <h2 class="section-title">Trusted by Institutions Across Africa</h2>
    <p class="section-sub">See what our users say about Comfort.</p>
    <div class="testimonials">
      <div class="testimonial">
        <div class="testimonial-stars">★★★★★</div>
        <p>"Comfort replaced 5 different tools we were using. Our school now runs everything from fees to report cards to parent communication in one place. The offline mode is a lifesaver when power goes out."</p>
        <div class="testimonial-author">Grace Nakamya</div>
        <div class="testimonial-role">Headteacher, Sunrise Primary School — Kampala</div>
      </div>
      <div class="testimonial">
        <div class="testimonial-stars">★★★★★</div>
        <p>"Managing our hotel's 45 rooms, reservations, and housekeeping was a nightmare with spreadsheets. Comfort's hotel module has everything we need. Revenue is up 30% since we started using it."</p>
        <div class="testimonial-author">Robert Mugisha</div>
        <div class="testimonial-role">Manager, Pearl Gardens Hotel — Entebbe</div>
      </div>
      <div class="testimonial">
        <div class="testimonial-stars">★★★★★</div>
        <p>"As a pharmacy, tracking expiry dates and prescriptions was critical. Comfort sends us alerts before drugs expire and the dispensing workflow is smooth. Our patients love the faster service."</p>
        <div class="testimonial-author">Sarah Achieng</div>
        <div class="testimonial-role">Pharmacist, HealthFirst Pharmacy — Jinja</div>
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:#f1f5f9" id="faq">
  <div class="container" style="max-width:800px">
    <h2 class="section-title">Frequently Asked Questions</h2>
    <p class="section-sub">Everything you need to know about Comfort.</p>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Is Comfort really free to start?</h4><p>Yes! The Free plan lets you manage up to 100 records with up to 3 users, forever. No credit card required. When you're ready to scale, upgrade to a paid plan.</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Does it work offline?</h4><p>Absolutely. Comfort is a Progressive Web App (PWA) that works offline. You can add data, take attendance, record sales, and more — everything syncs when you're back online.</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Is my data secure?</h4><p>Yes. All data is encrypted in transit (SSL/TLS) and at rest. We use role-based access control, audit logging, and two-factor authentication. Your data belongs to you.</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Can I customize it for my business?</h4><p>Yes! Each business type (hotel, restaurant, salon, pharmacy, etc.) gets a specialized dashboard with features built specifically for that industry. You can also customize branding, colors, and logos.</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>What payment methods do you accept?</h4><p>We accept MTN Mobile Money, Airtel Money, bank transfers, and Flutterwave for card payments. All prices are in Uganda Shillings (UGX).</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>How long does setup take?</h4><p>Most institutions are up and running in under 10 minutes. Just register, pick your institution type, and start adding data. Our team can help with data migration for larger setups.</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Can I switch between business types?</h4><p>Yes! If you start as a retail shop and later add a restaurant, you can enable multiple specializations. Each gets its own dedicated dashboard and features.</p></div>
    <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Do you offer support?</h4><p>Yes — Free plan gets email support (24-48hr response). Basic and above get priority support via email, WhatsApp, and phone. Enterprise gets a dedicated account manager.</p></div>
  </div>
</section>

<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Ready to Transform Your Institution?</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Join 500+ institutions already using Comfort across Africa.</p>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
    <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free — No Credit Card</a>
    <a href="/contact" style="display:inline-block;padding:16px 40px;background:rgba(255,255,255,0.15);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;border:2px solid rgba(255,255,255,0.4)">Talk to Sales</a>
  </div>
</section>

<footer>
  <div class="footer-grid">
    <div><h4>◆ Comfort</h4><p style="color:#94a3b8;font-size:13px;line-height:1.8">The Operating System for African Institutions. One platform, all your operations.</p></div>
    <div><h4>Product</h4><a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="/register">Register</a><a href="/login">Login</a><a href="/help-center">Help Center</a></div>
    <div><h4>Company</h4><a href="/about">About Us</a><a href="/contact">Contact</a><a href="/blog/posts">Blog</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
    <div><h4>Connect</h4><a href="#">Twitter / X</a><a href="#">Facebook</a><a href="#">LinkedIn</a><a href="#">Instagram</a><a href="https://wa.me/256700000000">WhatsApp</a></div>
  </div>
  <div class="footer-bottom">© ${new Date().getFullYear()} Comfort Platform. Built with ♥ in Uganda. All rights reserved.</div>
</footer>
<script>
// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); const t = document.querySelector(a.getAttribute('href')); if(t) t.scrollIntoView({behavior:'smooth'}); });
});
// Register service worker
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // REGISTRATION
  // ============================================================
  app.get('/register', (req, res) => {
    const selectedType = req.query.type || '';
    // Validate type parameter to prevent arbitrary injection
    if (selectedType && !PORTAL_TYPES.find(p => p.type === selectedType)) {
      return res.redirect('/register');
    }
    // Step 1: Type selection
    if (!selectedType) {
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register — Comfort</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b}
a{color:#4f46e5}.btn{display:inline-block;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px;border:none;cursor:pointer;text-decoration:none;transition:0.3s}
.btn-primary{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}
.container{max-width:1000px;margin:40px auto;padding:0 20px}
h1{text-align:center;font-size:28px;margin-bottom:8px}.sub{text-align:center;color:#64748b;margin-bottom:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.type-card{background:white;border:2px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;cursor:pointer;transition:0.2s;text-decoration:none;color:#1e293b}
.type-card:hover{border-color:#4f46e5;transform:translateY(-2px);box-shadow:0 4px 12px rgba(79,70,229,0.15);text-decoration:none}
.type-card .emoji{font-size:32px;margin-bottom:8px}.type-card .name{font-weight:700;font-size:14px}.type-card .price{font-size:12px;color:#64748b;margin-top:4px}
.back{text-align:center;margin-top:24px}
@media(max-width:600px){.grid{grid-template-columns:repeat(2,1fr)}h1{font-size:22px}}
</style></head><body>
<div class="container">
<h1>What type of institution?</h1>
<p class="sub">Choose the category that best describes your organization.</p>
<div class="grid">
${PORTAL_TYPES.map(p => `<a href="/register?type=${p.type}" class="type-card"><div class="emoji">${p.emoji}</div><div class="name">${p.label}</div><div class="price">${p.price === 'FREE' ? 'Free' : 'UGX '+p.price+'/mo'}</div></a>`).join('')}
</div>
<div class="back"><a href="/login" style="color:#64748b">Already have an account? Login</a></div>
</div></body></html>`;
      res.send(html);
      return;
    }

    // Step 2: Registration form
    const pt = PORTAL_TYPES.find(p => p.type === selectedType);
    const subOptions = SUB_TYPES[selectedType] || [];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register as ${esc(pt?.label || selectedType)} — Comfort</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b}
.container{max-width:480px;margin:40px auto;padding:0 20px}
.card{background:white;border-radius:16px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:1px solid #e2e8f0}
h2{text-align:center;margin-bottom:4px}.type-badge{text-align:center;margin-bottom:20px}
.type-badge span{display:inline-block;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;color:white;background:${pt?.color || '#4f46e5'}}
form input,form select{width:100%;padding:12px;margin:8px 0;border:2px solid #e2e8f0;border-radius:10px;font-size:15px;background:white;transition:border 0.2s}
form input:focus,form select:focus{outline:none;border-color:#4f46e5}
.btn{display:block;width:100%;padding:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:12px}
.btn:hover{opacity:0.9}
.back{text-align:center;margin-top:16px}
a{color:#4f46e5;font-size:13px}
.pw-strength{height:6px;border-radius:3px;margin:4px 0 8px;background:#e5e7eb;overflow:hidden}.pw-fill{height:100%;border-radius:3px;transition:width 0.3s}
label{font-size:13px;font-weight:600;color:#475569;display:block;margin-top:8px}
</style></head><body>
<div class="container">
<div class="card">
<h2>Create Your Account</h2>
<div class="type-badge"><span>${pt?.emoji || ''} ${pt?.label || selectedType}</span></div>
<form method="POST" action="/register">
<input type="hidden" name="_csrf" value="${req.csrfToken}">
<input type="hidden" name="type" value="${esc(selectedType)}">
<label>Organization Name *</label>
<input name="org_name" placeholder="e.g. Sunrise Primary School" required>
${subOptions.length > 1 ? `<label>Sub-Type / Category</label><select name="sub_type"><option value="">Select...</option>${subOptions.map(s => '<option value="'+esc(s)+'">'+esc(s)+'</option>').join('')}</select>` : ''}
<label>Your Email *</label>
<input name="email" type="email" placeholder="you@example.com" required>
<label>Phone Number *</label>
<input name="phone" placeholder="+256 700 000 000" required>
<label>Password *</label>
<input name="password" type="password" id="pw" placeholder="Min 8 chars, 1 uppercase, 1 number" required minlength="8" pattern="(?=.*[A-Z])(?=.*\\d).{8,}" oninput="checkPw(this.value)">
<div class="pw-strength"><div class="pw-fill" id="pw-fill" style="width:0;background:#e5e7eb"></div></div>
<label>Confirm Password *</label>
<input name="confirm_password" type="password" placeholder="Re-enter password" required>
<button type="submit" class="btn">Create Account &amp; Start Free</button>
</form>
</div>
<div class="back"><a href="/register">← Choose different type</a> | <a href="/login">Already have an account?</a></div>
</div>
<script>
function checkPw(v){var s=0,c='red';if(v.length>=8)s++;if(/[A-Z]/.test(v))s++;if(/[0-9]/.test(v))s++;if(/[^A-Za-z0-9]/.test(v))s++;
if(s<=1){c='red';s=25}else if(s==2){c='orange';s=50}else if(s==3){c='#f59e0b';s=75}else{c='#059669';s=100}
var f=document.getElementById('pw-fill');f.style.width=s+'%';f.style.background=c;}
</script>
</body></html>`;
    res.send(html);
  });

  // [H-1] POST /register removed — duplicate of server.js line 2545 which registers first.
  // Kept here (commented out) for reference. Includes M-3 sub_type validation fix.
  /*
  app.post('/register', ah(async (req, res) => {
    const { org_name, type, sub_type, email, phone, password, confirm_password } = req.body;
    // SECURITY: Validate type against known portal types to prevent privilege escalation
    const VALID_TYPES = ['school','church','organization','health','business','individual','hotel','restaurant','salon','pharmacy','gym','supermarket','retail','clinic'];
    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).send('<div style="text-align:center;padding:60px"><h2>Error</h2><p>Invalid institution type.</p><a href="/register">Go Back</a></div>');
    }
    // M-3: Validate sub_type against known allowed values per type
    const VALID_SUB_TYPES = {
      school: ['primary','secondary','university','nursery'],
      church: ['catholic','protestant','orthodox','mosque','other'],
      health: ['hospital','clinic','pharmacy','laboratory'],
      business: ['retail','wholesale','service','manufacturing'],
      organization: ['ngo','cbo','company','government'],
      individual: [],
      hotel: [], restaurant: [], salon: [], pharmacy: [], gym: [], supermarket: [], retail: [], clinic: []
    };
    if (sub_type && VALID_SUB_TYPES[type] && !VALID_SUB_TYPES[type].includes(sub_type)) {
      sub_type = null;
    }
    if (!org_name || !email || !phone || !password) {
      return res.send('<div style="text-align:center;padding:60px"><h2>Error</h2><p>All fields are required.</p><a href="/register?type='+esc(type||'')+'">Go Back</a></div>');
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.send('<div style="text-align:center;padding:60px"><h2>Weak Password</h2><p>Password must be 8+ characters with at least 1 uppercase letter and 1 number.</p><a href="/register?type='+esc(type||'')+'">Go Back</a></div>');
    }
    if (password !== confirm_password) {
      return res.send('<div style="text-align:center;padding:60px"><h2>Password Mismatch</h2><p>Passwords do not match.</p><a href="/register?type='+esc(type||'')+'">Go Back</a></div>');
    }
    try {
      const hash = await bcrypt.hash(password, 12);
      const baseDomain = org_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const subdomain = (baseDomain.length > 2 ? baseDomain : 'tenant') + '-' + Math.floor(Math.random() * 9999);
      const tenant = await pool.query(
        'INSERT INTO tenants(name,type,sub_type,email,phone,subdomain,approved,verified) VALUES($1,$2,$3,$4,$5,$6,true,true) RETURNING id',
        [org_name, type, sub_type || null, email, phone, subdomain]
      );
      const tid = tenant.rows[0].id;
      try {
        await pool.query('INSERT INTO users(tenant_id,email,password,password_hash,role,approved) VALUES($1,$2,$3,$3,$4,true)', [tid, email, hash, 'admin']);
      } catch(e) {
        await pool.query('INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,$4,true)', [tid, email, hash, 'admin']);
      }
      try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status) VALUES($1,$2,$3,$4)', [tid, 'free', 0, 'active']); } catch(e) {}
      await audit(email, 'register', 'New ' + type + ' account: ' + org_name + (sub_type ? ' (' + sub_type + ')' : ''));
      sendEmail(email, 'Welcome to Comfort!', '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:30px"><h1 style="color:#4f46e5">Welcome to Comfort!</h1><p>Your <strong>' + esc(org_name) + '</strong> account is ready.</p><a href="' + (process.env.BASE_URL || 'https://ssewasswa.onrender.com') + '/login" style="display:inline-block;padding:14px 32px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:700;margin:20px 0">Login to Dashboard</a></div>');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account Created — Comfort</title>
<style>body{font-family:-apple-system,sans-serif;background:#f0fdf4;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
.card{background:white;border-radius:20px;padding:48px 32px;max-width:480px;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
h1{font-size:28px;color:#059669;margin-bottom:8px} p{color:#475569;margin-bottom:24px}
.btn{display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px}
</style></head><body><div class="card"><div style="font-size:48px;margin-bottom:16px">🎉</div><h1>Account Created!</h1><p>Your <strong>${esc(org_name)}</strong> account is ready. Check your email for a welcome message.</p><a href="/login" class="btn">Login to Dashboard →</a></div></body></html>`;
      res.send(html);
    } catch(e) {
      res.send('<div style="text-align:center;padding:60px"><h2>Error</h2><p>' + esc(e.message) + '</p><a href="/register?type='+esc(type||'')+'">Go Back</a></div>');
    }
  }));
  */

  // ============================================================
  // PUBLIC PAGES
  // ============================================================
  app.get('/about', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>About — Comfort</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
nav{background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
nav .logo{font-size:20px;font-weight:900;color:#4f46e5}nav a{color:#475569;font-size:14px;text-decoration:none;margin-left:20px}
.container{max-width:800px;margin:40px auto;padding:0 20px}h1{font-size:32px;margin-bottom:8px}.sub{color:#64748b;margin-bottom:32px;line-height:1.8}
.values{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin:32px 0}
.value{background:white;border-radius:14px;padding:24px;border:1px solid #e2e8f0}.value h3{color:#4f46e5;margin-bottom:8px}
.cta{text-align:center;margin:40px 0;padding:40px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:20px;color:white}
.cta h2{margin-bottom:12px}.cta a{display:inline-block;padding:14px 32px;background:white;color:#4f46e5;border-radius:10px;font-weight:700;text-decoration:none}
footer{text-align:center;padding:24px;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;margin-top:40px}
</style></head><body><nav><div class="logo">◆ Comfort</div><div><a href="/">Home</a><a href="/register">Register</a><a href="/login">Login</a></div></nav>
<div class="container"><h1>About Comfort</h1><p class="sub">Comfort is Uganda's first all-in-one management platform built specifically for African institutions. We believe every school, hotel, restaurant, clinic, salon, and business deserves access to world-class management software — without the world-class price tag.</p>
<div class="values">
<div class="value"><h3>🎯 Our Mission</h3><p style="font-size:14px;color:#475569">To empower 1 million African institutions with affordable, accessible technology that simplifies operations and drives growth.</p></div>
<div class="value"><h3>🌍 Built for Africa</h3><p style="font-size:14px;color:#475569">Offline-first, mobile money payments, UGX pricing, Uganda tax compliance, and features designed for how African businesses actually work.</p></div>
<div class="value"><h3>🔒 Secure & Private</h3><p style="font-size:14px;color:#475569">End-to-end encryption, role-based access, audit logging, two-factor authentication. Your data stays yours.</p></div>
<div class="value"><h3>💡 Always Improving</h3><p style="font-size:14px;color:#475569">New features every week based on feedback from real institutions across Uganda, Kenya, Tanzania, and beyond.</p></div>
</div>
<div class="cta"><h2>Ready to get started?</h2><a href="/register">Start Free Today →</a></div>
</div><footer>© ${new Date().getFullYear()} Comfort Platform — Built with ♥ in Uganda</footer></body></html>`);
  });

  app.get('/contact', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contact — Comfort</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
nav{background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
nav .logo{font-size:20px;font-weight:900;color:#4f46e5}nav a{color:#475569;font-size:14px;text-decoration:none;margin-left:20px}
.container{max-width:600px;margin:40px auto;padding:0 20px}
.card{background:white;border-radius:16px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
h1{text-align:center;margin-bottom:24px}label{font-size:13px;font-weight:600;color:#475569;display:block;margin-top:8px}
input,select,textarea{width:100%;padding:12px;margin:6px 0;border:2px solid #e2e8f0;border-radius:10px;font-size:15px;font-family:inherit;transition:border 0.2s}
input:focus,textarea:focus{outline:none;border-color:#4f46e5}textarea{min-height:120px;resize:vertical}
.btn{display:block;width:100%;padding:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px}
.info{text-align:center;margin-top:24px;color:#64748b;font-size:14px}
</style></head><body><nav><div class="logo">◆ Comfort</div><div><a href="/">Home</a><a href="/register">Register</a><a href="/login">Login</a></div></nav>
<div class="container"><div class="card"><h1>Get in Touch</h1>
<form method="POST" action="/contact">
<input type="hidden" name="_csrf" value="${req.csrfToken}">
<label>Name *</label><input name="name" required>
<label>Email *</label><input name="email" type="email" required>
<label>Phone</label><input name="phone">
<label>Subject *</label><select name="subject" required><option value="">Select...</option><option>Sales Inquiry</option><option>Technical Support</option><option>Partnership</option><option>Feature Request</option><option>Bug Report</option><option>Other</option></select>
<label>Message *</label><textarea name="message" required placeholder="How can we help?"></textarea>
<button type="submit" class="btn">Send Message</button>
</form></div>
<div class="info">Or email us at <a href="mailto:hello@comfort.ug">hello@comfort.ug</a> | WhatsApp: <a href="https://wa.me/256700000000">+256 700 000 000</a></div>
</div></body></html>`);
  });

  app.post('/contact', ah(async (req, res) => {
    const { name, email, phone, subject, message } = req.body;
    // Validate inputs
    if (!name || !email || !message || name.length > 255 || email.length > 255 || (subject && subject.length > 255) || message.length > 5000) {
      return res.status(400).send('Invalid input. Please check your entries.');
    }
    // Sanitize subject to prevent email header injection
    const safeSubject = (subject || 'Contact Form Inquiry').replace(/[\r\n]/g, '').substring(0, 255);
    await pool.query('INSERT INTO contact_messages(name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5)', [name, email, phone, safeSubject, message]);
    sendEmail('hello@comfort.ug', 'Contact: ' + safeSubject, '<p><strong>' + esc(name) + '</strong> (' + esc(email) + ')</p><p>' + esc(message) + '</p>');
    res.send('<div style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:16px">✅</div><h1>Message Sent!</h1><p style="color:#64748b">We\'ll get back to you within 24 hours.</p><a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:600">Back to Home</a></div>');
  }));

  app.get('/features', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Features — Comfort</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
nav{background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
nav .logo{font-size:20px;font-weight:900;color:#4f46e5}nav a{color:#475569;font-size:14px;text-decoration:none;margin-left:20px}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px;text-align:center}
.hero h1{font-size:36px;font-weight:900;margin-bottom:8px}.hero p{opacity:0.9;font-size:18px}
.container{max-width:1000px;margin:0 auto;padding:40px 20px}
.cat{margin-bottom:48px}.cat h2{font-size:24px;font-weight:800;margin-bottom:4px;color:#1e293b}.cat p{color:#64748b;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.feat{background:white;padding:20px;border-radius:12px;border:1px solid #e2e8f0}
.feat h4{font-size:15px;font-weight:700;margin-bottom:6px;color:#4f46e5}.feat p{font-size:13px;color:#475569;line-height:1.6}
footer{text-align:center;padding:24px;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0}
</style></head><body><nav><div class="logo">◆ Comfort</div><div><a href="/">Home</a><a href="/register">Register</a><a href="/login">Login</a></div></nav>
<div class="hero"><h1>100+ Features. One Platform.</h1><p>Everything you need to run your institution, built in.</p></div>
<div class="container">
<div class="cat"><h2>🏫 School Management</h2><p>From admissions to graduation</p><div class="grid">
<div class="feat"><h4>Student Records</h4><p>Complete student profiles with photos, parent info, medical records, and academic history.</p></div>
<div class="feat"><h4>Fee Management</h4><p>Track fees, generate receipts, send reminders via SMS/email, accept mobile money.</p></div>
<div class="feat"><h4>Exams &amp; Report Cards</h4><p>Create exams, enter marks, auto-calculate grades, generate beautiful report cards (DOCX).</p></div>
<div class="feat"><h4>Attendance</h4><p>Daily attendance tracking with biometric support, absence alerts, and analytics.</p></div>
<div class="feat"><h4>Parent Portal</h4><p>Parents can view fees, attendance, marks, and communicate with teachers online.</p></div>
<div class="feat"><h4>Transport &amp; Hostel</h4><p>Manage school buses, routes, hostel rooms, and allocations.</p></div>
</div></div>
<div class="cat"><h2>🏨 Hotel &amp; Restaurant</h2><p>Complete hospitality management</p><div class="grid">
<div class="feat"><h4>Room Booking</h4><p>Manage rooms, check availability, accept reservations, and track occupancy in real-time.</p></div>
<div class="feat"><h4>Restaurant POS</h4><p>Digital menu, order management, kitchen display system, table reservations.</p></div>
<div class="feat"><h4>Guest Ledger</h4><p>Track all charges, payments, and services for each guest stay.</p></div>
<div class="feat"><h4>Housekeeping</h4><p>Task management for cleaning, maintenance, and room inspections.</p></div>
</div></div>
<div class="cat"><h2>🛍️ Retail &amp; Business</h2><p>POS, inventory, CRM, and more</p><div class="grid">
<div class="feat"><h4>Point of Sale</h4><p>Fast, reliable POS with barcode scanning, receipt generation, and multi-payment support.</p></div>
<div class="feat"><h4>Inventory</h4><p>Track stock levels, get low-stock alerts, manage purchase orders and suppliers.</p></div>
<div class="feat"><h4>CRM &amp; Invoicing</h4><p>Manage leads, create professional invoices, track payments, and nurture customers.</p></div>
<div class="feat"><h4>Payroll &amp; HR</h4><p>Auto-calculate Uganda PAYE and NSSF, manage leave, and generate payslips.</p></div>
</div></div>
<div class="cat"><h2>🔧 Platform Features</h2><p>Powering everything</p><div class="grid">
<div class="feat"><h4>Offline Mode</h4><p>Works without internet. Syncs automatically when you're back online.</p></div>
<div class="feat"><h4>Mobile App</h4><p>Install on your phone like a native app. Works on Android and iOS.</p></div>
<div class="feat"><h4>REST API</h4><p>Full JSON API for integrations with other tools and custom apps.</p></div>
<div class="feat"><h4>Multi-Currency</h4><p>Support for UGX, USD, KES, TZS, EUR, GBP, and more with auto FX rates.</p></div>
<div class="feat"><h4>White-Label</h4><p>Custom branding with your logo, colors, and even custom domain.</p></div>
<div class="feat"><h4>AI-Powered</h4><p>Smart analytics, fee default prediction, dropout risk alerts, and more.</p></div>
</div></div>
</div>
<footer>© ${new Date().getFullYear()} Comfort Platform — <a href="/register" style="color:#4f46e5">Start Free</a></footer></body></html>`);
  });

  // Tenant public profile (public-only, must not intercept authenticated portal routes)
  app.get('/portal/:subdomain', ah(async (req, res, next) => {
    const subdomain = req.params.subdomain;
    // If user is authenticated, let the authenticated portal routes handle it
    if (req.session && req.session.user) return next();
    // Skip reserved system routes — redirect to the actual page
    const reserved = ['login','register','dashboard','settings','billing','admin','api','static','public','news','blog','about','contact','privacy','terms','help','faq','features','pricing','test','assets','css','js','images','icon','favicon','manifest','sw','p','entertainment','fundraising','dev'];
    if (reserved.includes(subdomain)) return res.redirect('/' + subdomain);
    // Skip known portal type names (handled by authenticated routes in server.js)
    const portalTypes = ['school','clinic','health','church','organization','business','individual','hotel','restaurant','retail','salon','pharmacy','gym','hardware','supermarket','transport','electronics'];
    if (portalTypes.includes(subdomain)) return next();
    // Look up tenant by subdomain for the public profile page
    const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1 AND approved=true', [req.params.subdomain])).rows[0];
    if (!tenant) return res.status(404).send('<div style="text-align:center;padding:60px"><h1>Institution Not Found</h1><p style="color:#64748b">This institution does not exist or is not approved.</p><a href="/">Go to Comfort Home</a></div>');
    const typeLabels = {school:'School',clinic:'Clinic',health:'Health Center',church:'Church',hotel:'Hotel/Lodge',restaurant:'Restaurant',retail:'Retail Shop',salon:'Salon/Spa',pharmacy:'Pharmacy',gym:'Gym/Fitness',hardware:'Hardware Store',supermarket:'Supermarket',transport:'Transport',electronics:'Electronics Shop',business:'Business',individual:'Individual',organization:'Organization'};
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tenant.name)} — Comfort</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px;text-align:center}
.hero h1{font-size:36px;font-weight:900;margin-bottom:8px}.hero .badge{display:inline-block;padding:6px 16px;background:rgba(255,255,255,0.2);border-radius:20px;font-size:14px;margin-bottom:16px}
.container{max-width:600px;margin:40px auto;padding:0 20px}
.card{background:white;border-radius:16px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid #e2e8f0;margin-bottom:20px}
.btn{display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px}
.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
.info-row .label{color:#64748b}.info-row .value{font-weight:600}
</style></head><body>
<div class="hero"><div class="badge">${esc(typeLabels[tenant.type] || tenant.type)}</div><h1>${esc(tenant.name)}</h1>${tenant.sub_type ? '<p style="opacity:0.9">'+esc(tenant.sub_type)+'</p>' : ''}</div>
<div class="container">
<div class="card"><div class="info-row"><span class="label">Type</span><span class="value">${esc(typeLabels[tenant.type] || tenant.type)}</span></div>${tenant.sub_type ? '<div class="info-row"><span class="label">Category</span><span class="value">'+esc(tenant.sub_type)+'</span></div>' : ''}<div class="info-row"><span class="label">Email</span><span class="value">${esc(tenant.email)}</span></div>${tenant.phone ? '<div class="info-row"><span class="label">Phone</span><span class="value">'+esc(tenant.phone)+'</span></div>' : ''}</div>
<div style="text-align:center"><a href="/login" class="btn">Login to Dashboard</a></div>
</div></body></html>`);
  }));

  console.log('[PublicPortal] Landing page, registration, and public pages loaded');
};
