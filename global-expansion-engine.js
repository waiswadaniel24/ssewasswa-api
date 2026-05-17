// ============================================================
// === GLOBAL EXPANSION ENGINE — Comfort Zone SaaS Platform ===
// ============================================================
// Multi-Language i18n, Multi-Currency, Timezone Handling,
// Phone OTP Verification, Social Login (Facebook, Apple),
// Payment Gateways (Flutterwave, Paystack, PayPal),
// Global Public API, Global Landing Page
// ============================================================
// Self-executing module — uses globals set by server.js:
//   app, pool, ah, esc, renderPage, requireAuth,
//   migrations, VALID_TABLES, sendEmail, sendSMS
// ============================================================

// ============================================================
// 1. DATABASE MIGRATIONS
// ============================================================
const GE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS translations (
    id SERIAL PRIMARY KEY, tenant_id INTEGER DEFAULT 0,
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    key VARCHAR(255) NOT NULL, value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(locale, key)
  )`,
  `CREATE TABLE IF NOT EXISTS user_preferences (
    email TEXT NOT NULL, tenant_id INTEGER DEFAULT 0,
    locale TEXT DEFAULT 'en',
    timezone TEXT DEFAULT 'Africa/Kampala',
    currency TEXT DEFAULT 'UGX',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, tenant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_rates (
    currency VARCHAR(10) PRIMARY KEY,
    rate_usd NUMERIC(16,6) NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS phone_verifications (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(6) NOT NULL,
    verified BOOLEAN DEFAULT false,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS payment_gateways (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER DEFAULT 0,
    gateway_name VARCHAR(50) NOT NULL,
    config JSONB DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_translations_locale ON translations(locale)`,
  `CREATE INDEX IF NOT EXISTS idx_translations_key ON translations(key)`,
  `CREATE INDEX IF NOT EXISTS idx_translations_tenant ON translations(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_prefs_email ON user_preferences(email)`,
  `CREATE INDEX IF NOT EXISTS idx_phone_verif_phone ON phone_verifications(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_phone_verif_code ON phone_verifications(code, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_gateways_tenant ON payment_gateways(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(currency)`
];
GE_MIGRATIONS.forEach(m => migrations.push(m));
[
  'translations', 'user_preferences', 'exchange_rates',
  'phone_verifications', 'payment_gateways'
].forEach(t => VALID_TABLES.add(t));

// ============================================================
// 2. CONSTANTS & CONFIGURATION
// ============================================================

const SUPPORTED_LOCALES = ['en', 'sw', 'fr', 'ar', 'es', 'hi', 'zh', 'pt', 'am'];
const LOCALE_NAMES = {
  en: 'English', sw: 'Swahili (Kiswahili)', fr: 'French (Fran\u00e7ais)',
  ar: 'Arabic (\u0627\u0644\u0639\u0631\u0628\u064a\u0629)', es: 'Spanish (Espa\u00f1ol)',
  hi: 'Hindi (\u0939\u093f\u0928\u094d\u0926\u0940)', zh: 'Chinese (\u4e2d\u6587)',
  pt: 'Portuguese (Portugu\u00eas)', am: 'Amharic (\u12a0\u121b\u122d\u129b)'
};
const RTL_LOCALES = ['ar'];

const CURRENCY_RATES = {
  USD: 1, EUR: 0.92, GBP: 0.79, UGX: 3720, KES: 153.5, TZS: 2535,
  RWF: 1270, BWP: 13.65, NGN: 1585, ZAR: 18.9, GHS: 14.8, ETB: 56.5
};
const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '\u20ac', GBP: '\u00a3', UGX: 'UGX', KES: 'KES',
  TZS: 'TZS', RWF: 'FRW', BWP: 'P', NGN: '\u20a6', ZAR: 'R',
  GHS: 'GH\u20b5', ETB: 'Br'
};
const CURRENCY_LOCALES = {
  USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', UGX: 'en-UG',
  KES: 'en-KE', TZS: 'sw-TZ', RWF: 'rw-RW', BWP: 'en-BW',
  NGN: 'en-NG', ZAR: 'en-ZA', GHS: 'en-GH', ETB: 'am-ET'
};

const AFRICA_TIMEZONES = {
  'Africa/Kampala': { offset: '+03:00', country: 'Uganda', abbr: 'EAT' },
  'Africa/Nairobi': { offset: '+03:00', country: 'Kenya', abbr: 'EAT' },
  'Africa/Dar_es_Salaam': { offset: '+03:00', country: 'Tanzania', abbr: 'EAT' },
  'Africa/Kigali': { offset: '+02:00', country: 'Rwanda', abbr: 'CAT' },
  'Africa/Bujumbura': { offset: '+02:00', country: 'Burundi', abbr: 'CAT' },
  'Africa/Addis_Ababa': { offset: '+03:00', country: 'Ethiopia', abbr: 'EAT' },
  'Africa/Lagos': { offset: '+01:00', country: 'Nigeria', abbr: 'WAT' },
  'Africa/Accra': { offset: '+00:00', country: 'Ghana', abbr: 'GMT' },
  'Africa/Johannesburg': { offset: '+02:00', country: 'South Africa', abbr: 'SAST' },
  'Africa/Gaborone': { offset: '+02:00', country: 'Botswana', abbr: 'CAT' },
  'Africa/Cairo': { offset: '+02:00', country: 'Egypt', abbr: 'EET' },
  'Africa/Casablanca': { offset: '+01:00', country: 'Morocco', abbr: 'WET' },
  'Africa/Dakar': { offset: '+00:00', country: 'Senegal', abbr: 'GMT' },
  'Africa/Abidjan': { offset: '+00:00', country: 'C\u00f4te d\u0027Ivoire', abbr: 'GMT' },
  'Africa/Lusaka': { offset: '+02:00', country: 'Zambia', abbr: 'CAT' },
  'Africa/Harare': { offset: '+02:00', country: 'Zimbabwe', abbr: 'CAT' },
  'Africa/Maputo': { offset: '+02:00', country: 'Mozambique', abbr: 'CAT' },
  'Africa/Monrovia': { offset: '+00:00', country: 'Liberia', abbr: 'GMT' },
  'Africa/Tunis': { offset: '+01:00', country: 'Tunisia', abbr: 'CET' },
  'Africa/Algiers': { offset: '+01:00', country: 'Algeria', abbr: 'CET' }
};

const SUPPORTED_COUNTRIES = [
  { code: 'UG', name: 'Uganda', currency: 'UGX', locale: 'en', timezone: 'Africa/Kampala', flag: '\ud83c\uddfa\ud83c\uddec' },
  { code: 'KE', name: 'Kenya', currency: 'KES', locale: 'sw', timezone: 'Africa/Nairobi', flag: '\ud83c\uddf0\ud83c\uddea' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', locale: 'sw', timezone: 'Africa/Dar_es_Salaam', flag: '\ud83c\uddf9\ud83c\uddf2' },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', locale: 'en', timezone: 'Africa/Kigali', flag: '\ud83c\uddf7\ud83c\uddf4' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', locale: 'en', timezone: 'Africa/Lagos', flag: '\ud83c\uddf3\ud83c\uddec' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', locale: 'en', timezone: 'Africa/Accra', flag: '\ud83c\uddec\ud83c\udded' },
  { code: 'ET', name: 'Ethiopia', currency: 'ETB', locale: 'am', timezone: 'Africa/Addis_Ababa', flag: '\ud83c\uddea\ud83c\uddf9' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', locale: 'en', timezone: 'Africa/Johannesburg', flag: '\ud83c\uddff\ud83c\udde6' },
  { code: 'BW', name: 'Botswana', currency: 'BWP', locale: 'en', timezone: 'Africa/Gaborone', flag: '\ud83c\udde7\ud83c\uddfc' },
  { code: 'US', name: 'United States', currency: 'USD', locale: 'en', timezone: 'America/New_York', flag: '\ud83c\uddfa\ud83c\uddf8' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en', timezone: 'Europe/London', flag: '\ud83c\uddec\ud83c\udde7' },
  { code: 'FR', name: 'France', currency: 'EUR', locale: 'fr', timezone: 'Europe/Paris', flag: '\ud83c\uddeb\ud83c\uddf7' },
  { code: 'ES', name: 'Spain', currency: 'EUR', locale: 'es', timezone: 'Europe/Madrid', flag: '\ud83c\uddea\ud83c\uddf8' },
  { code: 'IN', name: 'India', currency: 'INR', locale: 'hi', timezone: 'Asia/Kolkata', flag: '\ud83c\uddee\ud83c\uddf3' },
  { code: 'CN', name: 'China', currency: 'CNY', locale: 'zh', timezone: 'Asia/Shanghai', flag: '\ud83c\udde8\ud83c\uddf3' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', locale: 'pt', timezone: 'America/Sao_Paulo', flag: '\ud83c\udde7\ud83c\uddf7' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', locale: 'ar', timezone: 'Africa/Cairo', flag: '\ud83c\uddea\ud83c\uddec' }
];

const SUPPORTED_INDUSTRIES = [
  { key: 'school', name: 'School / Education', desc: 'Primary, secondary, universities, vocational training' },
  { key: 'church', name: 'Church / Religious', desc: 'Churches, mosques, temples, faith-based organizations' },
  { key: 'hospital', name: 'Hospital / Clinic', desc: 'Hospitals, clinics, pharmacies, health centers' },
  { key: 'business', name: 'Business / Company', desc: 'SMEs, corporations, startups, agencies' },
  { key: 'restaurant', name: 'Restaurant / Hotel', desc: 'Restaurants, hotels, lodges, catering services' },
  { key: 'retail', name: 'Retail / Shop', desc: 'Supermarkets, shops, boutiques, wholesale' },
  { key: 'ngo', name: 'NGO / Nonprofit', desc: 'Non-governmental organizations, charities, foundations' },
  { key: 'government', name: 'Government', desc: 'Government agencies, local authorities, parastatals' },
  { key: 'farm', name: 'Farm / Agriculture', desc: 'Farms, cooperatives, agribusiness, veterinary' },
  { key: 'gym', name: 'Gym / Fitness', desc: 'Gyms, fitness centers, sports clubs, wellness' },
  { key: 'salon', name: 'Salon / Beauty', desc: 'Salons, barbershops, spas, beauty parlors' },
  { key: 'transport', name: 'Transport / Logistics', desc: 'Transport companies, logistics, courier services' },
  { key: 'real_estate', name: 'Real Estate', desc: 'Property management, real estate agencies, construction' },
  { key: 'legal', name: 'Legal / Law Firm', desc: 'Law firms, legal consultancies, compliance services' },
  { key: 'tech', name: 'Tech / IT', desc: 'IT companies, software development, tech startups' }
];

// ============================================================
// 3. DEFAULT TRANSLATIONS (50+ keys for common UI strings)
// ============================================================
const DEFAULT_TRANSLATIONS = {
  en: {
    nav_dashboard: 'Dashboard', nav_settings: 'Settings', nav_profile: 'Profile',
    nav_logout: 'Log Out', nav_login: 'Log In', nav_register: 'Register',
    action_save: 'Save', action_cancel: 'Cancel', action_delete: 'Delete',
    action_edit: 'Edit', action_create: 'Create', action_search: 'Search',
    action_submit: 'Submit', action_confirm: 'Confirm', action_back: 'Back',
    action_next: 'Next', action_close: 'Close', action_download: 'Download',
    action_upload: 'Upload', action_send: 'Send', action_copy: 'Copy',
    action_print: 'Print', action_export: 'Export', action_import: 'Import',
    action_view: 'View', action_add: 'Add', action_remove: 'Remove',
    label_name: 'Name', label_email: 'Email', label_phone: 'Phone',
    label_password: 'Password', label_confirm_password: 'Confirm Password',
    label_address: 'Address', label_city: 'City', label_country: 'Country',
    label_date: 'Date', label_time: 'Time', label_amount: 'Amount',
    label_description: 'Description', label_status: 'Status', label_type: 'Type',
    label_currency: 'Currency', label_language: 'Language', label_timezone: 'Timezone',
    label_role: 'Role', label_active: 'Active', label_inactive: 'Inactive',
    msg_saved: 'Saved successfully', msg_deleted: 'Deleted successfully',
    msg_updated: 'Updated successfully', msg_created: 'Created successfully',
    msg_error: 'An error occurred. Please try again.',
    msg_loading: 'Loading...', msg_no_data: 'No data found',
    msg_confirm_delete: 'Are you sure you want to delete this?',
    msg_welcome: 'Welcome back', msg_goodbye: 'See you next time',
    payment_pending: 'Pending', payment_completed: 'Completed',
    payment_failed: 'Failed', payment_cancelled: 'Cancelled',
    otp_sent: 'Verification code sent to your phone',
    otp_verified: 'Phone number verified successfully',
    otp_expired: 'Verification code has expired',
    otp_invalid: 'Invalid verification code',
    otp_max_attempts: 'Maximum attempts exceeded. Please request a new code.',
    landing_hero: 'Built for Africa, Ready for the World',
    landing_sub: 'The all-in-one management platform designed for African businesses, schools, churches, and organizations',
    landing_cta: 'Get Started Free',
    landing_languages: 'Available in 9+ Languages',
    landing_currencies: 'Multi-Currency Support',
    landing_mobile: 'Mobile-First Design'
  },
  sw: {
    nav_dashboard: 'Dashibodi', nav_settings: 'Mipangilio', nav_profile: 'Wasifu',
    nav_logout: 'Toka', nav_login: 'Ingia', nav_register: 'Jisajili',
    action_save: 'Hifadhi', action_cancel: 'Ghairi', action_delete: 'Futa',
    action_edit: 'Hariri', action_create: 'Unda', action_search: 'Tafuta',
    action_submit: 'Wasilisha', action_confirm: 'Thibitisha', action_back: 'Nyuma',
    action_next: 'Mbele', action_close: 'Funga', action_send: 'Tuma',
    label_name: 'Jina', label_email: 'Barua Pepe', label_phone: 'Simu',
    label_password: 'Nenosiri', label_date: 'Tarehe', label_time: 'Wakati',
    label_amount: 'Kiasi', label_description: 'Maelezo', label_status: 'Hali',
    label_country: 'Nchi', label_language: 'Lugha', label_currency: 'Fedha',
    msg_saved: 'Umehifadhi vizuri', msg_deleted: 'Umefuta vizuri',
    msg_updated: 'Umesasisha vizuri', msg_error: 'Kuna hitilafu. Tafadhali jaribu tena.',
    msg_loading: 'Inapakia...', msg_no_data: 'Hakuna data iliyopatikana',
    msg_confirm_delete: 'Una uhakika unataka kufuta hii?',
    msg_welcome: 'Karibu tena', payment_pending: 'Inasubiri',
    payment_completed: 'Imekamilika', payment_failed: 'Imeshindwa',
    otp_sent: 'Kodi ya uthibitisho imetumwa kwenye simu yako',
    otp_verified: 'Nambari ya simu imehakikishwa',
    otp_expired: 'Kodi ya uthibitisho imekwishwa muda wake',
    otp_invalid: 'Kodi ya uthibitisho si sahihi',
    landing_hero: 'Iliyoundwa kwa Afrika, Tayari kwa Dunia',
    landing_sub: 'Jukwaa la usimamizi lote-katika-moja lililoundwa kwa biashara, shule, makanisa na mashirika ya Afrika',
    landing_cta: 'Anza Bure',
    landing_languages: 'Inapatikana kwa Lugha 9+',
    landing_currencies: 'Msaada wa Fedha Nyingi',
    landing_mobile: 'Muundo wa Simu Kwanza'
  },
  fr: {
    nav_dashboard: 'Tableau de bord', nav_settings: 'Param\u00e8tres', nav_profile: 'Profil',
    nav_logout: 'D\u00e9connexion', nav_login: 'Connexion', nav_register: 'Inscription',
    action_save: 'Enregistrer', action_cancel: 'Annuler', action_delete: 'Supprimer',
    action_edit: 'Modifier', action_create: 'Cr\u00e9er', action_search: 'Rechercher',
    action_submit: 'Soumettre', action_confirm: 'Confirmer', action_back: 'Retour',
    label_name: 'Nom', label_email: 'E-mail', label_phone: 'T\u00e9l\u00e9phone',
    label_password: 'Mot de passe', label_date: 'Date', label_amount: 'Montant',
    label_description: 'Description', label_status: 'Statut', label_country: 'Pays',
    msg_saved: 'Enregistr\u00e9 avec succ\u00e8s', msg_deleted: 'Supprim\u00e9 avec succ\u00e8s',
    msg_error: 'Une erreur s\'est produite. Veuillez r\u00e9essayer.',
    msg_loading: 'Chargement...', msg_no_data: 'Aucune donn\u00e9e trouv\u00e9e',
    msg_welcome: 'Bienvenue', payment_pending: 'En attente',
    payment_completed: 'Termin\u00e9', payment_failed: '\u00c9chou\u00e9',
    otp_sent: 'Code de v\u00e9rification envoy\u00e9 \u00e0 votre t\u00e9l\u00e9phone',
    otp_verified: 'Num\u00e9ro de t\u00e9l\u00e9phone v\u00e9rifi\u00e9',
    landing_hero: 'Con\u00e7u pour l\'Afrique, Pr\u00eat pour le Monde',
    landing_sub: 'La plateforme de gestion tout-en-un con\u00e7ue pour les entreprises, \u00e9coles et organisations africaines',
    landing_cta: 'Commencer gratuitement'
  },
  ar: {
    nav_dashboard: '\u0644\u0648\u062d\u0629 \u0627\u0644\u0642\u064a\u0627\u062f\u0629', nav_settings: '\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a', nav_profile: '\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062e\u0635\u064a',
    nav_logout: '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c', nav_login: '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644', nav_register: '\u0627\u0644\u062a\u0633\u062c\u064a\u0644',
    action_save: '\u062d\u0641\u0638', action_cancel: '\u0625\u0644\u063a\u0627\u0621', action_delete: '\u062d\u0630\u0641',
    action_edit: '\u062a\u0639\u062f\u064a\u0644', action_create: '\u0625\u0646\u0634\u0627\u0621', action_search: '\u0628\u062d\u062b',
    label_name: '\u0627\u0644\u0627\u0633\u0645', label_email: '\u0627\u0644\u0628\u0631\u064a\u062f \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a', label_phone: '\u0627\u0644\u0647\u0627\u062a\u0641',
    label_password: '\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631', label_date: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e', label_amount: '\u0627\u0644\u0645\u0628\u0644\u063a',
    msg_saved: '\u062a\u0645 \u0627\u0644\u062d\u0641\u0638 \u0628\u0646\u062c\u0627\u062d', msg_error: '\u062d\u062f\u062b \u062e\u0637\u0623. \u064a\u0631\u062c\u0649 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.',
    msg_loading: '\u062c\u0627\u0631 \u0627\u0644\u062a\u062d\u0645\u064a\u0644...', msg_no_data: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a',
    msg_welcome: '\u0645\u0631\u062d\u0628\u0627 \u0628\u0643', payment_pending: '\u0642\u064a\u062f \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631',
    payment_completed: '\u0627\u0643\u062a\u0645\u0644', payment_failed: '\u0641\u0634\u0644',
    otp_sent: '\u062a\u0645 \u0625\u0631\u0633\u0627\u0644 \u0631\u0645\u0632 \u0627\u0644\u062a\u062d\u0642\u0642 \u0625\u0644\u0649 \u0647\u0627\u062a\u0641\u0643',
    landing_hero: '\u0645\u0635\u0645\u0645 \u0644\u0623\u0641\u0631\u064a\u0642\u064a\u0627\u060c \u062c\u0627\u0647\u0632 \u0644\u0644\u0639\u0627\u0644\u0645',
    landing_cta: '\u0627\u0628\u062f\u0623 \u0645\u062c\u0627\u0646\u0627\u064b'
  },
  es: {
    nav_dashboard: 'Panel', nav_settings: 'Configuraci\u00f3n', nav_profile: 'Perfil',
    nav_logout: 'Cerrar sesi\u00f3n', nav_login: 'Iniciar sesi\u00f3n', nav_register: 'Registrarse',
    action_save: 'Guardar', action_cancel: 'Cancelar', action_delete: 'Eliminar',
    action_edit: 'Editar', action_create: 'Crear', action_search: 'Buscar',
    label_name: 'Nombre', label_email: 'Correo electr\u00f3nico', label_phone: 'Tel\u00e9fono',
    label_password: 'Contrase\u00f1a', label_date: 'Fecha', label_amount: 'Monto',
    msg_saved: 'Guardado con \u00e9xito', msg_error: 'Ocurri\u00f3 un error. Intente de nuevo.',
    msg_loading: 'Cargando...', msg_no_data: 'No se encontraron datos',
    msg_welcome: 'Bienvenido', payment_pending: 'Pendiente',
    payment_completed: 'Completado', payment_failed: 'Fallido',
    otp_sent: 'C\u00f3digo de verificaci\u00f3n enviado a tu tel\u00e9fono',
    landing_hero: 'Hecho para \u00c1frica, Listo para el Mundo',
    landing_cta: 'Comenzar gratis'
  },
  hi: {
    nav_dashboard: '\u0921\u0948\u0936\u092c\u094b\u0930\u094d\u0921', nav_settings: '\u0938\u0947\u091f\u093f\u0902\u0917\u094d\u0938', nav_profile: '\u092a\u094d\u0930\u094b\u092b\u093e\u0907\u0932',
    nav_logout: '\u0932\u0949\u0917 \u0906\u0909\u091f', nav_login: '\u0932\u0949\u0917 \u0907\u0928', nav_register: '\u0930\u091c\u093f\u0938\u094d\u091f\u0930',
    action_save: '\u0938\u0947\u0935 \u0915\u0930\u0947\u0902', action_cancel: '\u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902', action_delete: '\u0939\u091f\u093e\u090f\u0902',
    action_edit: '\u0938\u0902\u092a\u093e\u0926\u093f\u0924 \u0915\u0930\u0947\u0902', action_create: '\u092c\u0928\u093e\u090f\u0902', action_search: '\u0916\u094b\u091c\u0947\u0902',
    label_name: '\u0928\u093e\u092e', label_email: '\u0908\u092e\u0947\u0932', label_phone: '\u092b\u094b\u0928',
    label_password: '\u092a\u093e\u0938\u0935\u0930\u094d\u0921', label_date: '\u0924\u093e\u0930\u0940\u0916', label_amount: '\u0930\u093e\u0936\u093f',
    msg_saved: '\u0938\u092b\u0932\u0924\u093e\u092a\u0942\u0930\u094d\u0935\u0915 \u0938\u0939\u0947\u091c\u093e \u0917\u092f\u093e', msg_error: '\u0917\u0932\u0924\u0940 \u0939\u0941\u0908\u0964 \u0915\u0943\u092a\u092f\u093e \u092a\u0941\u0928\u0903 \u092a\u094d\u0930\u092f\u093e\u0938 \u0915\u0930\u0947\u0902\u0964',
    msg_loading: '\u0932\u094b\u0921 \u0939\u094b \u0930\u0939\u093e \u0939\u0948...', msg_welcome: '\u0938\u094d\u0935\u093e\u0917\u0924 \u0939\u0948',
    payment_pending: '\u0932\u0902\u092c\u093f\u0924', payment_completed: '\u092a\u0942\u0930\u094d\u0923',
    landing_hero: '\u0905\u092b\u094d\u0930\u0940\u0915\u093e \u0915\u0947 \u0932\u093f\u090f, \u0926\u0941\u0928\u093f\u092f\u093e \u0915\u0947 \u0932\u093f\u090f \u0924\u0948\u092f\u093e\u0930',
    landing_cta: '\u092e\u0941\u092b\u094d\u0924 \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902'
  },
  zh: {
    nav_dashboard: '\u4eea\u8868\u677f', nav_settings: '\u8bbe\u7f6e', nav_profile: '\u4e2a\u4eba\u8d44\u6599',
    nav_logout: '\u9000\u51fa', nav_login: '\u767b\u5f55', nav_register: '\u6ce8\u518c',
    action_save: '\u4fdd\u5b58', action_cancel: '\u53d6\u6d88', action_delete: '\u5220\u9664',
    action_edit: '\u7f16\u8f91', action_create: '\u521b\u5efa', action_search: '\u641c\u7d22',
    label_name: '\u59d3\u540d', label_email: '\u90ae\u7bb1', label_phone: '\u7535\u8bdd',
    label_password: '\u5bc6\u7801', label_date: '\u65e5\u671f', label_amount: '\u91d1\u989d',
    msg_saved: '\u4fdd\u5b58\u6210\u529f', msg_error: '\u53d1\u751f\u9519\u8bef\uff0c\u8bf7\u91cd\u8bd5\u3002',
    msg_loading: '\u52a0\u8f7d\u4e2d...', msg_welcome: '\u6b22\u8fce\u56de\u6765',
    payment_pending: '\u5f85\u5904\u7406', payment_completed: '\u5df2\u5b8c\u6210',
    landing_hero: '\u4e3a\u975e\u6d32\u800c\u5efa\uff0c\u8d70\u5411\u5168\u7403',
    landing_cta: '\u514d\u8d39\u5f00\u59cb'
  },
  pt: {
    nav_dashboard: 'Painel', nav_settings: 'Configura\u00e7\u00f5es', nav_profile: 'Perfil',
    nav_logout: 'Sair', nav_login: 'Entrar', nav_register: 'Registar',
    action_save: 'Guardar', action_cancel: 'Cancelar', action_delete: 'Eliminar',
    action_edit: 'Editar', action_create: 'Criar', action_search: 'Pesquisar',
    label_name: 'Nome', label_email: 'E-mail', label_phone: 'Telefone',
    label_password: 'Palavra-passe', label_date: 'Data', label_amount: 'Montante',
    msg_saved: 'Guardado com sucesso', msg_error: 'Ocorreu um erro. Tente novamente.',
    msg_loading: 'A carregar...', msg_welcome: 'Bem-vindo',
    payment_pending: 'Pendente', payment_completed: 'Conclu\u00eddo',
    landing_hero: 'Feito para \u00c1frica, Pronto para o Mundo',
    landing_cta: 'Comece gr\u00e1tis'
  },
  am: {
    nav_dashboard: '\u12e8\u12b3\u12eb\u12a5\u1295 \u1201\u12ed\u122b', nav_settings: '\u1235\u1270\u120b\u12ce', nav_profile: '\u1218\u12c8\u1235',
    nav_logout: '\u12e8\u1235\u1240 \u1218\u1308\u1235', nav_login: '\u12e8\u1235\u1240 \u121c\u1208\u1228', nav_register: '\u1235\u121d\u122d\u122b',
    action_save: '\u12a0\u1200\u1295', action_cancel: '\u1213\u1260\u122a\u1235', action_delete: '\u1218\u1308\u1235',
    action_edit: '\u1218\u1235\u122b\u1218\u1235', action_create: '\u12a0\u120b\u122b', action_search: '\u1235\u121d\u1270\u1275',
    label_name: '\u1235\u121d', label_email: '\u12a0-\u1218\u12c8\u1295', label_phone: '\u1275\u1208\u1218',
    label_password: '\u1235\u12ad\u1295 \u1270\u1300\u122b', label_date: '\u12ae\u1260\u1268', label_amount: '\u1296\u1202\u1275',
    msg_saved: '\u12a0\u1200\u129b \u121c\u12ed\u1295\u122d \u12a0\u1200\u122b', msg_error: '\u1242\u1275 \u12a0\u1263\u12ad\u1291\u121b\u1295 \u12a0\u1218\u120b\u1295\u1208\u121d\u1295\u1202\u121d \u12a0\u121d\u120b\u1208\u12eb\u1295\u1202\u121d\u1295\u121b\u1295\u120d\u1295',
    msg_welcome: '\u12a0\u1295\u12ab\u1235\u12ad \u12a0\u121d\u12c8\u1293', payment_pending: '\u122b\u1218\u122a\u121d \u12a0\u1240\u122b',
    payment_completed: '\u12a0\u1295\u1218\u121d \u12a0\u1200\u122b',
    landing_hero: '\u1208\u122b \u12e4\u1272\u12ab \u12a5\u12ea \u12b8\u12ab\u1293\u1295\u121d \u12a0\u12a8\u121e\u1293\u1295\u121d',
    landing_cta: '\u12a0\u1298\u120b \u12a0\u1295\u12ab\u12c8\u122b\u121d \u1295\u121c\u12cd\u1295'
  }
};

// Translation cache for performance
const _translationCache = new Map();

// ============================================================
// 4. HELPER FUNCTIONS
// ============================================================

/**
 * Translate a key to the requested locale, falling back to English.
 * Checks DB translations first, then DEFAULT_TRANSLATIONS.
 */
async function t(key, locale) {
  locale = (locale || 'en').substring(0, 2).toLowerCase();
  if (!SUPPORTED_LOCALES.includes(locale)) locale = 'en';
  const cacheKey = locale + ':' + key;

  if (_translationCache.has(cacheKey)) return _translationCache.get(cacheKey);

  try {
    const result = await pool.query(
      'SELECT value FROM translations WHERE locale=$1 AND key=$2 LIMIT 1', [locale, key]
    );
    if (result.rows.length > 0) {
      _translationCache.set(cacheKey, result.rows[0].value);
      return result.rows[0].value;
    }
  } catch (e) { /* DB may not be ready yet */ }

  const fallback = DEFAULT_TRANSLATIONS[locale]?.[key] || DEFAULT_TRANSLATIONS.en?.[key] || key;
  _translationCache.set(cacheKey, fallback);
  return fallback;
}

/** Synchronous version using only DEFAULT_TRANSLATIONS (no DB) */
function tSync(key, locale) {
  locale = (locale || 'en').substring(0, 2).toLowerCase();
  if (!SUPPORTED_LOCALES.includes(locale)) locale = 'en';
  return DEFAULT_TRANSLATIONS[locale]?.[key] || DEFAULT_TRANSLATIONS.en?.[key] || key;
}

/**
 * Convert amount from one currency to another.
 * Uses DB rates if available, otherwise falls back to built-in CURRENCY_RATES.
 */
async function convertCurrency(amount, from, to) {
  from = (from || 'UGX').toUpperCase();
  to = (to || 'USD').toUpperCase();
  if (from === to) return amount;

  try {
    const rows = (await pool.query(
      'SELECT currency, rate_usd FROM exchange_rates WHERE currency IN ($1, $2)',
      [from, to]
    )).rows;
    if (rows.length === 2) {
      const fromRate = rows.find(r => r.currency === from)?.rate_usd;
      const toRate = rows.find(r => r.currency === to)?.rate_usd;
      if (fromRate && toRate) return (amount / fromRate) * toRate;
    }
  } catch (e) { /* fallback to built-in */ }

  const fromRate = CURRENCY_RATES[from] || 1;
  const toRate = CURRENCY_RATES[to] || 1;
  return (amount / fromRate) * toRate;
}

/**
 * Format amount with currency symbol and proper locale formatting.
 */
function formatCurrency(amount, currency) {
  currency = (currency || 'UGX').toUpperCase();
  const amt = parseFloat(amount) || 0;
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const loc = CURRENCY_LOCALES[currency] || 'en-US';
  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency', currency: currency,
      minimumFractionDigits: currency === 'UGX' ? 0 : 2,
      maximumFractionDigits: currency === 'UGX' ? 0 : 2
    }).format(amt);
  } catch (e) {
    return symbol + ' ' + amt.toLocaleString();
  }
}

/**
 * Format a date in a specific timezone.
 */
function formatDate(date, timezone, format) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  timezone = timezone || 'Africa/Kampala';
  try {
    const opts = { timeZone: timezone };
    if (format === 'time') {
      opts.hour = '2-digit'; opts.minute = '2-digit'; opts.hour12 = true;
      return d.toLocaleTimeString('en-US', opts);
    }
    if (format === 'datetime') {
      opts.year = 'numeric'; opts.month = 'short'; opts.day = '2-digit';
      opts.hour = '2-digit'; opts.minute = '2-digit'; opts.hour12 = true;
      return d.toLocaleString('en-US', opts);
    }
    if (format === 'short') {
      opts.month = 'short'; opts.day = 'numeric'; opts.year = 'numeric';
      return d.toLocaleDateString('en-US', opts);
    }
    opts.year = 'numeric'; opts.month = '2-digit'; opts.day = '2-digit';
    return d.toLocaleDateString('en-US', opts);
  } catch (e) {
    return d.toLocaleDateString();
  }
}

/**
 * Get user timezone from user_preferences.
 */
async function getUserTimezone(userEmail) {
  try {
    const result = await pool.query(
      'SELECT timezone FROM user_preferences WHERE email=$1 LIMIT 1', [userEmail]
    );
    if (result.rows.length > 0 && result.rows[0].timezone) return result.rows[0].timezone;
  } catch (e) { /* ignore */ }
  return 'Africa/Kampala';
}

/**
 * Generate a 6-digit OTP code.
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Detect locale from Accept-Language header.
 */
function detectLocaleFromHeader(acceptLang) {
  if (!acceptLang) return 'en';
  const langs = acceptLang.split(',').map(l => l.split(';')[0].trim().substring(0, 2).toLowerCase());
  for (const lang of langs) {
    if (SUPPORTED_LOCALES.includes(lang)) return lang;
  }
  return 'en';
}

/**
 * Express middleware: detect and set req.locale from query, cookie, or header.
 */
function detectLocale(req, res, next) {
  let locale = 'en';
  // 1. Explicit query param ?locale=sw
  if (req.query.locale && SUPPORTED_LOCALES.includes(req.query.locale.substring(0, 2))) {
    locale = req.query.locale.substring(0, 2);
  }
  // 2. Cookie
  else if (req.cookies && req.cookies.locale && SUPPORTED_LOCALES.includes(req.cookies.locale)) {
    locale = req.cookies.locale;
  }
  // 3. Accept-Language header
  else {
    locale = detectLocaleFromHeader(req.headers['accept-language']);
  }
  req.locale = locale;
  req.isRTL = RTL_LOCALES.includes(locale);
  next();
}

/**
 * Express middleware: attach user preferences to request.
 */
async function attachUserPrefs(req, res, next) {
  if (req.session && req.session.user && req.session.user.email) {
    try {
      const result = await pool.query(
        'SELECT locale, timezone, currency FROM user_preferences WHERE email=$1 AND tenant_id=$2',
        [req.session.user.email, req.session.user.tenant_id || 0]
      );
      if (result.rows.length > 0) {
        req.userPrefs = result.rows[0];
        req.locale = req.userPrefs.locale || req.locale || 'en';
      }
    } catch (e) { /* ignore */ }
  }
  next();
}

// ============================================================
// 5. SEED EXCHANGE RATES INTO DB
// ============================================================
(async () => {
  try {
    for (const [currency, rate] of Object.entries(CURRENCY_RATES)) {
      await pool.query(
        `INSERT INTO exchange_rates (currency, rate_usd) VALUES ($1, $2)
         ON CONFLICT (currency) DO UPDATE SET rate_usd = $2, last_updated = NOW()`,
        [currency, rate]
      );
    }
    console.log('[GlobalExpansion] Exchange rates seeded: ' + Object.keys(CURRENCY_RATES).length + ' currencies');
  } catch (e) {
    console.log('[GlobalExpansion] Exchange rates seed deferred (DB not ready)');
  }
})();

// ============================================================
// 6. AUTO-UPDATE EXCHANGE RATES DAILY
// ============================================================
async function refreshExchangeRates() {
  try {
    const currencies = Object.keys(CURRENCY_RATES).join(',');
    const fetch = globalThis.fetch || require('node-fetch');
    const resp = await fetch(
      `https://api.exchangerate-api.com/v4/latest/USD`
    ).catch(() => null);
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data && data.rates) {
        for (const [currency, rate] of Object.entries(CURRENCY_RATES)) {
          if (data.rates[currency]) {
            await pool.query(
              `INSERT INTO exchange_rates (currency, rate_usd) VALUES ($1, $2)
               ON CONFLICT (currency) DO UPDATE SET rate_usd = $2, last_updated = NOW()`,
              [currency, data.rates[currency]]
            );
          }
        }
        console.log('[GlobalExpansion] Exchange rates auto-updated from API');
      }
    }
  } catch (e) {
    // Silently fail — built-in rates will be used
  }
}

// Refresh every 24 hours (86400000 ms)
setTimeout(function dailyRefresh() {
  refreshExchangeRates();
  setTimeout(dailyRefresh, 86400000);
}, 60000); // first refresh after 1 minute

// ============================================================
// 7. ROUTES — MULTI-LANGUAGE / i18n
// ============================================================

// GET /api/locale/:code — switch language for session
app.get('/api/locale/:code', ah(async (req, res) => {
  const code = req.params.code.substring(0, 2).toLowerCase();
  if (!SUPPORTED_LOCALES.includes(code)) {
    return res.status(400).json({ error: 'Unsupported locale', supported: SUPPORTED_LOCALES });
  }
  // Store in user preferences if logged in
  if (req.session && req.session.user && req.session.user.email) {
    await pool.query(
      `INSERT INTO user_preferences (email, tenant_id, locale) VALUES ($1, $2, $3)
       ON CONFLICT (email, tenant_id) DO UPDATE SET locale = $3`,
      [req.session.user.email, req.session.user.tenant_id || 0, code]
    );
  }
  // Set cookie
  res.cookie('locale', code, { maxAge: 365 * 24 * 3600000, httpOnly: false });
  res.json({ locale: code, name: LOCALE_NAMES[code] || code, rtl: RTL_LOCALES.includes(code) });
}));

// GET /api/translations?locale=sw — get all translations for a locale
app.get('/api/translations', ah(async (req, res) => {
  const locale = (req.query.locale || 'en').substring(0, 2).toLowerCase();
  if (!SUPPORTED_LOCALES.includes(locale)) {
    return res.status(400).json({ error: 'Unsupported locale', supported: SUPPORTED_LOCALES });
  }
  const dbRows = (await pool.query(
    'SELECT key, value FROM translations WHERE locale=$1', [locale]
  )).rows;

  const dbTranslations = {};
  dbRows.forEach(r => { dbTranslations[r.key] = r.value; });

  // Merge with defaults (DB overrides defaults)
  const merged = { ...(DEFAULT_TRANSLATIONS[locale] || DEFAULT_TRANSLATIONS.en), ...dbTranslations };
  res.json({ locale, count: Object.keys(merged).length, translations: merged });
}));

// POST /api/translations (admin) — set/update a translation
app.post('/api/translations', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { locale, key, value, tenant_id } = req.body;
  if (!locale || !key || !value) {
    return res.status(400).json({ error: 'locale, key, and value are required' });
  }
  const loc = locale.substring(0, 2).toLowerCase();
  if (!SUPPORTED_LOCALES.includes(loc)) {
    return res.status(400).json({ error: 'Unsupported locale', supported: SUPPORTED_LOCALES });
  }
  await pool.query(
    `INSERT INTO translations (locale, key, value, tenant_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (locale, key) DO UPDATE SET value = $3, tenant_id = $4`,
    [loc, key.substring(0, 255), value.substring(0, 5000), tenant_id || 0]
  );
  // Clear cache for this locale
  for (const [cacheKey] of _translationCache) {
    if (cacheKey.startsWith(loc + ':')) _translationCache.delete(cacheKey);
  }
  res.json({ success: true, locale: loc, key, value });
}));

// ============================================================
// 8. ROUTES — MULTI-CURRENCY
// ============================================================

// GET /api/exchange-rate?from=UGX&to=USD
app.get('/api/exchange-rate', ah(async (req, res) => {
  const from = (req.query.from || 'UGX').toUpperCase();
  const to = (req.query.to || 'USD').toUpperCase();
  if (!CURRENCY_RATES[from] && !CURRENCY_RATES[to]) {
    return res.status(400).json({ error: 'Unsupported currency', supported: Object.keys(CURRENCY_RATES) });
  }
  let fromRate, toRate, lastUpdated;
  try {
    const rows = (await pool.query(
      'SELECT currency, rate_usd, last_updated FROM exchange_rates WHERE currency IN ($1, $2)', [from, to]
    )).rows;
    if (rows.length > 0) {
      rows.forEach(r => {
        if (r.currency === from) fromRate = parseFloat(r.rate_usd);
        if (r.currency === to) toRate = parseFloat(r.rate_usd);
        lastUpdated = r.last_updated;
      });
    }
  } catch (e) { /* fallback */ }

  fromRate = fromRate || CURRENCY_RATES[from] || 1;
  toRate = toRate || CURRENCY_RATES[to] || 1;
  const rate = toRate / fromRate;

  res.json({
    from, to, rate: Math.round(rate * 1000000) / 1000000,
    inverted: Math.round((1 / rate) * 1000000) / 1000000,
    last_updated: lastUpdated || new Date().toISOString(),
    currencies_supported: Object.keys(CURRENCY_RATES)
  });
}));

// ============================================================
// 9. ROUTES — TIMEZONE
// ============================================================

// GET /api/timezones — list supported African timezones
app.get('/api/timezones', ah(async (req, res) => {
  res.json({ timezones: AFRICA_TIMEZONES });
}));

// POST /api/user-prefs — save user preferences (timezone, currency, locale)
app.post('/api/user-prefs', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { timezone, currency, locale } = req.body;
  if (!SUPPORTED_LOCALES.includes(locale || 'en')) {
    return res.status(400).json({ error: 'Unsupported locale' });
  }
  await pool.query(
    `INSERT INTO user_preferences (email, tenant_id, locale, timezone, currency) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email, tenant_id) DO UPDATE SET locale=$3, timezone=$4, currency=$5`,
    [user.email, user.tenant_id || 0,
     (locale || 'en').substring(0, 2),
     timezone || 'Africa/Kampala',
     (currency || 'UGX').toUpperCase()]
  );
  res.json({ success: true, locale, timezone, currency });
}));

