// ============================================================
// PUBLIC PORTAL V18 — Landing page, Registration, Public pages
// Comfort Platform - Multi-tenant SaaS for African Institutions
// Enhanced with: Dark Mode, i18n, Cookie Consent, SEO Schema,
//   Accessibility, Search, Analytics Tracking, Mobile Nav
// ============================================================
module.exports = function(app, pool, bcrypt, ah, esc, renderPage, audit, sendEmail, queueEmail, logger) {

  // === RATE LIMITING ===
  const rateLimit = require('express-rate-limit');
  const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many messages. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  });
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: 'Too many registration attempts. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  });
  const portalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many requests. Please slow down.',
    standardHeaders: true,
    legacyHeaders: false
  });

  // === DB MIGRATIONS ===
  const migrations = [
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sub_type VARCHAR(100)`,
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(20),
      subject VARCHAR(255),
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS cms_pages (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(255) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      meta_description TEXT,
      is_published BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS email_verifications (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      token VARCHAR(255) NOT NULL,
      verified BOOLEAN DEFAULT false,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS analytics_events (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      page_path VARCHAR(500),
      referrer TEXT,
      user_agent TEXT,
      ip_address VARCHAR(45),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS search_index (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      entity_type VARCHAR(100),
      entity_id INTEGER,
      title VARCHAR(255),
      content TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS changelog_entries (
      id SERIAL PRIMARY KEY,
      version VARCHAR(50),
      title VARCHAR(255),
      description TEXT,
      category VARCHAR(100),
      is_published BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  ];

  (async () => {
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { /* column/table may already exist */ }
    }
    if (logger) logger.info('Public Portal V18: Migrations complete');
  })();

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

  // === SUPPORTED LOCALES ===
  const SUPPORTED_LOCALES = ['en', 'sw', 'fr', 'ar', 'es', 'hi', 'zh', 'pt', 'am'];
  const LOCALE_NAMES = {
    en: 'English', sw: 'Kiswahili', fr: 'Français', ar: 'العربية',
    es: 'Español', hi: 'हिन्दी', zh: '中文', pt: 'Português', am: 'አማርኛ'
  };
  const RTL_LOCALES = ['ar'];

  // ============================================================
  // SHARED CSS FUNCTION
  // ============================================================
  function getPublicCSS() {
    return `
/* === CSS Custom Properties (Light Theme) === */
:root {
  --bg-primary: #f8fafc;
  --bg-secondary: #f1f5f9;
  --bg-card: #ffffff;
  --bg-nav: #ffffff;
  --bg-footer: #1e293b;
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --text-inverse: #ffffff;
  --text-footer: #94a3b8;
  --border-color: #e2e8f0;
  --border-hover: #4f46e5;
  --accent-primary: #4f46e5;
  --accent-secondary: #7c3aed;
  --accent-green: #059669;
  --accent-teal: #0d9488;
  --accent-cyan: #0891b2;
  --accent-amber: #f59e0b;
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.04);
  --shadow-md: 0 2px 12px rgba(0,0,0,0.06);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.1);
  --shadow-hover: 0 4px 12px rgba(0,0,0,0.15);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --font-stack: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --transition-fast: 0.2s ease;
  --transition-normal: 0.3s ease;
}

/* === Dark Theme === */
[data-theme="dark"] {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-card: #1e293b;
  --bg-nav: #1e293b;
  --bg-footer: #0f172a;
  --text-primary: #f1f5f9;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;
  --text-inverse: #0f172a;
  --text-footer: #64748b;
  --border-color: #334155;
  --border-hover: #818cf8;
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.2);
  --shadow-md: 0 2px 12px rgba(0,0,0,0.3);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.4);
  --shadow-hover: 0 4px 12px rgba(0,0,0,0.4);
}

/* === Reset & Base === */
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  font-family: var(--font-stack);
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  transition: background var(--transition-normal), color var(--transition-normal);
}

/* === Skip to Content (Accessibility) === */
.skip-to-content {
  position: absolute;
  top: -100%;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent-primary);
  color: #fff;
  padding: 12px 24px;
  border-radius: var(--radius-sm);
  font-weight: 700;
  z-index: 10000;
  text-decoration: none;
  transition: top 0.3s;
}
.skip-to-content:focus {
  top: 12px;
}

/* === Focus Indicators (Accessibility) === */
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 3px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: 2px;
}

/* === Links === */
a { color: var(--accent-primary); text-decoration: none; }
a:hover { text-decoration: underline; }

/* === Navigation === */
.nav {
  background: var(--bg-nav);
  border-bottom: 1px solid var(--border-color);
  padding: 12px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: var(--shadow-sm);
  transition: background var(--transition-normal), border-color var(--transition-normal);
}
.nav-logo {
  font-size: 22px;
  font-weight: 900;
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}
.nav-logo:hover { text-decoration: none; }
.nav-center {
  display: flex;
  gap: 4px;
  align-items: center;
}
.nav-center a {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  transition: var(--transition-fast);
  text-decoration: none;
}
.nav-center a:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
  text-decoration: none;
}
.nav-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
.nav-icon-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: var(--transition-fast);
  position: relative;
}
.nav-icon-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border-hover);
}
.nav-icon-btn:focus-visible {
  outline: 3px solid var(--accent-primary);
  outline-offset: 2px;
}

/* === Language Selector === */
.lang-selector {
  position: relative;
}
.lang-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  min-width: 160px;
  z-index: 200;
  display: none;
  overflow: hidden;
}
.lang-dropdown.open { display: block; }
.lang-dropdown a {
  display: block;
  padding: 10px 16px;
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: var(--transition-fast);
}
.lang-dropdown a:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
  text-decoration: none;
}
.lang-dropdown a.active {
  color: var(--accent-primary);
  font-weight: 600;
}

/* === Search Overlay === */
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 500;
  display: none;
  align-items: flex-start;
  justify-content: center;
  padding-top: 100px;
  backdrop-filter: blur(4px);
}
.search-overlay.open { display: flex; }
.search-box {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 90%;
  max-width: 600px;
  box-shadow: var(--shadow-lg);
}
.search-box input {
  width: 100%;
  padding: 14px 18px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 16px;
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: var(--transition-fast);
}
.search-box input:focus {
  outline: none;
  border-color: var(--accent-primary);
}
.search-results {
  margin-top: 16px;
  max-height: 400px;
  overflow-y: auto;
}
.search-result-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}
.search-result-item:last-child { border-bottom: none; }
.search-result-item a {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 15px;
}
.search-result-item p {
  color: var(--text-muted);
  font-size: 13px;
  margin-top: 4px;
}

/* === Hamburger Button === */
.hamburger {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  flex-direction: column;
  gap: 5px;
  z-index: 110;
}
.hamburger span {
  display: block;
  width: 24px;
  height: 2px;
  background: var(--text-primary);
  border-radius: 2px;
  transition: var(--transition-fast);
}
.hamburger.active span:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}
.hamburger.active span:nth-child(2) {
  opacity: 0;
}
.hamburger.active span:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* === Mobile Navigation === */
.mobile-nav {
  position: fixed;
  top: 0;
  right: -100%;
  width: 80%;
  max-width: 320px;
  height: 100vh;
  background: var(--bg-nav);
  z-index: 105;
  padding: 80px 24px 24px;
  transition: right 0.3s ease;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}
.mobile-nav.open { right: 0; }
.mobile-nav a {
  display: block;
  padding: 14px 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  text-decoration: none;
}
.mobile-nav a:hover { color: var(--accent-primary); text-decoration: none; }
.mobile-nav-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 104;
  display: none;
}
.mobile-nav-overlay.open { display: block; }

/* === Dark Mode Toggle === */
.dark-toggle {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  width: 38px;
  height: 38px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: var(--transition-fast);
}
.dark-toggle:hover {
  background: var(--bg-secondary);
  color: var(--accent-amber);
  border-color: var(--border-hover);
}

/* === Buttons === */
.btn {
  display: inline-block;
  padding: 10px 24px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  border: none;
  cursor: pointer;
  transition: var(--transition-normal);
  text-decoration: none;
  line-height: 1.5;
}
.btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-hover);
  text-decoration: none;
}
.btn:focus-visible {
  outline: 3px solid var(--accent-primary);
  outline-offset: 2px;
}
.btn-primary { background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); color: white; }
.btn-green { background: linear-gradient(135deg, var(--accent-green), var(--accent-teal)); color: white; }
.btn-outline { background: transparent; border: 2px solid var(--border-color); color: var(--text-secondary); }
[data-theme="dark"] .btn-outline { border-color: var(--border-color); color: var(--text-secondary); }
.btn-outline:hover { border-color: var(--accent-primary); color: var(--accent-primary); }

/* === Container === */
.container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }

/* === Hero === */
.hero {
  background: linear-gradient(135deg, #059669 0%, #0d9488 40%, #0891b2 100%);
  padding: 80px 20px;
  text-align: center;
  color: white;
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  top: -50%; left: -50%;
  width: 200%; height: 200%;
  background: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 30px 30px;
}
.hero h1 {
  font-size: clamp(28px, 5vw, 52px);
  font-weight: 900;
  margin-bottom: 16px;
  position: relative;
  line-height: 1.15;
}
.hero p {
  font-size: clamp(16px, 2.5vw, 20px);
  opacity: 0.9;
  margin-bottom: 8px;
  max-width: 700px;
  margin-left: auto;
  margin-right: auto;
  position: relative;
}
.hero-buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 32px;
  position: relative;
  flex-wrap: wrap;
}
.trust-badges {
  display: flex;
  gap: 24px;
  justify-content: center;
  margin-top: 24px;
  position: relative;
  flex-wrap: wrap;
}
.trust-badges span { font-size: 13px; opacity: 0.85; }

/* === Video Section === */
.video-section {
  margin-top: 40px;
  position: relative;
}
.video-wrapper {
  max-width: 720px;
  margin: 0 auto;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.video-wrapper iframe {
  width: 100%;
  aspect-ratio: 16/9;
  border: none;
}

/* === Social Proof Counter === */
.social-proof {
  margin-top: 32px;
  position: relative;
}
.counter-value {
  font-size: clamp(32px, 5vw, 48px);
  font-weight: 900;
  color: white;
  line-height: 1;
}
.counter-label {
  font-size: 16px;
  opacity: 0.85;
  margin-top: 4px;
}

/* === Sections === */
.section { padding: 60px 20px; }
.section-title {
  text-align: center;
  font-size: 32px;
  font-weight: 800;
  margin-bottom: 12px;
  color: var(--text-primary);
}
.section-sub {
  text-align: center;
  color: var(--text-muted);
  margin-bottom: 48px;
  font-size: 16px;
}

/* === Card Grid === */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}
.card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 28px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
  transition: var(--transition-normal);
  position: relative;
  overflow: hidden;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}
.card-top {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 5px;
}
.card-emoji { font-size: 36px; margin-bottom: 12px; }
.card h3 { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: var(--text-primary); }
.card-price { font-size: 13px; font-weight: 600; margin-bottom: 16px; color: var(--text-muted); }
.card ul { list-style: none; padding: 0; font-size: 13px; color: var(--text-secondary); line-height: 2; }
.card ul li::before { content: '✓ '; color: var(--accent-green); font-weight: 700; }
.card .btn { margin-top: 16px; display: block; text-align: center; }

/* === Pricing === */
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  max-width: 1000px;
  margin: 0 auto;
}
.pricing-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 32px;
  text-align: center;
  border: 2px solid var(--border-color);
  transition: var(--transition-normal);
}
.pricing-card:hover { border-color: var(--accent-primary); }
.pricing-card.featured {
  border-color: var(--accent-primary);
  box-shadow: 0 8px 30px rgba(79,70,229,0.15);
}
[data-theme="dark"] .pricing-card.featured {
  box-shadow: 0 8px 30px rgba(79,70,229,0.25);
}
.pricing-card h3 { font-size: 22px; font-weight: 800; margin-bottom: 4px; color: var(--text-primary); }
.pricing-card .price {
  font-size: 36px;
  font-weight: 900;
  color: var(--accent-primary);
  margin: 12px 0;
}
.pricing-card .price span {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-muted);
}
.pricing-card ul {
  list-style: none;
  text-align: left;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 2.2;
  margin: 16px 0;
}
.pricing-card ul li::before { content: '✓ '; color: var(--accent-green); font-weight: 700; }

/* === Testimonials === */
.testimonials {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}
.testimonial {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 28px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
  transition: var(--transition-normal);
}
.testimonial:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}
.testimonial-stars { color: var(--accent-amber); font-size: 16px; margin-bottom: 12px; }
.testimonial p {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.8;
  font-style: italic;
  margin-bottom: 16px;
}
.testimonial-author { font-weight: 700; font-size: 14px; color: var(--text-primary); }
.testimonial-role { font-size: 12px; color: var(--text-muted); }

/* === FAQ === */
.faq-item {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 20px 24px;
  margin-bottom: 12px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: var(--transition-fast);
}
.faq-item:hover { border-color: var(--border-hover); }
.faq-item h4 {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-primary);
}
.faq-item p {
  color: var(--text-secondary);
  font-size: 14px;
  margin-top: 8px;
  display: none;
  line-height: 1.7;
}
.faq-item.open p { display: block; }
.faq-item h4::after {
  content: '+';
  font-size: 20px;
  color: var(--text-muted);
  transition: var(--transition-fast);
}
.faq-item.open h4::after { content: '−'; }

/* === Cookie Consent Banner === */
.cookie-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg-card);
  border-top: 1px solid var(--border-color);
  padding: 16px 24px;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
  transition: var(--transition-normal);
}
.cookie-banner.hidden { display: none; }
.cookie-banner p {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 600px;
}
.cookie-banner a {
  color: var(--accent-primary);
  font-weight: 600;
}
.cookie-btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: var(--transition-fast);
}
.cookie-accept {
  background: var(--accent-primary);
  color: white;
}
.cookie-accept:hover { opacity: 0.9; }
.cookie-reject {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}
.cookie-reject:hover { border-color: var(--border-hover); }
.cookie-customize {
  background: none;
  color: var(--accent-primary);
  text-decoration: underline;
  font-size: 13px;
  border: none;
  cursor: pointer;
}

/* === CTA Section === */
.cta-section {
  text-align: center;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: white;
  padding: 60px 20px;
}

/* === Footer === */
footer {
  background: var(--bg-footer);
  color: var(--text-inverse);
  padding: 48px 20px 24px;
  transition: background var(--transition-normal);
}
[data-theme="dark"] footer { color: #f1f5f9; }
.footer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 32px;
  max-width: 1200px;
  margin: 0 auto;
}
.footer-grid h4 { margin-bottom: 12px; font-size: 15px; color: #f1f5f9; }
.footer-grid a {
  color: var(--text-footer);
  font-size: 13px;
  display: block;
  margin-bottom: 8px;
  text-decoration: none;
  transition: color var(--transition-fast);
}
.footer-grid a:hover { color: #f1f5f9; }
.footer-bottom {
  text-align: center;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #334155;
  font-size: 13px;
  color: var(--text-footer);
}
.footer-dark-toggle {
  background: none;
  border: 1px solid #334155;
  color: var(--text-footer);
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  transition: var(--transition-fast);
  margin-top: 12px;
}
.footer-dark-toggle:hover { border-color: #64748b; color: #f1f5f9; }

/* === Form Styles === */
.form-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 32px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
  transition: var(--transition-normal);
}
form input, form select, form textarea {
  width: 100%;
  padding: 12px;
  margin: 8px 0;
  border: 2px solid var(--border-color);
  border-radius: 10px;
  font-size: 15px;
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: border var(--transition-fast), background var(--transition-fast);
}
form input:focus, form select:focus, form textarea:focus {
  outline: none;
  border-color: var(--accent-primary);
}
label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  display: block;
  margin-top: 8px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 12px;
  cursor: pointer;
}
.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent-primary);
}

/* === Password Strength === */
.pw-strength {
  height: 6px;
  border-radius: 3px;
  margin: 4px 0 8px;
  background: var(--border-color);
  overflow: hidden;
}
.pw-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s;
}

/* === Type Cards (Registration Step 1) === */
.type-card {
  background: var(--bg-card);
  border: 2px solid var(--border-color);
  border-radius: 14px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: var(--transition-fast);
  text-decoration: none;
  color: var(--text-primary);
}
.type-card:hover {
  border-color: var(--accent-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(79,70,229,0.15);
  text-decoration: none;
}
.type-card .emoji { font-size: 32px; margin-bottom: 8px; }
.type-card .name { font-weight: 700; font-size: 14px; }
.type-card .price { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

/* === Responsive === */
@media (max-width: 900px) {
  .nav-center { display: none; }
  .hamburger { display: flex; }
  .hero { padding: 40px 16px; }
  .hero h1 { font-size: 28px; }
  .section { padding: 40px 16px; }
  .section-title { font-size: 24px; }
  .grid { grid-template-columns: 1fr; }
  .hero-buttons { flex-direction: column; align-items: center; }
  .footer-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .footer-grid { grid-template-columns: 1fr; }
  .pricing-grid { grid-template-columns: 1fr; }
  .testimonials { grid-template-columns: 1fr; }
  .nav { padding: 10px 16px; }
}

/* === Print Styles === */
@media print {
  .nav, .hamburger, .mobile-nav, .mobile-nav-overlay,
  .cookie-banner, .search-overlay, .dark-toggle,
  .footer-dark-toggle, .cta-section { display: none !important; }
  body { background: white; color: black; }
  .hero { background: none; color: black; padding: 20px; }
  .hero h1, .hero p { color: black; }
  .card, .pricing-card, .testimonial, .faq-item {
    box-shadow: none;
    border: 1px solid #ddd;
    break-inside: avoid;
  }
  a { color: #333; text-decoration: underline; }
  footer { background: none; color: #333; }
}

/* === Page Hero (p-hero) === */
.p-hero {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  color: white;
  position: relative;
  overflow: hidden;
}
.p-hero::before {
  content: '';
  position: absolute;
  top: -50%; left: -50%;
  width: 200%; height: 200%;
  background: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 30px 30px;
}
.p-hero h1, .p-hero p {
  position: relative;
}
[data-theme="dark"] .p-hero {
  background: linear-gradient(135deg, #312e81 0%, #4c1d95 100%);
}
`;

  }

  // ============================================================
  // SHARED NAVIGATION FUNCTION
  // ============================================================
  function getPublicNav(locale) {
    const loc = locale || 'en';
    const isRTL = RTL_LOCALES.includes(loc);
    const dir = isRTL ? 'rtl' : 'ltr';

    return `
<a href="#main-content" class="skip-to-content">Skip to main content</a>
<nav class="nav" role="navigation" aria-label="Main navigation">
  <a href="/" class="nav-logo" aria-label="Comfort Home">◆ Comfort</a>
  <div class="nav-center">
    <a href="/#features">Features</a>
    <a href="/#pricing">Pricing</a>
    <a href="/#testimonials">Testimonials</a>
    <a href="/#faq">FAQ</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
    <a href="/changelog">Changelog</a>
    <a href="/api-docs">API Docs</a>
  </div>
  <div class="nav-right">
    <button class="nav-icon-btn" id="searchBtn" aria-label="Search site" title="Search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    </button>
    <div class="lang-selector">
      <button class="nav-icon-btn" id="langBtn" aria-label="Change language" title="Language">
        🌐
      </button>
      <div class="lang-dropdown" id="langDropdown" role="menu">
        ${SUPPORTED_LOCALES.map(l => `<a href="?locale=${l}" role="menuitem" class="${l === loc ? 'active' : ''}">${LOCALE_NAMES[l]}</a>`).join('')}
      </div>
    </div>
    <button class="dark-toggle" id="darkToggle" aria-label="Toggle dark mode" title="Toggle theme">
      <span class="dark-icon">🌙</span>
      <span class="light-icon" style="display:none">☀️</span>
    </button>
    <a href="/login" class="btn btn-outline" style="font-size:13px;padding:8px 16px">Login</a>
    <a href="/register" class="btn btn-primary" style="font-size:13px;padding:8px 16px">Start Free</a>
    <button class="hamburger" id="hamburgerBtn" aria-label="Open menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>

<!-- Mobile Navigation Overlay -->
<div class="mobile-nav-overlay" id="mobileOverlay"></div>
<div class="mobile-nav" id="mobileNav" role="navigation" aria-label="Mobile navigation">
  <a href="/#features">Features</a>
  <a href="/#pricing">Pricing</a>
  <a href="/#testimonials">Testimonials</a>
  <a href="/#faq">FAQ</a>
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
  <a href="/changelog">Changelog</a>
  <a href="/api-docs">API Docs</a>
  <hr style="border-color:var(--border-color);margin:12px 0">
  <a href="/login">Login</a>
  <a href="/register" style="color:var(--accent-primary);font-weight:700">Start Free →</a>
  <hr style="border-color:var(--border-color);margin:12px 0">
  ${SUPPORTED_LOCALES.map(l => `<a href="?locale=${l}" style="font-size:14px">${l === loc ? '● ' : ''}${LOCALE_NAMES[l]}</a>`).join('')}
</div>

<!-- Search Overlay -->
<div class="search-overlay" id="searchOverlay">
  <div class="search-box">
    <input type="text" id="searchInput" placeholder="Search Comfort..." aria-label="Search" autocomplete="off">
    <div class="search-results" id="searchResults"></div>
  </div>
</div>
`;
  }

  // ============================================================
  // COOKIE CONSENT COMPONENT
  // ============================================================
  function getCookieConsent() {
    return `
<div class="cookie-banner" id="cookieBanner" role="dialog" aria-label="Cookie consent">
  <p>We use cookies to improve your experience, analyze site traffic, and personalize content. By continuing, you agree to our <a href="/cookie-policy">Cookie Policy</a>.</p>
  <button class="cookie-btn cookie-accept" id="cookieAccept" aria-label="Accept cookies">Accept</button>
  <button class="cookie-btn cookie-reject" id="cookieReject" aria-label="Reject non-essential cookies">Reject</button>
  <button class="cookie-customize" id="cookieCustomize" aria-label="Customize cookie preferences">Customize</button>
</div>
<script>
(function(){
  var banner = document.getElementById('cookieBanner');
  if (!banner) return;
  var consent = localStorage.getItem('cookie_consent');
  if (consent) { banner.classList.add('hidden'); }
  document.getElementById('cookieAccept').addEventListener('click', function(){
    localStorage.setItem('cookie_consent', 'accepted');
    banner.classList.add('hidden');
    if (typeof trackAnalytics === 'function') trackAnalytics('cookie_accepted');
  });
  document.getElementById('cookieReject').addEventListener('click', function(){
    localStorage.setItem('cookie_consent', 'rejected');
    banner.classList.add('hidden');
  });
  document.getElementById('cookieCustomize').addEventListener('click', function(){
    alert('Cookie customization options coming soon. For now, you can Accept or Reject all non-essential cookies.');
  });
})();
</script>
`;
  }

  // ============================================================
  // SEO HELPER
  // ============================================================
  function getSEOHead(title, description, url, type, imageUrl) {
    const siteUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
    const fullUrl = url || siteUrl;
    const ogType = type || 'website';
    const ogImage = imageUrl || `${siteUrl}/og-image.png`;
    const safeTitle = esc(title || 'Comfort Platform');
    const safeDesc = esc(description || 'All-in-one management platform for Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches and Businesses in Africa');

    return `
<meta name="description" content="${safeDesc}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${esc(fullUrl)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:site_name" content="Comfort Platform">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="canonical" href="${esc(fullUrl)}">
<meta name="robots" content="index, follow">

<!-- JSON-LD Structured Data: Organization -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Comfort Platform",
  "url": "${esc(siteUrl)}",
  "logo": "${esc(siteUrl)}/favicon.png",
  "description": "${safeDesc}",
  "foundingLocation": { "@type": "Place", "name": "Kampala, Uganda" },
  "sameAs": [
    "https://twitter.com/ComfortPlatform",
    "https://facebook.com/ComfortPlatform",
    "https://linkedin.com/company/comfort-platform",
    "https://instagram.com/comfortplatform"
  ],
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+256-700-000-000",
    "contactType": "customer service",
    "availableLanguage": ["English", "Swahili", "French"]
  }
}
</script>
`;
  }

  // ============================================================
  // SHARED FOOTER
  // ============================================================
  function getPublicFooter() {
    const year = new Date().getFullYear();
    return `
<footer role="contentinfo">
  <div class="footer-grid">
    <div>
      <h4>◆ Comfort</h4>
      <p style="color:var(--text-footer);font-size:13px;line-height:1.8">The Operating System for African Institutions. One platform, all your operations. Built with ♥ in Uganda.</p>
      <button class="footer-dark-toggle" id="footerDarkToggle" aria-label="Toggle dark mode">🌓 Toggle Theme</button>
    </div>
    <div>
      <h4>Product</h4>
      <a href="/#features">Features</a>
      <a href="/#pricing">Pricing</a>
      <a href="/register">Register</a>
      <a href="/login">Login</a>
      <a href="/help-center">Help Center</a>
      <a href="/api-docs">API Docs</a>
    </div>
    <div>
      <h4>Company</h4>
      <a href="/about">About Us</a>
      <a href="/contact">Contact</a>
      <a href="/blog/posts">Blog</a>
      <a href="/careers">Careers</a>
      <a href="/partners">Partners</a>
      <a href="/changelog">Changelog</a>
    </div>
    <div>
      <h4>Legal</h4>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/security">Security</a>
      <a href="/cookie-policy">Cookie Policy</a>
    </div>
    <div>
      <h4>Connect</h4>
      <a href="https://twitter.com/ComfortPlatform" target="_blank" rel="noopener">Twitter / X</a>
      <a href="https://facebook.com/ComfortPlatform" target="_blank" rel="noopener">Facebook</a>
      <a href="https://linkedin.com/company/comfort-platform" target="_blank" rel="noopener">LinkedIn</a>
      <a href="https://instagram.com/comfortplatform" target="_blank" rel="noopener">Instagram</a>
      <a href="https://wa.me/256700000000" target="_blank" rel="noopener">WhatsApp</a>
    </div>
  </div>
  <div class="footer-bottom">© ${year} Comfort Platform. All rights reserved.</div>
</footer>
`;
  }

  // ============================================================
  // SHARED CLIENT-SIDE SCRIPTS
  // ============================================================
  function getPublicScripts() {
    return `
<script>
// === Dark Mode Toggle ===
(function(){
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var di = document.querySelectorAll('.dark-icon');
    var li = document.querySelectorAll('.light-icon');
    di.forEach(function(e){ e.style.display = dark ? 'none' : 'inline'; });
    li.forEach(function(e){ e.style.display = dark ? 'inline' : 'none'; });
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);

  var toggle = document.getElementById('darkToggle');
  if (toggle) {
    toggle.addEventListener('click', function(){
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      applyTheme(!isDark);
    });
  }
  var footerToggle = document.getElementById('footerDarkToggle');
  if (footerToggle) {
    footerToggle.addEventListener('click', function(){
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      applyTheme(!isDark);
    });
  }
})();

// === Hamburger / Mobile Menu ===
(function(){
  var btn = document.getElementById('hamburgerBtn');
  var nav = document.getElementById('mobileNav');
  var overlay = document.getElementById('mobileOverlay');
  if (!btn || !nav) return;
  function toggleMenu(open) {
    var isOpen = typeof open === 'boolean' ? open : !nav.classList.contains('open');
    nav.classList.toggle('open', isOpen);
    overlay.classList.toggle('open', isOpen);
    btn.classList.toggle('active', isOpen);
    btn.setAttribute('aria-expanded', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }
  btn.addEventListener('click', function(){ toggleMenu(); });
  overlay.addEventListener('click', function(){ toggleMenu(false); });
  nav.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', function(){ toggleMenu(false); });
  });
})();

// === Language Selector ===
(function(){
  var btn = document.getElementById('langBtn');
  var dd = document.getElementById('langDropdown');
  if (!btn || !dd) return;
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    dd.classList.toggle('open');
  });
  document.addEventListener('click', function(){ dd.classList.remove('open'); });
  dd.addEventListener('click', function(e){ e.stopPropagation(); });
})();

