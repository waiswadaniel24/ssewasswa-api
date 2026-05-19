// ============================================================
// PUBLIC PORTAL — Landing page, Registration, Public pages
// Comfort Platform - Multi-tenant SaaS for African Institutions
// ============================================================
module.exports = function(app, pool, bcrypt, ah, esc, renderPage, audit, sendEmail, queueEmail, logger) {

  // === WHATSAPP CONFIG ===
  // Check both env vars — WHATSAPP_NUMBE (typo key) has the correct number
  const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBE || process.env.WHATSAPP_NUMBER || '256752971118';
  const WHATSAPP_LINK = 'https://wa.me/' + WHATSAPP_NUMBER;
  const WHATSAPP_DISPLAY = '+' + WHATSAPP_NUMBER.replace(/^256/, '256 ').replace(/(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');

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
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comfort — The Operating System for African Institutions</title>
<meta name="description" content="All-in-one management platform for Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches and Businesses in Africa">
<meta property="og:title" content="Comfort Platform — Management Software for Africa">
<meta property="og:description" content="Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches — One Platform. Built for Uganda.">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}">
<link rel="canonical" href="${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}">
<meta name="robots" content="index, follow">
<link rel="icon" href="/favicon.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#059669">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Comfort">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="apple-touch-icon" sizes="152x152" href="/icon-152.png">
<link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png">
<script>
// CRITICAL: Capture beforeinstallprompt EARLY in <head> before any other scripts.
// This event fires when Chrome evaluates PWA criteria, which can happen
// before body scripts execute. Previous bug: listener was at bottom of page.
window._pwaPrompt=null;
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault();
  window._pwaPrompt=e;
  console.log('[PWA] beforeinstallprompt captured in <head> — install is available');
  // Signal to buttons that install is ready
  window._pwaReady=true;
  // If buttons already exist, update them
  var nb=document.getElementById('nav-install-btn');
  if(nb){nb.style.opacity='1';nb.title='Install app on your device';}
  var mb=document.getElementById('mobile-install-btn');
  if(mb){mb.style.opacity='1';}
  var fb=document.getElementById('float-install-btn');
  if(fb){fb.style.opacity='1';}
});
</script>
<style>
:root {
  --navy-900: #0f172a;
  --navy-800: #1e293b;
  --navy-700: #334155;
  --navy-600: #475569;
  --navy-500: #64748b;
  --navy-400: #94a3b8;
  --navy-300: #cbd5e1;
  --navy-200: #e2e8f0;
  --navy-100: #f1f5f9;
  --navy-50: #f8fafc;
  --emerald: #059669;
  --emerald-light: #d1fae5;
  --radius: 12px;
  --radius-lg: 20px;
  --shadow-sm: 0 1px 3px rgba(15,23,42,0.06);
  --shadow: 0 4px 16px rgba(15,23,42,0.08);
  --shadow-lg: 0 12px 40px rgba(15,23,42,0.12);
  --shadow-xl: 0 20px 60px rgba(15,23,42,0.15);
  --transition: 0.3s cubic-bezier(0.4,0,0.2,1);
}
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--navy-50); color: var(--navy-800); line-height: 1.7; overflow-x: hidden; }
a { color: inherit; text-decoration: none; }
ul { list-style: none; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

@keyframes fadeInUp { from { opacity: 0; transform: translateY(32px); } to { opacity: 1; transform: translateY(0); } }
@keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

.reveal { opacity: 0; transform: translateY(32px); transition: opacity 0.7s cubic-bezier(0.4,0,0.2,1), transform 0.7s cubic-bezier(0.4,0,0.2,1); }
.reveal.visible { opacity: 1; transform: translateY(0); }
.reveal-delay-1 { transition-delay: 0.1s; }
.reveal-delay-2 { transition-delay: 0.2s; }
.reveal-delay-3 { transition-delay: 0.3s; }
.reveal-delay-4 { transition-delay: 0.4s; }

.navbar { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; padding: 0 24px; transition: var(--transition); }
.navbar.scrolled { background: rgba(255,255,255,0.82); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border-bottom: 1px solid rgba(15,23,42,0.06); box-shadow: 0 1px 12px rgba(15,23,42,0.04); }
.navbar-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; height: 72px; }
.nav-logo { font-size: 22px; font-weight: 800; color: var(--navy-900); display: flex; align-items: center; gap: 10px; letter-spacing: -0.5px; }
.nav-logo .logo-mark { width: 36px; height: 36px; background: linear-gradient(135deg, var(--navy-900), var(--navy-700)); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; font-weight: 900; }
.nav-links { display: flex; align-items: center; gap: 4px; }
.nav-links a { font-size: 14px; font-weight: 500; color: var(--navy-600); padding: 8px 16px; border-radius: 8px; transition: var(--transition); }
.nav-links a:hover { color: var(--navy-900); background: var(--navy-100); }
.nav-actions { display: flex; align-items: center; gap: 12px; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 24px; border-radius: var(--radius); font-weight: 600; font-size: 14px; border: none; cursor: pointer; transition: var(--transition); white-space: nowrap; }
.btn:hover { transform: translateY(-1px); }
.btn-ghost { background: transparent; color: var(--navy-600); font-weight: 500; }
.btn-ghost:hover { color: var(--navy-900); background: var(--navy-100); transform: none; }
.btn-primary { background: var(--navy-900); color: white; box-shadow: 0 2px 8px rgba(15,23,42,0.2); }
.btn-primary:hover { background: var(--navy-800); box-shadow: 0 4px 16px rgba(15,23,42,0.25); }
.btn-outline { background: transparent; color: var(--navy-600); border: 1.5px solid var(--navy-200); }
.btn-outline:hover { border-color: var(--navy-900); color: var(--navy-900); }
.btn-white { background: white; color: var(--navy-900); box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
.btn-white:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
.btn-glass { background: rgba(255,255,255,0.15); color: white; border: 1.5px solid rgba(255,255,255,0.3); backdrop-filter: blur(4px); }
.btn-glass:hover { background: rgba(255,255,255,0.25); border-color: rgba(255,255,255,0.5); }
.btn-lg { padding: 14px 32px; font-size: 16px; border-radius: var(--radius); }
.hamburger { display: none; background: none; border: none; width: 40px; height: 40px; cursor: pointer; border-radius: 8px; align-items: center; justify-content: center; transition: var(--transition); position: relative; z-index: 1001; }
.hamburger:hover { background: var(--navy-100); }
.hamburger span { display: block; width: 20px; height: 2px; background: var(--navy-900); border-radius: 2px; transition: var(--transition); position: relative; }
.hamburger span::before, .hamburger span::after { content: ''; position: absolute; width: 20px; height: 2px; background: var(--navy-900); border-radius: 2px; transition: var(--transition); }
.hamburger span::before { top: -6px; }
.hamburger span::after { bottom: -6px; }
.hamburger.active span { background: transparent; }
.hamburger.active span::before { top: 0; transform: rotate(45deg); }
.hamburger.active span::after { bottom: 0; transform: rotate(-45deg); }
.mobile-menu { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.98); backdrop-filter: blur(20px); z-index: 999; padding: 100px 32px 32px; flex-direction: column; gap: 4px; opacity: 0; transform: translateY(-10px); transition: opacity 0.3s, transform 0.3s; }
.mobile-menu.open { display: flex; opacity: 1; transform: translateY(0); }
.mobile-menu a { font-size: 18px; font-weight: 500; color: var(--navy-800); padding: 14px 16px; border-radius: var(--radius); transition: var(--transition); }
.mobile-menu a:hover { background: var(--navy-100); color: var(--navy-900); }
.mobile-menu .mobile-actions { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--navy-200); display: flex; flex-direction: column; gap: 12px; }
.mobile-menu .mobile-actions .btn { width: 100%; justify-content: center; padding: 14px; }