// ============================================================
// 10. ROUTES — PHONE OTP VERIFICATION
// ============================================================

// POST /api/otp/send — send OTP via SMS
app.post('/api/otp/send', ah(async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.length < 8) {
    return res.status(400).json({ error: 'Valid phone number is required' });
  }
  const normalizedPhone = phone.replace(/[^0-9+]/g, '');
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Invalidate any previous unverified codes for this phone
  await pool.query(
    'UPDATE phone_verifications SET verified=false WHERE phone=$1 AND verified=false AND expires_at > NOW()',
    [normalizedPhone]
  );

  await pool.query(
    'INSERT INTO phone_verifications (phone, code, expires_at) VALUES ($1, $2, $3)',
    [normalizedPhone, code, expiresAt]
  );

  // Send SMS
  const message = `Your Comfort Zone verification code is ${code}. Valid for 5 minutes.`;
  try {
    if (typeof sendSMS === 'function') {
      await sendSMS(normalizedPhone, message);
    }
  } catch (e) {
    console.log('[GlobalExpansion] SMS send error:', e.message);
  }

  // In development, return the code for testing
  const isDev = process.env.NODE_ENV !== 'production';
  res.json({
    success: true,
    message: 'OTP sent to ' + normalizedPhone,
    expires_in: 300,
    ...(isDev ? { _dev_code: code } : {})
  });
}));