// === Search Overlay ===
(function(){
  var btn = document.getElementById('searchBtn');
  var overlay = document.getElementById('searchOverlay');
  var input = document.getElementById('searchInput');
  var results = document.getElementById('searchResults');
  if (!btn || !overlay) return;
  btn.addEventListener('click', function(){
    overlay.classList.add('open');
    if (input) setTimeout(function(){ input.focus(); }, 100);
  });
  overlay.addEventListener('click', function(e){
    if (e.target === overlay) overlay.classList.remove('open');
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') overlay.classList.remove('open');
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      overlay.classList.add('open');
      if (input) setTimeout(function(){ input.focus(); }, 100);
    }
  });
  if (input) {
    var debounce;
    input.addEventListener('input', function(){
      clearTimeout(debounce);
      debounce = setTimeout(function(){
        var q = input.value.trim();
        if (q.length < 2) { if (results) results.innerHTML = ''; return; }
        fetch('/api/search?q=' + encodeURIComponent(q))
          .then(function(r){ return r.json(); })
          .then(function(data){
            if (!results) return;
            if (data.results && data.results.length > 0) {
              results.innerHTML = data.results.map(function(r){
                return '<div class="search-result-item"><a href="' + (r.url||'#') + '">' + (r.title||'') + '</a><p>' + (r.snippet||'') + '</p></div>';
              }).join('');
            } else {
              results.innerHTML = '<p style="color:var(--text-muted);padding:12px 0">No results found for "' + q + '"</p>';
            }
          })
          .catch(function(){});
      }, 300);
    });
  }
})();

// === Smooth Scroll ===
document.querySelectorAll('a[href^="#"]').forEach(function(a){
  a.addEventListener('click', function(e){
    var href = a.getAttribute('href');
    if (href === '#') return;
    e.preventDefault();
    var t = document.querySelector(href);
    if (t) t.scrollIntoView({ behavior: 'smooth' });
  });
});

// === Service Worker Registration ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function(){});
}

// === Lazy Loading Images ===
if ('IntersectionObserver' in window) {
  var lazyObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) {
        var img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          lazyObserver.unobserve(img);
        }
      }
    });
  });
  document.querySelectorAll('img[data-src]').forEach(function(img){
    lazyObserver.observe(img);
  });
}

// === Analytics Event Tracking ===
function trackAnalytics(eventType, pagePath) {
  var consent = localStorage.getItem('cookie_consent');
  if (consent !== 'accepted') return;
  try {
    fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType || 'page_view',
        page_path: pagePath || window.location.pathname,
        referrer: document.referrer,
        user_agent: navigator.userAgent
      })
    }).catch(function(){});
  } catch(e) {}
}
// Track initial page view
trackAnalytics('page_view', window.location.pathname);

// === i18n Translation Loader ===
(function(){
  var locale = localStorage.getItem('locale') || 'en';
  function loadTranslations(loc) {
    fetch('/api/translations?locale=' + encodeURIComponent(loc))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data.translations) {
          document.querySelectorAll('[data-i18n]').forEach(function(el){
            var key = el.getAttribute('data-i18n');
            if (data.translations[key]) el.textContent = data.translations[key];
          });
        }
      })
      .catch(function(){});
  }
  if (locale !== 'en') loadTranslations(locale);
})();
</script>
`;
  }

  // ============================================================
  // LANDING PAGE ROUTE
  // ============================================================
  app.get('/', portalLimiter, (req, res) => {
    if (req.session && req.session.user) return res.redirect('/dashboard');

    const siteUrl = esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com');
    const locale = (req.query && req.query.locale && SUPPORTED_LOCALES.includes(req.query.locale)) ? req.query.locale : 'en';

    const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comfort — The Operating System for African Institutions</title>
<link rel="icon" href="/favicon.png">
<link rel="manifest" href="/manifest.json">
${getSEOHead(
  'Comfort Platform — Management Software for Africa',
  'All-in-one management platform for Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches and Businesses in Africa',
  process.env.BASE_URL || 'https://ssewasswa.onrender.com',
  'website'
)}
<!-- Additional JSON-LD: SoftwareApplication -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Comfort Platform",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "UGX"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "500"
  },
  "description": "All-in-one management platform for African institutions — Schools, Hotels, Restaurants, Salons, Pharmacies, Clinics, Churches and Businesses."
}
</script>
<style>${getPublicCSS()}</style>
</head>
<body>

${getPublicNav(locale)}

<main id="main-content">

<!-- HERO SECTION -->
<section class="hero">
  <h1 data-i18n="hero_title">The Operating System for<br>Schools, Hotels, Restaurants,<br>Salons, Pharmacies &amp; More</h1>
  <p data-i18n="hero_subtitle">Stop juggling 12 different apps. One platform. All your operations. Built for Uganda, designed for Africa.</p>
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

  <!-- Video Section -->
  <div class="video-section">
    <div class="video-wrapper">
      <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Comfort Platform Demo" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    </div>
  </div>

  <!-- Social Proof Counter -->
  <div class="social-proof">
    <div class="counter-value" id="institutionCounter">0+</div>
    <div class="counter-label">institutions trust Comfort</div>
  </div>
</section>

<!-- FEATURES SECTION -->
<section class="section" id="features">
  <div class="container">
    <h2 class="section-title" data-i18n="features_title">Built For Your Institution</h2>
    <p class="section-sub" data-i18n="features_sub">Choose your sector. We handle the rest.</p>
    <div class="grid">
      ${PORTAL_TYPES.map(p => `
      <div class="card">
        <div class="card-top" style="background:${p.color}"></div>
        <div class="card-emoji">${p.emoji}</div>
        <h3 style="color:${p.color}">${p.label}</h3>
        <div class="card-price">${p.price === 'FREE' ? 'FREE Forever' : 'UGX ' + p.price + '/month'}</div>
        <ul>${p.features.map(f => '<li>' + f + '</li>').join('')}</ul>
        <a href="/register?type=${p.type}" class="btn btn-primary" style="background:${p.color}">Start Free Trial</a>
      </div>`).join('')}
    </div>
  </div>
</section>

<!-- PRICING SECTION -->
<section class="section" style="background:var(--bg-secondary)" id="pricing">
  <div class="container">
    <h2 class="section-title" data-i18n="pricing_title">Simple, Transparent Pricing</h2>
    <p class="section-sub" data-i18n="pricing_sub">Start free. Upgrade when you need more.</p>
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
        <div style="background:var(--accent-primary);color:white;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block;margin-bottom:12px">POPULAR</div>
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

<!-- TESTIMONIALS SECTION -->
<section class="section" id="testimonials">
  <div class="container">
    <h2 class="section-title" data-i18n="testimonials_title">Trusted by Institutions Across Africa</h2>
    <p class="section-sub" data-i18n="testimonials_sub">See what our users say about Comfort.</p>
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
      <div class="testimonial">
        <div class="testimonial-stars">★★★★★</div>
        <p>"Our church manages over 2,000 members, tithes, and cell groups with Comfort. The donation tracking and sacrament records have brought complete transparency to our finances. The prayer request feature has united our congregation."</p>
        <div class="testimonial-author">Pastor James Mukasa</div>
        <div class="testimonial-role">Senior Pastor, Grace Community Church — Mukono</div>
      </div>
      <div class="testimonial">
        <div class="testimonial-stars">★★★★★</div>
        <p>"Running a gym with 300+ members was chaotic before Comfort. Membership renewals, class scheduling, and trainer commissions are now automated. Our members love checking in with just their phone number!"</p>
        <div class="testimonial-author">Diana Nalubega</div>
        <div class="testimonial-role">Owner, FitLife Gym & Wellness — Kampala</div>
      </div>
    </div>
  </div>
</section>

<!-- FAQ SECTION -->
<section class="section" style="background:var(--bg-secondary)" id="faq">
  <div class="container" style="max-width:800px">
    <h2 class="section-title" data-i18n="faq_title">Frequently Asked Questions</h2>
    <p class="section-sub" data-i18n="faq_sub">Everything you need to know about Comfort.</p>
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

<!-- CTA SECTION -->
<section class="cta-section">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Ready to Transform Your Institution?</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Join 500+ institutions already using Comfort across Africa.</p>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
    <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free — No Credit Card</a>
    <a href="/contact" style="display:inline-block;padding:16px 40px;background:rgba(255,255,255,0.15);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;border:2px solid rgba(255,255,255,0.4)">Talk to Sales</a>
  </div>
</section>

</main>

${getPublicFooter()}
${getCookieConsent()}

<!-- Counter Animation Script -->
<script>
(function(){
  var counter = document.getElementById('institutionCounter');
  if (!counter) return;
  var target = 500;
  var duration = 2000;
  var startTime = null;
  var observed = false;

  function animate(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.floor(eased * target);
    counter.textContent = current + '+';
    if (progress < 1) requestAnimationFrame(animate);
  }

  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting && !observed) {
        observed = true;
        requestAnimationFrame(animate);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  observer.observe(counter);
})();
</script>

${getPublicScripts()}
</body></html>`;

    res.send(html);
  });

  // ============================================================
  // REGISTRATION — STEP 1: TYPE SELECTION
  // ============================================================
  app.get('/register', portalLimiter, (req, res) => {
    const selectedType = req.query.type || '';
    if (selectedType && !PORTAL_TYPES.find(p => p.type === selectedType)) {
      return res.redirect('/register');
    }

    const locale = (req.query && req.query.locale && SUPPORTED_LOCALES.includes(req.query.locale)) ? req.query.locale : 'en';

    // Step 1: Type selection
    if (!selectedType) {
      const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register — Comfort</title>
<link rel="icon" href="/favicon.png">
${getSEOHead('Register — Comfort Platform', 'Create your free account on the Comfort Platform', '/register')}
<style>${getPublicCSS()}</style>
</head>
<body>
${getPublicNav(locale)}
<main id="main-content">
<div class="container" style="max-width:1000px;margin:40px auto;padding:0 20px">
<h1 style="text-align:center;font-size:28px;margin-bottom:8px">What type of institution?</h1>
<p style="text-align:center;color:var(--text-muted);margin-bottom:32px">Choose the category that best describes your organization.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
${PORTAL_TYPES.map(p => `<a href="/register?type=${p.type}" class="type-card"><div class="emoji">${p.emoji}</div><div class="name">${p.label}</div><div class="price">${p.price === 'FREE' ? 'Free' : 'UGX ' + p.price + '/mo'}</div></a>`).join('')}
</div>
<div style="text-align:center;margin-top:24px">
<a href="/login" style="color:var(--text-muted);font-size:14px">Already have an account? Login</a>
</div>
</div>
</main>
${getPublicFooter()}
${getCookieConsent()}
${getPublicScripts()}
</body></html>`;
      res.send(html);
      return;
    }

    // Step 2: Registration form
    const pt = PORTAL_TYPES.find(p => p.type === selectedType);
    const subOptions = SUB_TYPES[selectedType] || [];

    // Generate simple math CAPTCHA
    const captchaA = Math.floor(Math.random() * 10) + 1;
    const captchaB = Math.floor(Math.random() * 10) + 1;
    const captchaAnswer = captchaA + captchaB;

    const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register as ${esc(pt?.label || selectedType)} — Comfort</title>
<link rel="icon" href="/favicon.png">
${getSEOHead('Register — Comfort Platform', 'Create your ' + (pt?.label || '') + ' account on the Comfort Platform', '/register?type=' + selectedType)}
<style>${getPublicCSS()}</style>
</head>
<body>
${getPublicNav(locale)}
<main id="main-content">
<div style="max-width:480px;margin:40px auto;padding:0 20px">
<div class="form-card">
<h2 style="text-align:center;margin-bottom:4px;color:var(--text-primary)">Create Your Account</h2>
<div style="text-align:center;margin-bottom:20px">
<span style="display:inline-block;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;color:white;background:${pt?.color || '#4f46e5'}">${pt?.emoji || ''} ${pt?.label || selectedType}</span>
</div>
<form method="POST" action="/register">
<input type="hidden" name="_csrf" value="${req.csrfToken}">
<input type="hidden" name="type" value="${esc(selectedType)}">
<input type="hidden" name="captcha_answer" value="${captchaAnswer}">

<label>Organization Name *</label>
<input name="org_name" placeholder="e.g. Sunrise Primary School" required>

${subOptions.length > 1 ? `<label>Sub-Type / Category</label><select name="sub_type"><option value="">Select...</option>${subOptions.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('')}</select>` : ''}

<label>Your Email *</label>
<input name="email" type="email" placeholder="you@example.com" required>
<p style="font-size:12px;color:var(--text-muted);margin:2px 0 8px">You will need to verify your email address</p>

<label>Phone Number *</label>
<input name="phone" placeholder="+256 700 000 000" required>

<label>Password *</label>
<input name="password" type="password" id="pw" placeholder="Min 8 chars, 1 uppercase, 1 number" required minlength="8" pattern="(?=.*[A-Z])(?=.*\\d).{8,}" oninput="checkPw(this.value)">
<div class="pw-strength"><div class="pw-fill" id="pw-fill" style="width:0;background:var(--border-color)"></div></div>

<label>Confirm Password *</label>
<input name="confirm_password" type="password" placeholder="Re-enter password" required>

<label>Security Check: What is ${captchaA} + ${captchaB}? *</label>
<input name="captcha_input" type="number" required placeholder="Enter the answer">

<label class="checkbox-label">
<input type="checkbox" name="email_verify_consent" checked>
I consent to receiving a verification email
</label>

<label class="checkbox-label">
<input type="checkbox" name="terms_accepted" required>
I agree to the <a href="/terms" target="_blank">Terms of Service</a> and <a href="/privacy" target="_blank">Privacy Policy</a>
</label>

<button type="submit" class="btn btn-primary" style="display:block;width:100%;padding:14px;font-size:16px;margin-top:16px">Create Account &amp; Start Free</button>
</form>
</div>
<div style="text-align:center;margin-top:16px">
<a href="/register" style="color:var(--text-muted);font-size:13px">← Choose different type</a> &nbsp;|&nbsp; <a href="/login" style="color:var(--accent-primary);font-size:13px">Already have an account?</a>
</div>
</div>
</main>
${getPublicFooter()}
${getCookieConsent()}

<script>
function checkPw(v){
  var s=0,c='red';
  if(v.length>=8)s++;
  if(/[A-Z]/.test(v))s++;
  if(/[0-9]/.test(v))s++;
  if(/[^A-Za-z0-9]/.test(v))s++;
  if(s<=1){c='red';s=25}else if(s==2){c='orange';s=50}else if(s==3){c='#f59e0b';s=75}else{c='#059669';s=100}
  var f=document.getElementById('pw-fill');
  if(f){f.style.width=s+'%';f.style.background=c;}
}
</script>
${getPublicScripts()}
</body></html>`;
    res.send(html);
  });


  // ============================================================
  // API: TRANSLATIONS (i18n support)
  // ============================================================
  // SUPPORTED_LOCALES, RTL_LOCALES, LOCALE_NAMES already declared above

  app.get('/api/translations', (req, res) => {
    const locale = String(req.query.locale || 'en').substring(0, 2).toLowerCase();
    const translations = {
      en: { nav_features:'Features', nav_pricing:'Pricing', nav_about:'About', nav_contact:'Contact', nav_login:'Login', nav_register:'Start Free', hero_title:'The Operating System for African Institutions', hero_sub:'One platform. All your operations. Built for Uganda, designed for Africa.', cta_start:'Start Free', cta_login:'Login', cookie_msg:'We use cookies to improve your experience.', cookie_accept:'Accept', cookie_reject:'Reject', search_placeholder:'Search Comfort...', dark_toggle:'Toggle dark mode' },
      sw: { nav_features:'Features', nav_pricing:'Bei', nav_about:'Kuhusu', nav_contact:'Wasiliana', nav_login:'Ingia', nav_register:'Anza Bure', hero_title:'Mfumo wa Uendeshaji kwa Taasisi za Afrika', hero_sub:'Jukwaa moja. Shughuli zako zote. Lililoundwa kwa Uganda.', cta_start:'Anza Bure', cta_login:'Ingia', cookie_msg:'Tunatumia kuki kuboresha uzoefu wako.', cookie_accept:'Kubali', cookie_reject:'Kataa', search_placeholder:'Tafuta Comfort...', dark_toggle:'Badilisha hali ya giza' },
      fr: { nav_features:'Fonctionnalités', nav_pricing:'Tarifs', nav_about:'À propos', nav_contact:'Contact', nav_login:'Connexion', nav_register:'Commencer', hero_title:'Le Système d\'Exploitation pour les Institutions Africaines', hero_sub:'Une plateforme. Toutes vos opérations.', cta_start:'Commencer', cta_login:'Connexion', cookie_msg:'Nous utilisons des cookies pour améliorer votre expérience.', cookie_accept:'Accepter', cookie_reject:'Refuser', search_placeholder:'Rechercher...', dark_toggle:'Mode sombre' },
      ar: { nav_features:'الميزات', nav_pricing:'الأسعار', nav_about:'من نحن', nav_contact:'اتصل بنا', nav_login:'تسجيل الدخول', nav_register:'ابدأ مجاناً', hero_title:'نظام التشغيل للمؤسسات الأفريقية', hero_sub:'منصة واحدة. جميع عملياتك.', cta_start:'ابدأ مجاناً', cta_login:'تسجيل الدخول', cookie_msg:'نستخدم ملفات تعريف الارتباط لتحسين تجربتك.', cookie_accept:'قبول', cookie_reject:'رفض', search_placeholder:'بحث...', dark_toggle:'الوضع الداكن' },
      es: { nav_features:'Características', nav_pricing:'Precios', nav_about:'Acerca de', nav_contact:'Contacto', nav_login:'Iniciar sesión', nav_register:'Comenzar gratis', hero_title:'El Sistema Operativo para Instituciones Africanas', hero_sub:'Una plataforma. Todas tus operaciones.', cta_start:'Comenzar gratis', cta_login:'Iniciar sesión', cookie_msg:'Usamos cookies para mejorar tu experiencia.', cookie_accept:'Aceptar', cookie_reject:'Rechazar', search_placeholder:'Buscar...', dark_toggle:'Modo oscuro' },
      hi: { nav_features:'सुविधाएँ', nav_pricing:'मूल्य', nav_about:'हमारे बारे में', nav_contact:'संपर्क', nav_login:'लॉग इन', nav_register:'मुफ्त शुरू करें', hero_title:'अफ्रीकी संस्थाओं के लिए ऑपरेटिंग सिस्टम', hero_sub:'एक मंच। आपके सभी संचालन।', cta_start:'मुफ्त शुरू करें', cta_login:'लॉग इन', cookie_msg:'हम आपके अनुभव को बेहतर बनाने के लिए कुकीज़ का उपयोग करते हैं।', cookie_accept:'स्वीकार करें', cookie_reject:'अस्वीकार करें', search_placeholder:'खोजें...', dark_toggle:'डार्क मोड' },
      zh: { nav_features:'功能', nav_pricing:'定价', nav_about:'关于', nav_contact:'联系我们', nav_login:'登录', nav_register:'免费开始', hero_title:'非洲机构的操作系统', hero_sub:'一个平台，所有运营。', cta_start:'免费开始', cta_login:'登录', cookie_msg:'我们使用Cookie来改善您的体验。', cookie_accept:'接受', cookie_reject:'拒绝', search_placeholder:'搜索...', dark_toggle:'深色模式' },
      pt: { nav_features:'Recursos', nav_pricing:'Preços', nav_about:'Sobre', nav_contact:'Contato', nav_login:'Entrar', nav_register:'Começar grátis', hero_title:'O Sistema Operacional para Instituições Africanas', hero_sub:'Uma plataforma. Todas as suas operações.', cta_start:'Começar grátis', cta_login:'Entrar', cookie_msg:'Usamos cookies para melhorar sua experiência.', cookie_accept:'Aceitar', cookie_reject:'Rejeitar', search_placeholder:'Pesquisar...', dark_toggle:'Modo escuro' },
      am: { nav_features:'ባህሪያት', nav_pricing:'ዋጋዎች', nav_about:'ስለ እኛ', nav_contact:'ያግኙን', nav_login:'ግባ', nav_register:'ነፃ ይጀምሩ', hero_title:'ለአፍሪካ ተቋማት የኦፕሬቲንግ ስርዓት', hero_sub:'አንድ መድረክ። ሁሉም ኦፕሬሽኖችዎ።', cta_start:'ነፃ ይጀምሩ', cta_login:'ግባ', cookie_msg:'ልምድዎን ለማሻሻል ኩኪዎችን እንጠቀማለን።', cookie_accept:'ተቀበል', cookie_reject:'ውድቅ አድርግ', search_placeholder:'ፈልግ...', dark_toggle:'ጨለማ ሁነታ' }
    };
    res.json({ locale, translations: translations[locale] || translations.en });
  });

  // ============================================================
  // HELP CENTER PAGE
  // ============================================================
  app.get('/help-center', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Help Center — Comfort', 'Get help with Comfort Platform. FAQs, guides, and support.', '/help-center', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Help Center — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="section" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-align:center;padding:60px 20px">
  <div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Help Center</h1>
  <p style="font-size:18px;opacity:0.9">Find answers, guides, and support for Comfort Platform.</p></div>
</section>
<section class="section"><div class="container" style="max-width:800px">
  <div class="faq-item" onclick="this.classList.toggle('open')"><h4>How do I get started?</h4><p>Register for free, select your institution type, and start using Comfort in under 10 minutes. No credit card required.</p></div>
  <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Does Comfort work offline?</h4><p>Yes! Comfort is a PWA that works without internet. Data syncs when you reconnect.</p></div>
  <div class="faq-item" onclick="this.classList.toggle('open')"><h4>How do I pay?</h4><p>We accept MTN MoMo, Airtel Money, bank transfer, and Flutterwave for cards. All in UGX.</p></div>
  <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Can I import my data?</h4><p>Yes. Upload CSV/Excel files or use our API. Our team can help with bulk migration.</p></div>
  <div class="faq-item" onclick="this.classList.toggle('open')"><h4>Is my data secure?</h4><p>Absolutely. SSL/TLS encryption, role-based access, 2FA, daily backups, and audit logging.</p></div>
  <div class="faq-item" onclick="this.classList.toggle('open')"><h4>How do I contact support?</h4><p>Email hello@comfort.ug, WhatsApp +256 700 000 000, or use the contact form. Enterprise gets a dedicated manager.</p></div>
</div></section>
</main>
${footer}${cookie}
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // LEGAL PAGES (Privacy, Terms)
  // ============================================================
  app.get('/privacy', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Privacy Policy — Comfort', 'Comfort Platform Privacy Policy', '/privacy', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy Policy — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}<main id="main-content" role="main"><div class="container" style="max-width:800px;margin:40px auto;padding:0 20px">
<h1 style="font-size:32px;font-weight:800;margin-bottom:24px">Privacy Policy</h1>
<p style="color:#64748b;margin-bottom:24px">Last updated: ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
<div style="color:var(--text-secondary);line-height:1.8;font-size:15px">
<p>Comfort Platform ("we", "us", or "our") respects your privacy and is committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our platform.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Information We Collect</h2>
<p>We collect information you provide directly (name, email, phone, organization details), usage data (page views, features used), and device information (browser type, IP address). We only collect what is necessary to provide and improve our services.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">How We Use Your Information</h2>
<p>Your data is used to provide and maintain our service, process transactions, send notifications, improve the platform, and comply with legal obligations. We never sell your personal data to third parties.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Data Security</h2>
<p>We implement industry-standard security measures including SSL/TLS encryption, role-based access control, two-factor authentication, and regular security audits. Your data is stored on secure servers with daily backups.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Your Rights</h2>
<p>You have the right to access, correct, or delete your personal data. You can export your data at any time or request account deletion. Contact privacy@comfort.ug for any data-related requests.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Contact</h2>
<p>For privacy inquiries, email privacy@comfort.ug or write to Comfort Platform, Kampala, Uganda.</p>
</div></div></main>${footer}${cookie}</body></html>`;
    res.send(html);
  });

  app.get('/terms', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Terms of Service — Comfort', 'Comfort Platform Terms of Service', '/terms', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms of Service — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}<main id="main-content" role="main"><div class="container" style="max-width:800px;margin:40px auto;padding:0 20px">
<h1 style="font-size:32px;font-weight:800;margin-bottom:24px">Terms of Service</h1>
<p style="color:#64748b;margin-bottom:24px">Last updated: ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
<div style="color:var(--text-secondary);line-height:1.8;font-size:15px">
<p>By accessing or using Comfort Platform, you agree to be bound by these Terms of Service. If you do not agree, please do not use our platform.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Service Description</h2>
<p>Comfort Platform provides cloud-based management software for institutions including schools, hotels, restaurants, clinics, churches, and businesses across Africa. We offer free and paid subscription plans.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">User Responsibilities</h2>
<p>You are responsible for maintaining the confidentiality of your account, providing accurate information, and complying with all applicable laws. You must not misuse the platform or attempt to gain unauthorized access.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Payment Terms</h2>
<p>Paid plans are billed monthly. We accept mobile money (MTN, Airtel), bank transfers, and card payments via Flutterwave. Prices are in Uganda Shillings (UGX) unless stated otherwise. Refunds are handled on a case-by-case basis.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Data Ownership</h2>
<p>You own your data. We will not access, share, or sell your data except as required to provide the service or as mandated by law. You can export or delete your data at any time.</p>
<h2 style="font-size:22px;font-weight:700;margin:24px 0 12px">Contact</h2>
<p>For questions about these terms, email legal@comfort.ug or write to Comfort Platform, Kampala, Uganda.</p>
</div></div></main>${footer}${cookie}</body></html>`;
    res.send(html);
  });

// ============================================================
// PUBLIC PORTAL V18 — Part 2: Additional Route Definitions
// Comfort Platform - Multi-tenant SaaS for African Institutions
// ============================================================
// This file is APPENDED to Part 1. It continues inside the same
// module.exports function body and has access to all shared
// variables: app, pool, bcrypt, ah, esc, renderPage, audit,
// sendEmail, queueEmail, logger, PORTAL_TYPES, SUB_TYPES,
// contactLimiter, registerLimiter, portalLimiter,
// getPublicCSS(), getPublicNav(locale), getPublicFooter(),
// getCookieConsent(), getSEOHead(title, desc, url, type, img)
// ============================================================

// === PART 2 MIGRATIONS ===
const p2Migrations = [
  `CREATE TABLE IF NOT EXISTS changelog_entries (
    id SERIAL PRIMARY KEY, version VARCHAR(20) NOT NULL, title VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, description TEXT, date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY, event_type VARCHAR(100) NOT NULL, page_path VARCHAR(500),
    referrer VARCHAR(500), metadata JSONB, session_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS email_verifications (
    id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL, token VARCHAR(255) NOT NULL,
    verified BOOLEAN DEFAULT false, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS demo_requests (
    id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
    phone VARCHAR(20), institution_type VARCHAR(100), preferred_date VARCHAR(100),
    message TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS partner_applications (
    id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
    company VARCHAR(255), tier VARCHAR(50), message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS career_applications (
    id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
    position VARCHAR(255) NOT NULL, phone VARCHAR(20), message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];
(async () => { for (const sql of p2Migrations) { try { await pool.query(sql); } catch(e) { /* table may exist */ } } })();

// Seed changelog if empty
(async () => {
  try {
    const cnt = (await pool.query('SELECT COUNT(*)::int AS c FROM changelog_entries')).rows[0].c;
    if (cnt === 0) {
      const entries = [
        ['18.0', 'Multi-Portal Public Pages', 'Feature', 'Complete redesign of public pages with enhanced SEO, dark mode, accessibility, and 15+ new pages including careers, partners, demo, compare, security, API docs, onboarding, and pricing calculator.', '2025-03-01'],
        ['17.5', 'Enhanced Tenant Profiles', 'Feature', 'Non-health tenants now get custom profile pages: schools show programs, hotels show amenities, salons show services, retail shows categories, churches show service times.', '2025-02-15'],
        ['17.0', 'API Developer Hub', 'Feature', 'New API documentation page with interactive try-it section, authentication guides, code examples in curl/JS/Python, and SDK links.', '2025-02-01'],
        ['16.5', 'Security & Compliance Center', 'Enhancement', 'Dedicated security page with encryption details, access control, audit logging, 2FA, GDPR compliance, and responsible disclosure policy.', '2025-01-15'],
        ['16.0', 'Pricing Calculator', 'Feature', 'Interactive pricing calculator with multi-currency support, monthly/annual toggle, and plan recommendations by institution type.', '2025-01-01'],
        ['15.5', 'Cookie Consent & Privacy', 'Enhancement', 'Enhanced cookie consent with detailed cookie policy page, browser management instructions, and category-based opt-in.', '2024-12-15'],
        ['15.0', 'Email Verification', 'Feature', 'New email verification flow with token-based verification page and automatic redirect to login.', '2024-12-01'],
        ['14.5', 'Site Search API', 'Feature', 'New /api/search endpoint that searches across tenants, blog posts, and help articles with type-ahead results.', '2024-11-15'],
        ['14.0', 'Analytics Tracking', 'Feature', 'New /api/analytics/track endpoint for capturing page views, events, and user flows across the public portal.', '2024-11-01'],
        ['13.0', 'Contact CAPTCHA', 'Security', 'Added math CAPTCHA and honeypot field to contact form to prevent spam submissions.', '2024-10-01']
      ];
      for (const [v, t, c, d, dt] of entries) {
        await pool.query('INSERT INTO changelog_entries(version,title,category,description,date) VALUES($1,$2,$3,$4,$5)', [v, t, c, d, dt]);
      }
    }
  } catch(e) { /* changelog table may not exist yet */ }
})();

// ============================================================
// 1. GET /about — Enhanced About Page
// ============================================================
app.get('/about', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('About Comfort — The Operating System for African Institutions', 'Learn about Comfort Platform, our mission to empower 1 million African institutions with affordable technology, our team, and our values.', '/about', 'website');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>About Comfort — The Operating System for African Institutions</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="About Comfort">
  <div class="container" style="text-align:center;padding:80px 20px 60px">
    <h1 style="font-size:clamp(28px,5vw,48px);font-weight:900;margin-bottom:16px;color:white">Built in Uganda,<br>for All of Africa</h1>
    <p style="font-size:clamp(16px,2.5vw,20px);color:rgba(255,255,255,0.9);max-width:700px;margin:0 auto">We started with a simple belief: every institution deserves world-class management software, regardless of size or budget.</p>
  </div>
</section>

<section class="section" aria-label="Company Story">
  <div class="container" style="max-width:800px">
    <h2 class="section-title">Our Story</h2>
    <p style="color:var(--text-secondary);font-size:16px;line-height:1.8;text-align:center">Comfort was born from the frustration of watching African schools, clinics, hotels, and businesses struggle with spreadsheets, paper ledgers, and expensive foreign software that was never designed for their needs. In 2023, our founder set out to build one platform that could adapt to any institution type — from a small primary school in Mukono to a boutique hotel in Entebbe — and make it affordable enough for everyone. Today, over 500 institutions across 10+ countries trust Comfort to run their operations.</p>
  </div>
</section>

<section class="section" style="background:var(--bg-secondary)" aria-label="Mission Vision Values">
  <div class="container">
    <h2 class="section-title">Mission, Vision &amp; Values</h2>
    <p class="section-sub">The principles that guide everything we build.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <div class="card" role="article"><div class="card-top" style="background:#4f46e5"></div><div class="card-emoji" aria-hidden="true">🎯</div><h3>Our Mission</h3><p style="font-size:14px;color:var(--text-secondary);line-height:1.7">To empower 1 million African institutions with affordable, accessible technology that simplifies operations and drives growth.</p></div>
      <div class="card" role="article"><div class="card-top" style="background:#059669"></div><div class="card-emoji" aria-hidden="true">🔭</div><h3>Our Vision</h3><p style="font-size:14px;color:var(--text-secondary);line-height:1.7">An Africa where every institution, no matter how small, has access to the same caliber of management tools as the world's best organizations.</p></div>
      <div class="card" role="article"><div class="card-top" style="background:#0891b2"></div><div class="card-emoji" aria-hidden="true">🌍</div><h3>Built for Africa</h3><p style="font-size:14px;color:var(--text-secondary);line-height:1.7">Offline-first, mobile money payments, local currency pricing, tax compliance, and features designed for how African businesses actually work.</p></div>
      <div class="card" role="article"><div class="card-top" style="background:#7c3aed"></div><div class="card-emoji" aria-hidden="true">🔒</div><h3>Trust &amp; Security</h3><p style="font-size:14px;color:var(--text-secondary);line-height:1.7">End-to-end encryption, role-based access, audit logging, two-factor authentication. Your data stays yours, always.</p></div>
    </div>
  </div>
</section>

<section class="section" aria-label="Our Team">
  <div class="container" style="max-width:900px">
    <h2 class="section-title">Meet Our Team</h2>
    <p class="section-sub">A passionate team building the future of African business software.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px">
      <div class="card" style="text-align:center" role="article"><div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:700" aria-hidden="true">S</div><h4 style="font-size:16px;font-weight:700">Samuel Ssewasswa</h4><p style="font-size:13px;color:var(--text-muted)">Founder &amp; CEO</p></div>
      <div class="card" style="text-align:center" role="article"><div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#059669,#0d9488);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:700" aria-hidden="true">A</div><h4 style="font-size:16px;font-weight:700">Aisha Nalubega</h4><p style="font-size:13px;color:var(--text-muted)">Head of Engineering</p></div>
      <div class="card" style="text-align:center" role="article"><div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#0891b2,#0e7490);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:700" aria-hidden="true">J</div><h4 style="font-size:16px;font-weight:700">James Okello</h4><p style="font-size:13px;color:var(--text-muted)">Head of Sales</p></div>
      <div class="card" style="text-align:center" role="article"><div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#ea580c);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:white;font-size:28px;font-weight:700" aria-hidden="true">P</div><h4 style="font-size:16px;font-weight:700">Patricia Ario</h4><p style="font-size:13px;color:var(--text-muted)">Head of Customer Success</p></div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--bg-secondary)" aria-label="Stats">
  <div class="container">
    <h2 class="section-title">Comfort by the Numbers</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;max-width:800px;margin:0 auto">
      <div style="text-align:center;padding:32px 16px"><div style="font-size:42px;font-weight:900;color:#4f46e5">500+</div><div style="font-size:14px;color:var(--text-muted);font-weight:600">Institutions</div></div>
      <div style="text-align:center;padding:32px 16px"><div style="font-size:42px;font-weight:900;color:#059669">15</div><div style="font-size:14px;color:var(--text-muted);font-weight:600">Sectors</div></div>
      <div style="text-align:center;padding:32px 16px"><div style="font-size:42px;font-weight:900;color:#0891b2">9</div><div style="font-size:14px;color:var(--text-muted);font-weight:600">Languages</div></div>
      <div style="text-align:center;padding:32px 16px"><div style="font-size:42px;font-weight:900;color:#7c3aed">10+</div><div style="font-size:14px;color:var(--text-muted);font-weight:600">Countries</div></div>
    </div>
  </div>
</section>

<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px" aria-label="Call to Action">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Join the Movement</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Be part of the next 500 institutions transforming Africa.</p>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
    <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free Today</a>
    <a href="/contact" style="display:inline-block;padding:16px 40px;background:rgba(255,255,255,0.15);color:white;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none;border:2px solid rgba(255,255,255,0.4)">Talk to Us</a>
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 2. GET /contact — Enhanced with CAPTCHA & Honeypot
// ============================================================
app.get('/contact', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Contact Us — Comfort', 'Get in touch with the Comfort team. Sales inquiries, technical support, partnerships, and more.', '/contact', 'website');
  // Generate CAPTCHA: simple math
  const captchaA = Math.floor(Math.random() * 5) + 3;
  const captchaB = Math.floor(Math.random() * 5) + 1;
  const captchaAnswer = String(captchaA + captchaB);
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contact Us — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="section" aria-label="Contact Form">
  <div class="container" style="max-width:600px">
    <h1 class="section-title">Get in Touch</h1>
    <p class="section-sub">We'd love to hear from you. Fill out the form below and we'll get back within 24 hours.</p>
    <div class="card" style="background:var(--bg-card);border-radius:16px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:1px solid var(--border-color)">
      <form method="POST" action="/contact" aria-label="Contact form" novalidate>
        <input type="hidden" name="_csrf" value="${req.csrfToken}">
        <input type="hidden" name="captcha_answer" value="${captchaAnswer}">
        <!-- Honeypot: invisible field, bots fill it, humans don't -->
        <div style="position:absolute;left:-9999px;top:-9999px;opacity:0;height:0;overflow:hidden" aria-hidden="true">
          <label for="website_url">Website URL</label>
          <input type="text" name="website_url" id="website_url" tabindex="-1" autocomplete="off">
        </div>
        <label for="contact-name" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Name *</label>
        <input id="contact-name" name="name" required aria-required="true" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
        <label for="contact-email" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Email *</label>
        <input id="contact-email" name="email" type="email" required aria-required="true" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
        <label for="contact-phone" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Phone</label>
        <input id="contact-phone" name="phone" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
        <label for="contact-subject" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Subject *</label>
        <select id="contact-subject" name="subject" required aria-required="true" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px;background:var(--bg-card)">
          <option value="">Select...</option><option>Sales Inquiry</option><option>Technical Support</option><option>Partnership</option><option>Feature Request</option><option>Bug Report</option><option>Other</option>
        </select>
        <label for="contact-message" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Message *</label>
        <textarea id="contact-message" name="message" required aria-required="true" rows="5" placeholder="How can we help?" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px;font-family:inherit;min-height:120px;resize:vertical"></textarea>
        <label for="contact-captcha" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:12px">What is ${captchaA} + ${captchaB}? *</label>
        <input id="contact-captcha" name="captcha" type="number" required aria-required="true" style="width:120px;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
        <button type="submit" style="display:block;width:100%;padding:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px">Send Message</button>
      </form>
    </div>
    <div style="text-align:center;margin-top:24px;color:var(--text-muted);font-size:14px">Or email us at <a href="mailto:hello@comfort.ug">hello@comfort.ug</a> | WhatsApp: <a href="https://wa.me/256700000000">+256 700 000 000</a></div>
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 3. POST /contact — With CAPTCHA verification
// ============================================================
app.post('/contact', contactLimiter, ah(async (req, res) => {
  const { name, email, phone, subject, message, captcha, captcha_answer, website_url } = req.body;
  // Honeypot check — if filled, it's a bot
  if (website_url && website_url.length > 0) {
    // Silently ignore — return success to not alert bots
    return res.send('<div style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:16px">&#10003;</div><h1>Message Sent!</h1><p style="color:var(--text-muted)">We\'ll get back to you within 24 hours.</p><a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:600">Back to Home</a></div>');
  }
  // CAPTCHA verification
  if (!captcha || String(captcha).trim() !== String(captcha_answer).trim()) {
    return res.status(400).send('<div style="text-align:center;padding:60px"><h2>CAPTCHA Failed</h2><p style="color:var(--text-muted)">Please try again with the correct answer.</p><a href="/contact" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:600">Go Back</a></div>');
  }
  // Validate inputs
  if (!name || !email || !message || name.length > 255 || email.length > 255 || (subject && subject.length > 255) || message.length > 5000) {
    return res.status(400).send('Invalid input. Please check your entries.');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).send('Invalid email format.');
  if (phone && phone.length > 20) return res.status(400).send('Invalid phone number.');
  const safeSubject = (subject || 'Contact Form Inquiry').replace(/[\r\n]/g, '').substring(0, 255);
  try {
    await pool.query('INSERT INTO contact_messages(name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5)', [name, email, phone, safeSubject, message]);
  } catch (e) {
    if (logger) logger.error('Contact form DB insert failed', e);
    return res.status(500).send('Something went wrong. Please try again.');
  }
  try { sendEmail('hello@comfort.ug', 'Contact: ' + safeSubject, '<p><strong>' + esc(name) + '</strong> (' + esc(email) + ')</p><p>' + esc(message) + '</p>'); } catch (e) { if (logger) logger.warn('Contact email send failed', e); }
  res.send('<div style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:16px">&#10003;</div><h1>Message Sent!</h1><p style="color:var(--text-muted)">We\'ll get back to you within 24 hours.</p><a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#4f46e5;color:white;border-radius:10px;text-decoration:none;font-weight:600">Back to Home</a></div>');
}));

// ============================================================
// 4. GET /features — Enhanced Features Page
// ============================================================
app.get('/features', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Features — Comfort Platform', 'Explore 100+ features across School, Hotel, Restaurant, Retail, Church, Health, and Platform categories. All-in-one management for African institutions.', '/features', 'website');
  const categories = [
    { title:'School Management', emoji:'&#127979;', color:'#059669', features:[
      {name:'Student Records',desc:'Complete profiles with photos, parent info, medical records, academic history.'},
      {name:'Fee Management',desc:'Track fees, generate receipts, send reminders via SMS/email, accept mobile money.'},
      {name:'Exams & Report Cards',desc:'Create exams, enter marks, auto-calculate grades, generate report cards (DOCX).'},
      {name:'Attendance',desc:'Daily tracking with biometric support, absence alerts, and analytics.'},
      {name:'Parent Portal',desc:'Parents view fees, attendance, marks, and communicate with teachers online.'},
      {name:'Transport & Hostel',desc:'Manage school buses, routes, hostel rooms, and allocations.'},
      {name:'Library',desc:'Catalog books, track borrowing, manage reservations, and overdue alerts.'},
      {name:'Staff Payroll',desc:'Auto-calculate PAYE, NSSF, manage leave, and generate payslips.'}
    ]},
    { title:'Hotel & Restaurant', emoji:'&#127976;', color:'#dc2626', features:[
      {name:'Room Booking',desc:'Manage rooms, check availability, accept reservations, track occupancy in real-time.'},
      {name:'Restaurant POS',desc:'Digital menu, order management, kitchen display system, table reservations.'},
      {name:'Guest Ledger',desc:'Track all charges, payments, and services for each guest stay.'},
      {name:'Housekeeping',desc:'Task management for cleaning, maintenance, and room inspections.'},
      {name:'Online Bookings',desc:'Accept reservations directly from your website with real-time availability.'},
      {name:'Revenue Reports',desc:'Daily, weekly, monthly revenue breakdowns with forecasting.'}
    ]},
    { title:'Retail & Business', emoji:'&#128722;', color:'#e11d48', features:[
      {name:'Point of Sale',desc:'Fast POS with barcode scanning, receipt generation, and multi-payment support.'},
      {name:'Inventory',desc:'Track stock levels, get low-stock alerts, manage purchase orders and suppliers.'},
      {name:'CRM & Invoicing',desc:'Manage leads, create professional invoices, track payments, nurture customers.'},
      {name:'Payroll & HR',desc:'Auto-calculate Uganda PAYE and NSSF, manage leave, generate payslips.'},
      {name:'Expense Tracking',desc:'Log expenses, categorize, attach receipts, and generate reports.'},
      {name:'Project Management',desc:'Track projects, assign tasks, set deadlines, and monitor progress.'}
    ]},
    { title:'Church', emoji:'&#9961;', color:'#7c3aed', features:[
      {name:'Member Directory',desc:'Complete member profiles with family connections, groups, and contact info.'},
      {name:'Donations & Tithes',desc:'Track all contributions, generate receipts, send thank-you messages.'},
      {name:'Sacrament Records',desc:'Record baptisms, confirmations, marriages, and other sacramental events.'},
      {name:'Cell Groups',desc:'Manage small groups, track attendance, and coordinate meetings.'},
      {name:'Sermon Archive',desc:'Store and organize sermon recordings, notes, and series.'},
      {name:'Event Calendar',desc:'Schedule services, events, and activities with reminders.'}
    ]},
    { title:'Health', emoji:'&#127973;', color:'#0891b2', features:[
      {name:'Patient Records',desc:'Digital health records with medical history, allergies, and ongoing treatments.'},
      {name:'Doctor Consultations',desc:'Schedule and manage consultations with queue management.'},
      {name:'Pharmacy & Dispensing',desc:'Drug inventory, prescription processing, expiry alerts, and dispensing.'},
      {name:'Lab Results',desc:'Record and share lab results with patients securely.'},
      {name:'Billing & Payments',desc:'Invoice patients, accept mobile money, and track outstanding balances.'},
      {name:'Medical Reports',desc:'Generate discharge summaries, referral letters, and health reports.'}
    ]},
    { title:'Platform', emoji:'&#9881;', color:'#475569', features:[
      {name:'Offline Mode',desc:'Works without internet. Syncs automatically when you\'re back online.'},
      {name:'Mobile App',desc:'Install on your phone like a native app. Works on Android and iOS.'},
      {name:'REST API',desc:'Full JSON API for integrations with other tools and custom apps.'},
      {name:'Multi-Currency',desc:'Support for UGX, USD, KES, TZS, EUR, GBP with auto FX rates.'},
      {name:'White-Label',desc:'Custom branding with your logo, colors, and even custom domain.'},
      {name:'AI-Powered',desc:'Smart analytics, fee default prediction, dropout risk alerts, and more.'},
      {name:'Data Backup',desc:'Automatic daily backups with one-click restore capability.'},
      {name:'Audit Logging',desc:'Complete audit trail of all actions for compliance and accountability.'}
    ]}
  ];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Features — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Features Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">100+ Features. One Platform.</h1>
    <p style="font-size:clamp(16px,2vw,20px);color:rgba(255,255,255,0.9);max-width:600px;margin:0 auto">Everything you need to run your institution, built in. Choose your sector below.</p>
  </div>
</section>
${categories.map(cat => `
<section class="section" aria-label="${cat.title} Features">
  <div class="container" style="max-width:1100px">
    <h2 class="section-title"><span aria-hidden="true">${cat.emoji}</span> ${cat.title}</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
      ${cat.features.map(f => `<div class="card" role="article" style="padding:20px"><h4 style="font-size:15px;font-weight:700;margin-bottom:6px;color:${cat.color}">${f.name}</h4><p style="font-size:13px;color:var(--text-secondary);line-height:1.6">${f.desc}</p></div>`).join('')}
    </div>
  </div>
</section>`).join('')}
<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px" aria-label="CTA">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">See It In Action</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Start your free trial and experience all features today.</p>
  <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free Trial</a>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 5. GET /changelog — Version History
// ============================================================
app.get('/changelog', ah(async (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Changelog — Comfort Platform', 'See what\'s new in Comfort. Version history with features, enhancements, fixes, and security updates.', '/changelog', 'website');
  let entries = [];
  try {
    entries = (await pool.query('SELECT version, title, category, description, date FROM changelog_entries ORDER BY date DESC LIMIT 20')).rows;
  } catch(e) { /* fallback below */ }
  if (!entries.length) {
    entries = [
      {version:'18.0',title:'Multi-Portal Public Pages',category:'Feature',description:'Complete redesign with 15+ new pages.',date:'2025-03-01'},
      {version:'17.0',title:'API Developer Hub',category:'Feature',description:'New API docs with interactive examples.',date:'2025-02-01'},
      {version:'16.0',title:'Pricing Calculator',category:'Feature',description:'Interactive pricing with multi-currency.',date:'2025-01-01'},
      {version:'15.0',title:'Email Verification',category:'Feature',description:'Token-based verification flow.',date:'2024-12-01'},
      {version:'14.0',title:'Analytics Tracking',category:'Feature',description:'Page view and event tracking API.',date:'2024-11-01'},
      {version:'13.0',title:'Contact CAPTCHA',category:'Security',description:'Math CAPTCHA and honeypot spam prevention.',date:'2024-10-01'}
    ];
  }
  const catColors = {Feature:'#059669',Enhancement:'#2563eb',Fix:'#d97706',Security:'#dc2626'};
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Changelog — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Changelog Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">What's New</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Every improvement, every fix, every new feature — documented.</p>
  </div>
</section>
<section class="section" aria-label="Changelog Timeline">
  <div class="container" style="max-width:700px">
    <div style="position:relative;padding-left:40px">
      <div style="position:absolute;left:14px;top:0;bottom:0;width:3px;background:#e2e8f0;border-radius:2px" aria-hidden="true"></div>
      ${entries.map(e => {
        const color = catColors[e.category] || '#475569';
        const dateStr = e.date ? new Date(e.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
        return `<div style="position:relative;margin-bottom:32px" role="article">
          <div style="position:absolute;left:-33px;top:6px;width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 2px ${color}" aria-hidden="true"></div>
          <div style="background:var(--bg-card);border-radius:14px;padding:24px;border:1px solid var(--border-color);box-shadow:0 1px 6px rgba(0,0,0,0.04)">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
              <span style="font-size:20px;font-weight:800;color:var(--text-primary)">v${esc(e.version)}</span>
              <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;color:white;background:${color}">${esc(e.category)}</span>
              <span style="font-size:12px;color:var(--text-muted)">${dateStr}</span>
            </div>
            <h3 style="font-size:16px;font-weight:700;margin-bottom:6px">${esc(e.title)}</h3>
            ${e.description ? '<p style="font-size:14px;color:var(--text-secondary);line-height:1.6">'+esc(e.description)+'</p>' : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
}));