.hero { position: relative; min-height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 120px 24px 80px; }
.hero-bg { position: absolute; inset: 0; background: linear-gradient(-45deg, #0f172a, #1e3a5f, #0f172a, #162544); background-size: 400% 400%; animation: gradientShift 15s ease infinite; z-index: 0; }
.hero-bg::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.06), transparent), radial-gradient(circle at 20% 80%, rgba(5,150,105,0.15), transparent 50%), radial-gradient(circle at 80% 20%, rgba(14,165,233,0.12), transparent 50%); }
.hero-grid-overlay { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px); background-size: 60px 60px; z-index: 1; }
.hero-content { position: relative; z-index: 2; text-align: center; max-width: 800px; margin: 0 auto; animation: fadeInUp 0.8s ease-out; }
.hero-badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 100px; padding: 6px 18px 6px 8px; color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 500; margin-bottom: 32px; backdrop-filter: blur(8px); }
.hero-badge-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; animation: pulse 2s infinite; }
.hero h1 { font-size: clamp(36px, 6vw, 68px); font-weight: 800; color: white; line-height: 1.08; letter-spacing: -1.5px; margin-bottom: 24px; }
.hero h1 .highlight { background: linear-gradient(135deg, #22c55e, #14b8a6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.hero-subtitle { font-size: clamp(16px, 2.2vw, 20px); color: rgba(255,255,255,0.7); max-width: 600px; margin: 0 auto 40px; line-height: 1.7; font-weight: 400; }
.hero-buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 48px; }
.hero-trust { display: flex; align-items: center; justify-content: center; gap: 32px; flex-wrap: wrap; color: rgba(255,255,255,0.5); font-size: 13px; font-weight: 500; }
.hero-trust span { display: flex; align-items: center; gap: 6px; }
.hero-trust .check { color: #22c55e; font-size: 15px; }
.hero-visual { position: absolute; bottom: -2px; left: 0; right: 0; height: 120px; background: linear-gradient(to top, var(--navy-50), transparent); z-index: 3; }

.stats-bar { position: relative; z-index: 10; margin-top: -60px; margin-bottom: 0; padding: 0 24px; }
.stats-inner { max-width: 900px; margin: 0 auto; background: white; border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--navy-200); overflow: hidden; }
.stat-item { padding: 36px 24px; text-align: center; position: relative; }
.stat-item:not(:last-child)::after { content: ''; position: absolute; right: 0; top: 20%; height: 60%; width: 1px; background: var(--navy-200); }
.stat-number { font-size: clamp(28px, 4vw, 42px); font-weight: 800; color: var(--navy-900); letter-spacing: -1px; line-height: 1.2; }
.stat-label { font-size: 13px; font-weight: 500; color: var(--navy-500); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

.section { padding: 120px 24px; }
.section-header { text-align: center; max-width: 640px; margin: 0 auto 64px; }
.section-label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--emerald); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px; }
.section-label::before, .section-label::after { content: ''; width: 20px; height: 1.5px; background: var(--emerald); border-radius: 2px; opacity: 0.5; }
.section-title { font-size: clamp(28px, 4vw, 44px); font-weight: 800; color: var(--navy-900); letter-spacing: -0.5px; line-height: 1.15; margin-bottom: 16px; }
.section-desc { font-size: 17px; color: var(--navy-500); line-height: 1.7; }
.section-bg-light { background: var(--navy-50); }
.section-bg-dark { background: var(--navy-900); color: white; }

.features-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 24px; }
.feature-card { background: white; border-radius: var(--radius-lg); padding: 32px; border: 1px solid var(--navy-200); transition: var(--transition); position: relative; overflow: hidden; }
.feature-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--card-accent, var(--emerald)); transform: scaleX(0); transform-origin: left; transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); }
.feature-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-lg); border-color: transparent; }
.feature-card:hover::before { transform: scaleX(1); }
.feature-icon { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; color: white; margin-bottom: 20px; position: relative; overflow: hidden; }
.feature-icon::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.2), transparent); border-radius: inherit; }
.feature-card h3 { font-size: 18px; font-weight: 700; color: var(--navy-900); margin-bottom: 4px; }
.feature-price { font-size: 13px; font-weight: 600; color: var(--navy-500); margin-bottom: 16px; }
.feature-list { font-size: 13.5px; color: var(--navy-600); line-height: 2.1; }
.feature-list li { display: flex; align-items: center; gap: 8px; }
.feature-list li::before { content: ''; width: 16px; height: 16px; min-width: 16px; background: var(--emerald-light); border-radius: 50%; display: flex; align-items: center; justify-content: center; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23059669' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: center; background-size: 10px; }
.feature-cta { margin-top: 20px; display: block; text-align: center; width: 100%; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: var(--radius); color: white; transition: var(--transition); text-decoration: none; }
.feature-cta:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); text-decoration: none; color: white; }

.pricing-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; max-width: 1100px; margin: 0 auto; }
.pricing-card { background: white; border-radius: var(--radius-lg); padding: 36px 28px; border: 1.5px solid var(--navy-200); transition: var(--transition); position: relative; display: flex; flex-direction: column; }
.pricing-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
.pricing-card.featured { border-color: var(--navy-900); box-shadow: var(--shadow-lg); transform: scale(1.04); z-index: 1; }
.pricing-card.featured:hover { transform: scale(1.04) translateY(-4px); box-shadow: var(--shadow-xl); }
.pricing-popular { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: var(--navy-900); color: white; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 6px 20px; border-radius: 100px; }
.pricing-tier { font-size: 16px; font-weight: 700; color: var(--navy-900); margin-bottom: 8px; }
.pricing-amount { display: flex; align-items: baseline; gap: 4px; margin-bottom: 24px; }
.pricing-currency { font-size: 18px; font-weight: 700; color: var(--navy-900); }
.pricing-value { font-size: 44px; font-weight: 800; color: var(--navy-900); letter-spacing: -1px; line-height: 1; }
.pricing-period { font-size: 14px; color: var(--navy-500); font-weight: 500; }
.pricing-features { flex: 1; margin-bottom: 28px; }
.pricing-features li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: var(--navy-600); padding: 6px 0; }
.pricing-features li .check-icon { width: 18px; height: 18px; min-width: 18px; background: var(--emerald-light); border-radius: 50%; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23059669' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: center; background-size: 10px; margin-top: 2px; }
.pricing-card .btn { width: 100%; justify-content: center; padding: 12px 24px; }

.testimonials-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; max-width: 1100px; margin: 0 auto; }
.testimonial-card { background: white; border-radius: var(--radius-lg); padding: 36px; border: 1px solid var(--navy-200); transition: var(--transition); position: relative; }
.testimonial-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: transparent; }
.testimonial-quote-mark { font-size: 48px; line-height: 1; color: var(--navy-200); font-family: Georgia, serif; margin-bottom: -8px; }
.testimonial-stars { display: flex; gap: 2px; margin-bottom: 16px; }
.testimonial-stars span { color: #f59e0b; font-size: 16px; }
.testimonial-text { font-size: 15px; color: var(--navy-600); line-height: 1.8; margin-bottom: 24px; font-style: italic; }
.testimonial-author { display: flex; align-items: center; gap: 12px; }
.testimonial-avatar { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; color: white; }
.testimonial-info h4 { font-size: 14px; font-weight: 700; color: var(--navy-900); }
.testimonial-info p { font-size: 12px; color: var(--navy-500); font-weight: 500; }

.faq-container { max-width: 760px; margin: 0 auto; }
.faq-item { background: white; border-radius: var(--radius); margin-bottom: 12px; border: 1px solid var(--navy-200); overflow: hidden; transition: var(--transition); }
.faq-item:hover { border-color: var(--navy-300); }
.faq-item.open { border-color: var(--navy-400); box-shadow: var(--shadow-sm); }
.faq-question { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; cursor: pointer; font-size: 15px; font-weight: 600; color: var(--navy-900); transition: var(--transition); gap: 16px; user-select: none; }
.faq-question:hover { color: var(--navy-700); }
.faq-icon { width: 28px; height: 28px; min-width: 28px; border-radius: 8px; background: var(--navy-100); display: flex; align-items: center; justify-content: center; transition: var(--transition); }
.faq-icon svg { width: 14px; height: 14px; stroke: var(--navy-600); transition: transform 0.3s; }
.faq-item.open .faq-icon { background: var(--navy-900); }
.faq-item.open .faq-icon svg { stroke: white; transform: rotate(180deg); }
.faq-answer { max-height: 0; overflow: hidden; transition: max-height 0.4s cubic-bezier(0.4,0,0.2,1), padding 0.3s; }
.faq-item.open .faq-answer { max-height: 300px; }
.faq-answer-inner { padding: 0 24px 20px; font-size: 14.5px; color: var(--navy-600); line-height: 1.8; }

.cta-section { position: relative; padding: 120px 24px; text-align: center; overflow: hidden; }
.cta-bg { position: absolute; inset: 0; background: linear-gradient(-45deg, #0f172a, #1a2744, #0f172a, #162a45); background-size: 400% 400%; animation: gradientShift 12s ease infinite; }
.cta-bg::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 30% 50%, rgba(5,150,105,0.2), transparent 60%), radial-gradient(circle at 70% 50%, rgba(14,165,233,0.15), transparent 60%); }
.cta-content { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; }
.cta-content h2 { font-size: clamp(28px, 4vw, 44px); font-weight: 800; color: white; letter-spacing: -0.5px; margin-bottom: 16px; }
.cta-content p { font-size: 18px; color: rgba(255,255,255,0.65); margin-bottom: 40px; line-height: 1.7; }
.cta-buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }

.footer { background: var(--navy-900); color: white; padding: 80px 24px 40px; }
.footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; max-width: 1200px; margin: 0 auto; padding-bottom: 48px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.footer-brand .footer-logo { font-size: 20px; font-weight: 800; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
.footer-brand .footer-logo .logo-mark { width: 32px; height: 32px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.footer-brand p { font-size: 14px; color: var(--navy-400); line-height: 1.8; max-width: 300px; }
.footer-col h4 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--navy-300); margin-bottom: 20px; }
.footer-col a { display: block; font-size: 14px; color: var(--navy-400); padding: 5px 0; transition: var(--transition); }
.footer-col a:hover { color: white; transform: translateX(2px); }
.footer-social { display: flex; gap: 12px; margin-top: 24px; }
.footer-social a { width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; font-size: 14px; color: var(--navy-400); transition: var(--transition); padding: 0; }
.footer-social a:hover { background: rgba(255,255,255,0.1); color: white; transform: none; }
.footer-bottom { max-width: 1200px; margin: 0 auto; padding-top: 32px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--navy-500); flex-wrap: wrap; gap: 16px; }
.footer-bottom-links { display: flex; gap: 24px; }
.footer-bottom-links a { font-size: 13px; color: var(--navy-500); transition: var(--transition); }
.footer-bottom-links a:hover { color: white; }

