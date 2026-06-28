// src/routes/settings-search.js
//
// Settings search API (extracted from server.js as part of the Conservative
// route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handler in server.js.
// The module exports a factory that accepts a shared context object so the
// route handler can close over the same `requireAuth`, `ah`, etc. that the
// rest of server.js uses — no behavior changes, no re-definitions.
//
// The SETTINGS_INDEX constant is moved here with the route because it is
// only used by this route.
//
// Mount point in server.js:
//   app.use('/settings', require('./src/routes/settings-search')(sharedCtx));

const SETTINGS_INDEX = [
  { title: 'Profile', desc: 'Name, email, password, avatar', link: '/settings/profile', keywords: 'profile name email password avatar account personal' },
  { title: 'Organization', desc: 'Name, logo, branding, favicon, colors', link: '/settings/branding', keywords: 'organization logo branding favicon colors theme custom css font' },
  { title: 'Team & Invitations', desc: 'Users, invitations, roles, permissions, RBAC', link: '/settings/team', keywords: 'team users invitations roles permissions rbac access invite member staff' },
  { title: 'Payments', desc: 'MTN MoMo, Airtel, DPO, API keys, mobile money', link: '/settings/payments', keywords: 'payments mtn momo airtel dpo api keys mobile money flutterwave pay' },
  { title: 'Billing & Plans', desc: 'Invoices, subscriptions, plans, trial', link: '/billing', keywords: 'billing invoices subscriptions plans trial upgrade pricing payment' },
  { title: 'Security & 2FA', desc: 'Two-factor auth, password, sessions, CSRF', link: '/settings/2fa', keywords: 'security 2fa two-factor authentication password sessions csrf totp authenticator' },
  { title: 'Notifications', desc: 'Email, SMS, WhatsApp, alerts', link: '/settings/branding', keywords: 'notifications email sms whatsapp alerts notify reminders' },
  { title: 'Integrations', desc: 'Webhooks, API, CSV, export', link: '/integrations', keywords: 'integrations webhooks api csv export third-party connect' },
  { title: 'API Keys', desc: 'API access & webhooks management', link: '/api-keys', keywords: 'api keys webhooks access token developer endpoint' },
  { title: 'Data & Backup', desc: 'Backup, import, export, privacy', link: '/settings/backup', keywords: 'data backup import export privacy download restore archive compliance gdpr' },
  { title: 'School Settings', desc: 'Students, fees, classes, exams, timetable', link: '/school/students', keywords: 'school students fees classes exams timetable grades subjects curriculum' },
  { title: 'Church Settings', desc: 'Members, tithes, sermons, groups', link: '/church/members', keywords: 'church members tithes sermons groups offerings donations service cell' },
  { title: 'Currency', desc: 'UGX, KES, TZS, RWF settings', link: '/settings/currency', keywords: 'currency ugx kes tzs rwf money exchange rate symbol' },
  { title: 'Language', desc: 'Translations & locale settings', link: '/settings/translations', keywords: 'language translations locale i18n luganda swahili french english' },
  { title: 'Theme & Appearance', desc: 'Colors, fonts, CSS, dark mode', link: '/settings/theme', keywords: 'theme colors fonts css dark mode light appearance style customize design' },
  { title: 'Switch Portal', desc: 'School, Church, Clinic, Business & more', link: '/switch-portal', keywords: 'portal switch school church clinic business organization type category' },
  { title: 'Compliance & Audit', desc: 'Audit logs & data protection', link: '/compliance', keywords: 'compliance audit log data protection gdpr privacy regulation policy' },
  { title: 'Status Page', desc: 'Platform health monitoring', link: '/status', keywords: 'status health monitoring uptime performance system page' },
  { title: 'Custom Domains', desc: 'Custom domain & DNS settings', link: '/settings/domains', keywords: 'domains dns custom subdomain cname url website' },
  { title: 'SSO & Authentication', desc: 'SAML, OIDC, single sign-on', link: '/settings/sso', keywords: 'sso saml oidc authentication single sign-on login federation' },
  { title: 'CDN & Performance', desc: 'Content delivery & caching', link: '/settings/cdn', keywords: 'cdn performance caching content delivery speed optimize' },
  { title: 'Email Branding', desc: 'Email templates & whitelabeling', link: '/settings/email-branding', keywords: 'email branding templates whitelabel custom footer signature' },
  { title: 'Dashboard Customization', desc: 'Dashboard layout & widgets', link: '/settings/dashboard', keywords: 'dashboard customization layout widgets arrange preferences' },
  { title: 'Password', desc: 'Change your password', link: '/settings/password', keywords: 'password change reset update security login' },
];

module.exports = function createSettingsSearchRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { requireAuth, ah } = ctx;

  // GET /settings/search?q=term — Search across all settings
  router.get('/search', requireAuth, ah(async (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q || q.length < 2) return res.json({ success: true, results: [], query: q });
    const queryWords = q.split(/\s+/).filter(Boolean);
    const results = SETTINGS_INDEX.filter(item => {
      const searchText = (item.title + ' ' + item.desc + ' ' + item.keywords).toLowerCase();
      return queryWords.every(w => searchText.includes(w));
    }).map(item => ({ title: item.title, description: item.desc, link: item.link }));
    res.json({ success: true, results, query: q });
  }));

  return router;
};