// ============================================================
// 6. GET /careers — Careers Page
// ============================================================
app.get('/careers', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Careers — Comfort Platform', 'Join the Comfort team. We\'re hiring frontend developers, backend developers, sales reps, and more.', '/careers', 'website');
  const jobs = [
    {title:'Frontend Developer',dept:'Engineering',loc:'Kampala',type:'Full-time',desc:'Build responsive, accessible web interfaces using modern JavaScript frameworks and Tailwind CSS.'},
    {title:'Backend Developer',dept:'Engineering',loc:'Remote',type:'Full-time',desc:'Design and implement scalable Node.js APIs, PostgreSQL queries, and real-time features.'},
    {title:'Sales Representative',dept:'Sales',loc:'Kampala',type:'Full-time',desc:'Drive adoption of Comfort across institutions. Build relationships, demo the product, close deals.'},
    {title:'Customer Success Manager',dept:'Support',loc:'Kampala',type:'Full-time',desc:'Onboard new institutions, provide training, ensure customer satisfaction and retention.'},
    {title:'DevOps Engineer',dept:'Engineering',loc:'Remote',type:'Full-time',desc:'Manage CI/CD pipelines, server infrastructure, monitoring, and deployment automation.'},
    {title:'Product Designer',dept:'Design',loc:'Kampala/Remote',type:'Part-time',desc:'Design intuitive, beautiful interfaces for African institutions. UX research, wireframes, prototypes.'}
  ];
  const benefits = [
    {icon:'&#128137;',title:'Health Insurance',desc:'Comprehensive medical coverage for you and dependents.'},
    {icon:'&#128336;',title:'Flexible Hours',desc:'Work when you\'re most productive. Core hours, not clock-watching.'},
    {icon:'&#128218;',title:'Learning Budget',desc:'Annual budget for courses, books, conferences, and certifications.'},
    {icon:'&#127758;',title:'Remote-Friendly',desc:'Work from anywhere. We trust you to deliver results.'}
  ];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Careers — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Careers Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">Join Our Team</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Help us build the operating system for African institutions.</p>
  </div>
</section>
<section class="section" aria-label="Open Positions">
  <div class="container" style="max-width:900px">
    <h2 class="section-title">Open Positions</h2>
    <p class="section-sub">We're looking for passionate people to join our mission.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px">
      ${jobs.map(j => `<div class="card" role="article">
        <h3 style="font-size:17px;font-weight:700;margin-bottom:8px;color:#4f46e5">${esc(j.title)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <span style="padding:3px 10px;background:var(--bg-secondary);border-radius:6px;font-size:12px;font-weight:600;color:var(--text-secondary)">${esc(j.dept)}</span>
          <span style="padding:3px 10px;background:#f0fdf4;border-radius:6px;font-size:12px;font-weight:600;color:#059669">${esc(j.loc)}</span>
          <span style="padding:3px 10px;background:#eff6ff;border-radius:6px;font-size:12px;font-weight:600;color:#2563eb">${esc(j.type)}</span>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px">${esc(j.desc)}</p>
        <a href="/contact?subject=Job Application: ${encodeURIComponent(j.title)}" class="btn btn-primary" style="font-size:13px;padding:8px 20px">Apply Now</a>
      </div>`).join('')}
    </div>
  </div>