.whatsapp-float { position: fixed; bottom: 28px; right: 28px; width: 56px; height: 56px; background: #25d366; border-radius: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(37,211,102,0.4); z-index: 90; transition: var(--transition); text-decoration: none; color: white; }
.whatsapp-float:hover { transform: translateY(-3px) scale(1.05); box-shadow: 0 8px 30px rgba(37,211,102,0.5); text-decoration: none; }
.whatsapp-float svg { width: 28px; height: 28px; fill: white; }
.back-to-top { position: fixed; bottom: 28px; left: 28px; width: 44px; height: 44px; background: var(--navy-900); border-radius: 12px; display: none; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(15,23,42,0.3); z-index: 90; cursor: pointer; color: white; border: none; transition: var(--transition); }
.back-to-top:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(15,23,42,0.4); }
.back-to-top.visible { display: flex; }
.back-to-top svg { width: 20px; height: 20px; stroke: white; }
.cookie-banner { position: fixed; bottom: 0; left: 0; right: 0; background: var(--navy-900); color: white; padding: 16px 32px; z-index: 200; display: flex; align-items: center; justify-content: center; gap: 24px; flex-wrap: wrap; font-size: 14px; box-shadow: 0 -4px 30px rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.05); }
.cookie-banner a { color: #93c5fd; text-decoration: underline; }
.cookie-actions { display: flex; gap: 8px; }
.cookie-actions button { padding: 8px 20px; border-radius: 8px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; transition: var(--transition); }
.cookie-accept { background: var(--emerald); color: white; }
.cookie-accept:hover { background: #047857; }
.cookie-dismiss { background: transparent; color: var(--navy-400); border: 1px solid rgba(255,255,255,0.15) !important; }
.cookie-dismiss:hover { background: rgba(255,255,255,0.05); }

@media (max-width: 1024px) {
  .pricing-grid { grid-template-columns: repeat(2, 1fr); }
  .pricing-card.featured { transform: scale(1); }
  .pricing-card.featured:hover { transform: translateY(-4px); }
  .footer-grid { grid-template-columns: 1fr 1fr; gap: 40px; }
}
@media (max-width: 768px) {
  .nav-links, .nav-actions { display: none; }
  .hamburger { display: flex; }
  .hero { padding: 100px 20px 80px; min-height: auto; }
  .hero h1 { letter-spacing: -0.5px; }
  .stats-inner { grid-template-columns: repeat(2, 1fr); }
  .stat-item:nth-child(2)::after { display: none; }
  .section { padding: 80px 20px; }
  .section-header { margin-bottom: 48px; }
  .features-grid { grid-template-columns: 1fr; }
  .pricing-grid { grid-template-columns: 1fr; max-width: 420px; }
  .testimonials-grid { grid-template-columns: 1fr; max-width: 500px; }
  .footer-grid { grid-template-columns: 1fr; gap: 32px; }
  .footer-bottom { flex-direction: column; text-align: center; }
  .cta-section { padding: 80px 20px; }
  .cookie-banner { flex-direction: column; text-align: center; padding: 20px; gap: 16px; }
  .hero-buttons { flex-direction: column; align-items: stretch; }
  .hero-buttons .btn { width: 100%; }
  .cta-buttons { flex-direction: column; align-items: stretch; max-width: 320px; margin: 0 auto; }
}
</style>
</head>
<body>

<nav class="navbar" id="navbar">
  <div class="navbar-inner">
    <a href="/" class="nav-logo"><span class="logo-mark">C</span> Comfort</a>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/#pricing">Pricing</a>
      <a href="/#testimonials">Testimonials</a>
      <a href="/#faq">FAQ</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </div>
    <div class="nav-actions">
      <a href="/install" id="nav-install-btn" onclick="_pwaInstall();return false" style="font-size:13px;color:#10b981;font-weight:600;background:rgba(16,185,129,0.1);padding:8px 14px;border-radius:8px;text-decoration:none;align-items:center;gap:4px;cursor:pointer">&#128241; Install</a>
      <a href="/login" class="btn btn-ghost">Login</a>
      <a href="/register" class="btn btn-primary">Start Free</a>
    </div>
    <button class="hamburger" id="hamburger" aria-label="Toggle menu"><span></span></button>
  </div>
</nav>

<div class="mobile-menu" id="mobileMenu">
  <a href="/#features">Features</a>
  <a href="/#pricing">Pricing</a>
  <a href="/#testimonials">Testimonials</a>
  <a href="/#faq">FAQ</a>
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
  <a href="/blog">Blog</a>
  <a href="/help-center">Help Center</a>
  <div class="mobile-actions">
    <a href="/install" id="mobile-install-btn" onclick="_pwaInstall();return false" style="background:linear-gradient(135deg,#059669,#10b981);color:white;font-weight:600;padding:14px;border-radius:8px;text-align:center;text-decoration:none;cursor:pointer">&#128241; Install App</a>
    <a href="/login" class="btn btn-outline">Login</a>
    <a href="/register" class="btn btn-primary">Start Free</a>
  </div>
</div>

<section class="hero">
  <div class="hero-bg"></div>
  <div class="hero-grid-overlay"></div>
  <div class="hero-content">
    <div class="hero-badge"><span class="hero-badge-dot"></span> Trusted by 500+ institutions across Africa</div>
    <h1>The Operating System<br>for <span class="highlight">African</span> Institutions</h1>
    <p class="hero-subtitle">Schools, hotels, restaurants, salons, pharmacies, clinics, churches and businesses &mdash; one platform to run them all. Built for Uganda, designed for Africa.</p>
    <div class="hero-buttons">
      <a href="/register" class="btn btn-white btn-lg">Get Started Free &rarr;</a>
      <a href="/login" class="btn btn-glass btn-lg">Login</a>
    </div>
    <div class="hero-trust">
      <span><span class="check">&#10003;</span> No credit card required</span>
      <span><span class="check">&#10003;</span> Setup in 10 minutes</span>
      <span><span class="check">&#10003;</span> Works offline</span>
    </div>
  </div>
  <div class="hero-visual"></div>
</section>

<div class="stats-bar reveal" id="counters">
  <div class="stats-inner">
    <div class="stat-item"><div class="stat-number" data-target="500" data-suffix="+">0</div><div class="stat-label">Active Institutions</div></div>
    <div class="stat-item"><div class="stat-number" data-target="159" data-suffix="+">0</div><div class="stat-label">Features Built</div></div>
    <div class="stat-item"><div class="stat-number" data-target="15" data-suffix="+">0</div><div class="stat-label">Institution Types</div></div>
    <div class="stat-item"><div class="stat-number" data-target="99" data-suffix=".9%">0</div><div class="stat-label">Uptime</div></div>
  </div>
</div>

<section class="section" id="features">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Sectors</div>
      <h2 class="section-title">Built For Your Institution</h2>
      <p class="section-desc">Choose your sector and get a specialized dashboard with everything you need to manage, grow, and succeed.</p>
    </div>
    <div class="features-grid">
      ${PORTAL_TYPES.map((p, i) => `
      <div class="feature-card reveal reveal-delay-${(i % 4) + 1}" style="--card-accent:${p.color}">
        <div class="feature-icon" style="background:${p.color}">${p.label.charAt(0)}</div>
        <h3>${p.label}</h3>
        <div class="feature-price">${p.price === 'FREE' ? 'FREE Forever' : 'UGX '+p.price+'/month'}</div>
        <ul class="feature-list">${p.features.map(f => '<li>'+f+'</li>').join('')}</ul>
        <a href="/register?type=${p.type}" class="feature-cta" style="background:${p.color}">Start Free Trial</a>
      </div>`).join('')}
    </div>
  </div>
</section>

<section class="section section-bg-light" id="pricing">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Pricing</div>
      <h2 class="section-title">Simple, Transparent Pricing</h2>
      <p class="section-desc">Start free and upgrade when you need more. No hidden fees. Cancel anytime.</p>
    </div>
    <div class="pricing-grid">
      <div class="pricing-card reveal reveal-delay-1">
        <div class="pricing-tier">Free</div>
        <div class="pricing-amount"><span class="pricing-currency">UGX</span><span class="pricing-value">0</span><span class="pricing-period">/month</span></div>
        <ul class="pricing-features">
          <li><span class="check-icon"></span> Up to 100 records</li>
          <li><span class="check-icon"></span> Up to 3 users</li>
          <li><span class="check-icon"></span> All features included</li>
          <li><span class="check-icon"></span> Comfort branding</li>
          <li><span class="check-icon"></span> Email support</li>
          <li><span class="check-icon"></span> Mobile app</li>
        </ul>
        <a href="/register" class="btn btn-outline">Get Started Free</a>
      </div>
      <div class="pricing-card featured reveal reveal-delay-2">
        <div class="pricing-popular">Most Popular</div>
        <div class="pricing-tier">Basic</div>
        <div class="pricing-amount"><span class="pricing-currency">UGX</span><span class="pricing-value">100K</span><span class="pricing-period">/month</span></div>
        <ul class="pricing-features">
          <li><span class="check-icon"></span> Up to 1,000 records</li>
          <li><span class="check-icon"></span> Up to 10 users</li>
          <li><span class="check-icon"></span> All features</li>
          <li><span class="check-icon"></span> Custom branding</li>
          <li><span class="check-icon"></span> Priority support</li>
          <li><span class="check-icon"></span> Advanced reports</li>
        </ul>
        <a href="/register" class="btn btn-primary">Start 30-Day Free Trial</a>
      </div>
      <div class="pricing-card reveal reveal-delay-3">
        <div class="pricing-tier">Pro</div>
        <div class="pricing-amount"><span class="pricing-currency">UGX</span><span class="pricing-value">200K</span><span class="pricing-period">/month</span></div>
        <ul class="pricing-features">
          <li><span class="check-icon"></span> Up to 10,000 records</li>
          <li><span class="check-icon"></span> Up to 50 users</li>
          <li><span class="check-icon"></span> API access</li>
          <li><span class="check-icon"></span> White-label</li>
          <li><span class="check-icon"></span> Dedicated support</li>
          <li><span class="check-icon"></span> Analytics dashboard</li>
        </ul>
        <a href="/register" class="btn btn-outline">Start Free Trial</a>
      </div>
      <div class="pricing-card reveal reveal-delay-4">
        <div class="pricing-tier">Enterprise</div>
        <div class="pricing-amount"><span class="pricing-currency">UGX</span><span class="pricing-value">500K</span><span class="pricing-period">/month</span></div>
        <ul class="pricing-features">
          <li><span class="check-icon"></span> Unlimited records</li>
          <li><span class="check-icon"></span> Unlimited users</li>
          <li><span class="check-icon"></span> Custom domain</li>
          <li><span class="check-icon"></span> Custom integrations</li>
          <li><span class="check-icon"></span> SLA guarantee</li>
          <li><span class="check-icon"></span> Onboarding support</li>
        </ul>
        <a href="/contact" class="btn btn-outline">Contact Sales</a>
      </div>
    </div>
  </div>
</section>

<section class="section" id="testimonials">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">Testimonials</div>
      <h2 class="section-title">Trusted by Institutions Across Africa</h2>
      <p class="section-desc">See what our users say about transforming their operations with Comfort.</p>
    </div>
    <div class="testimonials-grid">
      <div class="testimonial-card reveal reveal-delay-1">
        <div class="testimonial-quote-mark">&ldquo;</div>
        <div class="testimonial-stars"><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span></div>
        <p class="testimonial-text">Comfort replaced 5 different tools we were using. Our school now runs everything from fees to report cards to parent communication in one place. The offline mode is a lifesaver when power goes out.</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar" style="background:#059669">G</div>
          <div class="testimonial-info"><h4>Grace Nakamya</h4><p>Headteacher, Sunrise Primary School &mdash; Kampala</p></div>
        </div>
      </div>
      <div class="testimonial-card reveal reveal-delay-2">
        <div class="testimonial-quote-mark">&ldquo;</div>
        <div class="testimonial-stars"><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span></div>
        <p class="testimonial-text">Managing our hotel's 45 rooms, reservations, and housekeeping was a nightmare with spreadsheets. Comfort's hotel module has everything we need. Revenue is up 30% since we started using it.</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar" style="background:#dc2626">R</div>
          <div class="testimonial-info"><h4>Robert Mugisha</h4><p>Manager, Pearl Gardens Hotel &mdash; Entebbe</p></div>
        </div>
      </div>
      <div class="testimonial-card reveal reveal-delay-3">
        <div class="testimonial-quote-mark">&ldquo;</div>
        <div class="testimonial-stars"><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span><span>&#9733;</span></div>
        <p class="testimonial-text">As a pharmacy, tracking expiry dates and prescriptions was critical. Comfort sends us alerts before drugs expire and the dispensing workflow is smooth. Our patients love the faster service.</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar" style="background:#2563eb">S</div>
          <div class="testimonial-info"><h4>Sarah Achieng</h4><p>Pharmacist, HealthFirst Pharmacy &mdash; Jinja</p></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section section-bg-light" id="faq">
  <div class="container">
    <div class="section-header reveal">
      <div class="section-label">FAQ</div>
      <h2 class="section-title">Frequently Asked Questions</h2>
      <p class="section-desc">Everything you need to know about getting started with Comfort.</p>
    </div>
    <div class="faq-container">
      <div class="faq-item reveal">
        <div class="faq-question"><span>Is Comfort really free to start?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Yes! The Free plan lets you manage up to 100 records with up to 3 users, forever. No credit card required. When you're ready to scale, upgrade to a paid plan.</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>Does it work offline?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Absolutely. Comfort is a Progressive Web App (PWA) that works offline. You can add data, take attendance, record sales, and more &mdash; everything syncs when you're back online.</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>Is my data secure?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Yes. All data is encrypted in transit (SSL/TLS) and at rest. We use role-based access control, audit logging, and two-factor authentication. Your data belongs to you.</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>Can I customize it for my business?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Yes! Each business type gets a specialized dashboard with features built specifically for that industry. You can also customize branding, colors, and logos.</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>What payment methods do you accept?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">We accept MTN Mobile Money, Airtel Money, bank transfers, and Flutterwave for card payments. All prices are in Uganda Shillings (UGX).</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>How long does setup take?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Most institutions are up and running in under 10 minutes. Just register, pick your institution type, and start adding data. Our team can help with data migration for larger setups.</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>Can I switch between business types?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Yes! If you start as a retail shop and later add a restaurant, you can enable multiple specializations. Each gets its own dedicated dashboard and features.</div></div>
      </div>
      <div class="faq-item reveal">
        <div class="faq-question"><span>Do you offer support?</span><span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span></div>
        <div class="faq-answer"><div class="faq-answer-inner">Yes &mdash; Free plan gets email support (24-48hr response). Basic and above get priority support via email, WhatsApp, and phone. Enterprise gets a dedicated account manager.</div></div>
      </div>
    </div>
  </div>
</section>

<section class="cta-section">
  <div class="cta-bg"></div>
  <div class="cta-content reveal">
    <h2>Ready to Transform<br>Your Institution?</h2>
    <p>Join 500+ institutions already using Comfort to streamline operations across Africa. Start free today.</p>
    <div class="cta-buttons">
      <a href="/register" class="btn btn-white btn-lg">Start Free &mdash; No Credit Card</a>
      <a href="/contact" class="btn btn-glass btn-lg">Talk to Sales</a>
    </div>
  </div>
</section>

<footer class="footer">
  <div class="footer-grid">
    <div class="footer-brand">
      <div class="footer-logo"><span class="logo-mark">C</span> Comfort</div>
      <p>The Operating System for African Institutions. One platform, all your operations. Built with care in Uganda.</p>
      <div class="footer-social">
        <a href="#" aria-label="Twitter">X</a>
        <a href="#" aria-label="Facebook">f</a>
        <a href="#" aria-label="LinkedIn">in</a>
        <a href="#" aria-label="Instagram">ig</a>
        <a href="${WHATSAPP_LINK}" aria-label="WhatsApp">W</a>
      </div>
    </div>
    <div class="footer-col"><h4>Product</h4><a href="/#features">Features</a><a href="/#pricing">Pricing</a><a href="/register">Register</a><a href="/login">Login</a><a href="/help-center">Help Center</a></div>
    <div class="footer-col"><h4>Company</h4><a href="/about">About Us</a><a href="/contact">Contact</a><a href="/blog/posts">Blog</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
    <div class="footer-col"><h4>Connect</h4><a href="#">Twitter / X</a><a href="#">Facebook</a><a href="#">LinkedIn</a><a href="#">Instagram</a><a href="${WHATSAPP_LINK}">WhatsApp</a></div>
  </div>
  <div class="footer-bottom">
    <span>&copy; ${new Date().getFullYear()} Comfort Platform. Built with &#9829; in Uganda. All rights reserved.</span>
    <div class="footer-bottom-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Support</a></div>
  </div>
</footer>

<a href="${WHATSAPP_LINK}" class="whatsapp-float" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
</a>

<button class="back-to-top" id="backToTop" aria-label="Back to top">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
</button>

<div id="float-install-btn" style="position:fixed;bottom:92px;right:28px;z-index:89;display:flex;flex-direction:column;align-items:center;gap:4px">
  <a href="/install" onclick="_pwaInstall();return false" style="display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#059669,#10b981);color:white;padding:12px 20px;border-radius:50px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 4px 20px rgba(5,150,105,0.4);font-family:sans-serif;animation:pulse-glow 2s ease-in-out infinite">&#128241; Install App</a>
  <style>@keyframes pulse-glow{0%,100%{box-shadow:0 4px 20px rgba(5,150,105,0.4)}50%{box-shadow:0 4px 30px rgba(5,150,105,0.7)}}</style>
</div>

<div class="cookie-banner" id="cookieBanner">
  <span>We use cookies to improve your experience. By continuing, you agree to our <a href="/privacy">Privacy Policy</a>.</span>
  <div class="cookie-actions">
    <button class="cookie-accept" onclick="handleCookieAccept()" type="button">Accept</button>
    <button class="cookie-dismiss" onclick="handleCookieDismiss()" type="button">Dismiss</button>
  </div>
</div>

<script>
// === GLOBAL COOKIE HANDLERS (must be at global scope for onclick to work) ===
function handleCookieAccept() {
  try { localStorage.setItem('cookieAccepted','1'); } catch(e) {}
  var b = document.getElementById('cookieBanner');
  if(b) b.style.display = 'none';
}
function handleCookieDismiss() {
  try { localStorage.setItem('cookieDismissed','1'); } catch(e) {}
  var b = document.getElementById('cookieBanner');
  if(b) b.style.display = 'none';
}

// === HIDE COOKIE BANNER IF ALREADY ACCEPTED ===
try {
  if(localStorage.getItem('cookieAccepted') || localStorage.getItem('cookieDismissed')) {
    var _cb = document.getElementById('cookieBanner');
    if(_cb) _cb.style.display = 'none';
  }
} catch(e) {}

// === SERVICE WORKER REGISTRATION ===
if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      console.log('[SW] Registered successfully, scope:',reg.scope);
    }).catch(function(err){
      console.warn('[SW] Registration failed:',err);
    });
  });
}