// POST /api/otp/verify — verify OTP code
app.post('/api/otp/verify', ah(async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone number and code are required' });
  }
  const normalizedPhone = phone.replace(/[^0-9+]/g, '');

  const record = (await pool.query(
    'SELECT * FROM phone_verifications WHERE phone=$1 AND code=$2 AND verified=false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
    [normalizedPhone, code.trim()]
  )).rows[0];

  if (!record) {
    // Check if expired or max attempts
    const lastRecord = (await pool.query(
      'SELECT * FROM phone_verifications WHERE phone=$1 ORDER BY created_at DESC LIMIT 1',
      [normalizedPhone]
    )).rows[0];

    if (lastRecord && lastRecord.attempts >= 3) {
      return res.status(429).json({ error: 'Maximum attempts exceeded. Please request a new code.' });
    }
    if (lastRecord && new Date(lastRecord.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Verification code has expired. Please request a new code.' });
    }
    return res.status(400).json({ error: 'Invalid verification code' });
  }

  // Increment attempts
  await pool.query(
    'UPDATE phone_verifications SET attempts=attempts+1 WHERE id=$1', [record.id]
  );

  // Verify
  await pool.query(
    'UPDATE phone_verifications SET verified=true WHERE id=$1', [record.id]
  );

  res.json({ success: true, message: 'Phone number verified successfully', phone: normalizedPhone });
}));