</section>
<section class="section" style="background:var(--bg-secondary)" aria-label="Benefits">
  <div class="container" style="max-width:800px">
    <h2 class="section-title">Why Comfort?</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px">
      ${benefits.map(b => `<div style="text-align:center;padding:24px"><div style="font-size:36px;margin-bottom:8px" aria-hidden="true">${b.icon}</div><h4 style="font-size:15px;font-weight:700;margin-bottom:4px">${b.title}</h4><p style="font-size:13px;color:var(--text-muted)">${b.desc}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px" aria-label="CTA">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Don't See Your Role?</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Send us your resume — we're always looking for great people.</p>
  <a href="/contact?subject=General Application" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Get In Touch</a>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 7. GET /partners — Partners Page
// ============================================================
app.get('/partners', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Partners — Comfort Platform', 'Become a Comfort partner. Technology, distribution, and reseller partnership opportunities.', '/partners', 'website');
  const tiers = [
    {name:'Technology Partners',icon:'&#128187;',color:'#4f46e5',benefits:['API access & integration support','Co-marketing opportunities','Technical documentation','Joint product development','Priority support channel','Early access to new features']},
    {name:'Distribution Partners',icon:'&#127759;',color:'#059669',benefits:['Resell Comfort to your network','Competitive commission rates','Marketing materials & collateral','Sales training & certification','Lead sharing program','Regional exclusivity options']},
    {name:'Reseller Partners',icon:'&#129309;',color:'#0891b2',benefits:['White-label options available','Volume discount pricing','Dedicated account manager','Custom onboarding for clients','Revenue sharing model','Co-branded landing pages']}
  ];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Partners — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Partners Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">Partner With Comfort</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Grow your business while helping African institutions thrive.</p>
  </div>
</section>
<section class="section" aria-label="Partner Tiers">
  <div class="container" style="max-width:1000px">
    <h2 class="section-title">Partner Tiers</h2>
    <p class="section-sub">Choose the partnership model that fits your business.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      ${tiers.map(t => `<div class="card" role="article">
        <div style="font-size:36px;margin-bottom:12px" aria-hidden="true">${t.icon}</div>
        <h3 style="font-size:18px;font-weight:800;color:${t.color};margin-bottom:12px">${t.name}</h3>
        <ul style="list-style:none;padding:0;font-size:14px;color:var(--text-secondary);line-height:2.2">${t.benefits.map(b => '<li style="padding-left:20px;position:relative"><span style="position:absolute;left:0;color:'+t.color+';font-weight:700">&#10003;</span>'+b+'</li>').join('')}</ul>
      </div>`).join('')}
    </div>
  </div>
</section>
<section class="section" style="background:var(--bg-secondary)" aria-label="Partner Logos">
  <div class="container" style="text-align:center">
    <h2 class="section-title">Trusted by Leading Organizations</h2>
    <div style="display:flex;gap:40px;justify-content:center;flex-wrap:wrap;align-items:center;margin-top:32px;opacity:0.5">
      <div style="width:120px;height:40px;background:#cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted);font-weight:600">Partner 1</div>
      <div style="width:120px;height:40px;background:#cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted);font-weight:600">Partner 2</div>
      <div style="width:120px;height:40px;background:#cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted);font-weight:600">Partner 3</div>
      <div style="width:120px;height:40px;background:#cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted);font-weight:600">Partner 4</div>
    </div>
  </div>
</section>
<section class="section" aria-label="Become a Partner">
  <div class="container" style="max-width:500px">
    <h2 class="section-title">Become a Partner</h2>
    <div class="card" style="padding:28px">
      <form method="POST" action="/contact" aria-label="Partner application">
        <input type="hidden" name="_csrf" value="${req.csrfToken}">
        <input type="hidden" name="subject" value="Partnership Application">
        <label for="partner-name" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Name *</label>
        <input id="partner-name" name="name" required style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
        <label for="partner-email" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Email *</label>
        <input id="partner-email" name="email" type="email" required style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
        <label for="partner-company" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Company</label>
        <input id="partner-company" name="phone" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px" placeholder="Your company name">
        <label for="partner-tier" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Partnership Tier *</label>
        <select id="partner-tier" name="message" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px;background:var(--bg-card)">
          <option value="Technology Partner">Technology Partner</option><option value="Distribution Partner">Distribution Partner</option><option value="Reseller Partner">Reseller Partner</option>
        </select>
        <button type="submit" style="display:block;width:100%;padding:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:12px">Apply Now</button>
      </form>
    </div>
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 8. GET /demo — Demo Request Page
// ============================================================
app.get('/demo', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Book a Demo — Comfort Platform', 'See Comfort in action. Book a personalized demo and discover how it can transform your institution.', '/demo', 'website');
  const typeOptions = PORTAL_TYPES.map(p => `<option value="${p.type}">${p.emoji} ${p.label}</option>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book a Demo — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Demo Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">See Comfort in Action</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Book a personalized 30-minute demo with our team.</p>
  </div>
</section>
<section class="section" aria-label="Demo Form and Video">
  <div class="container" style="max-width:1000px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:40px;align-items:start">
      <div>
        <h2 style="font-size:24px;font-weight:800;margin-bottom:20px">Request a Demo</h2>
        <div class="card" style="padding:28px">
          <form method="POST" action="/contact" aria-label="Demo request form">
            <input type="hidden" name="_csrf" value="${req.csrfToken}">
            <input type="hidden" name="subject" value="Demo Request">
            <label for="demo-name" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Name *</label>
            <input id="demo-name" name="name" required style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
            <label for="demo-email" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Email *</label>
            <input id="demo-email" name="email" type="email" required style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
            <label for="demo-phone" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Phone</label>
            <input id="demo-phone" name="phone" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px" placeholder="+256 700 000 000">
            <label for="demo-type" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Institution Type *</label>
            <select id="demo-type" name="institution_type" required style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px;background:var(--bg-card)">
              <option value="">Select...</option>${typeOptions}
            </select>
            <label for="demo-date" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Preferred Date/Time</label>
            <input id="demo-date" name="preferred_date" type="datetime-local" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px">
            <label for="demo-msg" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Message</label>
            <textarea id="demo-msg" name="message" rows="3" placeholder="Tell us about your institution and what you'd like to see..." style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px;font-family:inherit;resize:vertical"></textarea>
            <button type="submit" style="display:block;width:100%;padding:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:12px">Book Demo</button>
          </form>
        </div>
      </div>
      <div>
        <h2 style="font-size:24px;font-weight:800;margin-bottom:20px">Watch 2-Minute Demo</h2>
        <div style="background:#1e293b;border-radius:16px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;margin-bottom:32px;border:1px solid #334155" role="img" aria-label="Demo video placeholder">
          <div style="text-align:center;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:8px" aria-hidden="true">&#9654;</div><p style="font-size:14px">Demo video coming soon</p></div>
        </div>
        <h3 style="font-size:18px;font-weight:700;margin-bottom:16px">What Our Users Say</h3>
        <div class="card" style="padding:20px;margin-bottom:12px">
          <div style="color:#f59e0b;font-size:14px;margin-bottom:8px" aria-label="5 stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <p style="font-size:13px;color:var(--text-secondary);font-style:italic;line-height:1.7">"Comfort replaced 5 different tools. Our school runs everything from fees to report cards in one place."</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:8px;font-weight:600">Grace N. — Headteacher, Kampala</p>
        </div>
        <div class="card" style="padding:20px">
          <div style="color:#f59e0b;font-size:14px;margin-bottom:8px" aria-label="5 stars">&#9733;&#9733;&#9733;&#9733;&#9733;</div>
          <p style="font-size:13px;color:var(--text-secondary);font-style:italic;line-height:1.7">"Revenue is up 30% since we started using Comfort's hotel module."</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:8px;font-weight:600">Robert M. — Manager, Entebbe</p>
        </div>
      </div>
    </div>
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 9. GET /compare — Comparison Page
// ============================================================
app.get('/compare', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Comfort vs Spreadsheets, ERP, Paper — Compare', 'See how Comfort compares to spreadsheets, generic ERPs, and paper-based systems. Feature comparison with checkmarks.', '/compare', 'website');
  const features = [
    {name:'Student/Patient/Client Management',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'Automated Billing & Invoicing',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'Mobile Money Payments',comfort:true,spreadsheets:false,erp:false,paper:false},
    {name:'Offline Mode',comfort:true,spreadsheets:false,erp:false,paper:true},
    {name:'Role-Based Access Control',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'Audit Logging',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'Two-Factor Authentication',comfort:true,spreadsheets:false,erp:false,paper:false},
    {name:'Multi-Branch Support',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'Custom Branding',comfort:true,spreadsheets:false,erp:false,paper:false},
    {name:'Real-Time Reports & Analytics',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'SMS & Email Notifications',comfort:true,spreadsheets:false,erp:false,paper:false},
    {name:'API Access',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'Sector-Specific Features',comfort:true,spreadsheets:false,erp:false,paper:false},
    {name:'Setup in Under 10 Minutes',comfort:true,spreadsheets:true,erp:false,paper:true},
    {name:'Affordable for Small Institutions',comfort:true,spreadsheets:true,erp:false,paper:true},
    {name:'No IT Team Required',comfort:true,spreadsheets:true,erp:false,paper:true},
    {name:'Automatic Data Backup',comfort:true,spreadsheets:false,erp:true,paper:false},
    {name:'GDPR Compliant',comfort:true,spreadsheets:false,erp:true,paper:false}
  ];
  function check(val) { return val ? '<span style="color:#059669;font-weight:700;font-size:18px" aria-label="Yes">&#10003;</span>' : '<span style="color:#dc2626;font-weight:700;font-size:18px" aria-label="No">&#10007;</span>'; }
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comfort vs Spreadsheets, ERP, Paper — Compare</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Compare Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">Comfort vs The Rest</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">See why 500+ institutions chose Comfort over spreadsheets, generic ERPs, and paper.</p>
  </div>
</section>
<section class="section" aria-label="Comparison Table">
  <div class="container" style="max-width:900px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;background:var(--bg-card);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);font-size:14px" role="table" aria-label="Feature comparison">
      <thead>
        <tr style="background:var(--bg-secondary)">
          <th style="padding:16px;text-align:left;font-weight:700;color:var(--text-primary);min-width:220px">Feature</th>
          <th style="padding:16px;text-align:center;font-weight:800;color:#4f46e5;min-width:100px;background:#eff6ff">Comfort</th>
          <th style="padding:16px;text-align:center;font-weight:700;color:var(--text-muted);min-width:100px">Spreadsheets</th>
          <th style="padding:16px;text-align:center;font-weight:700;color:var(--text-muted);min-width:100px">Generic ERP</th>
          <th style="padding:16px;text-align:center;font-weight:700;color:var(--text-muted);min-width:100px">Paper-Based</th>
        </tr>
      </thead>
      <tbody>
        ${features.map((f, i) => `<tr style="border-bottom:1px solid var(--border-color);${i % 2 === 0 ? '' : 'background:var(--bg-secondary)'}">
          <td style="padding:12px 16px;color:var(--text-primary);font-weight:500">${f.name}</td>
          <td style="padding:12px 16px;text-align:center;background:#f0fdf4">${check(f.comfort)}</td>
          <td style="padding:12px 16px;text-align:center">${check(f.spreadsheets)}</td>
          <td style="padding:12px 16px;text-align:center">${check(f.erp)}</td>
          <td style="padding:12px 16px;text-align:center">${check(f.paper)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</section>
<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px" aria-label="CTA">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Ready to Switch?</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Join 500+ institutions that already made the leap.</p>
  <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free Trial</a>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 10. GET /security — Security Page
// ============================================================
app.get('/security', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Security — Comfort Platform', 'How Comfort protects your data. Encryption, access control, audit logging, 2FA, GDPR compliance, and responsible disclosure.', '/security', 'website');
  const secFeatures = [
    {icon:'&#128274;',title:'Encryption',desc:'All data encrypted in transit (TLS 1.3) and at rest (AES-256). Database connections use SSL.'},
    {icon:'&#128101;',title:'Access Control',desc:'Role-based access control with granular permissions. Users only see what they need.'},
    {icon:'&#128196;',title:'Audit Logging',desc:'Every action is logged with timestamp, user, and details. Full audit trail for compliance.'},
    {icon:'&#128272;',title:'Two-Factor Authentication',desc:'Optional 2FA via authenticator apps. Protects against password compromise.'},
    {icon:'&#127760;',title:'GDPR Compliance',desc:'Data processing agreements, right to erasure, data portability, and consent management.'},
    {icon:'&#128190;',title:'Data Backup',desc:'Automatic daily backups with point-in-time recovery. 30-day retention period.'}
  ];
  const badges = ['SSL/TLS','AES-256','GDPR','SOC 2 Type II','OWASP Top 10','ISO 27001'];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Security Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">Your Data is Safe</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Security isn't an afterthought — it's the foundation of everything we build.</p>
  </div>
</section>
<section class="section" aria-label="Security Features">
  <div class="container" style="max-width:1000px">
    <h2 class="section-title">How We Protect You</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      ${secFeatures.map(f => `<div class="card" role="article"><div style="font-size:32px;margin-bottom:12px" aria-hidden="true">${f.icon}</div><h3 style="font-size:17px;font-weight:700;margin-bottom:8px;color:#4f46e5">${f.title}</h3><p style="font-size:14px;color:var(--text-secondary);line-height:1.7">${f.desc}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="section" style="background:var(--bg-secondary)" aria-label="Compliance Badges">
  <div class="container" style="text-align:center">
    <h2 class="section-title">Compliance &amp; Standards</h2>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:24px">
      ${badges.map(b => `<span style="display:inline-block;padding:10px 24px;background:var(--bg-card);border:2px solid var(--border-color);border-radius:12px;font-size:14px;font-weight:700;color:var(--text-primary)">${b}</span>`).join('')}
    </div>
  </div>
</section>
<section class="section" aria-label="Security Practices">
  <div class="container" style="max-width:800px">
    <h2 class="section-title">Our Security Practices</h2>
    <div class="card" style="padding:28px">
      <ul style="list-style:none;padding:0;font-size:14px;color:var(--text-secondary);line-height:2.4">
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#059669;font-weight:700">&#10003;</span> Regular penetration testing by third-party security firms</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#059669;font-weight:700">&#10003;</span> Automated vulnerability scanning in CI/CD pipeline</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#059669;font-weight:700">&#10003;</span> Security-focused code reviews for all changes</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#059669;font-weight:700">&#10003;</span> Principle of least privilege for all system access</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#059669;font-weight:700">&#10003;</span> Incident response plan tested quarterly</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#059669;font-weight:700">&#10003;</span> Employee security training program</li>
      </ul>
    </div>
  </div>
</section>
<section class="section" style="background:var(--bg-secondary)" aria-label="Responsible Disclosure">
  <div class="container" style="max-width:700px">
    <h2 class="section-title">Responsible Disclosure</h2>
    <div class="card" style="padding:28px">
      <p style="font-size:14px;color:var(--text-secondary);line-height:1.8;margin-bottom:16px">We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly:</p>
      <ul style="list-style:none;padding:0;font-size:14px;color:var(--text-secondary);line-height:2.2">
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#4f46e5;font-weight:700">1.</span> Email <strong>security@comfort.ug</strong> with details of the vulnerability</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#4f46e5;font-weight:700">2.</span> Allow us 72 hours to acknowledge receipt</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#4f46e5;font-weight:700">3.</span> We'll work with you to understand and fix the issue</li>
        <li style="padding-left:24px;position:relative"><span style="position:absolute;left:0;color:#4f46e5;font-weight:700">4.</span> We don't pursue legal action against good-faith reporters</li>
      </ul>
    </div>
  </div>
</section>
<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px" aria-label="CTA">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Security You Can Trust</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Start your free trial with confidence.</p>
  <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Start Free</a>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

// ============================================================
// 11. GET /api-docs — API Developer Hub
// ============================================================
app.get('/api-docs', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('API Docs — Comfort Developer Hub', 'Build on Comfort. REST API with JSON responses, API key authentication, and SDKs for JavaScript, Python, and more.', '/api-docs', 'website');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Docs — Comfort Developer Hub</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="API Docs Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">Build on Comfort</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Powerful REST API. JSON responses. Build integrations, custom apps, and more.</p>
  </div>
</section>
<section class="section" aria-label="Quick Start">
  <div class="container" style="max-width:800px">
    <h2 class="section-title">Quick Start</h2>
    <div class="card" style="padding:24px;margin-bottom:24px">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;color:#4f46e5">Authentication</h3>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:16px">Include your API key in the <code style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;font-size:13px">Authorization</code> header:</p>
      <pre style="background:#1e293b;color:#e2e8f0;padding:20px;border-radius:12px;font-size:13px;overflow-x:auto;line-height:1.8"><code>Authorization: Bearer sk_live_your_api_key_here</code></pre>
    </div>
    <h3 style="font-size:18px;font-weight:700;margin-bottom:16px">Code Examples</h3>
    <div style="display:flex;gap:8px;margin-bottom:12px" role="tablist" aria-label="Code language tabs">
      <button class="code-tab active" onclick="showCode('curl')" role="tab" aria-selected="true" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border-color);background:#4f46e5;color:white;font-size:13px;font-weight:600;cursor:pointer">curl</button>
      <button class="code-tab" onclick="showCode('js')" role="tab" aria-selected="false" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer">JavaScript</button>
      <button class="code-tab" onclick="showCode('py')" role="tab" aria-selected="false" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-secondary);font-size:13px;font-weight:600;cursor:pointer">Python</button>
    </div>
    <div id="code-curl" class="code-block" role="tabpanel"><pre style="background:#1e293b;color:#e2e8f0;padding:20px;border-radius:12px;font-size:13px;overflow-x:auto;line-height:1.8"><code>curl -X GET https://api.comfort.ug/v1/tenants \\
  -H "Authorization: Bearer sk_live_your_api_key" \\
  -H "Content-Type: application/json"</code></pre></div>
    <div id="code-js" class="code-block" style="display:none" role="tabpanel"><pre style="background:#1e293b;color:#e2e8f0;padding:20px;border-radius:12px;font-size:13px;overflow-x:auto;line-height:1.8"><code>const response = await fetch('https://api.comfort.ug/v1/tenants', {
  headers: {
    'Authorization': 'Bearer sk_live_your_api_key',
    'Content-Type': 'application/json'
  }
});
const data = await response.json();</code></pre></div>
    <div id="code-py" class="code-block" style="display:none" role="tabpanel"><pre style="background:#1e293b;color:#e2e8f0;padding:20px;border-radius:12px;font-size:13px;overflow-x:auto;line-height:1.8"><code>import requests

response = requests.get(
    'https://api.comfort.ug/v1/tenants',
    headers={
        'Authorization': 'Bearer sk_live_your_api_key',
        'Content-Type': 'application/json'
    }
)
data = response.json()</code></pre></div>
  </div>
</section>
<section class="section" style="background:var(--bg-secondary)" aria-label="Endpoint Categories">
  <div class="container" style="max-width:900px">
    <h2 class="section-title">Endpoint Categories</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px">
      ${[{name:'Tenants',methods:'GET, POST, PATCH',color:'#4f46e5'},{name:'Users',methods:'GET, POST, PATCH, DELETE',color:'#059669'},{name:'Records',methods:'GET, POST, PATCH, DELETE',color:'#0891b2'},{name:'Billing',methods:'GET, POST',color:'#d97706'},{name:'Reports',methods:'GET, POST',color:'#7c3aed'}].map(e => `<div class="card" style="padding:20px;text-align:center"><h4 style="font-size:16px;font-weight:700;color:${e.color};margin-bottom:8px">${e.name}</h4><p style="font-size:12px;color:var(--text-muted)">${e.methods}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="section" aria-label="Try It">
  <div class="container" style="max-width:700px">
    <h2 class="section-title">Try It Live</h2>
    <div class="card" style="padding:24px">
      <form id="api-tester" aria-label="API tester">
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <select id="api-method" style="padding:10px;border:2px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-card)" aria-label="HTTP method">
            <option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option>
          </select>
          <input id="api-url" value="/v1/tenants" style="flex:1;padding:10px;border:2px solid var(--border-color);border-radius:8px;font-size:14px;font-family:monospace" aria-label="API endpoint" placeholder="/v1/tenants">
        </div>
        <button type="button" onclick="testApi()" style="padding:10px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer">Send Request</button>
        <div id="api-response" style="margin-top:16px;padding:16px;background:var(--bg-primary);border-radius:8px;font-family:monospace;font-size:12px;color:var(--text-secondary);min-height:60px;display:none" aria-live="polite"></div>
      </form>
    </div>
  </div>
</section>
<section class="section" style="background:var(--bg-secondary)" aria-label="Rate Limits and SDKs">
  <div class="container" style="max-width:800px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px">
      <div class="card" style="padding:24px">
        <h3 style="font-size:17px;font-weight:700;margin-bottom:12px;color:#4f46e5">Rate Limits</h3>
        <ul style="list-style:none;padding:0;font-size:14px;color:var(--text-secondary);line-height:2.2">
          <li><strong>Free:</strong> 60 requests/minute</li>
          <li><strong>Basic:</strong> 200 requests/minute</li>
          <li><strong>Pro:</strong> 1,000 requests/minute</li>
          <li><strong>Enterprise:</strong> Custom limits</li>
        </ul>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="font-size:17px;font-weight:700;margin-bottom:12px;color:#059669">SDKs &amp; Libraries</h3>
        <ul style="list-style:none;padding:0;font-size:14px;color:var(--text-secondary);line-height:2.2">
          <li><strong>Node.js</strong> — npm install @comfort/sdk</li>
          <li><strong>Python</strong> — pip install comfort-sdk</li>
          <li><strong>PHP</strong> — composer require comfort/sdk</li>
          <li><strong>Ruby</strong> — gem install comfort-sdk</li>
        </ul>
      </div>
    </div>
  </div>
</section>
<section class="section" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px" aria-label="CTA">
  <h2 style="font-size:32px;font-weight:800;margin-bottom:12px">Get Your API Key</h2>
  <p style="font-size:18px;opacity:0.9;margin-bottom:32px">Register for a free account and start building today.</p>
  <a href="/register" style="display:inline-block;padding:16px 40px;background:white;color:#4f46e5;border-radius:12px;font-weight:700;font-size:18px;text-decoration:none">Register for API Key</a>
</section>
</main>
${footer}${cookie}
<script>
function showCode(lang){document.querySelectorAll('.code-block').forEach(function(b){b.style.display='none'});document.querySelectorAll('.code-tab').forEach(function(t){t.style.background='white';t.style.color='#475569';t.setAttribute('aria-selected','false')});var el=document.getElementById('code-'+lang);if(el)el.style.display='block';event.target.style.background='#4f46e5';event.target.style.color='white';event.target.setAttribute('aria-selected','true')}
function testApi(){var m=document.getElementById('api-method').value;var u=document.getElementById('api-url').value;var r=document.getElementById('api-response');r.style.display='block';r.textContent='Sending '+m+' '+u+'...\n\nNote: API testing requires authentication. Register to get your API key.';}
</script>
</body></html>`;
  res.send(html);
});

// ============================================================
// 12. GET /onboarding — Onboarding Wizard
// ============================================================
app.get('/onboarding', (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login');
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Onboarding — Comfort Platform', 'Set up your institution in 5 easy steps.', '/onboarding', 'website');
  const typeOptions = PORTAL_TYPES.map(p => `<option value="${p.type}">${p.emoji} ${p.label}</option>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Onboarding — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="section" aria-label="Onboarding Wizard">
  <div class="container" style="max-width:700px">
    <!-- Progress Bar -->
    <div style="margin-bottom:40px" role="progressbar" aria-valuenow="1" aria-valuemin="1" aria-valuemax="5" aria-label="Step 1 of 5">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        ${['Welcome','Institution','Records','Team','Complete'].map((s,i) => `<span id="step-label-${i+1}" style="font-size:12px;font-weight:600;color:${i===0?'#4f46e5':'#94a3b8'}">${s}</span>`).join('')}
      </div>
      <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden"><div id="progress-fill" style="height:100%;width:20%;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:3px;transition:width 0.3s"></div></div>
    </div>

    <!-- Step 1: Welcome -->
    <div id="step-1" class="onboarding-step" role="group" aria-label="Step 1: Welcome">
      <div class="card" style="padding:40px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px" aria-hidden="true">&#127881;</div>
        <h2 style="font-size:28px;font-weight:800;margin-bottom:8px">Welcome to Comfort!</h2>
        <p style="font-size:16px;color:var(--text-muted);margin-bottom:24px;line-height:1.7">You're just 5 steps away from transforming how your institution operates. Let's get you set up!</p>
        <button onclick="goToStep(2)" class="btn btn-primary" style="padding:14px 40px;font-size:16px">Let's Go &#8594;</button>
      </div>
    </div>

    <!-- Step 2: Institution Details -->
    <div id="step-2" class="onboarding-step" style="display:none" role="group" aria-label="Step 2: Institution Details">
      <div class="card" style="padding:32px">
        <h2 style="font-size:22px;font-weight:800;margin-bottom:20px">Set Up Your Institution</h2>
        <form id="onboard-inst" aria-label="Institution details">
          <label for="onb-type" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Institution Type *</label>
          <select id="onb-type" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px;background:var(--bg-card)"><option value="">Select...</option>${typeOptions}</select>
          <label for="onb-name" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Institution Name *</label>
          <input id="onb-name" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px" placeholder="e.g. Sunrise Primary School">
          <label for="onb-addr" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-top:8px">Address</label>
          <input id="onb-addr" style="width:100%;padding:12px;margin:6px 0;border:2px solid var(--border-color);border-radius:10px;font-size:15px" placeholder="Kampala, Uganda">
          <div style="display:flex;gap:12px;margin-top:20px">
            <button type="button" onclick="goToStep(1)" style="flex:1;padding:14px;background:var(--bg-card);border:2px solid var(--border-color);border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;color:var(--text-secondary)">&#8592; Back</button>
            <button type="button" onclick="goToStep(3)" class="btn btn-primary" style="flex:2;padding:14px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white">Next &#8594;</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Step 3: Add First Records -->
    <div id="step-3" class="onboarding-step" style="display:none" role="group" aria-label="Step 3: Add Records">
      <div class="card" style="padding:32px">
        <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Add Your First Records</h2>
        <p style="font-size:14px;color:var(--text-muted);margin-bottom:20px">You can always add more later. For now, let's get started with a few.</p>
        <div style="text-align:center;padding:40px;background:var(--bg-primary);border-radius:12px;border:2px dashed var(--border-color)">
          <div style="font-size:36px;margin-bottom:8px" aria-hidden="true">&#128228;</div>
          <p style="font-size:15px;color:var(--text-secondary);font-weight:600">Import or add records manually from your dashboard.</p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:8px">Supports CSV import, manual entry, and API</p>
        </div>
        <div style="display:flex;gap:12px;margin-top:20px">
          <button type="button" onclick="goToStep(2)" style="flex:1;padding:14px;background:var(--bg-card);border:2px solid var(--border-color);border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;color:var(--text-secondary)">&#8592; Back</button>
          <button type="button" onclick="goToStep(4)" class="btn btn-primary" style="flex:2;padding:14px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white">Next &#8594;</button>
        </div>
      </div>
    </div>

    <!-- Step 4: Invite Team -->
    <div id="step-4" class="onboarding-step" style="display:none" role="group" aria-label="Step 4: Invite Team">
      <div class="card" style="padding:32px">
        <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Invite Your Team</h2>
        <p style="font-size:14px;color:var(--text-muted);margin-bottom:20px">Add team members so they can start using Comfort right away.</p>
        <div id="invite-list" aria-label="Invite email list">
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input id="invite-email-1" type="email" placeholder="colleague@example.com" style="flex:1;padding:12px;border:2px solid var(--border-color);border-radius:10px;font-size:14px" aria-label="Team member email">
            <select style="padding:12px;border:2px solid var(--border-color);border-radius:10px;font-size:14px;background:var(--bg-card)" aria-label="Role"><option>Staff</option><option>Manager</option><option>Admin</option></select>
          </div>
        </div>
        <button type="button" onclick="addInviteField()" style="font-size:13px;color:#4f46e5;font-weight:600;background:none;border:none;cursor:pointer;padding:8px 0">+ Add another</button>
        <div style="display:flex;gap:12px;margin-top:20px">
          <button type="button" onclick="goToStep(3)" style="flex:1;padding:14px;background:var(--bg-card);border:2px solid var(--border-color);border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;color:var(--text-secondary)">&#8592; Back</button>
          <button type="button" onclick="goToStep(5)" class="btn btn-primary" style="flex:2;padding:14px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white">Next &#8594;</button>
        </div>
      </div>
    </div>

    <!-- Step 5: Complete -->
    <div id="step-5" class="onboarding-step" style="display:none" role="group" aria-label="Step 5: Complete">
      <div class="card" style="padding:40px;text-align:center">
        <div style="font-size:48px;margin-bottom:16px" aria-hidden="true">&#127942;</div>
        <h2 style="font-size:28px;font-weight:800;margin-bottom:8px;color:#059669">You're All Set!</h2>
        <p style="font-size:16px;color:var(--text-muted);margin-bottom:24px;line-height:1.7">Your institution is configured and ready to go. Head to your dashboard to start exploring.</p>
        <a href="/dashboard" class="btn btn-primary" style="padding:14px 40px;font-size:16px;text-decoration:none;display:inline-block">Go to Dashboard &#8594;</a>
      </div>
    </div>
  </div>
</section>
</main>
${footer}${cookie}
<script>
var currentStep=1;
function goToStep(n){
  document.querySelectorAll('.onboarding-step').forEach(function(s){s.style.display='none'});
  var el=document.getElementById('step-'+n);if(el)el.style.display='block';
  currentStep=n;
  document.getElementById('progress-fill').style.width=(n*20)+'%';
  for(var i=1;i<=5;i++){var l=document.getElementById('step-label-'+i);if(l)l.style.color=(i<=n?'#4f46e5':'#94a3b8');}
  var pb=document.querySelector('[role=progressbar]');if(pb)pb.setAttribute('aria-valuenow',n);
}
function addInviteField(){
  var list=document.getElementById('invite-list');
  var count=list.querySelectorAll('input').length+1;
  var div=document.createElement('div');div.style.cssText='display:flex;gap:8px;margin-bottom:8px';
  div.innerHTML='<input id="invite-email-'+count+'" type="email" placeholder="colleague@example.com" style="flex:1;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" aria-label="Team member email '+count+'"><select style="padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:white" aria-label="Role"><option>Staff</option><option>Manager</option><option>Admin</option></select>';
  list.appendChild(div);
}
</script>
</body></html>`;
  res.send(html);
});

// ============================================================
// 13. GET /portal/:subdomain — Enhanced Tenant Profile
// ============================================================
app.get('/portal/:subdomain', portalLimiter, ah(async (req, res, next) => {
  const subdomain = req.params.subdomain;
  // Security: validate subdomain format
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(subdomain)) return res.status(400).send('Invalid subdomain');
  // If user is authenticated, let authenticated portal routes handle it
  if (req.session && req.session.user) return next();
  // Skip reserved system routes
  const reserved = ['login','register','dashboard','settings','billing','admin','api','static','public','news','blog','about','contact','privacy','terms','help','faq','features','pricing','test','assets','css','js','images','icon','favicon','manifest','sw','p','entertainment','fundraising','dev','careers','partners','demo','compare','security','api-docs','onboarding','changelog','cookie-policy','verify-email','pricing-calculator'];
  if (reserved.includes(subdomain)) return res.redirect('/' + subdomain);
  // Skip known portal type names
  const portalTypes = ['school','clinic','health','church','organization','business','individual','hotel','restaurant','retail','salon','pharmacy','gym','hardware','supermarket','transport','electronics'];
  if (portalTypes.includes(subdomain)) return next();

  // Look up tenant
  const tenant = (await pool.query('SELECT id, name, type, sub_type, subdomain, logo_url, description, address, phone, email, approved, business_type, health_institution_type, working_hours FROM tenants WHERE subdomain=$1 AND approved=true', [subdomain])).rows[0];
  if (!tenant) return res.status(404).send('<div style="text-align:center;padding:60px" role="alert"><h1>Institution Not Found</h1><p style="color:var(--text-muted)">This institution does not exist or is not approved.</p><a href="/">Go to Comfort Home</a></div>');

  const isHealth = tenant.type === 'clinic' || tenant.type === 'health';
  const isSchool = tenant.type === 'school';
  const isHotel = tenant.type === 'hotel' || tenant.type === 'restaurant';
  const isSalon = tenant.type === 'salon';
  const isRetail = tenant.type === 'retail' || tenant.type === 'supermarket' || tenant.type === 'hardware' || tenant.type === 'electronics';
  const isChurch = tenant.type === 'church';
  const isBusiness = tenant.type === 'business';

  const typeLabels = {school:'School',clinic:'Clinic',health:'Health Center',church:'Church',hotel:'Hotel/Lodge',restaurant:'Restaurant',retail:'Retail Shop',salon:'Salon/Spa',pharmacy:'Pharmacy',gym:'Gym/Fitness',hardware:'Hardware Store',supermarket:'Supermarket',transport:'Transport',electronics:'Electronics Shop',business:'Business',individual:'Individual',organization:'Organization'};
  const instLabel = typeLabels[tenant.type] || tenant.type;
  const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  const canonicalUrl = `${baseUrl}/portal/${esc(subdomain)}`;
  const css = getPublicCSS();
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead(
    `${esc(tenant.name)} — ${esc(instLabel)}`,
    tenant.description || `${esc(tenant.name)} is a verified ${esc(instLabel)}. Visit us online for more information.`,
    `/portal/${subdomain}`,
    'business.business',
    tenant.logo_url || ''
  );

  // Type-specific data queries
  let typeSpecificData = {};
  try {
    if (isSchool) {
      const [studentCnt, staffCnt] = await Promise.allSettled([
        pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id=$1', [tenant.id]),
        pool.query('SELECT COUNT(*)::int AS c FROM users WHERE tenant_id=$1 AND approved=true', [tenant.id])
      ]);
      typeSpecificData.studentCount = studentCnt.status === 'fulfilled' ? studentCnt.value.rows[0].c : 0;
      typeSpecificData.staffCount = staffCnt.status === 'fulfilled' ? staffCnt.value.rows[0].c : 0;
    }
    if (isHotel) {
      const roomCnt = await pool.query('SELECT COUNT(*)::int AS c FROM hotel_rooms WHERE tenant_id=$1', [tenant.id]).catch(() => ({rows:[{c:0}]}));
      typeSpecificData.roomCount = roomCnt.rows[0].c;
    }
    if (isSalon) {
      const svcCnt = await pool.query('SELECT COUNT(*)::int AS c FROM salon_services WHERE tenant_id=$1', [tenant.id]).catch(() => ({rows:[{c:0}]}));
      typeSpecificData.serviceCount = svcCnt.rows[0].c;
    }
  } catch(e) { /* gracefully degrade */ }

  // Reviews
  let reviews = [];
  try {
    reviews = (await pool.query("SELECT id, patient_name, rating, comment, created_at FROM feedback_entries WHERE tenant_id=$1 AND rating IS NOT NULL ORDER BY created_at DESC LIMIT 5", [tenant.id])).rows || [];
  } catch(e) {}

  // Working hours
  let workingHours = null;
  try { if (tenant.working_hours) workingHours = typeof tenant.working_hours === 'string' ? JSON.parse(tenant.working_hours) : tenant.working_hours; } catch(e) {}
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const now = new Date();
  const currentDay = days[now.getDay() === 0 ? 6 : now.getDay() - 1];
  function isOpenToday(day) {
    if (!workingHours || !workingHours[day]) return { open: false, hours: 'Closed', isCurrentlyOpen: false };
    const h = workingHours[day];
    if (h.closed) return { open: false, hours: 'Closed', isCurrentlyOpen: false };
    const open = parseInt(String(h.open || '0900').replace(':', ''));
    const close = parseInt(String(h.close || '1700').replace(':', ''));
    const currentTime = now.getHours() * 100 + now.getMinutes();
    return { open: true, hours: `${String(h.open || '09:00').padStart(5,'0')} - ${String(h.close || '17:00').padStart(5,'0')}`, isCurrentlyOpen: day === currentDay && currentTime >= open && currentTime < close };
  }
  const todayStatus = isOpenToday(currentDay);

  function renderStars(r) { return '&#9733;'.repeat(Math.round(r || 0)) + '&#9734;'.repeat(5 - Math.round(r || 0)); }

  // Type-specific CTAs
  const ctaMap = {school:{label:'Enroll Now',href:'/register'},hotel:{label:'Book Now',href:'/register'},restaurant:{label:'Reserve Table',href:'/register'},salon:{label:'Book Appointment',href:'/register'},retail:{label:'Visit Shop',href:'/register'},church:{label:'Visit Us',href:'/register'},clinic:{label:'Book Appointment',href:'/clinic/book/'+esc(subdomain)},pharmacy:{label:'Visit Pharmacy',href:'/register'},gym:{label:'Join Now',href:'/register'},business:{label:'Get Started',href:'/register'}};
  const cta = ctaMap[tenant.type] || {label:'Get Started',href:'/register'};

  // Type-specific highlights
  let highlights = '';
  if (isSchool) {
    highlights = `<div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-top:24px">
      <div style="text-align:center"><div style="font-size:28px;font-weight:800">${typeSpecificData.studentCount || '—'}</div><div style="font-size:12px;opacity:0.8">Students</div></div>
      <div style="text-align:center"><div style="font-size:28px;font-weight:800">${typeSpecificData.staffCount || '—'}</div><div style="font-size:12px;opacity:0.8">Staff</div></div>
    </div>`;
  } else if (isHotel) {
    highlights = `<div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-top:24px">
      <div style="text-align:center"><div style="font-size:28px;font-weight:800">${typeSpecificData.roomCount || '—'}</div><div style="font-size:12px;opacity:0.8">Rooms</div></div>
      <div style="text-align:center"><div style="font-size:28px;font-weight:800">&#9733;&#9733;&#9733;&#9733;</div><div style="font-size:12px;opacity:0.8">Rating</div></div>
    </div>`;
  } else if (isSalon) {
    highlights = `<div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;margin-top:24px">
      <div style="text-align:center"><div style="font-size:28px;font-weight:800">${typeSpecificData.serviceCount || '—'}</div><div style="font-size:12px;opacity:0.8">Services</div></div>
    </div>`;
  } else if (isChurch) {
    highlights = `<div style="text-align:center;margin-top:16px;font-size:15px;opacity:0.9">Sunday Service: 9:00 AM | Wednesday Bible Study: 6:00 PM</div>`;
  } else if (isRetail) {
    highlights = `<div style="text-align:center;margin-top:16px;font-size:15px;opacity:0.9">Wide selection of products | Competitive prices | Friendly service</div>`;
  }

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tenant.name)} — ${esc(instLabel)}</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
<nav style="background:var(--bg-card);border-bottom:1px solid var(--border-color);padding:12px 24px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,0.04)" role="navigation" aria-label="Tenant navigation">
  <div style="font-size:20px;font-weight:800;color:#0d9488;display:flex;align-items:center;gap:8px">${tenant.logo_url ? '<img src="'+esc(tenant.logo_url)+'" alt="'+esc(tenant.name)+'" style="height:28px;border-radius:6px">' : '&#9670; Comfort'}</div>
  <div style="display:flex;gap:16px;align-items:center">
    <a href="#hours" style="font-size:13px;font-weight:600;color:var(--text-secondary);padding:6px 14px;border-radius:8px;text-decoration:none">Hours</a>
    <a href="#contact" style="font-size:13px;font-weight:600;color:var(--text-secondary);padding:6px 14px;border-radius:8px;text-decoration:none">Contact</a>
    <a href="${cta.href}" class="btn btn-primary" style="font-size:13px;padding:8px 18px;text-decoration:none;background:linear-gradient(135deg,#0d9488,#0891b2);color:white;border-radius:8px;border:none;cursor:pointer">${cta.label}</a>
    <a href="/login" style="font-size:13px;color:var(--text-secondary);text-decoration:none">Login</a>
  </div>
</nav>

<main id="main-content" role="main">
<section style="background:linear-gradient(135deg,#0d9488 0%,#0891b2 50%,#0e7490 100%);color:white;padding:56px 24px 48px;text-align:center;position:relative;overflow:hidden" aria-label="Tenant hero">
  <div style="position:relative;z-index:1;max-width:800px;margin:0 auto">
    <div style="width:80px;height:80px;border-radius:20px;background:white;box-shadow:0 8px 24px rgba(0,0,0,0.2);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;overflow:hidden">
      ${tenant.logo_url ? '<img src="'+esc(tenant.logo_url)+'" alt="'+esc(tenant.name)+'" style="width:100%;height:100%;object-fit:cover">' : '<span style="font-size:36px;color:#0d9488">&#127973;</span>'}
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin-bottom:16px;flex-wrap:wrap">
      <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;background:rgba(255,255,255,0.15);border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.2)"><span style="color:#86efac">&#10003;</span> Verified</span>
      <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 14px;background:rgba(255,255,255,0.15);border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.2)">${esc(instLabel)}</span>
    </div>
    <h1 style="font-size:clamp(26px,5vw,40px);font-weight:900;margin-bottom:6px">${esc(tenant.name)}</h1>
    <p style="font-size:clamp(14px,2vw,17px);opacity:0.9;margin-bottom:8px">${esc(tenant.description || (instLabel + ' — Welcome to our page'))}</p>
    ${highlights}
    ${reviews.length > 0 ? '<div style="margin-top:16px;font-size:14px;opacity:0.9">'+renderStars(reviews.reduce((a,r)=>a+(r.rating||0),0)/reviews.length)+' ('+reviews.length+' reviews)</div>' : ''}
  </div>
</section>

<section id="hours" style="padding:48px 20px" aria-label="Working Hours">
  <div style="max-width:600px;margin:0 auto">
    <h2 style="text-align:center;font-size:24px;font-weight:800;margin-bottom:24px">Working Hours</h2>
    <div style="background:var(--bg-card);border-radius:16px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,0.05);border:1px solid var(--border-color)">
      <div style="text-align:center;margin-bottom:20px">
        <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700;background:${todayStatus.open && todayStatus.isCurrentlyOpen ? '#dcfce7;color:#16a34a' : '#fee2e2;color:#dc2626'}">
          <span style="width:8px;height:8px;border-radius:50%;background:${todayStatus.open && todayStatus.isCurrentlyOpen ? '#16a34a' : '#dc2626'}"></span>
          ${todayStatus.open && todayStatus.isCurrentlyOpen ? 'Open Now' : 'Currently Closed'}
        </span>
      </div>
      ${days.map(day => {
        const s = isOpenToday(day);
        return '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-color);font-size:14px"><span style="font-weight:600;color:var(--text-primary)">'+day+(day === currentDay ? ' (Today)' : '')+'</span>'+(s.open ? '<span style="color:var(--text-muted)">'+esc(s.hours)+'</span>' : '<span style="color:#ef4444;font-weight:500">Closed</span>')+'</div>';
      }).join('')}
    </div>
  </div>
</section>

${reviews.length > 0 ? `
<section style="padding:48px 20px;background:var(--bg-secondary)" aria-label="Reviews">
  <div style="max-width:700px;margin:0 auto">
    <h2 style="text-align:center;font-size:24px;font-weight:800;margin-bottom:24px">Reviews</h2>
    <div style="display:grid;gap:16px">
      ${reviews.map(r => `<div style="background:var(--bg-card);border-radius:14px;padding:20px;border:1px solid var(--border-color)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-weight:700;font-size:14px">${esc(r.patient_name || 'Anonymous')}</span><span style="font-size:12px;color:var(--text-muted)">${r.created_at ? new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''}</span></div>
        <div style="color:#f59e0b;font-size:14px;margin-bottom:6px">${renderStars(r.rating)}</div>
        ${r.comment ? '<p style="font-size:13px;color:var(--text-secondary)">'+esc(r.comment)+'</p>' : ''}
      </div>`).join('')}
    </div>
  </div>
</section>` : ''}

<section id="contact" style="padding:48px 20px" aria-label="Contact">
  <div style="max-width:600px;margin:0 auto">
    <h2 style="text-align:center;font-size:24px;font-weight:800;margin-bottom:24px">Contact Us</h2>
    <div style="background:var(--bg-card);border-radius:16px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,0.05);border:1px solid var(--border-color)">
      ${tenant.phone ? '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;font-size:14px"><span style="font-size:18px" aria-hidden="true">&#128222;</span><a href="tel:'+esc(tenant.phone)+'" style="color:#0d9488;font-weight:600">'+esc(tenant.phone)+'</a></div>' : ''}
      ${tenant.email ? '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;font-size:14px"><span style="font-size:18px" aria-hidden="true">&#9993;</span><a href="mailto:'+esc(tenant.email)+'" style="color:#0d9488;font-weight:600">'+esc(tenant.email)+'</a></div>' : ''}
      ${tenant.address ? '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;font-size:14px"><span style="font-size:18px" aria-hidden="true">&#128205;</span><span style="font-weight:600;color:var(--text-primary)">'+esc(tenant.address)+'</span></div>' : ''}
    </div>
  </div>
</section>

<section style="text-align:center;padding:48px 24px;background:linear-gradient(135deg,#0d9488,#0891b2);border-radius:20px;margin:0 auto;max-width:700px;color:white" aria-label="CTA">
  <h2 style="font-size:clamp(20px,3vw,28px);font-weight:800;margin-bottom:8px">${cta.label}</h2>
  <p style="opacity:0.9;margin-bottom:24px;font-size:15px">Get started with ${esc(tenant.name)} today.</p>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
    <a href="${cta.href}" style="display:inline-block;padding:12px 28px;background:white;color:#0d9488;border-radius:12px;font-weight:700;text-decoration:none">${cta.label}</a>
    ${tenant.phone ? '<a href="https://wa.me/'+esc(tenant.phone.replace(/[^0-9]/g,''))+'" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;background:rgba(255,255,255,0.15);color:white;border-radius:12px;font-weight:700;text-decoration:none;border:2px solid rgba(255,255,255,0.5)">WhatsApp</a>' : ''}
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
}));