// === PWA INSTALL LOGIC (v9.0 — Fixed) ===
// NOTE: beforeinstallprompt is captured EARLY in <head> and stored in window._pwaPrompt
// This fixes the bug where the event fired before the body script ran.
var _isStandalone=window.matchMedia('(display-mode:standalone)').matches||window.navigator.standalone===true;

// === TOAST NOTIFICATION SYSTEM ===
function showToast(msg,type,duration){
  type=type||'info';duration=duration||4000;
  var existing=document.getElementById('pwa-toast');
  if(existing)existing.remove();
  var t=document.createElement('div');
  t.id='pwa-toast';
  var colors={success:'background:#059669;color:#fff',error:'background:#dc2626;color:#fff',info:'background:#1e293b;color:#fff',warning:'background:#d97706;color:#fff'};
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:14px 28px;border-radius:12px;font-weight:600;font-size:14px;z-index:10000;box-shadow:0 8px 30px rgba(0,0,0,0.2);transition:opacity 0.3s;max-width:90vw;text-align:center;font-family:sans-serif;'+(colors[type]||colors.info);
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.style.opacity='0';setTimeout(function(){if(t.parentNode)t.remove();},300);},duration);
}

// === INSTALL CLICK HANDLER ===
function _pwaInstall(){
  var prompt=window._pwaPrompt;
  if(prompt){
    console.log('[PWA] Triggering install prompt');
    prompt.prompt();
    prompt.userChoice.then(function(c){
      if(c.outcome==='accepted'){
        console.log('[PWA] User accepted the install prompt');
        showToast('App installed successfully!','success');
      } else {
        console.log('[PWA] User dismissed the install prompt');
        showToast('You can install later from the browser menu','info',5000);
      }
      window._pwaPrompt=null;
      _hidePwaBtns();
    }).catch(function(err){
      console.warn('[PWA] Install prompt error:',err);
      window._pwaPrompt=null;
      showToast('Install failed — try your browser menu','error');
    });
  } else {
    // No prompt available — show helpful instructions instead of silent redirect
    var isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent);
    var isSafari=/Safari/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent);
    if(isIOS||isSafari){
      showToast('Tap Share → "Add to Home Screen" to install','info',6000);
    } else if(/Android/.test(navigator.userAgent)){
      showToast('Tap browser menu ⋮ → "Install app" to install','info',6000);
    } else {
      showToast('Use browser menu or address bar icon to install','info',6000);
    }
    // Also redirect to install page after a brief delay so user sees the toast
    setTimeout(function(){window.location.href='/install';},2000);
  }
}