/** Helper: verify a phone number has been OTP-verified. Returns true/false. */
async function verifyPhone(phone) {
  if (!phone) return false;
  const normalizedPhone = phone.replace(/[^0-9+]/g, '');
  const record = (await pool.query(
    'SELECT id FROM phone_verifications WHERE phone=$1 AND verified=true ORDER BY created_at DESC LIMIT 1',
    [normalizedPhone]
  )).rows[0];
  return !!record;
}

// ============================================================
// 11. ROUTES — SOCIAL LOGIN (Facebook, Apple)
// ============================================================

// GET /auth/facebook — Facebook OAuth login (placeholder)
app.get('/auth/facebook', (req, res) => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Facebook Login — Coming Soon</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#4f46e5,#7c3aed);min-height:100vh;display:flex;align-items:center;justify-content:center;color:white}
    .card{background:white;color:#1e293b;border-radius:20px;padding:48px;max-width:480px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.2)}
    .icon{font-size:64px;margin-bottom:16px}h1{margin-bottom:8px;color:#1e293b}p{color:#64748b;margin-bottom:24px;line-height:1.6}
    .env-var{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;margin:8px 0;font-family:monospace;font-size:13px;text-align:left;color:#475569}
    .btn{display:inline-block;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:8px;transition:.2s}
    .btn-primary{background:#4f46e5;color:white}.btn-secondary{background:#f1f5f9;color:#475569}</style></head>
    <body><div class="card">
    <div class="icon">📘</div>
    <h1>Facebook Login</h1>
    <p>This feature is planned and will be available soon. It allows users to log in with their Facebook account.</p>
    <p style="font-size:13px;font-weight:600;color:#475569;margin-bottom:12px">Required environment variables:</p>
    <div class="env-var">FACEBOOK_APP_ID=your_app_id</div>
    <div class="env-var">FACEBOOK_APP_SECRET=your_app_secret</div>
    <div style="margin-top:20px">
      <a href="/" class="btn btn-primary">Go Home</a>
      <a href="/register" class="btn btn-secondary">Register with Email</a>
    </div></div></body></html>`;
  res.send(html);
});

// GET /auth/facebook/callback — Facebook OAuth callback (placeholder)
app.get('/auth/facebook/callback', (req, res) => {
  res.redirect('/auth/facebook');
});

// GET /auth/apple — Apple Sign-In (placeholder)
app.get('/auth/apple', (req, res) => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Apple Sign-In — Coming Soon</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#1e293b,#334155);min-height:100vh;display:flex;align-items:center;justify-content:center;color:white}
    .card{background:white;color:#1e293b;border-radius:20px;padding:48px;max-width:480px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.2)}
    .icon{font-size:64px;margin-bottom:16px}h1{margin-bottom:8px;color:#1e293b}p{color:#64748b;margin-bottom:24px;line-height:1.6}
    .env-var{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;margin:8px 0;font-family:monospace;font-size:13px;text-align:left;color:#475569}
    .btn{display:inline-block;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:8px;transition:.2s}
    .btn-primary{background:#1e293b;color:white}.btn-secondary{background:#f1f5f9;color:#475569}</style></head>
    <body><div class="card">
    <div class="icon">🍎</div>
    <h1>Apple Sign-In</h1>
    <p>This feature is planned and will be available soon. It allows users to sign in with their Apple ID.</p>
    <p style="font-size:13px;font-weight:600;color:#475569;margin-bottom:12px">Required environment variables:</p>
    <div class="env-var">APPLE_CLIENT_ID=your_service_id</div>
    <div class="env-var">APPLE_TEAM_ID=your_team_id</div>
    <div class="env-var">APPLE_KEY_ID=your_key_id</div>
    <div class="env-var">APPLE_PRIVATE_KEY_PATH=/path/to/AuthKey.p8</div>
    <div style="margin-top:20px">
      <a href="/" class="btn btn-primary">Go Home</a>
      <a href="/register" class="btn btn-secondary">Register with Email</a>
    </div></div></body></html>`;
  res.send(html);
});

// POST /auth/apple/callback — Apple Sign-In callback (POST, Apple sends JWT)
app.post('/auth/apple/callback', (req, res) => {
  // Apple sends a POST with a JWT identity token
  // In production, verify the JWT with Apple's public keys
  res.redirect('/auth/apple');
});

// ============================================================
// 12. ROUTES — PAYMENT GATEWAYS
// ============================================================

// Helper: render gateway "Configure" page
function renderGatewayConfigPage(name, icon, color, envVars, callbackUrl) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name} Payment — Comfort Zone</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:${color};min-height:100vh;display:flex;align-items:center;justify-content:center;color:white}
    .card{background:white;color:#1e293b;border-radius:20px;padding:48px;max-width:520px;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.2)}
    .icon{font-size:72px;margin-bottom:16px}h1{margin-bottom:8px;color:#1e293b}p{color:#64748b;margin-bottom:24px;line-height:1.6}
    .env-var{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;margin:6px 0;font-family:monospace;font-size:13px;text-align:left;color:#475569}
    .callback-url{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:10px 16px;margin:8px 0;font-family:monospace;font-size:12px;text-align:left;color:#065f46;word-break:break-all}
    .btn{display:inline-block;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:6px;transition:.2s}
    .btn-primary{background:${color};color:white}.btn-secondary{background:#f1f5f9;color:#475569}</style></head>
    <body><div class="card">
    <div class="icon">${icon}</div>
    <h1>${name}</h1>
    <p>Complete your ${name} setup in the admin panel to start accepting payments.</p>
    <p style="font-size:13px;font-weight:600;color:#475569;margin-bottom:12px">Required configuration:</p>
    ${envVars.map(v => `<div class="env-var">${esc(v)}</div>`).join('')}
    <p style="font-size:13px;font-weight:600;color:#065f46;margin-top:16px;margin-bottom:8px">Callback URL:</p>
    <div class="callback-url">${esc(callbackUrl)}</div>
    <div style="margin-top:20px">
      <a href="/admin/payment-gateways" class="btn btn-primary">Configure in Admin</a>
      <a href="/payments" class="btn btn-secondary">Payments Dashboard</a>
    </div></div></body></html>`;
  return html;
}

const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

// Flutterwave
app.get('/pay/flutterwave/:ref', (req, res) => {
  res.send(renderGatewayConfigPage(
    'Flutterwave', '\ud83d\udcb3', 'linear-gradient(135deg,#f97316,#ea580c)',
    ['FLUTTERWAVE_PUBLIC_KEY=pk_xxx', 'FLUTTERWAVE_SECRET_KEY=sk_xxx', 'FLUTTERWAVE_WEBHOOK_SECRET=whsec_xxx'],
    BASE_URL + '/pay/flutterwave/callback'
  ));
});
app.get('/pay/flutterwave/callback', ah(async (req, res) => {
  // In production, verify Flutterwave webhook signature and update payment status
  const txRef = req.query.tx_ref || req.query.reference || 'unknown';
  const fwStatus = req.query.status || '';
  const fwAmount = parseFloat(req.query.amount) || 0;
  if (fwStatus === 'successful' && fwAmount > 0) {
    // Track revenue for platform earnings
    try { await global.trackRevenue('flutterwave_payment', fwAmount, `Flutterwave payment: ${txRef}`, txRef); } catch(e) {}
  }
  res.send('Flutterwave callback received. Payment processing is handled internally.');
}));

// Paystack
app.get('/pay/paystack/:ref', (req, res) => {
  res.send(renderGatewayConfigPage(
    'Paystack', '\ud83d\udcb3', 'linear-gradient(135deg,#059669,#047857)',
    ['PAYSTACK_PUBLIC_KEY=pk_xxx', 'PAYSTACK_SECRET_KEY=sk_xxx', 'PAYSTACK_WEBHOOK_SECRET=whsec_xxx'],
    BASE_URL + '/pay/paystack/callback'
  ));
});
app.get('/pay/paystack/callback', ah(async (req, res) => {
  const psRef = req.query.reference || 'unknown';
  const psStatus = req.query.trans_status || req.query.status || '';
  const psAmount = (parseFloat(req.query.amount) || 0) / 100; // Paystack amounts are in kobo/cents
  if ((psStatus === 'success' || psStatus === 'successful') && psAmount > 0) {
    // Track revenue for platform earnings
    try { await global.trackRevenue('paystack_payment', psAmount, `Paystack payment: ${psRef}`, psRef); } catch(e) {}
  }
  res.send('Paystack callback received. Payment processing is handled internally.');
}));

// PayPal
app.get('/pay/paypal/:ref', (req, res) => {
  res.send(renderGatewayConfigPage(
    'PayPal', '\ud83d\udcb3', 'linear-gradient(135deg,#0070ba,#003087)',
    ['PAYPAL_CLIENT_ID=your_client_id', 'PAYPAL_CLIENT_SECRET=your_client_secret', 'PAYPAL_WEBHOOK_ID=whsec_xxx', 'PAYPAL_MODE=sandbox (or live)'],
    BASE_URL + '/pay/paypal/callback'
  ));
});
app.get('/pay/paypal/callback', (req, res) => {
  res.send('PayPal callback received. Payment processing is handled internally.');
});

// Admin: GET /admin/payment-gateways — configure payment gateways
app.get('/admin/payment-gateways', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return res.status(403).send('Admin access required');
  }
  const gateways = (await pool.query(
    'SELECT * FROM payment_gateways WHERE tenant_id=$1 ORDER BY gateway_name',
    [user.tenant_id || 0]
  )).rows;

  const knownGateways = [
    { name: 'flutterwave', label: 'Flutterwave', icon: '\ud83c\uddff\ud83c\udde6', color: '#f97316',
      envVars: ['FLUTTERWAVE_PUBLIC_KEY', 'FLUTTERWAVE_SECRET_KEY', 'FLUTTERWAVE_WEBHOOK_SECRET'] },
    { name: 'paystack', label: 'Paystack', icon: '\ud83c\uddf3\ud83c\uddec', color: '#059669',
      envVars: ['PAYSTACK_PUBLIC_KEY', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_WEBHOOK_SECRET'] },
    { name: 'paypal', label: 'PayPal', icon: '\ud83c\uddfa\ud83c\uddf8', color: '#0070ba',
      envVars: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'] }
  ];

  const gatewayRows = knownGateways.map(gw => {
    const saved = gateways.find(g => g.gateway_name === gw.name);
    return { ...gw, saved, is_enabled: saved?.is_enabled || false };
  });

  const html = `<div style="max-width:900px;margin:0 auto">
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>\ud83d\udcb3 Payment Gateways</h1>
      <p style="opacity:0.9;margin-top:4px">Configure Flutterwave, Paystack, and PayPal for your organization</p>
    </div>
    <div style="display:grid;gap:16px">
      ${gatewayRows.map(gw => `
        <div class="card" style="padding:24px;border-left:4px solid ${gw.color}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="font-size:32px">${gw.icon}</span>
              <div>
                <h3 style="margin:0;color:#1e293b">${esc(gw.label)}</h3>
                <span style="font-size:13px;color:${gw.is_enabled ? '#059669' : '#94a3b8'}">
                  ${gw.is_enabled ? '\u2705 Enabled' : '\u23f8 Disabled'}
                </span>
              </div>
            </div>
            <form method="POST" action="/admin/payment-gateways" style="display:inline">
              <input type="hidden" name="gateway_name" value="${esc(gw.name)}">
              <input type="hidden" name="is_enabled" value="${gw.is_enabled ? 'false' : 'true'}">
              <button type="submit" class="btn" style="background:${gw.is_enabled ? '#fee2e2;color:#dc2626' : '#dcfce7;color:#16a34a'}">
                ${gw.is_enabled ? 'Disable' : 'Enable'}
              </button>
            </form>
          </div>
          <details style="margin-top:8px">
            <summary style="cursor:pointer;font-size:14px;color:#4f46e5;font-weight:600">
              ${gw.saved ? 'View Configuration' : 'Configure Gateway'}
            </summary>
            <form method="POST" action="/admin/payment-gateways" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
              <input type="hidden" name="gateway_name" value="${esc(gw.name)}">
              <input type="hidden" name="save_config" value="true">
              ${gw.envVars.map(ev => `
                <div>
                  <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${esc(ev)}</label>
                  <input type="text" name="${esc(ev.toLowerCase())}"
                    value="${esc(gw.saved?.config?.[ev.toLowerCase()] || process.env[ev] || '')}"
                    placeholder="${esc(ev)}"
                    style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:monospace">
                </div>
              `).join('')}
              <button type="submit" class="btn" style="background:#4f46e5;color:white;align-self:flex-start">
                \ud83d\udcbe Save Configuration
              </button>
            </form>
          </details>
        </div>
      `).join('')}
    </div>
    <div style="margin-top:20px">
      <a href="/payments" class="btn">\u2190 Back to Payments</a>
    </div>
  </div>`;
  res.send(renderPage('Payment Gateways', html, user));
}));

// Admin: POST /admin/payment-gateways — save gateway config
app.post('/admin/payment-gateways', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return res.status(403).send('Admin access required');
  }
  const { gateway_name, is_enabled, save_config } = req.body;
  if (!gateway_name) return res.redirect('/admin/payment-gateways');

  if (save_config === 'true') {
    // Save configuration as JSONB
    const config = {};
    const envVarMap = {
      flutterwave: ['flutterwave_public_key', 'flutterwave_secret_key', 'flutterwave_webhook_secret'],
      paystack: ['paystack_public_key', 'paystack_secret_key', 'paystack_webhook_secret'],
      paypal: ['paypal_client_id', 'paypal_client_secret', 'paypal_webhook_id', 'paypal_mode']
    };
    (envVarMap[gateway_name] || []).forEach(k => {
      if (req.body[k]) config[k] = req.body[k];
    });
    await pool.query(
      `INSERT INTO payment_gateways (tenant_id, gateway_name, config, is_enabled) VALUES ($1, $2, $3, true)
       ON CONFLICT DO UPDATE SET config = $3`,
      [user.tenant_id || 0, gateway_name, JSON.stringify(config)]
    );
  } else {
    // Toggle enabled/disabled
    await pool.query(
      `INSERT INTO payment_gateways (tenant_id, gateway_name, is_enabled) VALUES ($1, $2, $3)
       ON CONFLICT DO UPDATE SET is_enabled = $3`,
      [user.tenant_id || 0, gateway_name, is_enabled === 'true']
    );
  }
  res.redirect('/admin/payment-gateways');
}));

// ============================================================
// 13. GLOBAL PUBLIC API (v2)
// ============================================================

// GET /api/v2/health — health check
app.get('/api/v2/health', ah(async (req, res) => {
  let dbStatus = 'unknown';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (e) {
    dbStatus = 'disconnected';
  }
  res.json({
    status: 'ok',
    service: 'Comfort Zone Global Expansion Engine',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    locales: SUPPORTED_LOCALES.length,
    currencies: Object.keys(CURRENCY_RATES).length,
    countries: SUPPORTED_COUNTRIES.length,
    uptime: process.uptime()
  });
}));

// GET /api/v2/countries — list supported countries
app.get('/api/v2/countries', ah(async (req, res) => {
  res.json({
    count: SUPPORTED_COUNTRIES.length,
    countries: SUPPORTED_COUNTRIES
  });
}));

// GET /api/v2/industries — list supported tenant types
app.get('/api/v2/industries', ah(async (req, res) => {
  res.json({
    count: SUPPORTED_INDUSTRIES.length,
    industries: SUPPORTED_INDUSTRIES
  });
}));

// GET /api/v2/currencies — list supported currencies
app.get('/api/v2/currencies', ah(async (req, res) => {
  let rates = {};
  try {
    const rows = (await pool.query('SELECT currency, rate_usd FROM exchange_rates ORDER BY currency')).rows;
    rows.forEach(r => { rates[r.currency] = parseFloat(r.rate_usd); });
  } catch (e) {
    rates = { ...CURRENCY_RATES };
  }
  res.json({ count: Object.keys(rates).length, rates, symbols: CURRENCY_SYMBOLS });
}));

// GET /api/v2/locales — list supported locales
app.get('/api/v2/locales', ah(async (req, res) => {
  res.json({
    count: SUPPORTED_LOCALES.length,
    locales: SUPPORTED_LOCALES.map(code => ({
      code, name: LOCALE_NAMES[code], rtl: RTL_LOCALES.includes(code)
    }))
  });
}));

// ============================================================
// 14. GLOBAL LANDING PAGE
// ============================================================
app.get('/global', ah(async (req, res) => {
  const locale = req.query.locale || detectLocaleFromHeader(req.headers['accept-language']);
  const hero = tSync('landing_hero', locale);
  const sub = tSync('landing_sub', locale);
  const cta = tSync('landing_cta', locale);
  const langLabel = tSync('landing_languages', locale);
  const currLabel = tSync('landing_currencies', locale);
  const mobileLabel = tSync('landing_mobile', locale);

  const html = `<!DOCTYPE html><html lang="${esc(locale)}" ${RTL_LOCALES.includes(locale) ? 'dir="rtl"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comfort Zone — ${esc(hero)}</title>
<meta name="description" content="${esc(sub)}">
<link rel="icon" href="/public/favicon.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
.container{max-width:1200px;margin:0 auto;padding:0 20px}
nav{position:fixed;top:0;left:0;right:0;background:rgba(255,255,255,0.95);backdrop-filter:blur(12px);border-bottom:1px solid #e2e8f0;z-index:100;padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
nav .logo{font-size:20px;font-weight:800;color:#4f46e5;text-decoration:none}
nav .links{display:flex;gap:12px;align-items:center}
nav .links a{text-decoration:none;color:#475569;font-size:14px;font-weight:500;padding:8px 16px;border-radius:8px;transition:.2s}
nav .links a:hover{background:#f1f5f9;color:#4f46e5}
nav .links .btn-nav{background:#4f46e5;color:white}
nav .links .btn-nav:hover{background:#4338ca}
.hero{padding:140px 20px 80px;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#a855f7 100%);color:white;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,0.08) 1px,transparent 1px);background-size:30px 30px}
.hero h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:900;margin-bottom:16px;position:relative;text-shadow:0 2px 20px rgba(0,0,0,0.2)}
.hero p{font-size:clamp(1rem,2.5vw,1.25rem);opacity:0.95;max-width:700px;margin:0 auto 32px;position:relative}
.hero .cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;position:relative}
.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;transition:.2s;border:none;cursor:pointer}
.btn-primary{background:white;color:#4f46e5;box-shadow:0 4px 20px rgba(0,0,0,0.15)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,0.2)}
.btn-outline{background:transparent;color:white;border:2px solid rgba(255,255,255,0.5)}
.btn-outline:hover{background:rgba(255,255,255,0.15);border-color:white}
.features{padding:80px 20px;background:white}
.features h2{text-align:center;font-size:2rem;margin-bottom:12px;color:#1e293b}
.features>p{text-align:center;color:#64748b;margin-bottom:48px;max-width:600px;margin-left:auto;margin-right:auto}
.feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
.feature-card{background:#f8fafc;border:2px solid #e2e8f0;border-radius:16px;padding:28px;text-align:center;transition:.3s}
.feature-card:hover{border-color:#4f46e5;transform:translateY(-4px);box-shadow:0 12px 40px rgba(79,70,229,0.1)}
.feature-card .icon{font-size:48px;margin-bottom:12px}
.feature-card h3{font-size:18px;margin-bottom:8px;color:#1e293b}
.feature-card p{color:#64748b;font-size:14px}
.countries{padding:80px 20px;background:#f8fafc}
.countries h2{text-align:center;font-size:2rem;margin-bottom:12px}
.countries>p{text-align:center;color:#64748b;margin-bottom:48px}
.country-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.country-card{background:white;border:2px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;transition:.2s}
.country-card:hover{border-color:#4f46e5;transform:translateY(-2px)}
.country-card .flag{font-size:36px;margin-bottom:8px}
.country-card .name{font-weight:700;color:#1e293b;font-size:15px}
.country-card .meta{font-size:12px;color:#94a3b8;margin-top:4px}
.languages-section{padding:80px 20px;background:white;text-align:center}
.languages-section h2{font-size:2rem;margin-bottom:12px}
.lang-pills{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:32px}
.lang-pill{padding:10px 20px;background:#f1f5f9;border:2px solid #e2e8f0;border-radius:20px;font-size:14px;font-weight:600;color:#475569;text-decoration:none;transition:.2s;cursor:pointer}
.lang-pill:hover,.lang-pill.active{background:#4f46e5;color:white;border-color:#4f46e5}
.cta-section{padding:80px 20px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-align:center}
.cta-section h2{font-size:2.5rem;margin-bottom:16px}
.cta-section p{font-size:1.15rem;opacity:0.9;margin-bottom:32px;max-width:600px;margin-left:auto;margin-right:auto}
footer{padding:32px 20px;background:#0f172a;color:#94a3b8;text-align:center;font-size:14px}
footer a{color:#4f46e5;text-decoration:none}
@media(max-width:768px){
  nav .links{gap:6px}nav .links a{padding:6px 10px;font-size:13px}
  .hero h1{font-size:2rem}.hero{padding:120px 16px 60px}
  .feature-grid{grid-template-columns:1fr}.country-grid{grid-template-columns:repeat(2,1fr)}
  .cta-section h2{font-size:1.8rem}
}
</style>
</head>
<body>
<nav>
  <a href="/" class="logo">\ud83c\udf1f Comfort Zone</a>
  <div class="links">
    <a href="#features">Features</a>
    <a href="#countries">Countries</a>
    <a href="#languages">Languages</a>
    <a href="/login" class="btn-nav">Log In</a>
    <a href="/register" class="btn-nav" style="background:#059669">Register</a>
  </div>
</nav>

<section class="hero">
  <div class="container">
    <h1>${esc(hero)}</h1>
    <p>${esc(sub)}</p>
    <div class="cta-row">
      <a href="/register" class="btn btn-primary">\ud83c\udf1f ${esc(cta)}</a>
      <a href="#features" class="btn btn-outline">\u2b07 Learn More</a>
    </div>
    <div style="display:flex;justify-content:center;gap:24px;margin-top:40px;flex-wrap:wrap;opacity:0.9;position:relative">
      <span>\ud83c\udf0d ${SUPPORTED_COUNTRIES.length} Countries</span>
      <span>\ud83c\udf0d ${SUPPORTED_LOCALES.length} Languages</span>
      <span>\ud83d\udcb0 ${Object.keys(CURRENCY_RATES).length} Currencies</span>
      <span>\ud83d\udcf1 Mobile-First</span>
    </div>
  </div>
</section>

<section class="features" id="features">
  <div class="container">
    <h2>\ud83d\ude80 Why Comfort Zone?</h2>
    <p>Designed for the unique needs of African organizations — built with global standards</p>
    <div class="feature-grid">
      <div class="feature-card">
        <div class="icon">\ud83c\udf0d</div>
        <h3>${esc(langLabel)}</h3>
        <p>English, Swahili, French, Arabic, Spanish, Hindi, Chinese, Portuguese, Amharic — and growing</p>
      </div>
      <div class="feature-card">
        <div class="icon">\ud83d\udcb0</div>
        <h3>${esc(currLabel)}</h3>
        <p>UGX, USD, EUR, KES, TZS, RWF, NGN, GHS, ZAR, and more — automatic conversion</p>
      </div>
      <div class="feature-card">
        <div class="icon">\ud83d\udcf1</div>
        <h3>${esc(mobileLabel)}</h3>
        <p>Optimized for low-bandwidth environments and mobile devices used across Africa</p>
      </div>
      <div class="feature-card">
        <div class="icon">\ud83d\udced</div>
        <h3>Phone OTP Verification</h3>
        <p>Secure phone verification with SMS — works with MTN, Airtel, Safaricom, and all carriers</p>
      </div>
      <div class="feature-card">
        <div class="icon">\ud83d\udcb3</div>
        <h3>African Payment Gateways</h3>
        <p>Flutterwave, Paystack, PayPal, MTN MoMo, Airtel Money — pay how your customers prefer</p>
      </div>
      <div class="feature-card">
        <div class="icon">\ud83d\ude80</div>
        <h3>All-in-One Platform</h3>
        <p>Schools, churches, hospitals, businesses, NGOs — one platform, endless possibilities</p>
      </div>
    </div>
  </div>
</section>

<section class="countries" id="countries">
  <div class="container">
    <h2>\ud83c\udf0d Available in ${SUPPORTED_COUNTRIES.length} Countries</h2>
    <p>From Kampala to Johannesburg — built for the markets that matter most</p>
    <div class="country-grid">
      ${SUPPORTED_COUNTRIES.map(c => `
        <div class="country-card">
          <div class="flag">${c.flag}</div>
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${esc(c.currency)} \u00b7 ${esc(LOCALE_NAMES[c.locale] || c.locale)}</div>
        </div>
      `).join('')}
    </div>
  </div>
</section>

<section class="languages-section" id="languages">
  <div class="container">
    <h2>\ud83c\udf0d ${SUPPORTED_LOCALES.length} Languages Supported</h2>
    <p>Switch languages instantly — your entire platform adapts</p>
    <div class="lang-pills">
      ${SUPPORTED_LOCALES.map(code => `
        <a href="/global?locale=${esc(code)}" class="lang-pill ${code === locale ? 'active' : ''}">
          ${esc(LOCALE_NAMES[code] || code)}
        </a>
      `).join('')}
    </div>
  </div>
</section>

<section class="cta-section">
  <div class="container">
    <h2>Ready to Go Global?</h2>
    <p>Join thousands of organizations already using Comfort Zone to manage, grow, and scale.</p>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a href="/register" class="btn" style="background:white;color:#4f46e5">\ud83c\udf1f Start Free — No Credit Card</a>
      <a href="/api/v2/health" class="btn" style="background:transparent;color:white;border:2px solid rgba(255,255,255,0.5)">API Docs</a>
    </div>
  </div>
</section>

<footer>
  <p>\u00a9 ${new Date().getFullYear()} Comfort Zone Platform. Built with \u2764\ufe0f in Uganda.
    <a href="/">Home</a> &middot; <a href="/api/v2/health">API</a> &middot; <a href="/global">Global</a>
  </p>
</footer>
</body></html>`;
  res.type('html').send(html);
}));

// ============================================================
// 15. GLOBAL EXPORTS
// ============================================================
global.t = t;
global.tSync = tSync;
global.convertCurrency = convertCurrency;
global.formatCurrency = formatCurrency;
global.detectLocale = detectLocale;
global.attachUserPrefs = attachUserPrefs;
global.getUserTimezone = getUserTimezone;
global.formatDate = formatDate;
global.verifyPhone = verifyPhone;
global.SUPPORTED_LOCALES = SUPPORTED_LOCALES;
global.SUPPORTED_COUNTRIES = SUPPORTED_COUNTRIES;
global.DEFAULT_TRANSLATIONS = DEFAULT_TRANSLATIONS;
global.CURRENCY_RATES = CURRENCY_RATES;

// ============================================================
// 16. LOG MODULE LOAD
// ============================================================
console.log(`[GlobalExpansion] LOADED: i18n (${Object.keys(DEFAULT_TRANSLATIONS.en).length} keys, ${SUPPORTED_LOCALES.length} locales), multi-currency (${Object.keys(CURRENCY_RATES).length} currencies), timezone handling, OTP verification, social login (Facebook, Apple), payment gateways (Flutterwave, Paystack, PayPal), global API, global landing page`);