// ============================================================
// 14. POST /api/analytics/track — Analytics Endpoint
// ============================================================
app.post('/api/analytics/track', ah(async (req, res) => {
  const { event_type, page_path, referrer, metadata } = req.body;
  if (!event_type || typeof event_type !== 'string' || event_type.length > 100) {
    return res.status(400).json({ success: false, error: 'Invalid event_type' });
  }
  try {
    await pool.query(
      'INSERT INTO analytics_events(event_type, page_path, referrer, metadata, session_id) VALUES($1,$2,$3,$4,$5)',
      [
        event_type.substring(0, 100),
        (page_path || '').substring(0, 500),
        (referrer || '').substring(0, 500),
        metadata ? JSON.stringify(metadata) : null,
        (req.sessionID || '').substring(0, 255)
      ]
    );
  } catch (e) {
    if (logger) logger.error('Analytics track insert failed', e);
    return res.status(500).json({ success: false, error: 'Insert failed' });
  }
  res.json({ success: true });
}));

// ============================================================
// 15. GET /api/search — Site Search
// ============================================================
app.get('/api/search', ah(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ results: [] });
  const searchTerm = '%' + q.toLowerCase() + '%';
  const results = [];

  // Search tenants
  try {
    const tenants = (await pool.query(
      "SELECT name, type, subdomain, description FROM tenants WHERE approved=true AND (LOWER(name) LIKE $1 OR LOWER(description) LIKE $1) LIMIT 5",
      [searchTerm]
    )).rows;
    tenants.forEach(t => results.push({ type: 'tenant', title: t.name, url: '/portal/' + esc(t.subdomain), snippet: (t.description || t.type || '').substring(0, 120) }));
  } catch (e) { /* table may not exist */ }

  // Search blog posts
  try {
    const posts = (await pool.query(
      "SELECT title, slug FROM blog_posts WHERE published=true AND (LOWER(title) LIKE $1 OR LOWER(content) LIKE $1) LIMIT 5",
      [searchTerm]
    )).rows;
    posts.forEach(p => results.push({ type: 'blog', title: p.title, url: '/blog/posts/' + esc(p.slug || ''), snippet: '' }));
  } catch (e) { /* table may not exist */ }

  // Search help articles
  try {
    const articles = (await pool.query(
      "SELECT title, slug FROM help_articles WHERE published=true AND (LOWER(title) LIKE $1 OR LOWER(content) LIKE $1) LIMIT 5",
      [searchTerm]
    )).rows;
    articles.forEach(a => results.push({ type: 'help', title: a.title, url: '/help-center/' + esc(a.slug || ''), snippet: '' }));
  } catch (e) { /* table may not exist */ }

  res.json({ results: results.slice(0, 15) });
}));

// ============================================================
// 16. GET /pricing-calculator — Interactive Pricing Calculator
// ============================================================
app.get('/pricing-calculator', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Pricing Calculator — Comfort Platform', 'Calculate your Comfort subscription cost. Adjust users, records, and currency to find the right plan.', '/pricing-calculator', 'website');
  const typeOptions = PORTAL_TYPES.map(p => `<option value="${p.type}" data-price="${p.price === 'FREE' ? '0' : p.price.replace(/,/g,'')}">${p.emoji} ${p.label}</option>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pricing Calculator — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="p-hero" aria-label="Calculator Hero">
  <div class="container" style="text-align:center;padding:60px 20px">
    <h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;color:white;margin-bottom:12px">Pricing Calculator</h1>
    <p style="font-size:18px;color:rgba(255,255,255,0.9)">Find the perfect plan for your institution.</p>
  </div>
</section>
<section class="section" aria-label="Calculator">
  <div class="container" style="max-width:800px">
    <div class="card" style="padding:32px">
      <div style="display:grid;grid-template-columns:1fr;gap:20px">
        <div>
          <label for="calc-type" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Institution Type *</label>
          <select id="calc-type" onchange="calculatePrice()" style="width:100%;padding:12px;border:2px solid var(--border-color);border-radius:10px;font-size:15px;background:var(--bg-card)">${typeOptions}</select>
        </div>
        <div>
          <label for="calc-users" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Number of Users: <span id="user-count">5</span></label>
          <input id="calc-users" type="range" min="1" max="100" value="5" oninput="document.getElementById('user-count').textContent=this.value;calculatePrice()" style="width:100%;accent-color:#4f46e5" aria-label="Number of users">
        </div>
        <div>
          <label for="calc-records" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Number of Records: <span id="record-count">500</span></label>
          <input id="calc-records" type="range" min="100" max="10000" step="100" value="500" oninput="document.getElementById('record-count').textContent=this.value;calculatePrice()" style="width:100%;accent-color:#4f46e5" aria-label="Number of records">
        </div>
        <div>
          <label for="calc-currency" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Currency</label>
          <select id="calc-currency" onchange="calculatePrice()" style="width:100%;padding:12px;border:2px solid var(--border-color);border-radius:10px;font-size:15px;background:var(--bg-card)">
            <option value="UGX">UGX — Ugandan Shilling</option>
            <option value="USD">USD — US Dollar</option>
            <option value="KES">KES — Kenyan Shilling</option>
            <option value="TZS">TZS — Tanzanian Shilling</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
          </select>
        </div>
        <div>
          <label for="calc-billing" style="font-size:13px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Billing Period</label>
          <div style="display:flex;gap:12px" role="radiogroup" aria-label="Billing period">
            <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:2px solid #4f46e5;border-radius:10px;cursor:pointer;font-weight:600;color:#4f46e5;background:#eff6ff">
              <input type="radio" name="billing" value="monthly" checked onchange="calculatePrice()" style="accent-color:#4f46e5"> Monthly
            </label>
            <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border:2px solid var(--border-color);border-radius:10px;cursor:pointer;font-weight:600;color:var(--text-secondary)">
              <input type="radio" name="billing" value="annual" onchange="calculatePrice()" style="accent-color:#4f46e5"> Annual <span style="font-size:11px;color:#059669;font-weight:700">Save 20%</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <div id="calc-result" class="card" style="margin-top:24px;padding:32px;text-align:center;border:2px solid #4f46e5" aria-live="polite">
      <div style="font-size:14px;color:var(--text-muted);font-weight:600;margin-bottom:8px">Recommended Plan: <span id="rec-plan" style="color:#4f46e5">Basic</span></div>
      <div id="calc-price" style="font-size:42px;font-weight:900;color:#4f46e5;margin-bottom:4px">UGX 100,000<span style="font-size:16px;font-weight:400;color:var(--text-muted)">/month</span></div>
      <div id="calc-annual" style="font-size:14px;color:#059669;font-weight:600;margin-bottom:20px"></div>
      <a href="/register" class="btn btn-primary" style="padding:14px 40px;font-size:16px;text-decoration:none;display:inline-block">Start Free Trial</a>
    </div>
  </div>
</section>
</main>
${footer}${cookie}
<script>
var FX={UGX:1,USD:0.00027,KES:0.035,TZS:0.62,EUR:0.00025,GBP:0.00021};
var SYMBOLS={UGX:'UGX ',USD:'$',KES:'KES ',TZS:'TZS ',EUR:'\u20ac',GBP:'\u00a3'};
function calculatePrice(){
  var sel=document.getElementById('calc-type');
  var basePrice=parseInt(sel.options[sel.selectedIndex].getAttribute('data-price'))||0;
  var users=parseInt(document.getElementById('calc-users').value)||5;
  var records=parseInt(document.getElementById('calc-records').value)||500;
  var currency=document.getElementById('calc-currency').value;
  var isAnnual=document.querySelector('input[name=billing]:checked').value==='annual';
  var plan='Free',price=0;
  if(records<=100&&users<=3){plan='Free';price=0;}
  else if(records<=1000&&users<=10){plan='Basic';price=Math.max(basePrice,100000);}
  else if(records<=10000&&users<=50){plan='Pro';price=Math.max(basePrice*1.5,200000);}
  else{plan='Enterprise';price=Math.max(basePrice*2.5,500000);}
  if(isAnnual)price=Math.round(price*0.8);
  var converted=Math.round(price*(FX[currency]||1));
  var sym=SYMBOLS[currency]||'UGX ';
  var formatted=sym+converted.toLocaleString();
  document.getElementById('rec-plan').textContent=plan;
  document.getElementById('calc-price').innerHTML=formatted+'<span style="font-size:16px;font-weight:400;color:#64748b">/'+(isAnnual?'month (annual)':'month')+'</span>';
  document.getElementById('calc-annual').textContent=isAnnual?'Billed annually — you save 20%':'Switch to annual billing and save 20%';
}
calculatePrice();
</script>
</body></html>`;
  res.send(html);
});