function _hidePwaBtns(){
  window._pwaPrompt=null;
  var fb=document.getElementById('float-install-btn');if(fb)fb.style.display='none';
  var nb=document.getElementById('nav-install-btn');if(nb)nb.style.display='none';
  var mb=document.getElementById('mobile-install-btn');if(mb)mb.style.display='none';
}

window.addEventListener('appinstalled',function(){
  console.log('[PWA] App installed event fired');
  showToast('App installed successfully!','success');
  _hidePwaBtns();
});

// Show install buttons always if not in standalone mode (PWA already installed)
if(_isStandalone){_hidePwaBtns();}

// === PWA INSTALL DEBUG CHECK ===
setTimeout(function(){
  if(!window._pwaPrompt && !_isStandalone){
    console.log('[PWA Debug] Install prompt NOT captured after 3s. Possible reasons:');
    console.log('  - App is already installed');
    console.log('  - Manifest missing or invalid');
    console.log('  - Service worker not registered');
    console.log('  - Not served over HTTPS');
    console.log('  - Browser does not support PWA install');
    // Check manifest
    fetch('/manifest.json').then(function(r){return r.json()}).then(function(m){
      console.log('[PWA Debug] Manifest loaded:',m.name,m.short_name,m.display);
      console.log('[PWA Debug] Icons:',(m.icons||[]).map(function(i){return i.sizes}).join(', '));
    }).catch(function(e){console.warn('[PWA Debug] Manifest fetch failed:',e)});
    // Check SW
    navigator.serviceWorker.getRegistration().then(function(r){
      console.log('[PWA Debug] SW registered:',!!r,r&&r.scope);
    });
    // Check if in iframe (PWA install requires top-level frame)
    if(window!==window.top){
      console.warn('[PWA Debug] Page is in iframe — PWA install requires top-level navigation');
    }
  } else if(window._pwaPrompt){
    console.log('[PWA Debug] Install prompt is available and ready');
  }
},3000);
(function(){
  var navbar = document.getElementById('navbar');
  if(!navbar) return;
  window.addEventListener('scroll', function(){
    if(window.scrollY > 20) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  });
})();
(function(){
  var hamburger = document.getElementById('hamburger');
  var menu = document.getElementById('mobileMenu');
  if(!hamburger || !menu) return;
  hamburger.addEventListener('click', function(){
    hamburger.classList.toggle('active');
    menu.classList.toggle('open');
    document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
  });
  menu.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', function(){
      hamburger.classList.remove('active');
      menu.classList.remove('open');
      document.body.style.overflow = '';
    });
  });
})();
document.querySelectorAll('a[href^="/#"]').forEach(function(a){
  a.addEventListener('click', function(e){
    var href = a.getAttribute('href');
    var targetId = href.replace('/#', '');
    var target = document.getElementById(targetId);
    if(target){ e.preventDefault(); target.scrollIntoView({behavior:'smooth', block:'start'}); }
  });
});
(function(){
  var reveals = document.querySelectorAll('.reveal');
  if(!reveals.length || !('IntersectionObserver' in window)) { reveals.forEach(function(el){ el.classList.add('visible'); }); return; }
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){ entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  reveals.forEach(function(el){ observer.observe(el); });
})();
(function(){
  var counters = document.querySelectorAll('.stat-number[data-target]');
  var animated = false;
  function animateCounters(){
    if(animated) return; animated = true;
    counters.forEach(function(el){
      var target = parseInt(el.getAttribute('data-target'));
      var suffix = el.getAttribute('data-suffix') || '+';
      var duration = 2000, startTime = null;
      function step(ts){
        if(!startTime) startTime = ts;
        var progress = Math.min((ts - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(eased * target) + (progress >= 1 ? suffix : '');
        if(progress < 1) requestAnimationFrame(step);
        else el.textContent = target + suffix;
      }
      requestAnimationFrame(step);
    });
  }
  if(counters.length > 0 && 'IntersectionObserver' in window){
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ animateCounters(); obs.disconnect(); } });
    }, {threshold: 0.3});
    obs.observe(document.getElementById('counters'));
  }
})();
(function(){
  var btn = document.getElementById('backToTop');
  if(!btn) return;
  window.addEventListener('scroll', function(){
    if(window.scrollY > 600) btn.classList.add('visible');
    else btn.classList.remove('visible');
  });
})();
document.querySelectorAll('.faq-item').forEach(function(item){
  item.addEventListener('click', function(){
    var wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(el){ el.classList.remove('open'); });
    if(!wasOpen) item.classList.add('open');
  });
});
</script>
</body>
</html>`;
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
<input name="phone" placeholder="+256 7XX XXX XXX" required>
<label>Password *</label>
<input name="password" type="password" id="pw" placeholder="Choose a password (min 4 chars)" required minlength="4" oninput="checkPw(this.value)">
<div class="pw-strength"><div class="pw-fill" id="pw-fill" style="width:0;background:#e5e7eb"></div></div>
<label>Confirm Password *</label>
<input name="confirm_password" type="password" placeholder="Re-enter password" required>
<button type="submit" class="btn">Create Account &amp; Start Free</button>
</form>
</div>
<div class="back"><a href="/register">← Choose different type</a> | <a href="/login">Already have an account?</a></div>
</div>
<script>
function checkPw(v){var s=0,c='red';if(v.length>=4)s++;if(v.length>=8)s++;if(/[A-Z]/.test(v))s++;if(/[0-9]/.test(v))s++;if(/[^A-Za-z0-9]/.test(v))s++;
if(s<=1){c='red';s=20}else if(s==2){c='orange';s=40}else if(s==3){c='#f59e0b';s=60}else if(s==4){c='#84cc16';s=80}else{c='#059669';s=100}
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
<div class="info">Or email us at <a href="mailto:hello@comfort.ug">hello@comfort.ug</a> | WhatsApp: <a href="${WHATSAPP_LINK}">${WHATSAPP_DISPLAY}</a></div>
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
    const healthTypeLabels = {general_hospital:'General Hospital',health_center_iii:'Health Center III',health_center_iv:'Health Center IV',clinic:'Medical Clinic',dental:'Dental Clinic',eye_clinic:'Eye Clinic',mental_health:'Mental Health Facility',physiotherapy:'Physiotherapy Center',lab:'Medical Laboratory',imaging:'Imaging & Radiology Center',maternity:'Maternity Center',pharmacy:'Pharmacy',veterinary:'Veterinary Clinic',special:'Specialized Hospital'};
    const healthTypeServices = {
      general_hospital:['Emergency Care','General Surgery','Internal Medicine','Pediatrics','Obstetrics & Gynecology','Laboratory Services','Pharmacy','Radiology','ICU','Outpatient Care'],
      health_center_iii:['Maternity Care','Outpatient Consultation','Immunization','Laboratory Testing','Pharmacy','Antenatal Care','HIV Testing & Counseling','Family Planning'],
      health_center_iv:['Emergency Surgery','Medical Wards','Laboratory','Maternity','Dental Services','X-Ray','Mental Health','HIV/AIDS Care'],
      clinic:['General Consultation','Pharmacy','Laboratory','Vaccination','Family Planning','Antenatal Care','Minor Surgery'],
      dental:['Dental Consultation','Teeth Cleaning','Fillings','Root Canal','Tooth Extraction','Dental X-Ray','Orthodontics','Dentures'],
      eye_clinic:['Eye Examination','Visual Acuity Test','Glaucoma Screening','Cataract Surgery','Contact Lens Fitting','Spectacle Prescription','Retinal Examination'],
      mental_health:['Psychiatric Evaluation','Counseling','Cognitive Behavioral Therapy','Substance Abuse Treatment','Group Therapy','Crisis Intervention'],
      physiotherapy:['Physical Therapy','Rehabilitation','Sports Injury Treatment','Massage Therapy','Electrotherapy','Exercise Programs','Post-Surgical Rehab'],
      lab:['Blood Tests','Urinalysis','HIV Testing','Malaria Testing','TB Screening','Pregnancy Test','Liver Function','Kidney Function','Blood Sugar'],
      imaging:['X-Ray','Ultrasound','CT Scan','MRI','Mammography','Fluoroscopy','Bone Density Scan'],
      maternity:['Antenatal Care','Delivery','Postnatal Care','Family Planning','Immunization','Ultrasound Scanning','C-Section'],
      pharmacy:['Prescription Dispensing','Over-the-Counter Medicine','Drug Counseling','Vaccination','Health Screening','Chronic Disease Management'],
      veterinary:['Pet Consultation','Vaccination','Surgery','Diagnostics','Boarding','Grooming','Nutrition Counseling'],
      special:['Specialist Consultation','Advanced Surgery','Oncology','Cardiology','Neurology','Nephrology','Orthopedics']
    };
    const instType = tenant.health_institution_type || tenant.type;
    const instLabel = tenant.type === 'clinic' || tenant.type === 'health' ? (healthTypeLabels[instType] || typeLabels[tenant.type] || tenant.type) : (typeLabels[tenant.type] || tenant.type);
    const services = healthTypeServices[instType] || (tenant.type === 'clinic' ? healthTypeServices.clinic : null);

    // Query supporting data in parallel
    let doctors = [], nurses = [], patientCount = 0, reviews = [];
    try {
      const [docRes, nurseRes] = await Promise.allSettled([
        pool.query("SELECT name, specialization, department, license_no FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true ORDER BY name", [tenant.id]),
        pool.query("SELECT name, specialization, department FROM clinic_staff WHERE tenant_id=$1 AND role='nurse' AND is_active=true ORDER BY name LIMIT 6", [tenant.id])
      ]);
      doctors = docRes.status === 'fulfilled' ? docRes.value.rows : [];
      nurses = nurseRes.status === 'fulfilled' ? nurseRes.value.rows : [];
    } catch (e) { /* gracefully degrade */ }

    try {
      const cntRes = await pool.query("SELECT COUNT(*)::int AS total FROM consultations WHERE tenant_id=$1", [tenant.id]);
      patientCount = cntRes?.rows?.[0]?.total || 0;
    } catch (e) {
      try {
        const cntRes2 = await pool.query("SELECT COUNT(*)::int AS total FROM health_visits WHERE tenant_id=$1", [tenant.id]);
        patientCount = cntRes2?.rows?.[0]?.total || 0;
      } catch (e2) { /* no data */ }
    }

    try {
      const revRes = await pool.query("SELECT id, patient_name, rating, comment, created_at FROM feedback_entries WHERE tenant_id=$1 AND rating IS NOT NULL ORDER BY created_at DESC LIMIT 5", [tenant.id]);
      reviews = revRes?.rows || [];
    } catch (e) { /* table may not exist */ }

    // Working hours fallback
    let workingHours = null;
    try {
      if (tenant.working_hours) workingHours = typeof tenant.working_hours === 'string' ? JSON.parse(tenant.working_hours) : tenant.working_hours;
    } catch (e) { /* ignore */ }

    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const now = new Date();
    const currentDay = days[now.getDay() === 0 ? 6 : now.getDay() - 1];
    const currentTime = now.getHours() * 100 + now.getMinutes();

    function renderStars(rating) {
      const full = Math.round(rating || 0);
      let s = '';
      for (let i = 1; i <= 5; i++) s += i <= full ? '&#9733;' : '&#9734;';
      return s;
    }
    function isOpenToday(day) {
      if (!workingHours || !workingHours[day]) return { open: false, hours: 'Closed' };
      const h = workingHours[day];
      if (h.closed) return { open: false, hours: 'Closed' };
      const open = parseInt(String(h.open || '0900').replace(':', ''));
      const close = parseInt(String(h.close || '1700').replace(':', ''));
      return { open: true, hours: `${String(h.open || '09:00').padStart(5,'0')} - ${String(h.close || '17:00').padStart(5,'0')}`, isCurrentlyOpen: day === currentDay && currentTime >= open && currentTime < close };
    }

    const todayStatus = isOpenToday(currentDay);
    const whatsappPhone = tenant.phone ? tenant.phone.replace(/[^0-9]/g, '') : null;
    const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
    const canonicalUrl = `${baseUrl}/portal/${esc(req.params.subdomain)}`;

    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tenant.name)} — ${esc(instLabel)} | Professional Healthcare</title>
<meta name="description" content="${esc(tenant.description || tenant.name + ' is a verified ' + instLabel + '. Book an appointment online, view doctors, services, and working hours.')}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(canonicalUrl)}">
<meta property="og:title" content="${esc(tenant.name)} — ${esc(instLabel)}">
<meta property="og:description" content="Book an appointment at ${esc(tenant.name)}. Verified ${esc(instLabel)} offering ${services ? services.slice(0,3).join(', ') : 'quality healthcare services'}.">
<meta property="og:type" content="business.business">
<meta property="og:url" content="${esc(canonicalUrl)}">
${tenant.logo_url ? '<meta property="og:image" content="'+esc(tenant.logo_url)+'">' : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(tenant.name)}">
<meta name="twitter:description" content="Verified ${esc(instLabel)} — Book Online">
<link rel="icon" href="/favicon.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0fdfa;color:#1e293b;line-height:1.6}
a{color:#0d9488;text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%}
.topbar{background:white;border-bottom:1px solid #e2e8f0;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,0.04)}
.topbar-logo{font-size:20px;font-weight:800;color:#0d9488;display:flex;align-items:center;gap:8px}
.topbar-nav{display:flex;gap:16px;align-items:center}
.topbar-nav a{font-size:13px;font-weight:600;color:#475569;padding:6px 14px;border-radius:8px;transition:0.2s}
.topbar-nav a:hover{background:#f0fdfa;color:#0d9488;text-decoration:none}
.hero{background:linear-gradient(135deg,#0d9488 0%,#0891b2 50%,#0e7490 100%);color:white;padding:56px 24px 48px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-40%;right:-20%;width:500px;height:500px;border-radius:50%;background:rgba(255,255,255,0.04)}
.hero::after{content:'';position:absolute;bottom:-30%;left:-10%;width:400px;height:400px;border-radius:50%;background:rgba(255,255,255,0.03)}
.hero-inner{position:relative;z-index:1;max-width:800px;margin:0 auto}
.hero-logo{width:80px;height:80px;border-radius:20px;background:white;box-shadow:0 8px 24px rgba(0,0,0,0.2);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.hero-logo img{width:100%;height:100%;object-fit:cover}
.hero-logo .logo-fallback{font-size:36px;color:#0d9488}
.hero-badges{display:flex;gap:10px;justify-content:center;margin-bottom:16px;flex-wrap:wrap}
.hero-badge{display:inline-flex;align-items:center;gap:5px;padding:5px 14px;background:rgba(255,255,255,0.15);backdrop-filter:blur(8px);border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.2)}
.hero-badge .check{color:#86efac}
.hero h1{font-size:clamp(26px,5vw,40px);font-weight:900;margin-bottom:6px;letter-spacing:-0.5px}
.hero .tagline{font-size:clamp(14px,2vw,17px);opacity:0.9;margin-bottom:20px}
.hero-stats{display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-top:24px}
.hero-stat{text-align:center}
.hero-stat .num{font-size:28px;font-weight:800}
.hero-stat .lbl{font-size:12px;opacity:0.8}
.container{max-width:1100px;margin:0 auto;padding:0 20px}
.section{padding:48px 0}
.section-title{text-align:center;font-size:clamp(22px,3.5vw,30px);font-weight:800;margin-bottom:8px;color:#134e4a}
.section-sub{text-align:center;color:#64748b;margin-bottom:36px;font-size:15px}
.grid{display:grid;gap:20px}
.grid-2{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.card{background:white;border-radius:16px;padding:28px;box-shadow:0 1px 6px rgba(0,0,0,0.05);border:1px solid #e2e8f0;transition:0.3s}
.card:hover{box-shadow:0 8px 24px rgba(0,0,0,0.08)}
.card-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.card-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.card-icon.teal{background:#ccfbf1;color:#0d9488}
.card-icon.blue{background:#dbeafe;color:#2563eb}
.card-icon.green{background:#dcfce7;color:#16a34a}
.card-icon.amber{background:#fef3c7;color:#d97706}
.card-icon.red{background:#fee2e2;color:#dc2626}
.card-icon.purple{background:#f3e8ff;color:#7c3aed}
.card h3{font-size:17px;font-weight:700;color:#1e293b}
.card p.desc{font-size:13px;color:#64748b;margin-bottom:12px}
.cta-section{text-align:center;padding:48px 24px;background:linear-gradient(135deg,#0d9488,#0891b2);border-radius:20px;margin:0 auto;max-width:700px;color:white}
.cta-section h2{font-size:clamp(20px,3vw,28px);font-weight:800;margin-bottom:8px}
.cta-section p{opacity:0.9;margin-bottom:24px;font-size:15px}
.btn{display:inline-block;padding:12px 28px;border-radius:12px;font-weight:700;font-size:15px;border:none;cursor:pointer;transition:0.3s;text-decoration:none;text-align:center}
.btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,0.15);text-decoration:none}
.btn-white{background:white;color:#0d9488}
.btn-outline-white{background:transparent;border:2px solid rgba(255,255,255,0.5);color:white}
.btn-outline-white:hover{background:rgba(255,255,255,0.1);border-color:white}
.btn-teal{background:linear-gradient(135deg,#0d9488,#0891b2);color:white}
.btn-green{background:linear-gradient(135deg,#059669,#0d9488);color:white}
.btn-sm{padding:8px 18px;font-size:13px;border-radius:8px}
.doctor-card{display:flex;gap:16px;align-items:flex-start;padding:20px}
.doctor-avatar{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#0d9488,#0891b2);display:flex;align-items:center;justify-content:center;color:white;font-size:20px;font-weight:700;flex-shrink:0}
.doctor-info h4{font-size:15px;font-weight:700;margin-bottom:2px}
.doctor-info .spec{font-size:13px;color:#0d9488;font-weight:600}
.doctor-info .dept{font-size:12px;color:#94a3b8}
.doctor-info .lic{font-size:11px;color:#94a3b8}
.service-tag{display:inline-flex;align-items:center;gap:6px;padding:10px 18px;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:12px;font-size:13px;font-weight:600;color:#134e4a;transition:0.2s}
.service-tag:hover{background:#ccfbf1;border-color:#99f6e4}
.service-tag .icon{font-size:16px}
.hours-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;align-items:center}
.hours-row:last-child{border-bottom:none}
.hours-row .day{font-weight:600;color:#334155}
.hours-row .time{color:#64748b}
.hours-row .closed-label{color:#ef4444;font-weight:500}
.hours-row .open-now{color:#16a34a;font-weight:600}
.status-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700;margin-bottom:20px}
.status-badge.open{background:#dcfce7;color:#16a34a}
.status-badge.closed{background:#fee2e2;color:#dc2626}
.status-badge .dot{width:8px;height:8px;border-radius:50%;animation:pulse 2s infinite}
.status-badge.open .dot{background:#16a34a}
.status-badge.closed .dot{background:#dc2626}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
.review-card{padding:16px;border-bottom:1px solid #f1f5f9}
.review-card:last-child{border-bottom:none}
.review-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.review-name{font-weight:700;font-size:14px}
.review-date{font-size:12px;color:#94a3b8}
.review-stars{color:#f59e0b;font-size:16px;margin-bottom:6px}
.review-text{font-size:13px;color:#475569}
.contact-row{display:flex;align-items:center;gap:12px;padding:10px 0;font-size:14px}
.contact-row .contact-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.contact-row a{color:#0d9488;font-weight:600}
.contact-row .contact-label{color:#64748b;font-size:12px}
.contact-row .contact-value{font-weight:600;color:#1e293b}
.emergency-box{background:linear-gradient(135deg,#fee2e2,#fecaca);border:1px solid #fca5a5;border-radius:16px;padding:24px;text-align:center}
.emergency-box h3{color:#991b1b;font-size:18px;margin-bottom:6px}
.emergency-box p{color:#7f1d1d;font-size:14px;margin-bottom:12px}
.emergency-box .phone{font-size:22px;font-weight:800;color:#dc2626;display:block;margin-bottom:8px}
.map-placeholder{background:#e2e8f0;border-radius:16px;height:200px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:14px;border:2px dashed #cbd5e1}
.footer{background:#0f172a;color:#94a3b8;padding:40px 24px 24px;margin-top:48px}
.footer-inner{max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;flex-wrap:wrap;gap:24px}
.footer-brand{max-width:300px}
.footer-brand h3{color:white;font-size:18px;margin-bottom:8px}
.footer-brand p{font-size:13px}
.footer-links h4{color:white;font-size:14px;margin-bottom:12px}
.footer-links a{display:block;font-size:13px;color:#94a3b8;padding:3px 0}
.footer-links a:hover{color:white;text-decoration:none}
.footer-bottom{text-align:center;padding-top:20px;margin-top:20px;border-top:1px solid #1e293b;font-size:12px;max-width:1100px;margin-left:auto;margin-right:auto;color:#64748b}
.verified-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;background:#dcfce7;color:#16a34a;border-radius:6px;font-size:11px;font-weight:700}
.empty-state{text-align:center;padding:32px;color:#94a3b8;font-size:14px}
@media(max-width:640px){
.hero{padding:40px 16px 36px}
.hero-stats{gap:16px}
.hero-stat .num{font-size:22px}
.section{padding:32px 0}
.card{padding:20px}
.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}
.footer-inner{flex-direction:column}
.topbar-nav a.hide-mobile{display:none}
}
</style></head><body>
<nav class="topbar">
  <div class="topbar-logo">${tenant.logo_url ? '<img src="'+esc(tenant.logo_url)+'" alt="'+esc(tenant.name)+'" style="height:28px;border-radius:6px">' : '&#9670; Comfort'}</div>
  <div class="topbar-nav">
    <a href="#services">Services</a>
    <a href="#doctors">Doctors</a>
    <a href="#contact">Contact</a>
    <a href="/clinic/book/${esc(req.params.subdomain)}" class="btn btn-teal btn-sm">Book Now</a>
    <a href="/login" class="hide-mobile">Login</a>
  </div>
</nav>
<div class="hero">
  <div class="hero-inner">
    <div class="hero-logo">${tenant.logo_url ? '<img src="'+esc(tenant.logo_url)+'" alt="'+esc(tenant.name)+'">' : '<span class="logo-fallback">&#127973;</span>'}</div>
    <div class="hero-badges">
      <span class="hero-badge"><span class="check">&#10003;</span> Verified</span>
      <span class="hero-badge">${esc(instLabel)}</span>
      ${tenant.approved ? '<span class="hero-badge"><span class="check">&#10003;</span> Approved</span>' : ''}
    </div>
    <h1>${esc(tenant.name)}</h1>
    <p class="tagline">${esc(tenant.description || (instLabel + ' providing quality healthcare services'))}</p>
    <div class="hero-stats">
      <div class="hero-stat"><div class="num">${doctors.length}</div><div class="lbl">Doctors</div></div>
      <div class="hero-stat"><div class="num">${nurses.length}</div><div class="lbl">Nurses</div></div>
      <div class="hero-stat"><div class="num">${patientCount > 0 ? (patientCount >= 1000 ? (patientCount/1000).toFixed(1)+'K' : patientCount) : '500+'}</div><div class="lbl">Patients Served</div></div>
      ${reviews.length > 0 ? '<div class="hero-stat"><div class="num">'+reviews[0].rating?.toFixed(1)+'</div><div class="lbl">Avg Rating</div></div>' : '<div class="hero-stat"><div class="num">5.0</div><div class="lbl">Rating</div></div>'}
    </div>
  </div>
</div>
<div class="container">
${services && services.length > 0 ? `
<section class="section" id="services">
  <h2 class="section-title">Our Services</h2>
  <p class="section-sub">Comprehensive healthcare services tailored to your needs</p>
  <div class="grid grid-4">
    ${services.map((s, i) => '<div class="service-tag"><span class="icon">'+['&#128137;','&#128300;','&#129657;','&#127973;','&#128138;','&#128666;','&#128200;','&#128167;','&#128170;','&#129657;'][i % 10]+'</span>'+esc(s)+'</div>').join('')}
  </div>
</section>` : ''}

<section class="section" id="doctors">
  <h2 class="section-title">Our Medical Team</h2>
  <p class="section-sub">Experienced professionals dedicated to your health</p>
  <div class="grid grid-2">
    ${doctors.length > 0 ? doctors.map(d => `
    <div class="card">
      <div class="doctor-card">
        <div class="doctor-avatar">${esc(d.name ? d.name.charAt(0).toUpperCase() : 'D')}</div>
        <div class="doctor-info">
          <h4>${esc(d.name)}</h4>
          <div class="spec">${esc(d.specialization || 'General Practitioner')}</div>
          ${d.department ? '<div class="dept">'+esc(d.department)+'</div>' : ''}
          ${d.license_no ? '<div class="lic">Lic: '+esc(d.license_no)+'</div>' : ''}
        </div>
      </div>
    </div>`).join('') : '<div class="card"><div class="empty-state">&#128100; Our medical team profiles are being updated.<br>Please contact us for more information.</div></div>'}
    ${doctors.length > 0 && nurses.length > 0 ? `
    <div class="card">
      <div class="doctor-card">
        <div class="doctor-avatar" style="background:linear-gradient(135deg,#2563eb,#7c3aed)">&#128099;</div>
        <div class="doctor-info">
          <h4>Nursing Team</h4>
          <div class="spec">${nurses.length} Active Nurse${nurses.length !== 1 ? 's' : ''}</div>
          <div class="dept">Dedicated patient care professionals</div>
        </div>
      </div>
    </div>` : ''}
  </div>
</section>

<section class="section" id="hours">
  <h2 class="section-title">Working Hours</h2>
  <p class="section-sub">Plan your visit with our convenient hours</p>
  <div class="grid grid-2">
    <div class="card">
      <div style="text-align:center">
        <div class="status-badge ${todayStatus.open && todayStatus.isCurrentlyOpen ? 'open' : 'closed'}">
          <span class="dot"></span>
          ${todayStatus.open && todayStatus.isCurrentlyOpen ? 'Open Now' : 'Currently Closed'}
        </div>
        ${todayStatus.open ? '<p style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:4px">'+esc(todayStatus.hours)+'</p><p style="font-size:13px;color:#64748b">Today ('+esc(currentDay)+')</p>' : '<p style="font-size:14px;color:#64748b;margin-bottom:4px">Closed today</p><p style="font-size:13px;color:#64748b">See full schedule below</p>'}
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-icon amber">&#128339;</div>
        <h3>Full Schedule</h3>
      </div>
      ${workingHours ? days.map(day => {
        const s = isOpenToday(day);
        return '<div class="hours-row"><span class="day">'+day+(day === currentDay ? ' (Today)' : '')+'</span>' +
          (s.open ? '<span class="time'+(s.isCurrentlyOpen ? ' open-now' : '')+'">'+esc(s.hours)+'</span>' : '<span class="closed-label">Closed</span>') + '</div>';
      }).join('') : `
      <div class="hours-row"><span class="day">Monday</span><span class="time">08:00 - 17:00</span></div>
      <div class="hours-row"><span class="day">Tuesday</span><span class="time">08:00 - 17:00</span></div>
      <div class="hours-row"><span class="day">Wednesday</span><span class="time">08:00 - 17:00</span></div>
      <div class="hours-row"><span class="day">Thursday</span><span class="time">08:00 - 17:00</span></div>
      <div class="hours-row"><span class="day">Friday</span><span class="time">08:00 - 17:00</span></div>
      <div class="hours-row"><span class="day">Saturday</span><span class="time">09:00 - 13:00</span></div>
      <div class="hours-row"><span class="day">Sunday</span><span class="closed-label">Closed</span></div>`}
    </div>
  </div>
</section>

${reviews.length > 0 ? `
<section class="section" id="reviews">
  <h2 class="section-title">Patient Reviews</h2>
  <p class="section-sub">What our patients say about us</p>
  <div class="grid grid-2">
    <div class="card">
      ${reviews.map(r => `
      <div class="review-card">
        <div class="review-header"><span class="review-name">${esc(r.patient_name || 'Anonymous')}</span><span class="review-date">${r.created_at ? new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''}</span></div>
        <div class="review-stars">${renderStars(r.rating)}</div>
        ${r.comment ? '<div class="review-text">'+esc(r.comment)+'</div>' : ''}
      </div>`).join('')}
    </div>
    <div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      <div style="font-size:52px;font-weight:900;color:#0d9488">${reviews.reduce((a,r) => a + (r.rating || 0), 0) / reviews.length}</div>
      <div style="color:#f59e0b;font-size:24px;margin-bottom:8px">${renderStars(reviews.reduce((a,r) => a + (r.rating || 0), 0) / reviews.length)}</div>
      <div style="color:#64748b;font-size:14px">Based on ${reviews.length} review${reviews.length !== 1 ? 's' : ''}</div>
    </div>
  </div>