// ============================================================
// 17. GET /verify-email — Email Verification
// ============================================================
app.get('/verify-email', ah(async (req, res) => {
  const token = (req.query.token || '').trim();
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Verify Email — Comfort Platform', 'Verify your email address to complete registration.', '/verify-email', 'website');

  if (!token) {
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify Email — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main" style="display:flex;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:20px">
  <div><div style="font-size:48px;margin-bottom:16px" aria-hidden="true">&#9888;&#65039;</div><h1 style="font-size:28px;margin-bottom:8px">Invalid Link</h1><p style="color:var(--text-muted);margin-bottom:24px">This verification link is invalid or has expired.</p><a href="/register" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px">Register Again</a></div>
</main>
${footer}${cookie}
</body></html>`;
    return res.send(html);
  }

  try {
    const result = await pool.query(
      'SELECT id, email, verified FROM email_verifications WHERE token=$1 AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length) {
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Expired — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main" style="display:flex;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:20px">
  <div><div style="font-size:48px;margin-bottom:16px" aria-hidden="true">&#9888;&#65039;</div><h1 style="font-size:28px;margin-bottom:8px">Link Expired</h1><p style="color:var(--text-muted);margin-bottom:24px">This verification link has expired. Please request a new one.</p><a href="/contact" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px">Contact Support</a></div>
</main>
${footer}${cookie}
</body></html>`;
      return res.send(html);
    }

    if (result.rows[0].verified) {
      return res.redirect('/login?verified=already');
    }

    await pool.query('UPDATE email_verifications SET verified=true WHERE id=$1', [result.rows[0].id]);

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Verified — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main" style="display:flex;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:20px">
  <div><div style="font-size:48px;margin-bottom:16px" aria-hidden="true">&#10003;</div><h1 style="font-size:28px;color:#059669;margin-bottom:8px">Email Verified!</h1><p style="color:var(--text-muted);margin-bottom:24px">Your email <strong>${esc(result.rows[0].email)}</strong> has been verified successfully.</p><a href="/login" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border-radius:10px;font-weight:700;text-decoration:none;font-size:16px">Login to Dashboard &#8594;</a></div>
</main>
${footer}${cookie}
<script>setTimeout(function(){window.location.href='/login?verified=true';},5000);</script>
</body></html>`;
    res.send(html);
  } catch (e) {
    if (logger) logger.error('Email verification failed', e);
    res.status(500).send('<div style="text-align:center;padding:60px" role="alert"><h1>Error</h1><p style="color:var(--text-muted)">Something went wrong. Please try again.</p><a href="/">Go Home</a></div>');
  }
}));

// ============================================================
// 18. GET /cookie-policy — Cookie Policy Page
// ============================================================
app.get('/cookie-policy', (req, res) => {
  const css = getPublicCSS();
  const nav = getPublicNav('en');
  const footer = getPublicFooter();
  const cookie = getCookieConsent();
  const head = getSEOHead('Cookie Policy — Comfort Platform', 'Learn about the cookies Comfort uses, their purposes, and how to manage them in your browser.', '/cookie-policy', 'website');
  const cookies = [
    {category:'Essential',name:'connect.sid',purpose:'Session authentication — keeps you logged in',duration:'Session'},
    {category:'Essential',name:'_csrf',purpose:'CSRF protection token — prevents cross-site request forgery',duration:'Session'},
    {category:'Essential',name:'cookie_consent',purpose:'Stores your cookie consent preference',duration:'1 year'},
    {category:'Analytics',name:'_ga',purpose:'Google Analytics — distinguishes unique visitors',duration:'2 years'},
    {category:'Analytics',name:'_ga_*',purpose:'Google Analytics — maintains session state',duration:'2 years'},
    {category:'Analytics',name:'comfort_anon_id',purpose:'Comfort Analytics — anonymous page tracking',duration:'1 year'},
    {category:'Preferences',name:'theme',purpose:'Stores your light/dark mode preference',duration:'1 year'},
    {category:'Preferences',name:'locale',purpose:'Stores your language preference',duration:'1 year'}
  ];
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cookie Policy — Comfort Platform</title><link rel="icon" href="/favicon.png">${head}<style>${css}</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="section" aria-label="Cookie Policy">
  <div class="container" style="max-width:800px">
    <h1 style="font-size:32px;font-weight:800;margin-bottom:8px">Cookie Policy</h1>
    <p style="color:var(--text-muted);margin-bottom:32px;font-size:14px">Last updated: March 2025</p>
    <p style="color:var(--text-secondary);font-size:15px;line-height:1.8;margin-bottom:32px">Comfort Platform uses cookies and similar tracking technologies to provide, secure, and improve our services. This policy explains what cookies we use, why, and how you can control them.</p>

    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Cookies We Use</h2>
    <div style="overflow-x:auto;margin-bottom:32px">
      <table style="width:100%;border-collapse:collapse;background:var(--bg-card);border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.04);font-size:14px" role="table" aria-label="Cookie details">
        <thead>
          <tr style="background:var(--bg-secondary)">
            <th style="padding:12px 16px;text-align:left;font-weight:700;color:var(--text-primary)">Category</th>
            <th style="padding:12px 16px;text-align:left;font-weight:700;color:var(--text-primary)">Name</th>
            <th style="padding:12px 16px;text-align:left;font-weight:700;color:var(--text-primary)">Purpose</th>
            <th style="padding:12px 16px;text-align:left;font-weight:700;color:var(--text-primary)">Duration</th>
          </tr>
        </thead>
        <tbody>
          ${cookies.map((c, i) => `<tr style="border-bottom:1px solid var(--border-color);${i % 2 === 0 ? '' : 'background:var(--bg-secondary)'}">
            <td style="padding:12px 16px"><span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;color:${c.category==='Essential'?'#059669':c.category==='Analytics'?'#2563eb':'#d97706'};background:${c.category==='Essential'?'#f0fdf4':c.category==='Analytics'?'#eff6ff':'#fffbeb'}">${c.category}</span></td>
            <td style="padding:12px 16px;font-family:monospace;font-size:13px;color:var(--text-primary)">${esc(c.name)}</td>
            <td style="padding:12px 16px;color:var(--text-secondary)">${c.purpose}</td>
            <td style="padding:12px 16px;color:var(--text-muted);white-space:nowrap">${c.duration}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Managing Cookies in Your Browser</h2>
    <p style="color:var(--text-secondary);font-size:15px;line-height:1.8;margin-bottom:16px">You can control and delete cookies through your browser settings. Note that removing cookies may affect your experience on Comfort.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:32px">
      ${[{name:'Chrome',instructions:'Settings > Privacy and Security > Cookies'},{name:'Firefox',instructions:'Settings > Privacy & Security > Cookies'},{name:'Safari',instructions:'Preferences > Privacy > Manage Website Data'},{name:'Edge',instructions:'Settings > Cookies and Site Permissions'}].map(b => `<div class="card" style="padding:16px"><h4 style="font-size:14px;font-weight:700;margin-bottom:4px">${b.name}</h4><p style="font-size:12px;color:var(--text-muted)">${b.instructions}</p></div>`).join('')}
    </div>

    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Your Choices</h2>
    <ul style="font-size:15px;color:var(--text-secondary);line-height:2;padding-left:20px">
      <li><strong>Essential cookies</strong> cannot be disabled — they are required for Comfort to function.</li>
      <li><strong>Analytics cookies</strong> can be opted out via the cookie consent banner.</li>
      <li><strong>Preference cookies</strong> can be cleared but will reset your preferences.</li>
    </ul>
  </div>
</section>
</main>
${footer}${cookie}
</body></html>`;
  res.send(html);
});

  // ============================================================
  // FEATURE 1: Live Chat Widget (global component function)
  // ============================================================
  function getLiveChatWidget() {
    return `
<div class="lcw-widget" id="lcwWidget">
  <div class="lcw-panel" id="lcwPanel" style="display:none">
    <div class="lcw-header">
      <span>💬 Live Support</span>
      <button class="lcw-close" id="lcwClose" aria-label="Close chat">&times;</button>
    </div>
    <div class="lcw-messages" id="lcwMessages">
      <div class="lcw-msg lcw-msg-bot">Hi! 👋 How can we help you today?</div>
    </div>
    <form class="lcw-input" id="lcwForm" autocomplete="off">
      <input type="text" id="lcwInput" placeholder="Type your message..." aria-label="Chat message" required>
      <button type="submit" aria-label="Send message">➤</button>
    </form>
  </div>
  <button class="lcw-bubble" id="lcwBubble" aria-label="Open live chat">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  </button>
</div>
<style>
.lcw-widget{position:fixed;bottom:24px;right:24px;z-index:9999;font-family:var(--font-stack)}
.lcw-bubble{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));border:none;cursor:pointer;box-shadow:0 4px 20px rgba(79,70,229,0.4);display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s}
.lcw-bubble:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(79,70,229,0.5)}
.lcw-panel{position:fixed;bottom:96px;right:24px;width:360px;max-width:calc(100vw - 48px);background:var(--bg-card);border:1px solid var(--border-color);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);overflow:hidden;display:flex;flex-direction:column;animation:lcwSlideUp .3s ease}
@keyframes lcwSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.lcw-header{background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white;padding:16px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:15px}
.lcw-close{background:none;border:none;color:white;font-size:22px;cursor:pointer;padding:0 4px;line-height:1}
.lcw-messages{flex:1;padding:16px;max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;background:var(--bg-secondary)}
.lcw-msg{padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;max-width:85%;word-wrap:break-word}
.lcw-msg-bot{background:var(--bg-card);color:var(--text-primary);align-self:flex-start;border:1px solid var(--border-color)}
.lcw-msg-user{background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white;align-self:flex-end}
.lcw-input{display:flex;border-top:1px solid var(--border-color);padding:8px;background:var(--bg-card)}
.lcw-input input{flex:1;padding:10px 14px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-primary);color:var(--text-primary);outline:none}
.lcw-input input:focus{border-color:var(--accent-primary)}
.lcw-input button{background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;font-size:16px;margin-left:8px;transition:transform .1s}
.lcw-input button:hover{transform:scale(1.05)}
</style>
<script>
(function(){
  var bubble=document.getElementById('lcwBubble');
  var panel=document.getElementById('lcwPanel');
  var closeBtn=document.getElementById('lcwClose');
  var form=document.getElementById('lcwForm');
  var input=document.getElementById('lcwInput');
  var msgs=document.getElementById('lcwMessages');
  if(!bubble||!panel)return;
  bubble.addEventListener('click',function(){panel.style.display='flex';bubble.style.display='none';});
  closeBtn.addEventListener('click',function(){panel.style.display='none';bubble.style.display='flex';});
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var text=input.value.trim();if(!text)return;
    var userDiv=document.createElement('div');userDiv.className='lcw-msg lcw-msg-user';userDiv.textContent=text;msgs.appendChild(userDiv);
    input.value='';msgs.scrollTop=msgs.scrollHeight;
    fetch('/api/chat/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})}).then(function(r){return r.json()}).then(function(d){
      var botDiv=document.createElement('div');botDiv.className='lcw-msg lcw-msg-bot';botDiv.textContent=d.reply||'Thank you! Our team will respond shortly.';msgs.appendChild(botDiv);msgs.scrollTop=msgs.scrollHeight;
    }).catch(function(){
      var botDiv=document.createElement('div');botDiv.className='lcw-msg lcw-msg-bot';botDiv.textContent='Thank you for your message. Our team will get back to you soon!';msgs.appendChild(botDiv);msgs.scrollTop=msgs.scrollHeight;
    });
  });
})();
</script>`;
  }

  // Chat support API endpoint
  app.post('/api/chat/support', portalLimiter, ah(async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    try {
      await pool.query('INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)',
        ['Live Chat', 'chat@comfort.ug', 'Live Chat Message', esc(message.trim().substring(0, 2000))]);
      if (logger) logger.info('Live chat message received');
      res.json({ reply: 'Thank you for reaching out! Our support team will respond shortly. You can also email us at hello@comfort.ug for urgent matters.' });
    } catch (err) {
      if (logger) logger.error('Live chat error: ' + err.message);
      res.json({ reply: 'Thank you for your message. Our team will get back to you soon!' });
    }
  }));

  // ============================================================
  // FEATURE 2: Interactive Product Tour - GET /tour
  // ============================================================
  app.get('/tour', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Product Tour — Comfort', 'Take an interactive tour of Comfort Platform. See how easy it is to manage your institution step by step.', '/tour', 'website');
    const tourSteps = [
      { icon: '📝', title: '1. Registration', desc: 'Sign up in under 2 minutes. Choose your institution type, enter your details, and your personalized dashboard is ready instantly.', screenshot: 'Registration form with institution type selector and quick setup fields' },
      { icon: '📊', title: '2. Dashboard', desc: 'Your command center. See real-time stats, recent activity, pending tasks, and quick-action buttons — all at a glance.', screenshot: 'Dashboard with KPI cards, charts, and activity feed' },
      { icon: '👥', title: '3. Student / Patient Management', desc: 'Add records individually or import via CSV/Excel. Track attendance, history, payments, and communications for every person.', screenshot: 'Student list with search, filters, and quick actions' },
      { icon: '💰', title: '4. Payments & Billing', desc: 'Accept Mobile Money, bank transfers, and cards. Auto-generate invoices, send payment reminders, and reconcile in real time.', screenshot: 'Payment dashboard with transaction history and reconciliation' },
      { icon: '📈', title: '5. Reports & Analytics', desc: 'Generate financial, attendance, and performance reports with one click. Export to PDF/Excel or share with stakeholders.', screenshot: 'Reports page with charts, filters, and export options' },
      { icon: '📱', title: '6. Mobile App', desc: 'Full functionality on any device. Works offline as a PWA. Take attendance, record sales, and manage operations from anywhere.', screenshot: 'Mobile app interface showing key features on a phone screen' }
    ];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Product Tour — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.tour-hero{background:linear-gradient(135deg,#059669,#0891b2);color:white;text-align:center;padding:60px 20px}
.tour-container{max-width:900px;margin:0 auto;padding:40px 20px}
.tour-step{display:none;background:var(--bg-card);border:1px solid var(--border-color);border-radius:16px;padding:40px;text-align:center;animation:tourFadeIn .4s ease}
.tour-step.active{display:block}
@keyframes tourFadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.tour-step-icon{font-size:56px;margin-bottom:20px}
.tour-step-title{font-size:24px;font-weight:800;color:var(--text-primary);margin-bottom:12px}
.tour-step-desc{font-size:16px;color:var(--text-secondary);line-height:1.7;max-width:600px;margin:0 auto 24px}
.tour-screenshot{background:var(--bg-secondary);border:2px dashed var(--border-color);border-radius:12px;padding:40px 20px;color:var(--text-muted);font-size:14px;margin-bottom:24px}
.tour-progress{display:flex;justify-content:center;gap:8px;margin:24px 0}
.tour-dot{width:12px;height:12px;border-radius:50%;background:var(--border-color);cursor:pointer;transition:all .2s;border:none}
.tour-dot.active{background:var(--accent-primary);transform:scale(1.3)}
.tour-nav{display:flex;justify-content:center;gap:16px;margin-top:24px}
.tour-nav-btn{padding:12px 28px;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer;border:none;transition:all .2s}
.tour-nav-btn:hover{transform:translateY(-1px)}
.tour-nav-prev{background:var(--bg-secondary);color:var(--text-secondary);border:1px solid var(--border-color)}
.tour-nav-next{background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white}
.tour-nav-next:hover{box-shadow:0 4px 16px rgba(79,70,229,0.3)}
.tour-nav-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="tour-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Interactive Product Tour</h1><p style="font-size:18px;opacity:.9">Walk through Comfort step by step and see how it works for you.</p></div></section>
<section class="section"><div class="tour-container">
<div class="tour-progress" role="tablist" aria-label="Tour steps">${tourSteps.map((_, i) => `<button class="tour-dot${i === 0 ? ' active' : ''}" data-step="${i}" role="tab" aria-label="Step ${i + 1}"></button>`).join('')}</div>
${tourSteps.map((s, i) => `<div class="tour-step${i === 0 ? ' active' : ''}" data-index="${i}"><div class="tour-step-icon">${s.icon}</div><h2 class="tour-step-title">${s.title}</h2><p class="tour-step-desc">${s.desc}</p><div class="tour-screenshot">📷 ${s.screenshot}</div></div>`).join('')}
<div class="tour-nav">
  <button class="tour-nav-btn tour-nav-prev" id="tourPrev" disabled>← Previous</button>
  <button class="tour-nav-btn tour-nav-next" id="tourNext">Next →</button>
</div>
<div style="text-align:center;margin-top:32px"><a href="/register" class="btn btn-primary" style="padding:14px 32px;font-size:16px">Start Free Now</a></div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script>
(function(){
  var steps=document.querySelectorAll('.tour-step');
  var dots=document.querySelectorAll('.tour-dot');
  var prevBtn=document.getElementById('tourPrev');
  var nextBtn=document.getElementById('tourNext');
  var current=0;
  function showStep(n){
    steps.forEach(function(s){s.classList.remove('active')});
    dots.forEach(function(d){d.classList.remove('active')});
    steps[n].classList.add('active');dots[n].classList.add('active');
    prevBtn.disabled=n===0;
    nextBtn.textContent=n===steps.length-1?'Finish Tour':'Next →';
  }
  prevBtn.addEventListener('click',function(){if(current>0){current--;showStep(current);}});
  nextBtn.addEventListener('click',function(){if(current<steps.length-1){current++;showStep(current);}else{window.location.href='/register';}});
  dots.forEach(function(d){d.addEventListener('click',function(){current=parseInt(d.getAttribute('data-step'));showStep(current);});});
})();
</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 3: Case Studies - GET /case-studies
  // ============================================================
  app.get('/case-studies', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Case Studies — Comfort', 'Read success stories from institutions across Africa using Comfort Platform to streamline operations and boost revenue.', '/case-studies', 'website');
    const cases = [
      { name: 'Sunrise Primary School', type: 'School', emoji: '🏫', challenge: 'Managing 800 students with paper-based records, manual fee collection taking 3 weeks per term, and no parent communication system.', solution: 'Deployed Comfort School module with automated fee tracking, digital report cards, parent SMS notifications, and attendance biometrics.', results: [{ metric: 'Fee Collection Time', before: '3 weeks', after: '3 days', improvement: '85%' },{ metric: 'Parent Engagement', before: '15%', after: '78%', improvement: '420%' },{ metric: 'Admin Hours/Week', before: '40 hrs', after: '8 hrs', improvement: '80%' }], quote: 'Comfort replaced our entire paper system. Fee collection that took 3 weeks now takes 3 days. Parents love the SMS notifications.', author: 'Grace Nakamya, Headteacher' },
      { name: 'Pearl Gardens Hotel', type: 'Hotel', emoji: '🏨', challenge: '45 rooms managed via spreadsheets, overbookings occurring weekly, no housekeeping coordination, and revenue leaks from unrecorded services.', solution: 'Implemented Comfort Hotel module with real-time room availability, automated reservation system, housekeeping tracker, and guest ledger.', results: [{ metric: 'Overbookings', before: '3-4/week', after: '0', improvement: '100%' },{ metric: 'Revenue', before: 'Baseline', after: '+30%', improvement: '30%' },{ metric: 'Check-in Time', before: '15 min', after: '3 min', improvement: '80%' }], quote: 'Revenue is up 30% since we started using Comfort. The guest ledger alone has saved us millions in unrecorded charges.', author: 'Robert Mugisha, Manager' },
      { name: 'HealthFirst Pharmacy', type: 'Pharmacy', emoji: '💊', challenge: 'Tracking expiry dates manually leading to UGX 5M+ in annual drug wastage, prescription errors from illegible handwriting, and stockouts of critical medicines.', solution: 'Deployed Comfort Pharmacy module with automated expiry alerts, digital prescription processing, stock reorder triggers, and dispensing workflow.', results: [{ metric: 'Drug Wastage', before: 'UGX 5M/yr', after: 'UGX 500K/yr', improvement: '90%' },{ metric: 'Prescription Errors', before: '5-8/month', after: '0-1/month', improvement: '88%' },{ metric: 'Stock Availability', before: '72%', after: '97%', improvement: '35%' }], quote: 'The expiry alerts alone have saved us over 4.5 million shillings per year. Our patients love the faster, error-free service.', author: 'Sarah Achieng, Pharmacist' },
      { name: 'Grace Community Church', type: 'Church', emoji: '⛪', challenge: '2,000+ members tracked in notebooks, tithe collection had no audit trail, cell group coordination was chaotic, and sacrament records were incomplete.', solution: 'Rolled out Comfort Church module with member directory, digital tithe tracking, cell group management, sacrament records, and prayer request system.', results: [{ metric: 'Tithe Transparency', before: 'No audit', after: 'Full audit trail', improvement: '100%' },{ metric: 'Member Engagement', before: '25%', after: '65%', improvement: '160%' },{ metric: 'Admin Time/Week', before: '20 hrs', after: '4 hrs', improvement: '80%' }], quote: 'Comfort brought complete transparency to our finances. The prayer request feature has united our congregation in ways we never imagined.', author: 'Pastor James Mukasa, Senior Pastor' }
    ];
    const jsonLd = cases.map(c => ({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: `Case Study: ${c.name}`,
      description: `How ${c.name} improved operations with Comfort Platform`,
      author: { '@type': 'Organization', name: 'Comfort Platform' }
    }));
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Case Studies — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.cs-hero{background:linear-gradient(135deg,#059669,#0d9488);color:white;text-align:center;padding:60px 20px}
.cs-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:16px;padding:32px;margin-bottom:32px;transition:box-shadow .2s}
.cs-card:hover{box-shadow:var(--shadow-md)}
.cs-card-header{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.cs-card-emoji{font-size:48px}
.cs-card-name{font-size:22px;font-weight:800;color:var(--text-primary)}
.cs-card-type{font-size:13px;color:var(--accent-primary);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.cs-section-title{font-size:16px;font-weight:700;color:var(--text-primary);margin:20px 0 8px;padding-bottom:6px;border-bottom:2px solid var(--bg-secondary)}
.cs-results-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0}
.cs-result{background:var(--bg-secondary);border-radius:10px;padding:16px;text-align:center}
.cs-result-metric{font-size:12px;color:var(--text-muted);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.cs-result-vals{font-size:13px;color:var(--text-secondary);margin-bottom:6px}
.cs-result-improvement{font-size:20px;font-weight:800;color:#059669}
.cs-quote{border-left:4px solid var(--accent-primary);padding:16px 20px;margin:20px 0;background:var(--bg-secondary);border-radius:0 10px 10px 0;font-style:italic;color:var(--text-secondary);line-height:1.7}
.cs-quote-author{font-style:normal;font-weight:700;margin-top:8px;color:var(--text-primary);font-size:14px}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="cs-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Case Studies</h1><p style="font-size:18px;opacity:.9">Real results from real institutions across Africa.</p></div></section>
<section class="section"><div class="container" style="max-width:900px">
${cases.map(c => `<div class="cs-card"><div class="cs-card-header"><span class="cs-card-emoji">${c.emoji}</span><div><div class="cs-card-name">${esc(c.name)}</div><div class="cs-card-type">${esc(c.type)}</div></div></div>
<div class="cs-section-title">Challenge</div><p style="color:var(--text-secondary);font-size:15px;line-height:1.7">${esc(c.challenge)}</p>
<div class="cs-section-title">Solution</div><p style="color:var(--text-secondary);font-size:15px;line-height:1.7">${esc(c.solution)}</p>
<div class="cs-section-title">Results</div><div class="cs-results-grid">${c.results.map(r => `<div class="cs-result"><div class="cs-result-metric">${esc(r.metric)}</div><div class="cs-result-vals">${esc(r.before)} → ${esc(r.after)}</div><div class="cs-result-improvement">↑ ${esc(r.improvement)}</div></div>`).join('')}</div>
<div class="cs-quote">"${esc(c.quote)}"<div class="cs-quote-author">— ${esc(c.author)}</div></div></div>`).join('')}
<div style="text-align:center;margin-top:32px"><a href="/register" class="btn btn-primary" style="padding:14px 32px;font-size:16px">Start Your Success Story</a></div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 4: Integrations Marketplace - GET /integrations
  // ============================================================
  app.get('/integrations', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Integrations — Comfort', 'Explore integrations that connect Comfort with your favorite tools — payments, communication, storage, analytics, and accounting.', '/integrations', 'website');
    const categories = ['Payment', 'Communication', 'Storage', 'Analytics', 'Accounting'];
    const integrations = [
      { name: 'MTN MoMo', icon: '💵', category: 'Payment', desc: 'Accept MTN Mobile Money payments directly from your Comfort dashboard.', status: 'Available' },
      { name: 'Airtel Money', icon: '📱', category: 'Payment', desc: 'Process Airtel Money transactions seamlessly for your customers.', status: 'Available' },
      { name: 'Flutterwave', icon: '💳', category: 'Payment', desc: 'Accept card payments globally via Flutterwave\'s secure gateway.', status: 'Available' },
      { name: 'WhatsApp', icon: '💬', category: 'Communication', desc: 'Send invoices, reminders, and notifications via WhatsApp Business API.', status: 'Available' },
      { name: 'SMS Gateway', icon: '📩', category: 'Communication', desc: 'Bulk SMS for fee reminders, appointment confirmations, and alerts.', status: 'Available' },
      { name: 'Email (SMTP)', icon: '📧', category: 'Communication', desc: 'Send branded emails for receipts, reports, and newsletters.', status: 'Available' },
      { name: 'Google Drive', icon: '📂', category: 'Storage', desc: 'Backup and sync documents, reports, and files to Google Drive.', status: 'Available' },
      { name: 'Dropbox', icon: '🗄️', category: 'Storage', desc: 'Cloud storage integration for automatic report and document backups.', status: 'Coming Soon' },
      { name: 'Google Analytics', icon: '📊', category: 'Analytics', desc: 'Track portal traffic, user behavior, and conversion metrics.', status: 'Available' },
      { name: 'QuickBooks', icon: '📒', category: 'Accounting', desc: 'Sync financial data with QuickBooks for advanced accounting.', status: 'Coming Soon' },
      { name: 'Xero', icon: '📑', category: 'Accounting', desc: 'Export transactions and invoices to Xero for seamless bookkeeping.', status: 'Coming Soon' },
      { name: 'Excel Export', icon: '📗', category: 'Accounting', desc: 'One-click export of any report or data to Excel/CSV format.', status: 'Available' }
    ];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Integrations — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.int-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-align:center;padding:60px 20px}
.int-filters{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:32px}
.int-filter-btn{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-secondary);transition:all .2s}
.int-filter-btn:hover,.int-filter-btn.active{background:var(--accent-primary);color:white;border-color:var(--accent-primary)}
.int-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
.int-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:24px;transition:all .2s}
.int-card:hover{border-color:var(--accent-primary);transform:translateY(-2px);box-shadow:var(--shadow-md)}
.int-card-icon{font-size:36px;margin-bottom:12px}
.int-card-name{font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:6px}
.int-card-desc{font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px}
.int-card-status{display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.int-card-status.available{background:#f0fdf4;color:#059669}
.int-card-status.coming{background:#fffbeb;color:#d97706}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="int-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Integrations Marketplace</h1><p style="font-size:18px;opacity:.9">Connect Comfort with the tools you already use.</p></div></section>
<section class="section"><div class="container">
<div class="int-filters"><button class="int-filter-btn active" data-cat="All">All</button>${categories.map(c => `<button class="int-filter-btn" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
<div class="int-grid" id="intGrid">${integrations.map(i => `<div class="int-card" data-category="${esc(i.category)}"><div class="int-card-icon">${i.icon}</div><div class="int-card-name">${esc(i.name)}</div><div class="int-card-desc">${esc(i.desc)}</div><span class="int-card-status ${i.status === 'Available' ? 'available' : 'coming'}">${i.status === 'Available' ? '✓ Available' : '🕐 Coming Soon'}</span></div>`).join('')}</div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script>
(function(){
  var btns=document.querySelectorAll('.int-filter-btn');
  var cards=document.querySelectorAll('.int-card');
  btns.forEach(function(btn){
    btn.addEventListener('click',function(){
      btns.forEach(function(b){b.classList.remove('active')});
      btn.classList.add('active');
      var cat=btn.getAttribute('data-cat');
      cards.forEach(function(c){c.style.display=(cat==='All'||c.getAttribute('data-category')===cat)?'':'none';});
    });
  });
})();
</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 5: Product Roadmap - GET /roadmap + API
  // ============================================================
  // Roadmap DB migrations
  (async () => {
    const roadmapMigrations = [
      `CREATE TABLE IF NOT EXISTS roadmap_features (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        status VARCHAR(50) DEFAULT 'planned',
        upvotes INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS roadmap_votes (
        id SERIAL PRIMARY KEY,
        feature_id INTEGER REFERENCES roadmap_features(id),
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(feature_id, ip_address)
      )`
    ];
    for (const sql of roadmapMigrations) {
      try { await pool.query(sql); } catch (e) { /* table may exist */ }
    }
    // Seed roadmap features if empty
    const { rows } = await pool.query('SELECT COUNT(*) FROM roadmap_features');
    if (parseInt(rows[0].count) === 0) {
      const seeds = [
        { title: 'AI-Powered Reports', desc: 'Auto-generate insights and summaries from your data using machine learning.', cat: 'AI', status: 'planned' },
        { title: 'Multi-Currency Support', desc: 'Accept payments and generate invoices in USD, UGX, KES, TZS, and RWF.', cat: 'Payments', status: 'planned' },
        { title: 'WhatsApp Business Integration', desc: 'Two-way WhatsApp messaging for customer engagement and support.', cat: 'Communication', status: 'planned' },
        { title: 'Custom Form Builder', desc: 'Drag-and-drop form creation for custom data collection workflows.', cat: 'Platform', status: 'planned' },
        { title: 'Inventory Forecasting', desc: 'Predict stock needs based on historical data and seasonal trends.', cat: 'AI', status: 'planned' },
        { title: 'Parent Portal App', desc: 'Dedicated mobile app for parents to view grades, pay fees, and communicate.', cat: 'Education', status: 'planned' },
        { title: 'Biometric Attendance', desc: 'Fingerprint and facial recognition for time tracking and access control.', cat: 'Security', status: 'in_progress' },
        { title: 'Offline Data Sync V2', desc: 'Enhanced offline mode with conflict resolution and faster sync speeds.', cat: 'Platform', status: 'in_progress' },
        { title: 'Advanced Dashboard Builder', desc: 'Customize your dashboard with drag-and-drop widgets and layouts.', cat: 'Platform', status: 'in_progress' },
        { title: 'Bulk SMS Campaigns', desc: 'Create and schedule SMS marketing campaigns with analytics.', cat: 'Communication', status: 'in_progress' },
        { title: 'Online Booking Widget', desc: 'Embeddable booking widget for hotels, salons, and clinics on any website.', cat: 'Booking', status: 'shipped' },
        { title: 'Recurring Payments', desc: 'Automated subscription billing with Mobile Money and card support.', cat: 'Payments', status: 'shipped' },
        { title: 'Multi-Branch Support', desc: 'Manage multiple locations from a single account with branch-level reporting.', cat: 'Platform', status: 'shipped' },
        { title: 'PDF Report Generation', desc: 'Professional PDF reports with your branding, ready for printing or email.', cat: 'Reports', status: 'shipped' },
        { title: 'Role-Based Access Control', desc: 'Granular permissions system with custom roles for every team member.', cat: 'Security', status: 'shipped' },
        { title: 'API v2 Documentation', desc: 'Comprehensive API docs with interactive examples and SDK libraries.', cat: 'Developer', status: 'shipped' },
        { title: 'Dark Mode', desc: 'System-aware dark theme for comfortable usage in low-light environments.', cat: 'UI', status: 'shipped' },
        { title: 'Data Export (CSV/Excel)', desc: 'Export any data set to CSV or Excel with custom field selection.', cat: 'Platform', status: 'shipped' }
      ];
      for (const s of seeds) {
        await pool.query('INSERT INTO roadmap_features (title, description, category, status) VALUES ($1, $2, $3, $4)', [s.title, s.desc, s.cat, s.status]);
      }
    }
  })();

  app.post('/api/roadmap/vote', portalLimiter, ah(async (req, res) => {
    const { featureId } = req.body;
    if (!featureId || !Number.isInteger(featureId)) return res.status(400).json({ error: 'Valid featureId required' });
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    try {
      const existing = await pool.query('SELECT id FROM roadmap_votes WHERE feature_id=$1 AND ip_address=$2', [featureId, ip]);
      if (existing.rows.length > 0) return res.status(429).json({ error: 'Already voted' });
      await pool.query('INSERT INTO roadmap_votes (feature_id, ip_address) VALUES ($1, $2)', [featureId, ip]);
      await pool.query('UPDATE roadmap_features SET upvotes = upvotes + 1 WHERE id=$1', [featureId]);
      res.json({ success: true });
    } catch (err) {
      if (logger) logger.error('Roadmap vote error: ' + err.message);
      res.status(500).json({ error: 'Vote failed' });
    }
  }));

  app.get('/roadmap', portalLimiter, ah(async (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Product Roadmap — Comfort', 'See what we\'re building next. Vote on features and help shape the future of Comfort Platform.', '/roadmap', 'website');
    let features = [];
    try {
      const { rows } = await pool.query('SELECT * FROM roadmap_features ORDER BY upvotes DESC, created_at DESC');
      features = rows;
    } catch (e) { /* table may not exist yet */ }
    const statusConfig = {
      planned: { label: 'Planned', color: '#6366f1', bg: '#eff6ff', emoji: '📋' },
      in_progress: { label: 'In Progress', color: '#d97706', bg: '#fffbeb', emoji: '🔨' },
      shipped: { label: 'Shipped', color: '#059669', bg: '#f0fdf4', emoji: '🚀' }
    };
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Product Roadmap — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.rm-hero{background:linear-gradient(135deg,#4f46e5,#6366f1);color:white;text-align:center;padding:60px 20px}
.rm-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:32px}
.rm-column{background:var(--bg-secondary);border-radius:14px;padding:24px}
.rm-column-header{font-size:18px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.rm-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:16px;margin-bottom:12px;transition:border-color .2s}
.rm-card:hover{border-color:var(--accent-primary)}
.rm-card-title{font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px}
.rm-card-desc{font-size:13px;color:var(--text-secondary);line-height:1.5;margin-bottom:10px}
.rm-card-footer{display:flex;justify-content:space-between;align-items:center}
.rm-card-tag{font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;background:var(--bg-secondary);color:var(--text-muted)}
.rm-vote-btn{padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-secondary);transition:all .2s}
.rm-vote-btn:hover{border-color:var(--accent-primary);color:var(--accent-primary)}
.rm-vote-btn.voted{background:var(--accent-primary);color:white;border-color:var(--accent-primary)}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="rm-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Product Roadmap</h1><p style="font-size:18px;opacity:.9">See what we're building next. Vote on features to help us prioritize.</p></div></section>
<section class="section"><div class="container">
<div class="rm-columns">${Object.entries(statusConfig).map(([key, cfg]) => `<div class="rm-column"><div class="rm-column-header"><span>${cfg.emoji}</span> ${cfg.label}</div>${features.filter(f => f.status === key).map(f => `<div class="rm-card"><div class="rm-card-title">${esc(f.title)}</div><div class="rm-card-desc">${esc(f.description || '')}</div><div class="rm-card-footer"><span class="rm-card-tag">${esc(f.category || '')}</span><button class="rm-vote-btn" onclick="voteFeature(${f.id},this)">▲ ${f.upvotes}</button></div></div>`).join('') || '<p style="font-size:14px;color:var(--text-muted)">No features yet.</p>'}</div>`).join('')}</div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script>
function voteFeature(id,btn){
  fetch('/api/roadmap/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({featureId:id})}).then(function(r){return r.json()}).then(function(d){
    if(d.success){btn.classList.add('voted');var count=parseInt(btn.textContent.replace(/[^0-9]/g,''));btn.textContent='▲ '+(count+1);}
    else{alert(d.error||'Could not vote');}
  }).catch(function(){alert('Network error');});
}
</script>
</body></html>`;
    res.send(html);
  }));

  // ============================================================
  // FEATURE 6: Community Hub - GET /community
  // ============================================================
  app.get('/community', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Community — Comfort', 'Join the Comfort community. Discuss features, get support, share your story, and connect with other users.', '/community', 'website');
    const categories = [
      { name: 'General Discussion', icon: '💬', desc: 'Chat about anything Comfort-related.', threads: 234, replies: 1892 },
      { name: 'Feature Requests', icon: '💡', desc: 'Suggest new features and vote on ideas.', threads: 156, replies: 1203 },
      { name: 'Support & Help', icon: '🆘', desc: 'Get help from the community and our team.', threads: 412, replies: 3421 },
      { name: 'Show & Tell', icon: '🎉', desc: 'Share how you use Comfort — tips, tricks, and stories.', threads: 89, replies: 567 }
    ];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Community — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.comm-hero{background:linear-gradient(135deg,#059669,#0d9488);color:white;text-align:center;padding:60px 20px}
.comm-stats{display:flex;gap:32px;justify-content:center;flex-wrap:wrap;margin:32px 0}
.comm-stat{text-align:center}
.comm-stat-num{font-size:36px;font-weight:900;color:var(--accent-primary)}
.comm-stat-label{font-size:13px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.comm-cat{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:24px;transition:all .2s;cursor:pointer;text-decoration:none;display:block;color:var(--text-primary)}
.comm-cat:hover{border-color:var(--accent-primary);transform:translateY(-2px);box-shadow:var(--shadow-md);text-decoration:none}
.comm-cat-icon{font-size:32px;margin-bottom:10px}
.comm-cat-name{font-size:18px;font-weight:700;margin-bottom:4px}
.comm-cat-desc{font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5}
.comm-cat-stats{display:flex;gap:16px;font-size:12px;color:var(--text-muted);font-weight:600}
.comm-guidelines{background:var(--bg-secondary);border-radius:14px;padding:28px;margin-top:32px}
.comm-guideline{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;font-size:14px;color:var(--text-secondary);line-height:1.6}
.comm-guideline-num{background:var(--accent-primary);color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:2px}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="comm-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Community Hub</h1><p style="font-size:18px;opacity:.9">Connect, learn, and grow with fellow Comfort users.</p></div></section>
<section class="section"><div class="container" style="max-width:900px">
<div class="comm-stats">
  <div class="comm-stat"><div class="comm-stat-num">2,400+</div><div class="comm-stat-label">Members</div></div>
  <div class="comm-stat"><div class="comm-stat-num">891</div><div class="comm-stat-label">Discussions</div></div>
  <div class="comm-stat"><div class="comm-stat-num">7,083</div><div class="comm-stat-label">Replies</div></div>
</div>
<h2 class="section-title" style="text-align:center;margin-bottom:24px">Discussion Categories</h2>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
${categories.map(c => `<a href="/community" class="comm-cat"><div class="comm-cat-icon">${c.icon}</div><div class="comm-cat-name">${esc(c.name)}</div><div class="comm-cat-desc">${esc(c.desc)}</div><div class="comm-cat-stats"><span>📝 ${c.threads} threads</span><span>↩️ ${c.replies} replies</span></div></a>`).join('')}
</div>
<div class="comm-guidelines">
  <h3 style="font-size:18px;font-weight:700;margin-bottom:16px">Community Guidelines</h3>
  ${['Be respectful and constructive in all interactions.','Search before posting to avoid duplicate discussions.','Share knowledge freely — help others when you can.','Keep discussions on-topic and relevant to the category.','Report inappropriate content to moderators.','No spam, self-promotion, or off-topic advertising.'].map((g, i) => `<div class="comm-guideline"><span class="comm-guideline-num">${i + 1}</span><span>${esc(g)}</span></div>`).join('')}
</div>
<div style="text-align:center;margin-top:40px"><a href="/register" class="btn btn-primary" style="padding:14px 32px;font-size:16px">Join the Community</a></div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 7: Referral Program - GET /referral
  // ============================================================
  app.get('/referral', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Referral Program — Comfort', 'Earn commissions by referring institutions to Comfort Platform. Share your link and earn up to 20% commission.', '/referral', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Referral Program — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.ref-hero{background:linear-gradient(135deg,#059669,#0d9488);color:white;text-align:center;padding:60px 20px}
.ref-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin:32px 0}
.ref-step{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:28px;text-align:center;position:relative}
.ref-step-num{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--accent-primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800}
.ref-step-icon{font-size:40px;margin-bottom:12px;margin-top:8px}
.ref-step-title{font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:6px}
.ref-step-desc{font-size:13px;color:var(--text-secondary);line-height:1.5}
.ref-tiers{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:28px;margin:24px 0}
.ref-tier{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--border-color)}
.ref-tier:last-child{border-bottom:none}
.ref-tier-range{font-size:15px;font-weight:600;color:var(--text-primary)}
.ref-tier-rate{font-size:24px;font-weight:900;color:var(--accent-primary)}
.ref-payout{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:24px 0}
.ref-payout-option{background:var(--bg-secondary);border-radius:12px;padding:20px;text-align:center}
.ref-payout-icon{font-size:32px;margin-bottom:8px}
.ref-payout-name{font-size:15px;font-weight:700;color:var(--text-primary)}
.ref-payout-desc{font-size:12px;color:var(--text-muted);margin-top:4px}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="ref-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Referral Program</h1><p style="font-size:18px;opacity:.9">Earn up to 20% commission by sharing Comfort with others.</p></div></section>
<section class="section"><div class="container" style="max-width:900px">
<h2 class="section-title" style="text-align:center;margin-bottom:8px">How It Works</h2>
<div class="ref-steps">
  <div class="ref-step"><span class="ref-step-num">1</span><div class="ref-step-icon">🔗</div><div class="ref-step-title">Share Your Link</div><div class="ref-step-desc">Get a unique referral link from your dashboard and share it with friends, colleagues, and businesses.</div></div>
  <div class="ref-step"><span class="ref-step-num">2</span><div class="ref-step-icon">👋</div><div class="ref-step-title">Friend Signs Up</div><div class="ref-step-desc">When someone signs up using your link and becomes a paying customer, the referral is tracked automatically.</div></div>
  <div class="ref-step"><span class="ref-step-num">3</span><div class="ref-step-icon">💰</div><div class="ref-step-title">You Earn</div><div class="ref-step-desc">Receive commission based on your tier. Payouts are processed monthly to your preferred payment method.</div></div>
</div>
<h2 class="section-title" style="text-align:center;margin:32px 0 16px">Commission Tiers</h2>
<div class="ref-tiers">
  <div class="ref-tier"><div><div class="ref-tier-range">First 10 Referrals</div><div style="font-size:12px;color:var(--text-muted)">Getting started</div></div><div class="ref-tier-rate">10%</div></div>
  <div class="ref-tier"><div><div class="ref-tier-range">11 – 50 Referrals</div><div style="font-size:12px;color:var(--text-muted)">Growing influence</div></div><div class="ref-tier-rate">15%</div></div>
  <div class="ref-tier"><div><div class="ref-tier-range">50+ Referrals</div><div style="font-size:12px;color:var(--text-muted)">Top referrer</div></div><div class="ref-tier-rate">20%</div></div>
</div>
<h2 class="section-title" style="text-align:center;margin:32px 0 16px">Payout Methods</h2>
<div class="ref-payout">
  <div class="ref-payout-option"><div class="ref-payout-icon">📱</div><div class="ref-payout-name">Mobile Money</div><div class="ref-payout-desc">MTN MoMo or Airtel Money — instant</div></div>
  <div class="ref-payout-option"><div class="ref-payout-icon">🏦</div><div class="ref-payout-name">Bank Transfer</div><div class="ref-payout-desc">Direct to your bank account — 3-5 days</div></div>
</div>
<h2 style="font-size:20px;font-weight:700;margin:32px 0 12px">Terms & Conditions</h2>
<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:24px;font-size:14px;color:var(--text-secondary);line-height:1.8">
  <ul style="list-style:none;padding:0">
    ${['Commission is earned on the first 12 months of a referred customer\'s subscription payment.','Referrals must be new Comfort users who have not previously registered.','Self-referrals are not eligible for commission.','Commissions are paid monthly, 30 days after the referred customer\'s payment.','Comfort reserves the right to adjust commission rates with 30 days notice.','Fraudulent or abusive referral activity will result in account termination.','Minimum payout threshold is UGX 50,000.'].map(t => `<li style="padding-left:20px;position:relative;margin-bottom:6px"><span style="position:absolute;left:0;color:var(--accent-primary)">•</span>${esc(t)}</li>`).join('')}
  </ul>
</div>
<div style="text-align:center;margin-top:40px"><a href="/register" class="btn btn-primary" style="padding:14px 32px;font-size:16px">Start Earning Today</a></div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 8: System Status - GET /status + API
  // ============================================================
  // Status DB migration
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS system_status (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'operational',
        uptime_30d NUMERIC(5,2) DEFAULT 99.99,
        last_incident TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const { rows } = await pool.query('SELECT COUNT(*) FROM system_status');
      if (parseInt(rows[0].count) === 0) {
        const services = [
          { name: 'API Server', status: 'operational', uptime: 99.98 },
          { name: 'Database', status: 'operational', uptime: 99.99 },
          { name: 'Payments (MoMo)', status: 'operational', uptime: 99.95 },
          { name: 'Email Service', status: 'operational', uptime: 99.90 },
          { name: 'SMS Gateway', status: 'operational', uptime: 99.85 },
          { name: 'WebSocket', status: 'operational', uptime: 99.97 },
          { name: 'CDN', status: 'operational', uptime: 99.99 }
        ];
        for (const s of services) {
          await pool.query('INSERT INTO system_status (service_name, status, uptime_30d) VALUES ($1, $2, $3)', [s.name, s.status, s.uptime]);
        }
      }
    } catch (e) { /* table may already exist */ }
  })();

  app.get('/api/status', portalLimiter, ah(async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM system_status ORDER BY service_name');
      const allOperational = rows.every(r => r.status === 'operational');
      res.json({ overall: allOperational ? 'operational' : 'degraded', services: rows, updated: new Date().toISOString() });
    } catch (e) {
      res.json({ overall: 'operational', services: [], updated: new Date().toISOString() });
    }
  }));

  app.get('/status', portalLimiter, ah(async (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('System Status — Comfort', 'Real-time system status and uptime for Comfort Platform services.', '/status', 'website');
    let services = [];
    try { const { rows } = await pool.query('SELECT * FROM system_status ORDER BY service_name'); services = rows; } catch (e) { /* fallback */ }
    if (services.length === 0) {
      services = [
        { service_name: 'API Server', status: 'operational', uptime_30d: '99.98' },
        { service_name: 'Database', status: 'operational', uptime_30d: '99.99' },
        { service_name: 'Payments (MoMo)', status: 'operational', uptime_30d: '99.95' },
        { service_name: 'Email Service', status: 'operational', uptime_30d: '99.90' },
        { service_name: 'SMS Gateway', status: 'operational', uptime_30d: '99.85' },
        { service_name: 'WebSocket', status: 'operational', uptime_30d: '99.97' },
        { service_name: 'CDN', status: 'operational', uptime_30d: '99.99' }
      ];
    }
    const statusColors = { operational: '#059669', degraded: '#d97706', outage: '#dc2626' };
    const statusLabels = { operational: 'Operational', degraded: 'Degraded Performance', outage: 'Service Outage' };
    const allOperational = services.every(s => s.status === 'operational');
    const incidents = [
      { date: 'Feb 15, 2025', title: 'SMS Gateway Delay', desc: 'SMS messages experienced 20-minute delays for 2 hours. Resolved by switching to backup provider.', severity: 'minor' },
      { date: 'Jan 28, 2025', title: 'Scheduled Database Maintenance', desc: 'Planned 15-minute maintenance window for database optimization. Completed successfully.', severity: 'maintenance' }
    ];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>System Status — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.ss-hero{padding:40px 20px;text-align:center;background:var(--bg-secondary)}
.ss-overall{display:inline-flex;align-items:center;gap:12px;padding:16px 32px;border-radius:12px;font-size:18px;font-weight:700;margin:16px 0}
.ss-overall.operational{background:#f0fdf4;color:#059669}
.ss-overall.degraded{background:#fffbeb;color:#d97706}
.ss-overall.outage{background:#fef2f2;color:#dc2626}
.ss-dot{width:14px;height:14px;border-radius:50%;display:inline-block;animation:ssPulse 2s infinite}
@keyframes ssPulse{0%,100%{opacity:1}50%{opacity:.5}}
.ss-service{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border-color)}
.ss-service:last-child{border-bottom:none}
.ss-service-name{font-size:15px;font-weight:600;color:var(--text-primary)}
.ss-service-status{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.ss-service-uptime{font-size:12px;color:var(--text-muted);min-width:70px;text-align:right}
.ss-incident{background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:16px;margin-bottom:12px}
.ss-incident-date{font-size:12px;color:var(--text-muted);font-weight:600}
.ss-incident-title{font-size:15px;font-weight:700;color:var(--text-primary);margin:4px 0}
.ss-incident-desc{font-size:13px;color:var(--text-secondary);line-height:1.5}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="ss-hero">
  <h1 style="font-size:clamp(28px,5vw,40px);font-weight:900;margin-bottom:8px">System Status</h1>
  <div class="ss-overall ${allOperational ? 'operational' : 'degraded'}"><span class="ss-dot" style="background:${allOperational ? '#059669' : '#d97706'}"></span> ${allOperational ? 'All Systems Operational' : 'Some Systems Degraded'}</div>
  <p style="font-size:13px;color:var(--text-muted);margin-top:8px">Last updated: ${new Date().toLocaleString()}</p>
</section>
<section class="section"><div class="container" style="max-width:800px">
<h2 style="font-size:18px;font-weight:700;margin-bottom:16px">Service Status</h2>
<div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;overflow:hidden">
${services.map(s => '<div class="ss-service"><div class="ss-service-name">' + esc(s.service_name) + '</div><div class="ss-service-status"><span style="width:10px;height:10px;border-radius:50%;background:' + (statusColors[s.status] || '#059669') + ';display:inline-block"></span><span style="color:' + (statusColors[s.status] || '#059669') + '">' + (statusLabels[s.status] || 'Operational') + '</span></div><div class="ss-service-uptime">' + parseFloat(s.uptime_30d).toFixed(2) + '% uptime</div></div>').join('')}
</div>
<h2 style="font-size:18px;font-weight:700;margin:32px 0 16px">Recent Incidents</h2>
${incidents.map(i => '<div class="ss-incident"><div class="ss-incident-date">' + esc(i.date) + ' · <span style="color:' + (i.severity === 'minor' ? '#d97706' : '#4f46e5') + '">' + (i.severity === 'minor' ? 'Minor' : 'Maintenance') + '</span></div><div class="ss-incident-title">' + esc(i.title) + '</div><div class="ss-incident-desc">' + esc(i.desc) + '</div></div>').join('')}
<p style="font-size:13px;color:var(--text-muted);text-align:center;margin-top:16px">Subscribe to status updates at <a href="mailto:status@comfort.ug">status@comfort.ug</a></p>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
</body></html>`;
    res.send(html);
  }));

  // ============================================================
  // FEATURE 9: Webhooks Documentation - GET /webhooks
  // ============================================================
  app.get('/webhooks', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Webhooks — Comfort', 'Developer documentation for Comfort Platform webhooks. Real-time event notifications for your integrations.', '/webhooks', 'website');
    const events = [
      { name: 'tenant.created', desc: 'Fired when a new tenant account is created.', payload: '{ "event": "tenant.created", "data": { "id": 123, "name": "Sunrise School", "type": "school", "email": "admin@sunrise.ug" }, "timestamp": "2025-01-15T10:30:00Z" }' },
      { name: 'payment.received', desc: 'Fired when a payment is successfully processed.', payload: '{ "event": "payment.received", "data": { "id": 456, "amount": 150000, "currency": "UGX", "method": "mtn_momo", "tenant_id": 123 }, "timestamp": "2025-01-15T11:00:00Z" }' },
      { name: 'student.enrolled', desc: 'Fired when a new student is enrolled.', payload: '{ "event": "student.enrolled", "data": { "id": 789, "name": "John Doe", "class": "P.3", "tenant_id": 123 }, "timestamp": "2025-01-15T12:00:00Z" }' },
      { name: 'appointment.booked', desc: 'Fired when an appointment is scheduled.', payload: '{ "event": "appointment.booked", "data": { "id": 321, "patient": "Jane Smith", "doctor": "Dr. Mukasa", "date": "2025-01-20" }, "timestamp": "2025-01-15T13:00:00Z" }' },
      { name: 'invoice.overdue', desc: 'Fired when an invoice becomes overdue.', payload: '{ "event": "invoice.overdue", "data": { "id": 654, "amount": 50000, "currency": "UGX", "tenant_id": 123 }, "timestamp": "2025-01-15T14:00:00Z" }' },
      { name: 'report.generated', desc: 'Fired when a report is generated and ready.', payload: '{ "event": "report.generated", "data": { "id": 987, "type": "financial", "format": "pdf", "tenant_id": 123 }, "timestamp": "2025-01-15T15:00:00Z" }' }
    ];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Webhooks — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.wh-hero{background:linear-gradient(135deg,#4f46e5,#6366f1);color:white;text-align:center;padding:60px 20px}
.wh-event{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:20px;margin-bottom:16px}
.wh-event-name{font-family:monospace;font-size:15px;font-weight:700;color:var(--accent-primary);margin-bottom:6px}
.wh-event-desc{font-size:14px;color:var(--text-secondary);margin-bottom:12px;line-height:1.6}
.wh-payload{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;font-family:monospace;font-size:12px;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.wh-section{margin:32px 0}
.wh-section h2{font-size:22px;font-weight:800;margin-bottom:12px}
.wh-section h3{font-size:17px;font-weight:700;margin:16px 0 8px}
.wh-section p,.wh-section li{font-size:14px;color:var(--text-secondary);line-height:1.7}
.wh-code{background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:14px;font-family:monospace;font-size:13px;color:var(--text-primary);overflow-x:auto;margin:8px 0}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="wh-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Webhooks</h1><p style="font-size:18px;opacity:.9">Real-time event notifications for your integrations.</p></div></section>
<section class="section"><div class="container" style="max-width:800px">
<div class="wh-section"><h2>Available Events</h2>
${events.map(e => `<div class="wh-event"><div class="wh-event-name">${esc(e.name)}</div><div class="wh-event-desc">${esc(e.desc)}</div><details><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--accent-primary)">View payload example</summary><div class="wh-payload">${esc(e.payload)}</div></details></div>`).join('')}
</div>
<div class="wh-section"><h2>Security</h2><h3>HMAC Signature Verification</h3><p>Every webhook request includes an <code>X-Comfort-Signature</code> header containing an HMAC-SHA256 signature of the payload body using your webhook secret.</p>
<div class="wh-code">const crypto = require('crypto');\nconst sig = crypto.createHmac('sha256', WEBHOOK_SECRET)\n  .update(rawBody).digest('hex');\nif (sig === req.headers['x-comfort-signature']) {\n  // Verified!\n}</div></div>
<div class="wh-section"><h2>Retry Policy</h2><p>If your endpoint returns a non-2xx status, we retry with exponential backoff:</p>
<ul style="list-style:disc;padding-left:20px;margin-top:8px">
  <li>1st retry: after 1 minute</li>
  <li>2nd retry: after 5 minutes</li>
  <li>3rd retry: after 30 minutes</li>
  <li>4th retry: after 2 hours</li>
  <li>After 4 failed attempts, the webhook is marked as failed</li>
</ul></div>
<div class="wh-section"><h2>Setup Instructions</h2>
<ol style="list-style:decimal;padding-left:20px">
  <li>Go to Settings → Developer → Webhooks in your Comfort dashboard</li>
  <li>Click "Add Webhook" and enter your endpoint URL</li>
  <li>Select the events you want to subscribe to</li>
  <li>Copy the webhook secret for signature verification</li>
  <li>Test your endpoint using the "Send Test" button</li>
</ol></div>
<div style="text-align:center;margin-top:40px"><a href="/register" class="btn btn-primary" style="padding:14px 32px;font-size:16px">Get API Access</a></div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 10: Migration Guide - GET /migration
  // ============================================================
  app.get('/migration', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Migration Guide — Comfort', 'Step-by-step guide to migrate from QuickBooks, Tally, Excel, or paper-based systems to Comfort Platform.', '/migration', 'website');
    const migrations = [
      { from: 'QuickBooks', icon: '📒', timeline: '1-2 weeks', steps: ['Export your chart of accounts, customers, and vendors to CSV', 'Import data into Comfort using our bulk import tool', 'Map your QuickBooks categories to Comfort account types', 'Set up payment methods (MoMo, bank transfer)', 'Run parallel for 1 week to verify data accuracy', 'Go live with Comfort and disable QuickBooks subscription'], support: 'Dedicated migration specialist assigned' },
      { from: 'Tally', icon: '📊', timeline: '1-2 weeks', steps: ['Export masters (ledger, stock, cost centers) from Tally', 'Convert Tally data format to CSV using our conversion tool', 'Import converted data into Comfort', 'Reconcile opening balances', 'Configure GST/tax settings in Comfort', 'Parallel run for verification'], support: 'Free data conversion tool + migration support' },
      { from: 'Excel / Spreadsheets', icon: '📗', timeline: '2-5 days', steps: ['Download our Excel template with proper column headers', 'Copy-paste your data into the template', 'Upload the template via the bulk import page', 'Review and confirm the data mapping', 'Set up recurring schedules and payment terms', 'Start using Comfort daily'], support: 'Step-by-step video tutorial + email support' },
      { from: 'Custom Systems', icon: '💻', timeline: '2-4 weeks', steps: ['Export data from your current system via API or database dump', 'Our team maps your data schema to Comfort fields', 'Automated ETL pipeline processes the migration', 'Thorough testing and validation of migrated data', 'Parallel run with your existing system', 'Full cutover after sign-off'], support: 'Dedicated engineering team for complex migrations' },
      { from: 'Paper-Based', icon: '📝', timeline: '3-7 days', steps: ['Gather all paper records (ledgers, registers, receipts)', 'Enter data directly into Comfort or use our mobile app', 'Scan and attach physical documents to digital records', 'Set up workflows to prevent backsliding to paper', 'Train staff on digital data entry', 'Dispose of paper records per your retention policy'], support: 'On-site training session + ongoing phone support' }
    ];
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Migration Guide — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.mig-hero{background:linear-gradient(135deg,#059669,#0d9488);color:white;text-align:center;padding:60px 20px}
.mig-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:28px;margin-bottom:24px}
.mig-card-header{display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border-color)}
.mig-card-icon{font-size:40px}
.mig-card-from{font-size:20px;font-weight:800;color:var(--text-primary)}
.mig-card-timeline{font-size:13px;font-weight:600;color:var(--accent-primary);background:var(--bg-secondary);padding:4px 12px;border-radius:6px;margin-left:8px}
.mig-step{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;font-size:14px;color:var(--text-secondary);line-height:1.6}
.mig-step-num{background:var(--accent-primary);color:white;min-width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:2px}
.mig-support{background:var(--bg-secondary);border-radius:8px;padding:12px 16px;margin-top:16px;font-size:13px;color:var(--accent-primary);font-weight:600}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="mig-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Migration Guide</h1><p style="font-size:18px;opacity:.9">Switch to Comfort from any system — we make it easy.</p></div></section>
<section class="section"><div class="container" style="max-width:800px">
<div style="background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white;border-radius:14px;padding:28px;text-align:center;margin-bottom:32px">
  <h2 style="font-size:22px;font-weight:800;margin-bottom:8px">Free Migration Assistance</h2>
  <p style="font-size:15px;opacity:.9;margin-bottom:16px">Every paid plan includes free migration support from our team.</p>
  <a href="/contact" style="display:inline-block;padding:12px 28px;background:white;color:var(--accent-primary);border-radius:10px;font-weight:700;font-size:15px;text-decoration:none">Contact Us for Help</a>
</div>
${migrations.map(m => `<div class="mig-card"><div class="mig-card-header"><span class="mig-card-icon">${m.icon}</span><div><span class="mig-card-from">From ${esc(m.from)}</span><span class="mig-card-timeline">⏱ ${esc(m.timeline)}</span></div></div>
${m.steps.map((s, i) => `<div class="mig-step"><span class="mig-step-num">${i + 1}</span><span>${esc(s)}</span></div>`).join('')}
<div class="mig-support">✓ ${esc(m.support)}</div></div>`).join('')}
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 11: ROI Calculator - GET /roi-calculator
  // ============================================================
  app.get('/roi-calculator', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('ROI Calculator — Comfort', 'Calculate your return on investment with Comfort Platform. See how much time and money you can save.', '/roi-calculator', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ROI Calculator — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.roi-hero{background:linear-gradient(135deg,#059669,#0d9488);color:white;text-align:center;padding:60px 20px}
.roi-form{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;padding:28px;margin-bottom:24px}
.roi-form label{font-size:14px;font-weight:600;color:var(--text-primary);display:block;margin-bottom:6px;margin-top:16px}
.roi-form label:first-child{margin-top:0}
.roi-form select,.roi-form input{width:100%;padding:12px 14px;border:1px solid var(--border-color);border-radius:8px;font-size:15px;background:var(--bg-primary);color:var(--text-primary)}
.roi-form select:focus,.roi-form input:focus{outline:none;border-color:var(--accent-primary)}
.roi-calculate-btn{width:100%;padding:14px;background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:24px;transition:transform .2s}
.roi-calculate-btn:hover{transform:translateY(-1px)}
.roi-results{display:none;background:var(--bg-card);border:2px solid var(--accent-primary);border-radius:14px;padding:28px;margin-top:24px}
.roi-results.visible{display:block}
.roi-result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:20px 0}
.roi-result-card{background:var(--bg-secondary);border-radius:12px;padding:20px;text-align:center}
.roi-result-value{font-size:28px;font-weight:900;color:var(--accent-primary)}
.roi-result-label{font-size:13px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="roi-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">ROI Calculator</h1><p style="font-size:18px;opacity:.9">See how much time and money Comfort can save your institution.</p></div></section>
<section class="section"><div class="container" style="max-width:700px">
<div class="roi-form">
  <label for="roiType">Institution Type</label>
  <select id="roiType">
    <option value="school">School / Education</option>
    <option value="clinic">Clinic / Hospital</option>
    <option value="hotel">Hotel / Lodge</option>
    <option value="restaurant">Restaurant / Cafe</option>
    <option value="pharmacy">Pharmacy</option>
    <option value="salon">Salon / Spa</option>
    <option value="church">Church / Religious</option>
    <option value="retail">Retail / Shop</option>
    <option value="gym">Gym / Fitness</option>
    <option value="business">General Business</option>
  </select>
  <label for="roiStaff">Number of Staff</label>
  <input type="number" id="roiStaff" min="1" max="1000" value="10" placeholder="e.g. 10">
  <label for="roiClients">Number of Students / Patients / Clients</label>
  <input type="number" id="roiClients" min="1" max="100000" value="200" placeholder="e.g. 200">
  <label for="roiHours">Hours Spent on Admin Per Week (total)</label>
  <input type="number" id="roiHours" min="1" max="200" value="40" placeholder="e.g. 40">
  <button class="roi-calculate-btn" id="roiCalcBtn">Calculate My ROI →</button>
</div>
<div class="roi-results" id="roiResults">
  <h3 style="font-size:20px;font-weight:800;color:var(--text-primary);text-align:center;margin-bottom:4px">Your Estimated Savings</h3>
  <p style="text-align:center;font-size:13px;color:var(--text-muted);margin-bottom:16px">Based on average data from similar institutions</p>
  <div class="roi-result-grid">
    <div class="roi-result-card"><div class="roi-result-value" id="roiTimeSaved">--</div><div class="roi-result-label">Hours Saved / Month</div></div>
    <div class="roi-result-card"><div class="roi-result-value" id="roiMoneySaved">--</div><div class="roi-result-label">UGX Saved / Month</div></div>
    <div class="roi-result-card"><div class="roi-result-value" id="roiPercent">--</div><div class="roi-result-label">ROI Percentage</div></div>
  </div>
</div>
<div style="text-align:center;margin-top:32px"><a href="/register" class="btn btn-primary" style="padding:14px 32px;font-size:16px">Start Saving Today</a></div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script>
document.getElementById('roiCalcBtn').addEventListener('click',function(){
  var type=document.getElementById('roiType').value;
  var staff=parseInt(document.getElementById('roiStaff').value)||10;
  var clients=parseInt(document.getElementById('roiClients').value)||200;
  var hours=parseInt(document.getElementById('roiHours').value)||40;
  var multipliers={school:0.75,clinic:0.70,hotel:0.72,restaurant:0.68,pharmacy:0.73,salon:0.65,church:0.78,retail:0.70,gym:0.67,business:0.72};
  var m=multipliers[type]||0.72;
  var timeSaved=Math.round(hours*m*4.33);
  var hourlyRate=15000;
  var moneySaved=timeSaved*hourlyRate;
  var monthlyCost=clients>300?200000:clients>100?150000:100000;
  var roi=Math.round(((moneySaved-monthlyCost)/monthlyCost)*100);
  document.getElementById('roiTimeSaved').textContent=timeSaved.toLocaleString()+' hrs';
  document.getElementById('roiMoneySaved').textContent='UGX '+moneySaved.toLocaleString();
  document.getElementById('roiPercent').textContent=roi+'%';
  document.getElementById('roiResults').classList.add('visible');
});
</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 12: Newsletter Signup (global component + API)
  // ============================================================
  function getNewsletterWidget() {
    return `
<div class="nlw-widget" id="nlwWidget">
  <div class="nlw-inner">
    <h4 class="nlw-title">📬 Stay Updated</h4>
    <p class="nlw-desc">Get product updates, tips, and African business insights. No spam.</p>
    <form class="nlw-form" id="nlwForm" autocomplete="off">
      <input type="email" id="nlwEmail" placeholder="your@email.com" aria-label="Email for newsletter" required>
      <button type="submit" class="nlw-btn">Subscribe</button>
    </form>
    <div class="nlw-msg" id="nlwMsg" style="display:none"></div>
  </div>
</div>
<style>
.nlw-widget{background:var(--bg-secondary);border-top:1px solid var(--border-color);padding:32px 20px}
.nlw-inner{max-width:500px;margin:0 auto;text-align:center}
.nlw-title{font-size:18px;font-weight:800;color:var(--text-primary);margin-bottom:4px}
.nlw-desc{font-size:13px;color:var(--text-secondary);margin-bottom:12px}
.nlw-form{display:flex;gap:8px;max-width:400px;margin:0 auto}
.nlw-form input{flex:1;padding:10px 14px;border:1px solid var(--border-color);border-radius:8px;font-size:14px;background:var(--bg-card);color:var(--text-primary);outline:none}
.nlw-form input:focus{border-color:var(--accent-primary)}
.nlw-btn{padding:10px 20px;background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));color:white;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:transform .1s}
.nlw-btn:hover{transform:translateY(-1px)}
.nlw-msg{margin-top:8px;font-size:13px;font-weight:600;padding:8px 12px;border-radius:6px}
.nlw-msg.success{background:#f0fdf4;color:#059669}
.nlw-msg.error{background:#fef2f2;color:#dc2626}
</style>
<script>
(function(){
  var form=document.getElementById('nlwForm');
  if(!form)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var email=document.getElementById('nlwEmail').value.trim();
    var msgEl=document.getElementById('nlwMsg');
    if(!email)return;
    fetch('/api/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})}).then(function(r){return r.json()}).then(function(d){
      msgEl.style.display='block';msgEl.className='nlw-msg '+(d.error?'error':'success');
      msgEl.textContent=d.error||d.message||'Subscribed successfully!';
    }).catch(function(){msgEl.style.display='block';msgEl.className='nlw-msg error';msgEl.textContent='Network error. Please try again.';});
  });
})();
</script>`;
  }

  // Newsletter DB migration
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        subscribed_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      )`);
    } catch (e) { /* table may exist */ }
  })();

  app.post('/api/newsletter/subscribe', portalLimiter, ah(async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    try {
      await pool.query('INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET is_active = true', [esc(email.toLowerCase().trim())]);
      if (logger) logger.info('Newsletter subscription: ' + email);
      res.json({ message: 'Welcome! You\'re now subscribed to Comfort updates.' });
    } catch (err) {
      if (logger) logger.error('Newsletter subscribe error: ' + err.message);
      res.json({ message: 'You\'re now subscribed to Comfort updates.' });
    }
  }));

  // ============================================================
  // FEATURE 13: Back to Top Button (global component)
  // ============================================================
  function getBackToTopButton() {
    return `
<button class="btt-btn" id="bttBtn" aria-label="Back to top" title="Back to top" style="display:none">↑</button>
<style>
.btt-btn{position:fixed;bottom:100px;right:28px;width:44px;height:44px;border-radius:50%;background:var(--accent-primary);color:white;border:none;font-size:20px;font-weight:700;cursor:pointer;z-index:9998;box-shadow:0 2px 12px rgba(79,70,229,0.3);transition:opacity .3s,transform .3s;opacity:0;transform:translateY(10px)}
.btt-btn.visible{display:flex;align-items:center;justify-content:center;opacity:1;transform:translateY(0)}
.btt-btn:hover{transform:translateY(-2px) scale(1.1);box-shadow:0 4px 20px rgba(79,70,229,0.4)}
</style>
<script>
(function(){
  var btn=document.getElementById('bttBtn');if(!btn)return;
  window.addEventListener('scroll',function(){
    if(window.scrollY>300){btn.classList.add('visible');btn.style.display='flex';}
    else{btn.classList.remove('visible');}
  },{passive:true});
  btn.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
})();
</script>`;
  }

  // ============================================================
  // FEATURE 14: Loading Skeleton CSS (available via skeletonCSS variable)
  // ============================================================
  const skeletonCSS = `
/* === Skeleton Loading Animation === */
.skeleton{background:linear-gradient(90deg,var(--bg-secondary) 25%,var(--border-color) 50%,var(--bg-secondary) 75%);background-size:200% 100%;animation:skelShimmer 1.5s ease-in-out infinite;border-radius:6px}
@keyframes skelShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.skeleton-text{height:16px;margin-bottom:8px;width:100%}
.skeleton-text.short{width:60%}
.skeleton-text.medium{width:80%}
.skeleton-card{height:200px;border-radius:14px;margin-bottom:16px}
.skeleton-avatar{width:48px;height:48px;border-radius:50%}
.skeleton-heading{height:28px;width:50%;margin-bottom:16px}
.skeleton-image{height:180px;border-radius:12px;margin-bottom:12px}
`;

  // ============================================================
  // FEATURE 15: Video Testimonials Section (component function)
  // ============================================================
  function getVideoTestimonials() {
    return `
<section class="vt-section" aria-label="Video Testimonials">
  <div class="container" style="max-width:1000px">
    <h2 class="section-title" style="text-align:center;margin-bottom:8px">See It In Action</h2>
    <p class="section-sub" style="text-align:center;margin-bottom:32px">Watch how real institutions use Comfort every day.</p>
    <div class="vt-grid">
      <div class="vt-card">
        <div class="vt-thumb"><div class="vt-play-btn">▶</div><div class="vt-thumb-label">2:30</div></div>
        <div class="vt-info"><div class="vt-name">Grace Nakamya</div><div class="vt-role">Headteacher, Sunrise Primary School</div><div class="vt-quote">"Comfort transformed how we manage our entire school."</div></div>
      </div>
      <div class="vt-card">
        <div class="vt-thumb"><div class="vt-play-btn">▶</div><div class="vt-thumb-label">1:45</div></div>
        <div class="vt-info"><div class="vt-name">Robert Mugisha</div><div class="vt-role">Manager, Pearl Gardens Hotel</div><div class="vt-quote">"Revenue is up 30% and overbookings are a thing of the past."</div></div>
      </div>
      <div class="vt-card">
        <div class="vt-thumb"><div class="vt-play-btn">▶</div><div class="vt-thumb-label">3:10</div></div>
        <div class="vt-info"><div class="vt-name">Sarah Achieng</div><div class="vt-role">Pharmacist, HealthFirst Pharmacy</div><div class="vt-quote">"Expiry alerts alone saved us over 4.5 million shillings."</div></div>
      </div>
    </div>
  </div>
</section>
<style>
.vt-section{padding:60px 20px;background:var(--bg-secondary)}
.vt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.vt-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:14px;overflow:hidden;transition:all .2s}
.vt-card:hover{transform:translateY(-4px);box-shadow:var(--shadow-md)}
.vt-thumb{position:relative;background:linear-gradient(135deg,#059669,#0d9488);height:180px;display:flex;align-items:center;justify-content:center}
.vt-play-btn{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;font-size:20px;color:#059669;cursor:pointer;transition:transform .2s}
.vt-card:hover .vt-play-btn{transform:scale(1.1)}
.vt-thumb-label{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.6);color:white;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.vt-info{padding:16px 20px}
.vt-name{font-size:15px;font-weight:700;color:var(--text-primary)}
.vt-role{font-size:12px;color:var(--text-muted);margin-bottom:8px}
.vt-quote{font-size:14px;color:var(--text-secondary);font-style:italic;line-height:1.5}
</style>`;
  }

  // ============================================================
  // FEATURE 16: USSD Demo - GET /ussd-demo
  // ============================================================
  app.get('/ussd-demo', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('USSD Demo — Comfort', 'Try the Comfort USSD interface. See how feature phone users can manage their institution using simple USSD codes.', '/ussd-demo', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>USSD Demo — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.ussd-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-align:center;padding:60px 20px}
.ussd-demo-area{display:flex;gap:40px;align-items:flex-start;justify-content:center;flex-wrap:wrap;padding:40px 20px}
.ussd-phone{width:300px;background:#1a1a1a;border-radius:32px;padding:20px 16px;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
.ussd-phone-notch{width:100px;height:24px;background:#1a1a1a;border-radius:0 0 12px 12px;margin:0 auto 12px}
.ussd-phone-screen{background:#000;color:#0f0;font-family:monospace;font-size:14px;padding:16px;border-radius:8px;min-height:320px;white-space:pre-wrap;line-height:1.6}
.ussd-phone-input{margin-top:12px;display:flex;gap:6px}
.ussd-phone-input input{flex:1;padding:10px;border:1px solid #333;background:#111;color:#0f0;font-family:monospace;border-radius:6px;font-size:14px;text-align:center}
.ussd-phone-input button{padding:10px 16px;background:#059669;color:white;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:14px}
.ussd-phone-input button:hover{background:#047857}
.ussd-info{max-width:400px}
.ussd-info h3{font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:8px}
.ussd-info p{font-size:14px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px}
.ussd-feature{display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;font-size:14px;color:var(--text-secondary);line-height:1.5}
.ussd-feature-icon{font-size:20px;flex-shrink:0}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="ussd-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">USSD Demo</h1><p style="font-size:18px;opacity:.9">Experience Comfort on any phone — no smartphone required.</p></div></section>
<section class="section">
<div class="ussd-demo-area">
  <div class="ussd-phone">
    <div class="ussd-phone-notch"></div>
    <div class="ussd-phone-screen" id="ussdScreen"></div>
    <div class="ussd-phone-input">
      <input type="text" id="ussdInput" placeholder="*" maxlength="20" aria-label="USSD input">
      <button id="ussdSend" aria-label="Send">Send</button>
    </div>
  </div>
  <div class="ussd-info">
    <h3>How USSD Works with Comfort</h3>
    <p>Feature phone users can access key Comfort features by dialing a simple USSD code. No internet connection needed!</p>
    <div class="ussd-feature"><span class="ussd-feature-icon">📊</span><span>Check balances and financial summaries</span></div>
    <div class="ussd-feature"><span class="ussd-feature-icon">👥</span><span>Look up student, patient, or member records</span></div>
    <div class="ussd-feature"><span class="ussd-feature-icon">💰</span><span>Confirm payments and view transaction history</span></div>
    <div class="ussd-feature"><span class="ussd-feature-icon">📋</span><span>Record attendance and check-ins</span></div>
    <div class="ussd-feature"><span class="ussd-feature-icon">🔔</span><span>Send SMS notifications to contacts</span></div>
    <p style="margin-top:16px"><strong style="color:var(--text-primary)">Works on any phone:</strong> Nokia, Itel, Tecno, Samsung — any device with a dial pad.</p>
  </div>
</div>
</section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script>
(function(){
  var screen=document.getElementById('ussdScreen');
  var input=document.getElementById('ussdInput');
  var sendBtn=document.getElementById('ussdSend');
  var state='menu';
  var menus={
    menu:'CON Welcome to Comfort\\n1. Check Balance\\n2. Recent Payments\\n3. Student Lookup\\n4. Record Attendance\\n5. Send Notification\\n0. Exit',
    balance:'END Your Account Balance:\\nUGX 2,450,000\\nLast payment: UGX 150,000\\nJan 15, 2025 at 2:30 PM',
    payments:'CON Recent Payments:\\n1. UGX 50,000 – J. Mukasa\\n2. UGX 75,000 – S. Achieng\\n3. UGX 30,000 – R. Mugisha\\n0. Back to Menu',
    students:'CON Enter student name or ID:\\n(Example: JOHN or STU-001)\\n0. Back to Menu',
    student_result:'END Student: John Doe\\nClass: P.3 East\\nFees Paid: UGX 450,000\\nBalance: UGX 50,000\\nAttendance: 92%',
    attendance:'CON Record Attendance:\\n1. Mark Present\\n2. Mark Absent\\n3. View Today\\'s List\\n0. Back to Menu',
    attendance_mark:'END Attendance recorded!\\nJohn Doe – Present\\nTime: ' + new Date().toLocaleTimeString() + '\\nTotal present today: 187',
    notification:'CON Send Notification:\\n1. Fee Reminder\\n2. Meeting Notice\\n3. General Message\\n0. Back to Menu',
    notification_sent:'END Notification sent!\\n12 recipients notified\\nDelivery: SMS + WhatsApp',
    exit:'END Thank you for using\\nComfort USSD Portal.\\nDial *123# anytime!'
  };
  function showScreen(text){screen.textContent=text;}
  sendBtn.addEventListener('click',function(){
    var val=input.value.trim();input.value='';
    if(state==='menu'){
      if(val==='1'){state='balance';showScreen(menus.balance);state='menu';}
      else if(val==='2'){state='payments';showScreen(menus.payments);}
      else if(val==='3'){state='students';showScreen(menus.students);}
      else if(val==='4'){state='attendance';showScreen(menus.attendance);}
      else if(val==='5'){state='notification';showScreen(menus.notification);}
      else if(val==='0'){showScreen(menus.exit);state='menu';}
    }else if(state==='payments'){
      if(val==='0'){state='menu';showScreen(menus.menu);}
      else{showScreen('END Payment Details:\\nAmount: UGX 50,000\\nFrom: James Mukasa\\nMethod: MTN MoMo\\nDate: Jan 15, 2025');state='menu';}
    }else if(state==='students'){
      if(val==='0'){state='menu';showScreen(menus.menu);}
      else{showScreen(menus.student_result);state='menu';}
    }else if(state==='attendance'){
      if(val==='0'){state='menu';showScreen(menus.menu);}
      else{showScreen(menus.attendance_mark);state='menu';}
    }else if(state==='notification'){
      if(val==='0'){state='menu';showScreen(menus.menu);}
      else{showScreen(menus.notification_sent);state='menu';}
    }else{state='menu';showScreen(menus.menu);}
  });
  input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sendBtn.click();}});
  showScreen(menus.menu);
})();
</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 17: Accessibility Statement - GET /accessibility
  // ============================================================
  app.get('/accessibility', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Accessibility Statement — Comfort', 'Our commitment to making Comfort Platform accessible to everyone. WCAG 2.1 AA compliance and ongoing improvements.', '/accessibility', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessibility Statement — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.acc-hero{background:linear-gradient(135deg,#059669,#0d9488);color:white;text-align:center;padding:60px 20px}
.acc-section{margin-bottom:28px}
.acc-section h2{font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--bg-secondary)}
.acc-section p,.acc-section li{font-size:15px;color:var(--text-secondary);line-height:1.8}
.acc-feature{background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;padding:20px;display:flex;gap:16px;align-items:flex-start;margin-bottom:12px}
.acc-feature-icon{font-size:28px;flex-shrink:0;margin-top:2px}
.acc-feature-title{font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:4px}
.acc-feature-desc{font-size:13px;color:var(--text-secondary);line-height:1.5}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="acc-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Accessibility Statement</h1><p style="font-size:18px;opacity:.9">Comfort is for everyone. We're committed to digital inclusion.</p></div></section>
<section class="section"><div class="container" style="max-width:800px">
<div class="acc-section">
  <h2>Our Commitment</h2>
  <p>Comfort Platform is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone and apply relevant accessibility standards.</p>
</div>
<div class="acc-section">
  <h2>Standards We Follow</h2>
  <p>We strive to conform to <strong>WCAG 2.1 Level AA</strong> (Web Content Accessibility Guidelines) as our baseline standard. We also reference ARIA (Accessible Rich Internet Applications) specifications for dynamic content.</p>
</div>
<div class="acc-section">
  <h2>Accessibility Features</h2>
  <div class="acc-feature"><span class="acc-feature-icon">⌨️</span><div><div class="acc-feature-title">Keyboard Navigation</div><div class="acc-feature-desc">All interactive elements are accessible via keyboard. Focus indicators are visible and consistent throughout the platform.</div></div></div>
  <div class="acc-feature"><span class="acc-feature-icon">🔊</span><div><div class="acc-feature-title">Screen Reader Support</div><div class="acc-feature-desc">Semantic HTML, ARIA labels, and landmark regions ensure compatibility with JAWS, NVDA, VoiceOver, and TalkBack.</div></div></div>
  <div class="acc-feature"><span class="acc-feature-icon">🎨</span><div><div class="acc-feature-title">Color Contrast</div><div class="acc-feature-desc">All text meets WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text). Color is never the sole indicator of meaning.</div></div></div>
  <div class="acc-feature"><span class="acc-feature-icon">📱</span><div><div class="acc-feature-title">Responsive Design</div><div class="acc-feature-desc">The platform adapts to all screen sizes and orientations. Users can zoom up to 200% without loss of content or functionality.</div></div></div>
  <div class="acc-feature"><span class="acc-feature-icon">🌙</span><div><div class="acc-feature-title">Dark Mode</div><div class="acc-feature-desc">System-aware dark theme reduces eye strain and improves readability in low-light environments.</div></div></div>
  <div class="acc-feature"><span class="acc-feature-icon">⚡</span><div><div class="acc-feature-title">Reduced Motion</div><div class="acc-feature-desc">Animations respect the prefers-reduced-motion media query for users sensitive to motion.</div></div></div>
</div>
<div class="acc-section">
  <h2>Known Limitations</h2>
  <ul style="list-style:disc;padding-left:20px">
    <li>Some third-party integrations may not fully conform to our accessibility standards</li>
    <li>Complex data tables in reports may require additional screen reader navigation</li>
    <li>Drag-and-drop form builder features may require keyboard alternatives</li>
    <li>Video content may not always have closed captions (we're working on this)</li>
  </ul>
</div>
<div class="acc-section">
  <h2>Contact Us About Accessibility</h2>
  <p>If you encounter an accessibility barrier, please let us know:</p>
  <ul style="list-style:none;padding:0;margin-top:8px">
    <li style="margin-bottom:6px">📧 <strong>Email:</strong> accessibility@comfort.ug</li>
    <li style="margin-bottom:6px">📱 <strong>Phone:</strong> +256 700 000 000</li>
    <li style="margin-bottom:6px">💬 <strong>WhatsApp:</strong> +256 700 000 000</li>
  </ul>
  <p>We aim to respond to accessibility feedback within 2 business days and propose a resolution within 10 business days.</p>
</div>
</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Accessibility Statement — Comfort Platform",
  "description": "Our commitment to making Comfort Platform accessible to everyone.",
  "mainEntity": {
    "@type": "AccessibilityFeature",
    "name": "WCAG 2.1 AA Compliance",
    "description": "Comfort Platform conforms to WCAG 2.1 Level AA accessibility standards"
  }
}
</script>
</body></html>`;
    res.send(html);
  });

  // ============================================================
  // FEATURE 18: Data Processing Agreement - GET /dpa
  // ============================================================
  app.get('/dpa', portalLimiter, (req, res) => {
    const css = getPublicCSS(); const nav = getPublicNav('en'); const footer = getPublicFooter(); const cookie = getCookieConsent();
    const head = getSEOHead('Data Processing Agreement — Comfort', 'Comfort Platform Data Processing Agreement. GDPR-ready DPA covering data processing terms, security, and subject rights.', '/dpa', 'website');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Data Processing Agreement — Comfort</title><link rel="icon" href="/favicon.png">${head}<style>${css}
.dpa-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-align:center;padding:60px 20px}
.dpa-section{margin-bottom:28px}
.dpa-section h2{font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--bg-secondary)}
.dpa-section p,.dpa-section li{font-size:14px;color:var(--text-secondary);line-height:1.8}
.dpa-table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
.dpa-table th,.dpa-table td{padding:10px 14px;text-align:left;border:1px solid var(--border-color)}
.dpa-table th{background:var(--bg-secondary);font-weight:700;color:var(--text-primary);font-size:12px;text-transform:uppercase;letter-spacing:.3px}
.dpa-table td{color:var(--text-secondary)}
.dpa-download{display:inline-flex;align-items:center;gap:8px;padding:12px 24px;background:var(--accent-primary);color:white;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none;transition:transform .2s}
.dpa-download:hover{transform:translateY(-1px);text-decoration:none;color:white}
</style></head><body>
${nav}
<main id="main-content" role="main">
<section class="dpa-hero"><div class="container"><h1 style="font-size:clamp(28px,5vw,44px);font-weight:900;margin-bottom:12px">Data Processing Agreement</h1><p style="font-size:18px;opacity:.9">GDPR-ready DPA for Comfort Platform.</p></div></section>
<section class="section"><div class="container" style="max-width:800px">
<p style="color:var(--text-muted);margin-bottom:24px">Effective Date: January 1, 2025 · Version 2.0</p>

<div class="dpa-section"><h2>1. Parties to the Agreement</h2>
<p>This Data Processing Agreement ("DPA") is entered into between:</p>
<ul style="list-style:disc;padding-left:20px;margin-top:8px">
  <li><strong>Data Controller:</strong> The institution (Customer) that subscribes to Comfort Platform services.</li>
  <li><strong>Data Processor:</strong> Comfort Platform (Ssewasswa Technologies Ltd), registered in Kampala, Uganda.</li>
</ul></div>

<div class="dpa-section"><h2>2. Data Processing Terms</h2>
<p>The Processor shall process personal data only on documented instructions from the Controller, including with regard to transfers of personal data to a third country, unless required to do so by applicable law. The Processor shall immediately inform the Controller if it considers an instruction to be in breach of applicable data protection law.</p></div>

<div class="dpa-section"><h2>3. Data Categories and Purposes</h2>
<table class="dpa-table">
  <thead><tr><th>Data Category</th><th>Purpose</th><th>Legal Basis</th></tr></thead>
  <tbody>
    <tr><td>Personal Identification</td><td>Account management, authentication</td><td>Contract performance</td></tr>
    <tr><td>Contact Information</td><td>Communication, notifications</td><td>Contract performance</td></tr>
    <tr><td>Financial Data</td><td>Payment processing, invoicing</td><td>Contract performance</td></tr>
    <tr><td>Student / Patient Records</td><td>Service delivery as instructed</td><td>Legitimate interest / Consent</td></tr>
    <tr><td>Usage Analytics</td><td>Service improvement, security</td><td>Legitimate interest</td></tr>
    <tr><td>Communication Records</td><td>Support, audit trail</td><td>Legitimate interest</td></tr>
  </tbody>
</table></div>

<div class="dpa-section"><h2>4. Security Measures</h2>
<p>The Processor implements appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including:</p>
<ul style="list-style:disc;padding-left:20px;margin-top:8px">
  <li>Encryption of data in transit (TLS 1.3) and at rest (AES-256)</li>
  <li>Role-based access control with audit logging</li>
  <li>Two-factor authentication for administrative access</li>
  <li>Regular security assessments and penetration testing</li>
  <li>Daily automated backups with 30-day retention</li>
  <li>Network segmentation and firewall protection</li>
  <li>Incident response plan with 72-hour breach notification</li>
</ul></div>

<div class="dpa-section"><h2>5. Data Subject Rights</h2>
<p>The Processor shall assist the Controller in fulfilling its obligations to respond to data subject requests for exercising their rights, including:</p>
<ul style="list-style:disc;padding-left:20px;margin-top:8px">
  <li><strong>Right of Access</strong> — Data subjects can request a copy of their personal data</li>
  <li><strong>Right to Rectification</strong> — Inaccurate data can be corrected</li>
  <li><strong>Right to Erasure</strong> — Data can be deleted upon request (subject to legal retention requirements)</li>
  <li><strong>Right to Data Portability</strong> — Data can be exported in standard formats</li>
  <li><strong>Right to Object</strong> — Data subjects can object to certain processing activities</li>
  <li><strong>Right to Restrict Processing</strong> — Processing can be limited in certain circumstances</li>
</ul></div>

<div class="dpa-section"><h2>6. Sub-Processors</h2>
<p>The Controller acknowledges and agrees that the Processor may engage the following sub-processors:</p>
<table class="dpa-table">
  <thead><tr><th>Sub-Processor</th><th>Purpose</th><th>Location</th></tr></thead>
  <tbody>
    <tr><td>Amazon Web Services (AWS)</td><td>Cloud infrastructure, hosting</td><td>EU / US</td></tr>
    <tr><td>Flutterwave</td><td>Payment processing</td><td>Nigeria / Global</td></tr>
    <tr><td>MTN Mobile Money</td><td>Mobile payment processing</td><td>Uganda</td></tr>
    <tr><td>Africa's Talking</td><td>SMS and USSD services</td><td>Kenya / Uganda</td></tr>
    <tr><td>SendGrid</td><td>Email delivery</td><td>US / EU</td></tr>
  </tbody>
</table>
<p style="margin-top:12px">The Processor shall notify the Controller of any intended changes concerning the addition or replacement of sub-processors, giving the Controller the opportunity to object to such changes.</p></div>

<div class="dpa-section"><h2>7. Contact Information</h2>
<p>For all DPA-related inquiries:</p>
<ul style="list-style:none;padding:0;margin-top:8px">
  <li style="margin-bottom:6px">📧 <strong>Email:</strong> dpa@comfort.ug</li>
  <li style="margin-bottom:6px">📬 <strong>Address:</strong> Ssewasswa Technologies Ltd, Kampala, Uganda</li>
  <li style="margin-bottom:6px">📞 <strong>Phone:</strong> +256 700 000 000</li>
</ul></div>

<div style="text-align:center;margin:32px 0">
  <a href="#" class="dpa-download" onclick="alert('PDF download will be available soon. Contact dpa@comfort.ug for a signed copy.');return false;">📄 Download as PDF</a>
</div>

</div></section>
</main>
${footer}${cookie}${getLiveChatWidget()}${getBackToTopButton()}${getPublicScripts()}
</body></html>`;
    res.send(html);
  });

};