</section>` : `
<section class="section" id="reviews">
  <h2 class="section-title">Patient Reviews</h2>
  <p class="section-sub">Your health is our priority</p>
  <div class="card" style="text-align:center;padding:48px">
    <div style="font-size:48px;margin-bottom:12px">&#11088;</div>
    <div style="font-size:20px;font-weight:700;margin-bottom:6px">Excellent Care</div>
    <div style="color:#f59e0b;font-size:20px;margin-bottom:8px">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
    <div style="color:#64748b;font-size:14px">We're building our review collection.<br>Book an appointment and share your experience!</div>
  </div>
</section>`}

<section class="section" id="location">
  <h2 class="section-title">Find Us</h2>
  <p class="section-sub">Visit us at our location</p>
  <div class="card" style="padding:0;overflow:hidden">
    ${tenant.address ? '<div style="padding:20px 28px;font-size:14px;color:#334155;font-weight:600">&#128205; '+esc(tenant.address)+'</div>' : ''}
    <div class="map-placeholder" id="map-container">
      &#128506; Google Maps integration — Enable location services in your clinic settings to display an interactive map.
    </div>
  </div>
</section>

<section class="section" id="contact">
  <h2 class="section-title">Contact Us</h2>
  <p class="section-sub">Get in touch — we're here to help</p>
  <div class="grid grid-2">
    <div class="card">
      <div class="card-header">
        <div class="card-icon teal">&#128222;</div>
        <h3>Contact Information</h3>
      </div>
      ${tenant.phone ? `
      <div class="contact-row">
        <div class="contact-icon" style="background:#ccfbf1;color:#0d9488">&#128222;</div>
        <div><div class="contact-label">Phone</div><a href="tel:${esc(tenant.phone)}">${esc(tenant.phone)}</a></div>
      </div>` : ''}
      ${tenant.email ? `
      <div class="contact-row">
        <div class="contact-icon" style="background:#dbeafe;color:#2563eb">&#9993;</div>
        <div><div class="contact-label">Email</div><a href="mailto:${esc(tenant.email)}">${esc(tenant.email)}</a></div>
      </div>` : ''}
      ${whatsappPhone ? `
      <div class="contact-row">
        <div class="contact-icon" style="background:#dcfce7;color:#16a34a">&#128172;</div>
        <div><div class="contact-label">WhatsApp</div><a href="https://wa.me/${esc(whatsappPhone)}" target="_blank" rel="noopener">Chat with us</a></div>
      </div>` : ''}
      ${tenant.address ? `
      <div class="contact-row">
        <div class="contact-icon" style="background:#fef3c7;color:#d97706">&#128205;</div>
        <div><div class="contact-label">Address</div><span class="contact-value">${esc(tenant.address)}</span></div>
      </div>` : ''}
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-icon red">&#128680;</div>
        <h3>Emergency</h3>
      </div>
      <div class="emergency-box">
        <h3>Need Emergency Care?</h3>
        <p>For medical emergencies, call us immediately or visit our facility directly.</p>
        ${tenant.phone ? '<span class="phone">&#128222; '+esc(tenant.phone)+'</span><a href="tel:'+esc(tenant.phone)+'" class="btn btn-sm" style="background:#dc2626;color:white;display:block">Call Now</a>' : '<a href="#contact" class="btn btn-sm" style="background:#dc2626;color:white">View Contact Info</a>'}
      </div>
    </div>
  </div>
</section>

<section class="section" id="booking">
  <div class="cta-section">
    <h2>&#128197; Book an Appointment</h2>
    <p>Schedule your visit online — fast, easy, and secure. No waiting in line.</p>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a href="/clinic/book/${esc(req.params.subdomain)}" class="btn btn-white">Book Appointment Now</a>
      ${whatsappPhone ? '<a href="https://wa.me/'+esc(whatsappPhone)+'?text=Hello%2C%20I%20would%20like%20to%20book%20an%20appointment" target="_blank" rel="noopener" class="btn btn-outline-white">WhatsApp Us</a>' : ''}
    </div>
  </div>
</section>
</div>
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <h3>${esc(tenant.name)}</h3>
      <p>${esc(tenant.description || (instLabel + ' — Providing quality healthcare services. Book an appointment online.'))}</p>
    </div>
    <div class="footer-links">
      <h4>Quick Links</h4>
      <a href="#services">Services</a>
      <a href="#doctors">Our Doctors</a>
      <a href="#hours">Working Hours</a>
      <a href="#contact">Contact</a>
    </div>
    <div class="footer-links">
      <h4>Legal</h4>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/">Comfort Platform</a>
    </div>
  </div>
  <div class="footer-bottom">
    &copy; ${new Date().getFullYear()} ${esc(tenant.name)}. Powered by <a href="/" style="color:#0d9488;font-weight:600">Comfort Platform</a>. All rights reserved.
  </div>
</footer></body></html>`);
  }));

  console.log('[PublicPortal] Landing page, registration, and public pages loaded');
};
