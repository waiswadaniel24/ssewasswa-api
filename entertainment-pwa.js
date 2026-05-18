/**
 * Entertainment PWA — Full-featured entertainment hub with dark mode,
 * multi-language support, accessibility, achievements, streaks, referrals,
 * profile, discovery, offline content, and help/FAQ.
 *
 * Usage in server.js:
 *   const entertainmentPwa = require('./entertainment-pwa');
 *   entertainmentPwa(app, pool, { esc, renderPage, requireAuth, logger });
 *
 * Export: module.exports = function(app, pool, opts) { ... }
 */

module.exports = async function (app, pool, opts) {

  // =========================================================================
  // LOCAL HELPERS
  // =========================================================================

  const esc = opts.esc || (s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const renderPage = opts.renderPage || ((title, body) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body>${body}</body></html>`);
  const requireAuth = opts.requireAuth || ((req, res, next) => next());
  const logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
  const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const sanitizeStr = s => typeof s === 'string' ? s.trim().replace(/[<>'"]/g, '') : s;

  // =========================================================================
  // TRANSLATIONS MAP
  // =========================================================================

  const TRANSLATIONS = {
    en: { Home: 'Home', Videos: 'Videos', Music: 'Music', Games: 'Games', Social: 'Social', Shorts: 'Shorts', Live: 'Live', Hub: 'Hub', Profile: 'Profile', Settings: 'Settings', Search: 'Search', Discover: 'Discover', Achievements: 'Achievements', Streaks: 'Streaks', Referrals: 'Referrals', Offline: 'Offline', Help: 'Help & FAQ', Notifications: 'Notifications', Language: 'Language', Theme: 'Theme', Accessibility: 'Accessibility', Dark: 'Dark', Light: 'Light', Save: 'Save', Cancel: 'Cancel', Back: 'Back', Continue: 'Continue', Trending: 'Trending', StaffPicks: 'Staff Picks', StudentFavorites: 'Student Favorites', NewArrivals: 'New Arrivals', HiddenGems: 'Hidden Gems', Downloaded: 'Downloaded', Coins: 'Coins', Followers: 'Followers', Following: 'Following', Watched: 'Watched', Played: 'Played', Posts: 'Posts', Earned: 'Earned', Locked: 'Locked', Share: 'Share', Copy: 'Copy', Invite: 'Invite', ContactSupport: 'Contact Support', ReportBug: 'Report Bug', Submit: 'Submit', Close: 'Close', FontSize: 'Font Size', HighContrast: 'High Contrast', ReducedMotion: 'Reduced Motion', ScreenReaderHints: 'Screen Reader Hints', DownloadManager: 'Download Manager', Storage: 'Storage' },
    lg: { Home: 'Awaka', Videos: 'Vidiyo', Music: 'Ennyimba', Games: 'Mizannyo', Social: 'Ekitongole', Shorts: 'Ebibuga', Live: 'Okulage', Hub: 'Ekitebe', Profile: 'Omubala', Settings: 'Enteekateeka', Search: 'Noonya', Discover: 'Zuula', Achievements: 'Obulamu', Streaks: 'Ennaku', Referrals: 'Okulagira', Offline: 'Bulijjo', Help: 'Yamba & FAQ', Notifications: 'Okwatumiza', Language: 'Olulimi', Theme: 'Endabika', Accessibility: 'Okusoma', Dark: 'Obudde', Light: 'Obulungi', Save: 'Tereka', Cancel: 'Sazaamu', Back: 'Emabega', Continue: 'Okugendawo', Trending: 'Oluvanyuma', StaffPicks: 'Enteekateeka', StudentFavorites: 'Abasoma Abasinga', NewArrivals: 'Empya', HiddenGems: 'Obulungi Obusirikitu', Downloaded: 'Kiwandise', Coins: 'Sente', Followers: 'Abafuurira', Following: 'Afurira', Watched: 'Yalaba', Played: 'Yagezako', Posts: 'Ebirowoozo', Earned: 'Yafuna', Locked: 'Kikuumiddwa', Share: 'Gaba', Copy: 'Kopi', Invite: 'Mukwate', ContactSupport: 'Yamba Abategeka', ReportBug: 'Ttwala Obulabe', Submit: 'Werezza', Close: 'Gala', FontSize: 'Obunene bw\'ennukuta', HighContrast: 'Obwengula', ReducedMotion: 'Okwekyusa ebirowoozo', ScreenReaderHints: 'Okuyamba omusomi', DownloadManager: 'Akawayiro akawandise', Storage: 'Ekyamba' },
    sw: { Home: 'Nyumbani', Videos: 'Video', Music: 'Muziki', Games: 'Michezo', Social: 'Kijamii', Shorts: 'Fupi', Live: 'Moja kwa moja', Hub: 'Kituo', Profile: 'Wasifu', Settings: 'Mipangilio', Search: 'Tafuta', Discover: 'Gundua', Achievements: 'Mafanikio', Streaks: 'Mfululizo', Referrals: 'Mwaliko', Offline: 'Nje ya mtandao', Help: 'Usaidizi & FAQ', Notifications: 'Arifa', Language: 'Lugha', Theme: 'Mandhari', Accessibility: 'Uwezekaji', Dark: 'Giza', Light: 'Nuru', Save: 'Hifadhi', Cancel: 'Futa', Back: 'Nyuma', Continue: 'Endelea', Trending: 'Inayoendelea', StaffPicks: 'Uchaguzi wa Wafanyakazi', StudentFavorites: 'Vipendwa vya Wanafunzi', NewArrivals: 'Mapya', HiddenGems: 'Vito Fichwa', Downloaded: 'Imeshushwa', Coins: 'Sarafu', Followers: 'Wafuasi', Following: 'Unafuata', Watched: 'Imeangaliwa', Played: 'Imechezwa', Posts: 'Machapisho', Earned: 'Imepatikana', Locked: 'Imefungwa', Share: 'Shiriki', Copy: 'Nakili', Invite: 'Karibisha', ContactSupport: 'Wasiliana na Msaada', ReportBug: 'Ripoti Hitilafu', Submit: 'Wasilisha', Close: 'Funga', FontSize: 'Ukubwa wa Fonti', HighContrast: 'Ulinganishu Mwingi', ReducedMotion: 'Punguza Mwendo', ScreenReaderHints: 'Vidokezo vya Kisoma', DownloadManager: 'Kidhibiti cha Upakuaji', Storage: 'Hifadhi' },
    fr: { Home: 'Accueil', Videos: 'Videos', Music: 'Musique', Games: 'Jeux', Social: 'Social', Shorts: 'Courts', Live: 'En direct', Hub: 'Centre', Profile: 'Profil', Settings: 'Parametres', Search: 'Rechercher', Discover: 'Decouvrir', Achievements: 'Succes', Streaks: 'Series', Referrals: 'Parrainage', Offline: 'Hors ligne', Help: 'Aide & FAQ', Notifications: 'Notifications', Language: 'Langue', Theme: 'Theme', Accessibility: 'Accessibilite', Dark: 'Sombre', Light: 'Clair', Save: 'Enregistrer', Cancel: 'Annuler', Back: 'Retour', Continue: 'Continuer', Trending: 'Tendances', StaffPicks: 'Choix de l\'equipe', StudentFavorites: 'Favoris etudiants', NewArrivals: 'Nouveautes', HiddenGems: 'Pepites cachees', Downloaded: 'Telecharge', Coins: 'Pieces', Followers: 'Abonnes', Following: 'Abonnements', Watched: 'Regardees', Played: 'Jouees', Posts: 'Publications', Earned: 'Obtenus', Locked: 'Verrouilles', Share: 'Partager', Copy: 'Copier', Invite: 'Inviter', ContactSupport: 'Contacter le support', ReportBug: 'Signaler un bug', Submit: 'Soumettre', Close: 'Fermer', FontSize: 'Taille de police', HighContrast: 'Contraste eleve', ReducedMotion: 'Mouvement reduit', ScreenReaderHints: 'Astuces lecteur d\'ecran', DownloadManager: 'Gestionnaire de telechargements', Storage: 'Stockage' },
    ar: { Home: '\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629', Videos: '\u0641\u064a\u062f\u064a\u0648\u0647\u0627\u062a', Music: '\u0645\u0648\u0633\u064a\u0642\u0649', Games: '\u0623\u0644\u0639\u0627\u0628', Social: '\u0627\u062c\u062a\u0645\u0627\u0639\u064a', Shorts: '\u0642\u0635\u064a\u0631\u0629', Live: '\u0645\u0628\u0627\u0634\u0631', Hub: '\u0627\u0644\u0645\u0631\u0643\u0632', Profile: '\u0627\u0644\u0645\u0644\u0641', Settings: '\u0625\u0639\u062f\u0627\u062f\u0627\u062a', Search: '\u0628\u062d\u062b', Discover: '\u0627\u0643\u062a\u0634\u0641', Achievements: '\u0625\u0646\u062c\u0627\u0632\u0627\u062a', Streaks: '\u062a\u0633\u0644\u0633\u0644', Referrals: '\u0625\u062d\u0627\u0644\u0629', Offline: '\u062f\u0648\u0646 \u0627\u062a\u0635\u0627\u0644', Help: '\u0645\u0633\u0627\u0639\u062f\u0629', Notifications: '\u0625\u0634\u0639\u0627\u0631\u0627\u062a', Language: '\u0627\u0644\u0644\u063a\u0629', Theme: '\u0627\u0644\u0645\u0638\u0647\u0631', Accessibility: '\u0625\u0645\u0643\u0627\u0646\u064a\u0629 \u0627\u0644\u0648\u0635\u0648\u0644', Dark: '\u062f\u0627\u0643\u0646', Light: '\u0641\u0627\u062a\u062d', Save: '\u062d\u0641\u0638', Cancel: '\u0625\u0644\u063a\u0627\u0621', Back: '\u0639\u0648\u062f\u0629', Continue: '\u0645\u062a\u0627\u0628\u0639\u0629', Trending: '\u0631\u0627\u0626\u062c', StaffPicks: '\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u0641\u0631\u064a\u0642', StudentFavorites: '\u0645\u0641\u0636\u0644\u0627\u062a \u0627\u0644\u0637\u0644\u0627\u0628', NewArrivals: '\u0648\u0627\u0631\u062f\u0627\u062a \u062c\u062f\u064a\u062f\u0629', HiddenGems: '\u062c\u0648\u0627\u0647\u0631 \u0645\u062e\u0641\u064a\u0629', Downloaded: '\u062a\u0645 \u0627\u0644\u062a\u0646\u0632\u064a\u0644', Coins: '\u0639\u0645\u0644\u0627\u062a', Followers: '\u0645\u062a\u0627\u0628\u0639\u064a\u0646', Following: '\u0645\u062a\u0627\u0628\u0639', Watched: '\u0645\u0634\u0627\u0647\u062f\u0629', Played: '\u0644\u0639\u0628\u0629', Posts: '\u0645\u0646\u0634\u0648\u0631\u0627\u062a', Earned: '\u0645\u0643\u062a\u0633\u0628', Locked: '\u0645\u0642\u0641\u0644', Share: '\u0645\u0634\u0627\u0631\u0643\u0629', Copy: '\u0646\u0633\u062e', Invite: '\u062f\u0639\u0648\u0629', ContactSupport: '\u0627\u062a\u0635\u0644 \u0628\u0627\u0644\u062f\u0639\u0645', ReportBug: '\u0625\u0628\u0644\u0627\u063a \u0639\u0646 \u062e\u0644\u0644', Submit: '\u0625\u0631\u0633\u0627\u0644', Close: '\u0625\u063a\u0644\u0627\u0642', FontSize: '\u062d\u062c\u0645 \u0627\u0644\u062e\u0637', HighContrast: '\u062a\u0628\u0627\u064a\u0646 \u0639\u0627\u0644\u064a', ReducedMotion: '\u062a\u0642\u0644\u064a\u0644 \u0627\u0644\u062d\u0631\u0643\u0629', ScreenReaderHints: '\u062a\u0644\u0645\u064a\u062d\u0627\u062a \u0642\u0627\u0631\u0626 \u0627\u0644\u0634\u0627\u0634\u0629', DownloadManager: '\u0645\u062f\u064a\u0631 \u0627\u0644\u062a\u0646\u0632\u064a\u0644', Storage: '\u0627\u0644\u062a\u062e\u0632\u064a\u0646' }
  };

  const SUPPORTED_LANGS = [
    { code: 'en', name: 'English', flag: '\u{1F1FA}\u{1F1F8}' },
    { code: 'lg', name: 'Luganda', flag: '\u{1F1F1}\u{1F1EC}' },
    { code: 'sw', name: 'Swahili', flag: '\u{1F1F9}\u{1F1FF}' },
    { code: 'fr', name: 'French', flag: '\u{1F1EB}\u{1F1F7}' },
    { code: 'ar', name: 'Arabic', flag: '\u{1F1F8}\u{1F1E6}' }
  ];

  const ACHIEVEMENT_DEFS = [
    { key: 'binge_watcher', name: 'Binge Watcher', desc: 'Watch 10 videos', icon: '\u{1F4FA}', condition: (p) => p.total_videos_watched >= 10 },
    { key: 'music_lover', name: 'Music Lover', desc: 'Listen to 50 tracks', icon: '\u{1F3B5}', condition: (p) => p.total_music_played >= 50 },
    { key: 'gamer', name: 'Gamer', desc: 'Play 20 games', icon: '\u{1F3AE}', condition: (p) => p.total_games_played >= 20 },
    { key: 'social_butterfly', name: 'Social Butterfly', desc: 'Make 10 posts', icon: '\u{1F4E3}', condition: (p) => p.total_posts >= 10 },
    { key: 'influencer', name: 'Influencer', desc: 'Get 100 followers', icon: '\u{2B50}', condition: (p) => p.followers >= 100 },
    { key: 'creator', name: 'Creator', desc: 'Upload 5 content items', icon: '\u{1F3A8}', condition: (p) => (p.total_posts || 0) >= 5 },
    { key: 'early_adopter', name: 'Early Adopter', desc: 'Use feature in first week', icon: '\u{1F680}', condition: (p) => { const d = p.created_at; if (!d) return false; const diff = (Date.now() - new Date(d).getTime()) / 86400000; return diff <= 7; } },
    { key: 'premium', name: 'Premium', desc: 'Subscribe to premium', icon: '\u{1F451}', condition: () => false },
    { key: 'tournament_champion', name: 'Tournament Champion', desc: 'Win a tournament', icon: '\u{1F3C6}', condition: () => false }
  ];

  const STREAK_REWARDS = [
    { day: 3, coins: 50 },
    { day: 7, coins: 200 },
    { day: 14, coins: 500 },
    { day: 30, coins: 1000 }
  ];

  // Helper: get user settings with defaults
  async function getUserSettings(tid, email) {
    const r = await pool.query(
      'SELECT * FROM ent_user_settings WHERE tenant_id=$1 AND user_email=$2', [tid, email]
    );
    return r.rows[0] || { theme: 'light', language: 'en', font_size: 'medium', high_contrast: false, reduced_motion: false };
  }

  // Helper: get user profile with defaults
  async function getUserProfile(tid, email) {
    const r = await pool.query(
      'SELECT * FROM ent_user_profiles WHERE tenant_id=$1 AND user_email=$2', [tid, email]
    );
    return r.rows[0] || { display_name: email.split('@')[0], bio: '', avatar_url: '', coins: 0, total_videos_watched: 0, total_music_played: 0, total_games_played: 0, total_posts: 0, followers: 0, following: 0, current_streak: 0, longest_streak: 0, created_at: new Date() };
  }

  // Helper: get notification prefs
  async function getNotifPrefs(tid, email) {
    const r = await pool.query(
      'SELECT * FROM ent_notification_prefs WHERE tenant_id=$1 AND user_email=$2', [tid, email]
    );
    return r.rows[0] || { new_video: true, new_music: true, game_challenge: true, social_mention: true, live_stream: true, subscription_expiring: true };
  }

  // Helper: translate a key
  function t(lang, key) {
    return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
  }

  // Helper: dark mode inline body style
  function bodyStyle(settings) {
    if (settings.theme === 'dark') {
      return 'background:#0f172a;color:#e2e8f0;';
    }
    return 'background:#f8fafc;color:#1e293b;';
  }

  // Helper: dark mode card style
  function cardStyle(settings) {
    if (settings.theme === 'dark') {
      return 'background:#1e293b;border:1px solid #334155;color:#e2e8f0;';
    }
    return 'background:white;border:1px solid #e2e8f0;color:#1e293b;';
  }

  // Helper: font size inline style
  function fontSizeStyle(settings) {
    const map = { small: '14px', medium: '16px', large: '18px', xl: '20px' };
    return `font-size:${map[settings.font_size] || '16px'};`;
  }

  // Shared CSS
  const SHARED_CSS = `
    *{margin:0;padding:0;box-sizing:border-box}
    .ent-container{max-width:1200px;margin:0 auto;padding:20px}
    .ent-card{border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,.08);transition:all .3s}
    .ent-btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#6366f1,#ec4899);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:.3s;font-size:14px}
    .ent-btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(99,102,241,.4)}
    .ent-btn-sm{padding:8px 16px;font-size:13px;border-radius:8px}
    .ent-btn-outline{background:transparent;border:2px solid #6366f1;color:#6366f1}
    .ent-btn-green{background:linear-gradient(135deg,#059669,#10b981)}
    .ent-btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}
    .ent-hero{background:linear-gradient(135deg,#6366f1,#ec4899,#f59e0b);color:white;padding:50px 30px;border-radius:16px;margin-bottom:25px;text-align:center;position:relative;overflow:hidden}
    .ent-hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:linear-gradient(45deg,transparent,rgba(255,255,255,.1),transparent);animation:entShimmer 3s infinite}
    @keyframes entShimmer{0%{transform:translateX(-100%) rotate(45deg)}100%{transform:translateX(100%) rotate(45deg)}}
    .ent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin:20px 0}
    .ent-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:15px;margin:20px 0}
    .ent-stat{border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05)}
    .ent-stat-num{font-size:28px;font-weight:800;background:linear-gradient(135deg,#6366f1,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .ent-tag{display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;background:#e0e7ff;color:#3730a3}
    .ent-tag-green{background:#d1fae5;color:#065f46}.ent-tag-gold{background:#fef3c7;color:#92400e}.ent-tag-red{background:#fee2e2;color:#991b1b}
    .ent-muted{opacity:.7;font-size:13px}
    .ent-alert{padding:16px;border-radius:10px;margin-bottom:15px}
    .ent-alert-success{background:#d1fae5;color:#065f46}.ent-alert-error{background:#fee2e2;color:#991b1b}.ent-alert-info{background:#dbeafe;color:#1e40af}
    .ent-flex-between{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
    .ent-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
    .ent-badge-locked{background:#f1f5f9;color:#94a3b8}
    .ent-badge-earned{background:linear-gradient(135deg,#6366f1,#ec4899);color:white}
    input,select,textarea{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:white;color:#1e293b;transition:border-color .2s;margin:4px 0}
    input:focus,select:focus,textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
    .ent-nav{background:linear-gradient(135deg,#6366f1,#7c3aed);color:white;padding:12px 20px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;box-shadow:0 4px 12px rgba(99,102,241,.3)}
    .ent-nav a{color:white;text-decoration:none;padding:8px 14px;border-radius:8px;transition:.2s;font-size:13px;font-weight:500}.ent-nav a:hover{background:rgba(255,255,255,.2)}.ent-nav a.active{background:rgba(255,255,255,.25)}
    .ent-toggle{position:relative;width:52px;height:28px;border-radius:14px;cursor:pointer;transition:.3s;border:none}
    .ent-toggle.on{background:#10b981}.ent-toggle.off{background:#94a3b8}
    .ent-toggle::after{content:'';position:absolute;width:22px;height:22px;border-radius:50%;background:white;top:3px;left:3px;transition:.3s}
    .ent-toggle.on::after{left:27px}
    .ent-streak-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
    .ent-streak-day{width:100%;aspect-ratio:1;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;cursor:default}
    .ent-streak-day.active{background:#10b981;color:white}.ent-streak-day.missed{background:#e2e8f0;color:#94a3b8}
    @media(max-width:768px){.ent-grid{grid-template-columns:1fr}.ent-stats{grid-template-columns:repeat(2,1fr)}.ent-hero{padding:30px 15px}.ent-nav{flex-direction:column}.ent-container{padding:12px}}
  `;

  // Render full entertainment page
  function entPage(title, content, settings, lang) {
    const isDark = settings.theme === 'dark';
    const hc = settings.high_contrast;
    const rm = settings.reduced_motion;
    return `<!DOCTYPE html>
<html lang="${esc(lang)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Entertainment Hub</title>
<meta name="theme-color" content="${isDark ? '#0f172a' : '#6366f1'}">
<style>${SHARED_CSS}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;${bodyStyle(settings)}${fontSizeStyle(settings)}transition:background .3s,color .3s}
${hc ? 'body,.ent-card,.ent-stat{border:2px solid #000!important;outline:1px solid #000!important}' : ''}
${rm ? '@keyframes entShimmer{0%,100%{transform:none}}.ent-hero::before{animation:none!important}' : ''}
input,select,textarea{background:${isDark ? '#1e293b' : 'white'};color:${isDark ? '#e2e8f0' : '#1e293b'};border-color:${isDark ? '#475569' : '#e2e8f0'}}
.ent-card{${cardStyle(settings)}}
.ent-stat{${cardStyle(settings)}}
.ent-streak-day.missed{background:${isDark ? '#334155' : '#e2e8f0'};color:${isDark ? '#64748b' : '#94a3b8'}}
</style>
</head><body>
${content}
</body></html>`;
  }

  // =========================================================================
  // MIGRATIONS
  // =========================================================================

  const MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS ent_user_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      theme TEXT DEFAULT 'light',
      language TEXT DEFAULT 'en',
      font_size TEXT DEFAULT 'medium',
      high_contrast BOOLEAN DEFAULT false,
      reduced_motion BOOLEAN DEFAULT false,
      UNIQUE(tenant_id, user_email)
    )`,
    `CREATE TABLE IF NOT EXISTS ent_user_profiles (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      coins INTEGER DEFAULT 0,
      total_videos_watched INTEGER DEFAULT 0,
      total_music_played INTEGER DEFAULT 0,
      total_games_played INTEGER DEFAULT 0,
      total_posts INTEGER DEFAULT 0,
      followers INTEGER DEFAULT 0,
      following INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, user_email)
    )`,
    `CREATE TABLE IF NOT EXISTS ent_user_referrals (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      referrer_email TEXT NOT NULL,
      referral_code TEXT UNIQUE,
      referred_email TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reward_given BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ent_user_achievements (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      achievement_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      unlocked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, user_email, achievement_key)
    )`,
    `CREATE TABLE IF NOT EXISTS ent_user_streaks (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      streak_date DATE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      coins_earned INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, user_email, streak_date)
    )`,
    `CREATE TABLE IF NOT EXISTS ent_notification_prefs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      new_video BOOLEAN DEFAULT true,
      new_music BOOLEAN DEFAULT true,
      game_challenge BOOLEAN DEFAULT true,
      social_mention BOOLEAN DEFAULT true,
      live_stream BOOLEAN DEFAULT true,
      subscription_expiring BOOLEAN DEFAULT true,
      UNIQUE(tenant_id, user_email)
    )`,
    `CREATE TABLE IF NOT EXISTS ent_downloads (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      content_type TEXT DEFAULT '',
      content_id INTEGER DEFAULT 0,
      status TEXT DEFAULT 'downloaded',
      downloaded_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ent_settings_tid ON ent_user_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ent_profiles_tid ON ent_user_profiles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ent_referrals_code ON ent_user_referrals(referral_code)`,
    `CREATE INDEX IF NOT EXISTS idx_ent_achievements_user ON ent_user_achievements(tenant_id, user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_ent_streaks_user ON ent_user_streaks(tenant_id, user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_ent_downloads_user ON ent_downloads(tenant_id, user_email)`
  ];

  for (const sql of MIGRATIONS) {
    try { await pool.query(sql); } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('duplicate') && !e.message.includes('does not exist')) {
        logger.warn('[Entertainment] Migration warning: ' + e.message);
      }
    }
  }
  logger.info('[Entertainment] Migrations complete (' + MIGRATIONS.length + ' statements)');

  // =========================================================================
  // 13 — ENTERTAINMENT NAVIGATION SNIPPET
  // =========================================================================

  function renderNav(lang, active) {
    const tabs = [
      { href: '/entertainment/hub', key: 'Hub', icon: '\u{1F3E0}' },
      { href: '/entertainment/discover', key: 'Discover', icon: '\u{1F50D}' },
      { href: '/entertainment/videos', key: 'Videos', icon: '\u{1F4FA}' },
      { href: '/entertainment/music', key: 'Music', icon: '\u{1F3B5}' },
      { href: '/entertainment/games', key: 'Games', icon: '\u{1F3AE}' },
      { href: '/entertainment/social', key: 'Social', icon: '\u{1F4E3}' },
      { href: '/entertainment/shorts', key: 'Shorts', icon: '\u{1F4F9}' },
      { href: '/entertainment/live', key: 'Live', icon: '\u{1F534}' },
      { href: '/entertainment/profile', key: 'Profile', icon: '\u{1F464}' },
      { href: '/entertainment/settings/theme', key: 'Settings', icon: '\u2699\u{FE0F}' }
    ];
    return `<nav class="ent-nav" role="navigation" aria-label="${esc(t(lang,'Settings'))} navigation">${tabs.map(tab =>
      `<a href="${esc(tab.href)}" class="${active === tab.key ? 'active' : ''}" role="link" aria-current="${active === tab.key ? 'page' : 'false'}">${tab.icon} ${esc(t(lang, tab.key))}</a>`
    ).join('')}</nav>`;
  }

  app.get('/entertainment/nav', ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';
    const active = req.query.active || 'Hub';
    res.type('html').send(renderNav(lang, active));
  }));

  // =========================================================================
  // 1 — ENTERTAINMENT HUB HOME
  // =========================================================================

  app.get('/entertainment/hub', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const profile = await getUserProfile(tid, email);
    const lang = settings.language || 'en';

    const quickCards = [
      { href: '/entertainment/videos', icon: '\u{1F4FA}', key: 'Videos', color: '#ef4444', desc: 'Watch trending videos' },
      { href: '/entertainment/music', icon: '\u{1F3B5}', key: 'Music', color: '#8b5cf6', desc: 'Stream music & playlists' },
      { href: '/entertainment/games', icon: '\u{1F3AE}', key: 'Games', color: '#f59e0b', desc: 'Play fun games' },
      { href: '/entertainment/social', icon: '\u{1F4E3}', key: 'Social', color: '#3b82f6', desc: 'Connect with friends' },
      { href: '/entertainment/shorts', icon: '\u{1F4F9}', key: 'Shorts', color: '#ec4899', desc: 'Quick entertainment' },
      { href: '/entertainment/live', icon: '\u{1F534}', key: 'Live', color: '#ef4444', desc: 'Watch live streams' }
    ];

    const trendingItems = [
      { title: 'Top Viral Video This Week', type: 'Video', icon: '\u{1F3AC}' },
      { title: 'Afrobeats Mix 2025', type: 'Music', icon: '\u{1F3A7}' },
      { title: 'Quiz Tournament Finals', type: 'Game', icon: '\u{1F3B2}' },
      { title: 'Student Comedy Night', type: 'Short', icon: '\u{1F602}' },
      { title: 'Live DJ Set Friday', type: 'Live', icon: '\u{1F4A5}' }
    ];

    const continueItems = [
      { title: 'Documentary: East African Wildlife', progress: 65, icon: '\u{1F4FA}' },
      { title: 'Chill Vibes Playlist', progress: 30, icon: '\u{1F3B5}' },
      { title: 'Puzzle Quest Level 12', progress: 80, icon: '\u{1F3AE}' }
    ];

    const activityFeed = [
      { text: 'You watched "Tech Review 2025"', time: '2h ago', icon: '\u{1F4FA}' },
      { text: 'You earned +10 coins!', time: '3h ago', icon: '\u{1F4B0}' },
      { text: 'New follower: @friend123', time: '5h ago', icon: '\u{1F464}' },
      { text: 'You completed a daily streak', time: '1d ago', icon: '\u{1F525}' }
    ];

    const content = `
      ${renderNav(lang, 'Hub')}
      <div class="ent-container">
        <div class="ent-hero" role="banner">
          <h1 style="font-size:clamp(28px,5vw,48px);margin-bottom:10px;position:relative;z-index:1">${esc(t(lang, 'Hub'))} \u{1F680}</h1>
          <p style="font-size:clamp(14px,2vw,20px);opacity:.9;max-width:600px;margin:0 auto;position:relative;z-index:1">Your one-stop entertainment destination. Watch, listen, play, and connect.</p>
          <div style="margin-top:20px;position:relative;z-index:1">
            <input type="text" placeholder="${esc(t(lang,'Search'))}..." style="max-width:400px;margin:0 auto;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white;border-radius:12px;padding:14px 20px" aria-label="${esc(t(lang,'Search'))}">
          </div>
        </div>

        <div class="ent-grid">
          ${quickCards.map(c => `
            <a href="${esc(c.href)}" class="ent-card" style="text-decoration:none;cursor:pointer;border-left:4px solid ${esc(c.color)};position:relative;overflow:hidden" role="link" aria-label="${esc(t(lang, c.key))}">
              <div style="font-size:36px;margin-bottom:8px">${c.icon}</div>
              <h3 style="font-size:18px;margin-bottom:4px;${settings.theme === 'dark' ? 'color:#e2e8f0' : 'color:#1e293b'}">${esc(t(lang, c.key))}</h3>
              <div class="ent-muted">${esc(c.desc)}</div>
            </a>
          `).join('')}
        </div>

        <div class="ent-card" role="region" aria-label="${esc(t(lang,'Trending'))}">
          <div class="ent-flex-between" style="margin-bottom:16px">
            <h2 style="font-size:20px">\u{1F4C8} ${esc(t(lang, 'Trending'))}</h2>
          </div>
          <div style="display:flex;gap:16px;overflow-x:auto;padding-bottom:8px">
            ${trendingItems.map((item, i) => `
              <div class="ent-card" style="min-width:220px;flex-shrink:0;text-align:center;border-top:3px solid ${i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : '#cd7f32'}">
                <div style="font-size:32px;margin-bottom:8px">${item.icon}</div>
                <h4 style="font-size:14px;margin-bottom:4px">${esc(item.title)}</h4>
                <span class="ent-tag">${esc(item.type)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="ent-card" role="region" aria-label="${esc(t(lang,'Continue'))}">
          <h2 style="font-size:20px;margin-bottom:16px">\u{25B6}\u{FE0F} ${esc(t(lang, 'Continue'))}</h2>
          <div class="ent-grid">
            ${continueItems.map(item => `
              <div class="ent-card" style="cursor:pointer">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
                  <div style="font-size:28px">${item.icon}</div>
                  <div>
                    <h4 style="font-size:14px">${esc(item.title)}</h4>
                    <div class="ent-muted">${item.progress}% complete</div>
                  </div>
                </div>
                <div style="height:8px;border-radius:4px;background:${settings.theme === 'dark' ? '#334155' : '#e2e8f0'};overflow:hidden">
                  <div style="height:100%;width:${item.progress}%;background:linear-gradient(135deg,#6366f1,#ec4899);border-radius:4px;transition:width .5s"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="ent-card" role="region" aria-label="Recent activity">
          <h2 style="font-size:20px;margin-bottom:16px">\u{1F4CB} Recent Activity</h2>
          ${activityFeed.map(a => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid ${settings.theme === 'dark' ? '#334155' : '#f1f5f9'}">
              <div style="font-size:20px">${a.icon}</div>
              <div style="flex:1"><span style="font-size:14px">${esc(a.text)}</span></div>
              <div class="ent-muted">${esc(a.time)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    res.send(entPage('Entertainment Hub', content, settings, lang));
  }));

  // =========================================================================
  // 2 — DARK/LIGHT THEME TOGGLE
  // =========================================================================

  app.get('/entertainment/settings/theme', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    const content = `
      ${renderNav(lang, 'Settings')}
      <div class="ent-container">
        <div class="ent-card">
          <h2 style="font-size:22px;margin-bottom:20px">\u{1F3A8} ${esc(t(lang, 'Theme'))}</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
            <div onclick="document.getElementById('themeForm').querySelector('[name=theme]').value='light';document.getElementById('themeForm').submit()" style="cursor:pointer;border-radius:12px;padding:24px;text-align:center;border:3px solid ${settings.theme === 'light' ? '#6366f1' : 'transparent'};background:#f8fafc" role="button" tabindex="0" aria-label="Light theme">
              <div style="font-size:48px;margin-bottom:8px">\u{2600}\u{FE0F}</div>
              <h3>Light</h3>
            </div>
            <div onclick="document.getElementById('themeForm').querySelector('[name=theme]').value='dark';document.getElementById('themeForm').submit()" style="cursor:pointer;border-radius:12px;padding:24px;text-align:center;border:3px solid ${settings.theme === 'dark' ? '#ec4899' : 'transparent'};background:#0f172a;color:#e2e8f0" role="button" tabindex="0" aria-label="Dark theme">
              <div style="font-size:48px;margin-bottom:8px">\u{1F319}</div>
              <h3>Dark</h3>
            </div>
          </div>
          <form id="themeForm" method="POST" action="/entertainment/settings/theme/toggle">
            <input type="hidden" name="theme" value="">
            <button type="button" class="ent-btn" onclick="const f=document.getElementById('themeForm');f.querySelector('[name=theme]').value=f.querySelector('[name=theme]').value||'${settings.theme === 'dark' ? 'light' : 'dark'}';f.submit()">
              ${esc(t(lang, settings.theme === 'dark' ? 'Light' : 'Dark'))} Mode
            </button>
          </form>
          <div class="ent-alert ent-alert-info" style="margin-top:16px">Current theme: <strong>${esc(settings.theme)}</strong></div>
        </div>
      </div>
    `;
    res.send(entPage('Theme Settings', content, settings, lang));
  }));

  app.post('/entertainment/settings/theme/toggle', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const theme = (req.body.theme === 'dark' || req.body.theme === 'light') ? req.body.theme : 'light';

    await pool.query(`
      INSERT INTO ent_user_settings (tenant_id, user_email, theme)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET theme = $3
    `, [tid, email, theme]);
    res.redirect('/entertainment/settings/theme');
  }));

  // =========================================================================
  // 3 — MULTI-LANGUAGE SUPPORT
  // =========================================================================

  app.get('/entertainment/settings/language', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    const content = `
      ${renderNav(lang, 'Settings')}
      <div class="ent-container">
        <div class="ent-card">
          <h2 style="font-size:22px;margin-bottom:20px">\u{1F310} ${esc(t(lang, 'Language'))}</h2>
          <form method="POST" action="/entertainment/settings/language/save">
            ${SUPPORTED_LANGS.map(l => `
              <label style="display:flex;align-items:center;gap:12px;padding:16px;border-radius:12px;margin-bottom:8px;cursor:pointer;border:2px solid ${lang === l.code ? '#6366f1' : (settings.theme === 'dark' ? '#334155' : '#e2e8f0')};${settings.theme === 'dark' ? 'background:#1e293b' : 'background:#f8fafc'}" role="radio" aria-checked="${lang === l.code}">
                <input type="radio" name="language" value="${esc(l.code)}" ${lang === l.code ? 'checked' : ''} style="width:20px;height:20px" required>
                <div style="font-size:28px">${l.flag}</div>
                <div>
                  <div style="font-weight:600;font-size:16px">${esc(l.name)}</div>
                  <div class="ent-muted">${esc(t(l.code, 'Home'))}, ${esc(t(l.code, 'Videos'))}, ${esc(t(l.code, 'Music'))}</div>
                </div>
              </label>
            `).join('')}
            <button type="submit" class="ent-btn" style="margin-top:16px">${esc(t(lang, 'Save'))}</button>
          </form>
        </div>
      </div>
    `;
    res.send(entPage('Language Settings', content, settings, lang));
  }));

  app.post('/entertainment/settings/language/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const language = SUPPORTED_LANGS.some(l => l.code === req.body.language) ? req.body.language : 'en';

    await pool.query(`
      INSERT INTO ent_user_settings (tenant_id, user_email, language)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET language = $3
    `, [tid, email, language]);
    res.redirect('/entertainment/settings/language');
  }));

  // =========================================================================
  // 4 — PUSH NOTIFICATION PREFERENCES
  // =========================================================================

  app.get('/entertainment/settings/notifications', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const prefs = await getNotifPrefs(tid, email);
    const lang = settings.language || 'en';

    const notifTypes = [
      { key: 'new_video', label: 'New Video Uploaded', icon: '\u{1F4FA}' },
      { key: 'new_music', label: 'New Music Released', icon: '\u{1F3B5}' },
      { key: 'game_challenge', label: 'Game Challenge', icon: '\u{1F3AE}' },
      { key: 'social_mention', label: 'Social Mention', icon: '\u{1F4E3}' },
      { key: 'live_stream', label: 'Live Stream Start', icon: '\u{1F534}' },
      { key: 'subscription_expiring', label: 'Subscription Expiring', icon: '\u{26A0}\u{FE0F}' }
    ];

    const content = `
      ${renderNav(lang, 'Settings')}
      <div class="ent-container">
        <div class="ent-card">
          <h2 style="font-size:22px;margin-bottom:20px">\u{1F514} ${esc(t(lang, 'Notifications'))}</h2>
          <form method="POST" action="/entertainment/settings/notifications">
            ${notifTypes.map(nt => `
              <div class="ent-flex-between" style="padding:14px 0;border-bottom:1px solid ${settings.theme === 'dark' ? '#334155' : '#f1f5f9'}">
                <div style="display:flex;align-items:center;gap:12px">
                  <div style="font-size:24px">${nt.icon}</div>
                  <div>
                    <div style="font-weight:600">${esc(nt.label)}</div>
                    <div class="ent-muted">Get notified about ${esc(nt.label.toLowerCase())}</div>
                  </div>
                </div>
                <button type="button" class="ent-toggle ${prefs[nt.key] ? 'on' : 'off'}" onclick="this.classList.toggle('on');this.classList.toggle('off');this.nextElementSibling.value=this.classList.contains('on')?'true':'false'" role="switch" aria-checked="${!!prefs[nt.key]}" aria-label="${esc(nt.label)}"></button>
                <input type="hidden" name="${esc(nt.key)}" value="${prefs[nt.key] ? 'true' : 'false'}">
              </div>
            `).join('')}
            <button type="submit" class="ent-btn" style="margin-top:20px">${esc(t(lang, 'Save'))}</button>
          </form>
        </div>
      </div>
    `;
    res.send(entPage('Notification Preferences', content, settings, lang));
  }));

  app.post('/entertainment/settings/notifications', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const keys = ['new_video', 'new_music', 'game_challenge', 'social_mention', 'live_stream', 'subscription_expiring'];
    const vals = keys.map(k => req.body[k] === 'true');
    await pool.query(`
      INSERT INTO ent_notification_prefs (tenant_id, user_email, new_video, new_music, game_challenge, social_mention, live_stream, subscription_expiring)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET new_video=$3, new_music=$4, game_challenge=$5, social_mention=$6, live_stream=$7, subscription_expiring=$8
    `, [tid, email, ...vals]);
    res.redirect('/entertainment/settings/notifications');
  }));

  // =========================================================================
  // 5 — REFERRAL PROGRAM
  // =========================================================================

  app.get('/entertainment/referrals', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    let refRecord = (await pool.query(
      'SELECT * FROM ent_user_referrals WHERE tenant_id=$1 AND referrer_email=$2', [tid, email]
    )).rows[0];

    let code = refRecord?.referral_code;
    if (!code) {
      code = 'ENT-' + email.split('@')[0].toUpperCase().slice(0, 6) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      try {
        await pool.query(
          'INSERT INTO ent_user_referrals (tenant_id, referrer_email, referral_code) VALUES ($1,$2,$3)',
          [tid, email, code]
        );
      } catch (e) { /* duplicate code race - just regenerate */ }
    }

    const referrals = (await pool.query(
      'SELECT * FROM ent_user_referrals WHERE tenant_id=$1 AND referrer_email=$2 ORDER BY created_at DESC', [tid, email]
    )).rows;

    const invitedCount = referrals.length;
    const signups = referrals.filter(r => r.status === 'signed_up').length;
    const activeCount = referrals.filter(r => r.status === 'active').length;
    const coinsEarned = referrals.filter(r => r.reward_given).length * 500;

    const shareUrl = (typeof req !== 'undefined' && req.get) ? `${req.get('origin') || 'https://app.example.com'}/entertainment/referrals?code=${encodeURIComponent(code)}` : `https://app.example.com/entertainment/referrals?code=${encodeURIComponent(code)}`;

    const content = `
      ${renderNav(lang, 'Referrals')}
      <div class="ent-container">
        <div class="ent-hero" style="padding:40px 20px">
          <h1 style="font-size:32px;margin-bottom:8px">\u{1F91D} ${esc(t(lang, 'Referrals'))}</h1>
          <p>Invite friends and earn <strong>500 coins</strong> per successful referral!</p>
        </div>

        <div class="ent-card" style="text-align:center">
          <h3 style="margin-bottom:12px">Your Referral Code</h3>
          <div style="font-size:28px;font-weight:900;letter-spacing:3px;color:#6366f1;margin-bottom:16px" id="refCode" aria-label="Referral code: ${esc(code)}">${esc(code)}</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">
            <button class="ent-btn ent-btn-sm ent-btn-green" onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(code)}');this.textContent='Copied!'" aria-label="Copy referral code">\u{1F4CB} ${esc(t(lang, 'Copy'))}</button>
            <a href="https://wa.me/?text=Join%20me%20on%20Entertainment%20Hub!%20Code:%20${encodeURIComponent(code)}" target="_blank" class="ent-btn ent-btn-sm" style="background:#25d366" aria-label="Share via WhatsApp">WhatsApp</a>
            <a href="https://twitter.com/intent/tweet?text=Join%20Entertainment%20Hub!%20Code:%20${encodeURIComponent(code)}" target="_blank" class="ent-btn ent-btn-sm" style="background:#1da1f2" aria-label="Share via Twitter">Twitter</a>
          </div>
        </div>

        <div class="ent-stats">
          <div class="ent-stat"><div class="ent-stat-num">${invitedCount}</div><div class="ent-muted">${esc(t(lang, 'Invited'))}</div></div>
          <div class="ent-stat"><div class="ent-stat-num">${signups}</div><div class="ent-muted">Signups</div></div>
          <div class="ent-stat"><div class="ent-stat-num">${activeCount}</div><div class="ent-muted">Active</div></div>
          <div class="ent-stat"><div class="ent-stat-num" style="-webkit-text-fill-color:#f59e0b;background:none">${coinsEarned}</div><div class="ent-muted">${esc(t(lang, 'Coins'))} Earned</div></div>
        </div>

        <div class="ent-card">
          <h3 style="margin-bottom:12px">Referral History</h3>
          ${referrals.length > 0 ? `<table><thead><tr><th>Email</th><th>Status</th><th>Date</th><th>Reward</th></tr></thead><tbody>
            ${referrals.map(r => `<tr>
              <td>${esc(r.referred_email || 'Pending')}</td>
              <td><span class="ent-tag ${r.status === 'active' ? 'ent-tag-green' : r.status === 'signed_up' ? 'ent-tag-gold' : 'ent-tag-red'}">${esc(r.status)}</span></td>
              <td class="ent-muted">${r.created_at ? r.created_at.toISOString().slice(0, 10) : ''}</td>
              <td>${r.reward_given ? '<span class="ent-tag ent-tag-green">+500</span>' : '-'}</td>
            </tr>`).join('')}
          </tbody></table>` : '<p class="ent-muted">No referrals yet. Share your code to get started!</p>'}
        </div>
      </div>
    `;
    res.send(entPage('Referrals', content, settings, lang));
  }));

  app.post('/entertainment/referrals/invite', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const referredEmail = sanitizeStr(req.body.email || '');

    if (!referredEmail || !referredEmail.includes('@')) {
      return res.redirect('/entertainment/referrals?error=invalid_email');
    }

    try {
      await pool.query(`
        INSERT INTO ent_user_referrals (tenant_id, referrer_email, referred_email, status)
        VALUES ($1, $2, $3, 'pending')
      `, [tid, email, referredEmail]);
    } catch (e) {
      logger.warn('[Entertainment] Referral invite error: ' + e.message);
    }
    res.redirect('/entertainment/referrals');
  }));

  // =========================================================================
  // 6 — ACHIEVEMENT BADGES
  // =========================================================================

  app.get('/entertainment/achievements', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const profile = await getUserProfile(tid, email);
    const lang = settings.language || 'en';

    const earned = (await pool.query(
      'SELECT achievement_key FROM ent_user_achievements WHERE tenant_id=$1 AND user_email=$2', [tid, email]
    )).rows.map(r => r.achievement_key);

    // Check and auto-unlock achievements
    for (const ach of ACHIEVEMENT_DEFS) {
      if (!earned.includes(ach.key) && ach.condition(profile)) {
        try {
          await pool.query(`
            INSERT INTO ent_user_achievements (tenant_id, user_email, achievement_key, achievement_name, description, icon)
            VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING
          `, [tid, email, ach.key, ach.name, ach.desc, ach.icon]);
          earned.push(ach.key);
        } catch (e) { /* skip duplicate */ }
      }
    }

    const content = `
      ${renderNav(lang, 'Achievements')}
      <div class="ent-container">
        <div class="ent-hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444,#ec4899);padding:35px 20px">
          <h1 style="font-size:32px;margin-bottom:8px">\u{1F3C6} ${esc(t(lang, 'Achievements'))}</h1>
          <p>${earned.length} / ${ACHIEVEMENT_DEFS.length} unlocked</p>
        </div>

        <div class="ent-card">
          <div style="height:12px;border-radius:6px;background:${settings.theme === 'dark' ? '#334155' : '#e2e8f0'};overflow:hidden;margin-bottom:20px">
            <div style="height:100%;width:${(earned.length / ACHIEVEMENT_DEFS.length * 100)}%;background:linear-gradient(135deg,#f59e0b,#ec4899);border-radius:6px;transition:width .5s"></div>
          </div>
          <div class="ent-grid">
            ${ACHIEVEMENT_DEFS.map(ach => {
              const isEarned = earned.includes(ach.key);
              return `<div class="ent-card" style="text-align:center;opacity:${isEarned ? '1' : '.5'};position:relative;overflow:hidden">
                <div style="font-size:48px;margin-bottom:8px;${isEarned ? '' : 'filter:grayscale(1)' }">${ach.icon}</div>
                <h4 style="margin-bottom:4px">${esc(ach.name)}</h4>
                <div class="ent-muted" style="font-size:12px">${esc(ach.desc)}</div>
                <div style="margin-top:10px">
                  ${isEarned
                    ? '<span class="ent-badge ent-badge-earned">\u2713 ' + esc(t(lang, 'Earned')) + '</span>'
                    : '<span class="ent-badge ent-badge-locked">\u{1F512} ' + esc(t(lang, 'Locked')) + '</span>'
                  }
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `;
    res.send(entPage('Achievements', content, settings, lang));
  }));

  // =========================================================================
  // 7 — USER ENGAGEMENT STREAKS
  // =========================================================================

  app.get('/entertainment/streaks', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const profile = await getUserProfile(tid, email);
    const lang = settings.language || 'en';

    // Ensure streak for today
    const today = new Date().toISOString().slice(0, 10);
    try {
      await pool.query(`
        INSERT INTO ent_user_streaks (tenant_id, user_email, streak_date, is_active)
        VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING
      `, [tid, email, today]);
    } catch (e) { /* already exists */ }

    // Get last 30 days
    const streaks = (await pool.query(
      `SELECT streak_date, is_active, coins_earned FROM ent_user_streaks
       WHERE tenant_id=$1 AND user_email=$2 AND streak_date >= CURRENT_DATE - 29
       ORDER BY streak_date DESC`, [tid, email]
    )).rows;

    // Calculate current streak
    let currentStreak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const dateStr = new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10);
      const day = streaks.find(s => s.streak_date === dateStr);
      if (day && day.is_active) { currentStreak++; } else { break; }
    }

    // Update profile streak
    if (currentStreak !== profile.current_streak) {
      await pool.query(`
        UPDATE ent_user_profiles SET current_streak = GREATEST(current_streak, $3), longest_streak = GREATEST(longest_streak, $3)
        WHERE tenant_id = $1 AND user_email = $2
      `, [tid, email, currentStreak]);
    }

    // Build calendar (last 30 days, newest first)
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const calendarCells = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86400000);
      const dateStr = date.toISOString().slice(0, 10);
      const day = streaks.find(s => s.streak_date === dateStr);
      calendarCells.push({ date: date.getDate(), active: !!(day && day.is_active), coins: day ? day.coins_earned : 0 });
    }

    const nextReward = STREAK_REWARDS.find(r => r.day > currentStreak) || STREAK_REWARDS[STREAK_REWARDS.length - 1];
    const prevRewardCoins = STREAK_REWARDS.filter(r => r.day <= currentStreak).pop();
    const totalCoinsFromStreaks = streaks.reduce((sum, s) => sum + (s.coins_earned || 0), 0);

    const content = `
      ${renderNav(lang, 'Streaks')}
      <div class="ent-container">
        <div class="ent-hero" style="background:linear-gradient(135deg,#ef4444,#f59e0b);padding:35px 20px">
          <h1 style="font-size:36px;margin-bottom:8px">\u{1F525} ${esc(t(lang, 'Streaks'))}</h1>
          <div style="font-size:64px;font-weight:900;margin:8px 0">${currentStreak}</div>
          <p>Day streak ${currentStreak >= 7 ? '- You\'re on fire!' : currentStreak >= 3 ? '- Great momentum!' : '- Keep going!'}</p>
        </div>

        <div class="ent-stats">
          <div class="ent-stat"><div class="ent-stat-num">${currentStreak}</div><div class="ent-muted">Current Streak</div></div>
          <div class="ent-stat"><div class="ent-stat-num" style="-webkit-text-fill-color:#f59e0b;background:none">${profile.longest_streak || 0}</div><div class="ent-muted">Longest Streak</div></div>
          <div class="ent-stat"><div class="ent-stat-num" style="-webkit-text-fill-color:#10b981;background:none">${totalCoinsFromStreaks}</div><div class="ent-muted">${esc(t(lang, 'Coins'))} from Streaks</div></div>
        </div>

        <div class="ent-card">
          <h3 style="margin-bottom:16px">Streak Rewards</h3>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
            ${STREAK_REWARDS.map(r => `
              <div style="text-align:center;padding:12px;border-radius:12px;${currentStreak >= r.day ? 'background:linear-gradient(135deg,#d1fae5,#a7f3d0);' : (settings.theme === 'dark' ? 'background:#1e293b;border:1px solid #334155;' : 'background:#f8fafc;border:1px solid #e2e8f0;')}flex:1;min-width:100px">
                <div style="font-size:24px;font-weight:900;${currentStreak >= r.day ? 'color:#059669;' : ''}">Day ${r.day}</div>
                <div style="font-size:14px;margin-top:4px">${currentStreak >= r.day ? '\u2705' : '\u{1F512}'} +${r.coins} coins</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="ent-card">
          <h3 style="margin-bottom:16px">Last 30 Days</h3>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center;margin-bottom:8px">
            ${dayNames.map(d => `<div style="font-size:12px;font-weight:600;${settings.theme === 'dark' ? 'color:#94a3b8' : 'color:#64748b'}">${d}</div>`).join('')}
          </div>
          <div class="ent-streak-cal" role="grid" aria-label="Streak calendar">
            ${calendarCells.map(c => `
              <div class="ent-streak-day ${c.active ? 'active' : 'missed'}" title="${c.date}: ${c.active ? 'Active' : 'Missed'}${c.coins ? ' (+' + c.coins + ' coins)' : ''}" role="gridcell">${c.date}</div>
            `).join('')}
          </div>
          <div style="display:flex;gap:16px;margin-top:12px">
            <div style="display:flex;align-items:center;gap:6px"><div style="width:16px;height:16px;border-radius:4px;background:#10b981"></div><span class="ent-muted">Active</span></div>
            <div style="display:flex;align-items:center;gap:6px"><div style="width:16px;height:16px;border-radius:4px;background:${settings.theme === 'dark' ? '#334155' : '#e2e8f0'}"></div><span class="ent-muted">Missed</span></div>
          </div>
        </div>
      </div>
    `;
    res.send(entPage('Streaks', content, settings, lang));
  }));

  // =========================================================================
  // 8 — ENTERTAINMENT PROFILE
  // =========================================================================

  app.get('/entertainment/profile', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const profile = await getUserProfile(tid, email);
    const lang = settings.language || 'en';

    const earnedCount = (await pool.query(
      'SELECT COUNT(*)::int FROM ent_user_achievements WHERE tenant_id=$1 AND user_email=$2', [tid, email]
    )).rows[0].count;

    const profileStats = [
      { label: t(lang, 'Watched'), value: profile.total_videos_watched || 0, icon: '\u{1F4FA}', color: '#ef4444' },
      { label: t(lang, 'Played') + ' (Music)', value: profile.total_music_played || 0, icon: '\u{1F3B5}', color: '#8b5cf6' },
      { label: t(lang, 'Played') + ' (Games)', value: profile.total_games_played || 0, icon: '\u{1F3AE}', color: '#f59e0b' },
      { label: t(lang, 'Posts'), value: profile.total_posts || 0, icon: '\u{1F4E3}', color: '#3b82f6' },
      { label: t(lang, 'Followers'), value: profile.followers || 0, icon: '\u{1F465}', color: '#ec4899' },
      { label: t(lang, 'Following'), value: profile.following || 0, icon: '\u{1F464}', color: '#06b6d4' },
      { label: t(lang, 'Achievements'), value: earnedCount, icon: '\u{1F3C6}', color: '#f59e0b' },
      { label: t(lang, 'Coins'), value: profile.coins || 0, icon: '\u{1F4B0}', color: '#10b981' }
    ];

    const content = `
      ${renderNav(lang, 'Profile')}
      <div class="ent-container">
        <div class="ent-card" style="text-align:center;padding:40px 20px;position:relative;overflow:hidden">
          <div style="position:absolute;top:0;left:0;right:0;height:100px;background:linear-gradient(135deg,#6366f1,#ec4899,#f59e0b);border-radius:16px 16px 0 0"></div>
          <div style="position:relative;z-index:1;margin-top:20px">
            <div style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#ec4899);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:40px;color:white;border:4px solid ${settings.theme === 'dark' ? '#0f172a' : 'white'};box-shadow:0 4px 20px rgba(99,102,241,.4)">
              ${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : '\u{1F464}'}
            </div>
            <h1 style="font-size:28px;margin-bottom:4px">${esc(profile.display_name || email.split('@')[0])}</h1>
            <p class="ent-muted" style="max-width:400px;margin:0 auto">${esc(profile.bio || 'Entertainment enthusiast')}</p>
            <div style="display:flex;justify-content:center;gap:20px;margin-top:16px">
              <div><span style="font-weight:800;font-size:20px">${profile.followers || 0}</span> <span class="ent-muted">${esc(t(lang, 'Followers'))}</span></div>
              <div><span style="font-weight:800;font-size:20px">${profile.following || 0}</span> <span class="ent-muted">${esc(t(lang, 'Following'))}</span></div>
              <div><span style="font-weight:800;font-size:20px">${profile.current_streak || 0}</span> <span class="ent-muted">streak</span></div>
            </div>
            <a href="/entertainment/profile/edit" class="ent-btn ent-btn-sm" style="margin-top:16px">\u270F\u{FE0F} Edit Profile</a>
          </div>
        </div>

        <div class="ent-stats">
          ${profileStats.map(s => `
            <div class="ent-stat" style="border-top:3px solid ${s.color}">
              <div style="font-size:24px;margin-bottom:4px">${s.icon}</div>
              <div class="ent-stat-num" style="-webkit-text-fill-color:${s.color};background:none">${s.value}</div>
              <div class="ent-muted">${esc(s.label)}</div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          <a href="/entertainment/achievements" class="ent-btn ent-btn-sm">\u{1F3C6} ${esc(t(lang, 'Achievements'))}</a>
          <a href="/entertainment/streaks" class="ent-btn ent-btn-sm ent-btn-gold">\u{1F525} ${esc(t(lang, 'Streaks'))}</a>
          <a href="/entertainment/referrals" class="ent-btn ent-btn-sm ent-btn-green">\u{1F91D} ${esc(t(lang, 'Referrals'))}</a>
        </div>
      </div>
    `;
    res.send(entPage('Entertainment Profile', content, settings, lang));
  }));

  app.post('/entertainment/profile/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const displayName = sanitizeStr(req.body.display_name || '');
    const bio = sanitizeStr(req.body.bio || '');

    await pool.query(`
      INSERT INTO ent_user_profiles (tenant_id, user_email, display_name, bio)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET display_name = $3, bio = $4
    `, [tid, email, displayName, bio]);
    res.redirect('/entertainment/profile');
  }));

  // =========================================================================
  // 9 — CONTENT DISCOVERY
  // =========================================================================

  app.get('/entertainment/discover', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    const collections = [
      { title: t(lang, 'StaffPicks'), desc: 'Handpicked by our team', icon: '\u2B50', color: '#f59e0b', items: [
        { title: 'Best Student Films 2025', icon: '\u{1F3AC}' }, { title: 'Study Music Collection', icon: '\u{1F3B5}' }, { title: 'Brain Training Games', icon: '\u{1F9E0}' }
      ]},
      { title: t(lang, 'StudentFavorites'), desc: 'Most loved by students', icon: '\u2764\u{FE0F}', color: '#ef4444', items: [
        { title: 'Comedy Skits', icon: '\u{1F602}' }, { title: 'Afrobeats Hits', icon: '\u{1F3A7}' }, { title: 'Word Puzzles', icon: '\u{1F510}' }
      ]},
      { title: t(lang, 'Trending') + ' ' + t(lang, 'NewArrivals'), desc: 'Fresh content this week', icon: '\u{1F680}', color: '#6366f1', items: [
        { title: 'Tech Trends 2025', icon: '\u{1F4BB}' }, { title: 'Lo-Fi Beats New', icon: '\u{1F3B6}' }, { title: 'Speed Runner Challenge', icon: '\u{1F3C3}' }
      ]},
      { title: t(lang, 'HiddenGems'), desc: 'Undiscovered treasures', icon: '\u{1F48E}', color: '#8b5cf6', items: [
        { title: 'Indie Film Showcase', icon: '\u{1F3AC}' }, { title: 'Classical Study Music', icon: '\u{1F3BB}' }, { title: 'Logic Puzzle Pack', icon: '\u{1F9E9}' }
      ]}
    ];

    const categories = [
      { name: 'Action', icon: '\u{1F4A5}', color: '#ef4444' },
      { name: 'Comedy', icon: '\u{1F602}', color: '#f59e0b' },
      { name: 'Music', icon: '\u{1F3B5}', color: '#8b5cf6' },
      { name: 'Education', icon: '\u{1F4DA}', color: '#3b82f6' },
      { name: 'Sports', icon: '\u26BD', color: '#10b981' },
      { name: 'Drama', icon: '\u{1F3AD}', color: '#ec4899' },
      { name: 'Documentary', icon: '\u{1F3AC}', color: '#06b6d4' },
      { name: 'Gaming', icon: '\u{1F3AE}', color: '#f97316' }
    ];

    const content = `
      ${renderNav(lang, 'Discover')}
      <div class="ent-container">
        <div class="ent-hero" style="padding:35px 20px">
          <h1 style="font-size:32px;margin-bottom:8px">\u{1F50D} ${esc(t(lang, 'Discover'))}</h1>
          <p>Explore curated collections and find your next favorite</p>
        </div>

        ${collections.map(col => `
          <div class="ent-card">
            <div class="ent-flex-between" style="margin-bottom:16px">
              <div>
                <h2 style="font-size:20px">${col.icon} ${esc(col.title)}</h2>
                <div class="ent-muted">${esc(col.desc)}</div>
              </div>
              <span class="ent-tag" style="background:${col.color}22;color:${col.color}">See All</span>
            </div>
            <div style="display:flex;gap:16px;overflow-x:auto;padding-bottom:8px">
              ${col.items.map(item => `
                <div class="ent-card" style="min-width:200px;flex-shrink:0;text-align:center;border-top:3px solid ${col.color};cursor:pointer">
                  <div style="font-size:36px;margin-bottom:8px">${item.icon}</div>
                  <h4 style="font-size:14px">${esc(item.title)}</h4>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}

        <div class="ent-card">
          <h2 style="font-size:20px;margin-bottom:16px">\u{1F4C1} Browse Categories</h2>
          <div class="ent-grid">
            ${categories.map(cat => `
              <div class="ent-card" style="text-align:center;cursor:pointer;border-left:4px solid ${cat.color}" role="button" tabindex="0" aria-label="${esc(cat.name)}">
                <div style="font-size:36px;margin-bottom:8px">${cat.icon}</div>
                <h4 style="font-size:15px">${esc(cat.name)}</h4>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    res.send(entPage('Discover', content, settings, lang));
  }));

  // =========================================================================
  // 10 — ACCESSIBILITY SETTINGS
  // =========================================================================

  app.get('/entertainment/settings/accessibility', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    const fontSizes = [
      { value: 'small', label: 'Small (14px)' },
      { value: 'medium', label: 'Medium (16px)' },
      { value: 'large', label: 'Large (18px)' },
      { value: 'xl', label: 'Extra Large (20px)' }
    ];

    const content = `
      ${renderNav(lang, 'Settings')}
      <div class="ent-container">
        <div class="ent-card">
          <h2 style="font-size:22px;margin-bottom:20px">\u267F ${esc(t(lang, 'Accessibility'))}</h2>
          <form method="POST" action="/entertainment/settings/accessibility">

            <div style="margin-bottom:24px">
              <h3 style="margin-bottom:12px">\u{1F4F0} ${esc(t(lang, 'FontSize'))}</h3>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
                ${fontSizes.map(fs => `
                  <label style="display:block;padding:14px;border-radius:10px;text-align:center;cursor:pointer;border:2px solid ${settings.font_size === fs.value ? '#6366f1' : (settings.theme === 'dark' ? '#334155' : '#e2e8f0')};font-size:${fs.value === 'small' ? '14px' : fs.value === 'medium' ? '16px' : fs.value === 'large' ? '18px' : '20px'};${settings.theme === 'dark' ? 'background:#1e293b' : 'background:#f8fafc'}" role="radio" aria-checked="${settings.font_size === fs.value}">
                    <input type="radio" name="font_size" value="${esc(fs.value)}" ${settings.font_size === fs.value ? 'checked' : ''} style="margin-right:8px">
                    ${esc(fs.label)}
                  </label>
                `).join('')}
              </div>
            </div>

            <div style="margin-bottom:20px">
              <h3 style="margin-bottom:12px">\u{1F3A8} ${esc(t(lang, 'HighContrast'))}</h3>
              <div class="ent-flex-between" style="padding:14px;border-radius:10px;${settings.theme === 'dark' ? 'background:#1e293b' : 'background:#f8fafc'}">
                <div>
                  <div style="font-weight:600">Enable High Contrast</div>
                  <div class="ent-muted">Increase border visibility for better readability</div>
                </div>
                <button type="button" class="ent-toggle ${settings.high_contrast ? 'on' : 'off'}" onclick="this.classList.toggle('on');this.classList.toggle('off');this.nextElementSibling.value=this.classList.contains('on')?'true':'false'" role="switch" aria-checked="${settings.high_contrast}"></button>
                <input type="hidden" name="high_contrast" value="${settings.high_contrast ? 'true' : 'false'}">
              </div>
            </div>

            <div style="margin-bottom:20px">
              <h3 style="margin-bottom:12px">\u{1F3B3} ${esc(t(lang, 'ReducedMotion'))}</h3>
              <div class="ent-flex-between" style="padding:14px;border-radius:10px;${settings.theme === 'dark' ? 'background:#1e293b' : 'background:#f8fafc'}">
                <div>
                  <div style="font-weight:600">Enable Reduced Motion</div>
                  <div class="ent-muted">Disable animations and transitions</div>
                </div>
                <button type="button" class="ent-toggle ${settings.reduced_motion ? 'on' : 'off'}" onclick="this.classList.toggle('on');this.classList.toggle('off');this.nextElementSibling.value=this.classList.contains('on')?'true':'false'" role="switch" aria-checked="${settings.reduced_motion}"></button>
                <input type="hidden" name="reduced_motion" value="${settings.reduced_motion ? 'true' : 'false'}">
              </div>
            </div>

            <div style="margin-bottom:20px">
              <h3 style="margin-bottom:12px">\u{1F4DD} ${esc(t(lang, 'ScreenReaderHints'))}</h3>
              <div class="ent-alert ent-alert-info">
                Screen reader hints are enabled by default across all pages using ARIA labels, roles, and descriptive alt text. All interactive elements include proper keyboard navigation support.
              </div>
            </div>

            <button type="submit" class="ent-btn">${esc(t(lang, 'Save'))}</button>
          </form>
        </div>
      </div>
    `;
    res.send(entPage('Accessibility Settings', content, settings, lang));
  }));

  app.post('/entertainment/settings/accessibility', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const fontSize = ['small', 'medium', 'large', 'xl'].includes(req.body.font_size) ? req.body.font_size : 'medium';
    const highContrast = req.body.high_contrast === 'true';
    const reducedMotion = req.body.reduced_motion === 'true';

    await pool.query(`
      INSERT INTO ent_user_settings (tenant_id, user_email, font_size, high_contrast, reduced_motion)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET font_size = $3, high_contrast = $4, reduced_motion = $5
    `, [tid, email, fontSize, highContrast, reducedMotion]);
    res.redirect('/entertainment/settings/accessibility');
  }));

  // =========================================================================
  // 11 — OFFLINE CONTENT / DOWNLOAD MANAGER
  // =========================================================================

  app.get('/entertainment/offline', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    const downloads = (await pool.query(
      'SELECT * FROM ent_downloads WHERE tenant_id=$1 AND user_email=$2 ORDER BY downloaded_at DESC LIMIT 50', [tid, email]
    )).rows;

    const availableContent = [
      { type: 'Music', title: 'Chill Vibes Playlist', size: '45 MB', icon: '\u{1F3B5}', id: 'music-1' },
      { type: 'Music', title: 'Study Beats Collection', size: '62 MB', icon: '\u{1F3B6}', id: 'music-2' },
      { type: 'Audiobook', title: 'African Folk Tales', size: '120 MB', icon: '\u{1F4DA}', id: 'audio-1' },
      { type: 'Audiobook', title: 'Entrepreneurship 101', size: '89 MB', icon: '\u{1F4D6}', id: 'audio-2' },
      { type: 'Podcast', title: 'Campus Life Stories', size: '55 MB', icon: '\u{1F399}\u{FE0F}', id: 'pod-1' },
      { type: 'Music', title: 'Afrobeats 2025 Mix', size: '78 MB', icon: '\u{1F3A7}', id: 'music-3' }
    ];

    const totalStorage = downloads.length * 50; // approximate MB
    const maxStorage = 500;

    const content = `
      ${renderNav(lang, 'Offline')}
      <div class="ent-container">
        <div class="ent-hero" style="padding:35px 20px;background:linear-gradient(135deg,#06b6d4,#3b82f6)">
          <h1 style="font-size:32px;margin-bottom:8px">\u{1F4E6} ${esc(t(lang, 'DownloadManager'))}</h1>
          <p>Download music and audiobooks for offline enjoyment</p>
        </div>

        <div class="ent-card">
          <div class="ent-flex-between" style="margin-bottom:12px">
            <h3>\u{1F4BE} ${esc(t(lang, 'Storage'))}</h3>
            <span class="ent-tag">${totalStorage} MB / ${maxStorage} MB</span>
          </div>
          <div style="height:12px;border-radius:6px;background:${settings.theme === 'dark' ? '#334155' : '#e2e8f0'};overflow:hidden">
            <div style="height:100%;width:${Math.min(100, (totalStorage / maxStorage) * 100)}%;background:${totalStorage > maxStorage * 0.8 ? '#ef4444' : '#10b981'};border-radius:6px"></div>
          </div>
          <div class="ent-muted" style="margin-top:8px">${downloads.length} items downloaded</div>
        </div>

        <div class="ent-card">
          <h3 style="margin-bottom:16px">\u{1F4E5} Available for Download</h3>
          ${availableContent.map(c => {
            const isDownloaded = downloads.some(d => d.content_type === c.type && d.content_id === c.id);
            return `<div class="ent-flex-between" style="padding:14px 0;border-bottom:1px solid ${settings.theme === 'dark' ? '#334155' : '#f1f5f9'}">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="font-size:28px">${c.icon}</div>
                <div>
                  <div style="font-weight:600">${esc(c.title)}</div>
                  <div class="ent-muted">${esc(c.type)} &middot; ${esc(c.size)}</div>
                </div>
              </div>
              ${isDownloaded
                ? '<span class="ent-tag ent-tag-green">\u2713 ' + esc(t(lang, 'Downloaded')) + '</span>'
                : `<form method="POST" action="/entertainment/offline/download" style="display:inline"><input type="hidden" name="content_type" value="${esc(c.type)}"><input type="hidden" name="content_id" value="${esc(c.id)}"><button type="submit" class="ent-btn ent-btn-sm">\u{2B07} Download</button></form>`
              }
            </div>`;
          }).join('')}
        </div>

        ${downloads.length > 0 ? `
          <div class="ent-card">
            <h3 style="margin-bottom:16px">\u{1F4C1} My Downloads</h3>
            ${downloads.map(d => `
              <div class="ent-flex-between" style="padding:10px 0;border-bottom:1px solid ${settings.theme === 'dark' ? '#334155' : '#f1f5f9'}">
                <div>
                  <div style="font-weight:600">${esc(d.content_type)} #${esc(String(d.content_id))}</div>
                  <div class="ent-muted">${d.downloaded_at ? d.downloaded_at.toISOString().slice(0, 16).replace('T', ' ') : ''}</div>
                </div>
                <div style="display:flex;gap:8px">
                  <span class="ent-tag ent-tag-green">${esc(d.status)}</span>
                  <form method="POST" action="/entertainment/offline/remove" style="display:inline"><input type="hidden" name="id" value="${d.id}"><button type="submit" class="ent-btn ent-btn-sm" style="background:#ef4444;font-size:12px;padding:6px 12px">Remove</button></form>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
    res.send(entPage('Offline Content', content, settings, lang));
  }));

  app.post('/entertainment/offline/download', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const contentType = sanitizeStr(req.body.content_type || '');
    const contentId = sanitizeStr(req.body.content_id || '');

    try {
      await pool.query(`
        INSERT INTO ent_downloads (tenant_id, user_email, content_type, content_id, status)
        VALUES ($1, $2, $3, $4, 'downloaded')
      `, [tid, email, contentType, contentId]);
    } catch (e) { logger.warn('[Entertainment] Download error: ' + e.message); }
    res.redirect('/entertainment/offline');
  }));

  app.post('/entertainment/offline/remove', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const id = parseInt(req.body.id) || 0;
    if (id) {
      try { await pool.query('DELETE FROM ent_downloads WHERE id=$1 AND tenant_id=$2', [id, tid]); } catch (e) {}
    }
    res.redirect('/entertainment/offline');
  }));

  // =========================================================================
  // 12 — HELP & FAQ
  // =========================================================================

  app.get('/entertainment/help', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const email = user.email;
    const settings = await getUserSettings(tid, email);
    const lang = settings.language || 'en';

    const faqs = [
      { q: 'How do I earn coins?', a: 'You earn coins by maintaining daily streaks, watching videos, playing games, and referring friends. Check the streaks page for daily login rewards!' },
      { q: 'How does the referral program work?', a: 'Share your unique referral code with friends. When they sign up using your code, you earn 500 coins! Track all your referrals on the Referrals page.' },
      { q: 'How do I change the language?', a: 'Go to Settings > Language and choose from English, Luganda, Swahili, French, or Arabic. The entire interface will update to your selected language.' },
      { q: 'Can I download content for offline use?', a: 'Yes! Visit the Offline page to download music tracks and audiobooks. Downloaded content is available without an internet connection.' },
      { q: 'How do I earn achievement badges?', a: 'Achievements are unlocked automatically when you reach certain milestones like watching 10 videos, playing 20 games, or maintaining a 7-day streak. Visit the Achievements page to see all badges.' },
      { q: 'How do I enable dark mode?', a: 'Go to Settings > Theme and select Dark mode. You can switch back to Light mode at any time. Your preference is saved automatically.' },
      { q: 'Is my data private?', a: 'Yes, your profile data, preferences, and activity are private to your account. We use encryption and secure authentication to protect your information.' },
      { q: 'How do I report a bug?', a: 'Use the Report Bug form at the bottom of this page. Describe the issue you encountered and our team will investigate it promptly.' }
    ];

    const content = `
      ${renderNav(lang, 'Help')}
      <div class="ent-container">
        <div class="ent-hero" style="padding:35px 20px;background:linear-gradient(135deg,#10b981,#059669)">
          <h1 style="font-size:32px;margin-bottom:8px">\u{2753} ${esc(t(lang, 'Help'))}</h1>
          <p>Find answers and get support</p>
        </div>

        <div class="ent-card">
          <h2 style="font-size:20px;margin-bottom:16px">\u{1F4AC} Frequently Asked Questions</h2>
          ${faqs.map((faq, i) => `
            <div style="border-bottom:1px solid ${settings.theme === 'dark' ? '#334155' : '#f1f5f9'}">
              <button onclick="const a=this.nextElementSibling;a.style.display=a.style.display==='none'?'block':'none';this.querySelector('.faq-arrow').textContent=a.style.display==='none'?'\\u25B6':'\\u25BC'" style="width:100%;text-align:left;padding:16px 0;background:none;border:none;cursor:pointer;font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center;color:${settings.theme === 'dark' ? '#e2e8f0' : '#1e293b'}" aria-expanded="false" aria-controls="faq-${i}">
                <span>${esc(faq.q)}</span>
                <span class="faq-arrow">\u25B6</span>
              </button>
              <div id="faq-${i}" style="display:none;padding:0 0 16px;color:${settings.theme === 'dark' ? '#94a3b8' : '#64748b'};line-height:1.7" role="region">${esc(faq.a)}</div>
            </div>
          `).join('')}
        </div>

        <div class="ent-grid">
          <div class="ent-card">
            <h3 style="margin-bottom:16px">\u{1F4E7} ${esc(t(lang, 'ContactSupport'))}</h3>
            <form method="POST" action="/entertainment/help/contact">
              <label style="display:block;margin-bottom:12px;font-weight:600">Subject</label>
              <input name="subject" placeholder="What do you need help with?" required aria-label="Support subject">
              <label style="display:block;margin:12px 0;font-weight:600">Message</label>
              <textarea name="message" rows="4" placeholder="Describe your issue in detail..." required aria-label="Support message"></textarea>
              <button type="submit" class="ent-btn ent-btn-green" style="margin-top:12px">\u{1F4E8} ${esc(t(lang, 'Submit'))}</button>
            </form>
          </div>

          <div class="ent-card">
            <h3 style="margin-bottom:16px">\u{1F41B} ${esc(t(lang, 'ReportBug'))}</h3>
            <form method="POST" action="/entertainment/help/bug">
              <label style="display:block;margin-bottom:12px;font-weight:600">Bug Title</label>
              <input name="title" placeholder="Brief description of the bug" required aria-label="Bug title">
              <label style="display:block;margin:12px 0;font-weight:600">Steps to Reproduce</label>
              <textarea name="steps" rows="4" placeholder="1. Go to... 2. Click on... 3. See error..." required aria-label="Steps to reproduce"></textarea>
              <label style="display:block;margin:12px 0;font-weight:600">Expected Behavior</label>
              <textarea name="expected" rows="2" placeholder="What should happen instead?" aria-label="Expected behavior"></textarea>
              <button type="submit" class="ent-btn" style="margin-top:12px;background:linear-gradient(135deg,#ef4444,#dc2626)">\u{1F6A8} Report</button>
            </form>
          </div>
        </div>
      </div>
    `;
    res.send(entPage('Help & FAQ', content, settings, lang));
  }));

  app.post('/entertainment/help/contact', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const subject = sanitizeStr(req.body.subject || '');
    const message = sanitizeStr(req.body.message || '');
    logger.info(`[Entertainment] Support contact from ${user.email}: ${subject}`);
    res.redirect('/entertainment/help?sent=1');
  }));

  app.post('/entertainment/help/bug', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = user.tenant_id;
    const title = sanitizeStr(req.body.title || '');
    const steps = sanitizeStr(req.body.steps || '');
    logger.info(`[Entertainment] Bug report from ${user.email}: ${title}`);
    res.redirect('/entertainment/help?bug=1');
  }));

  // =========================================================================
  // STUB ROUTES for Videos, Music, Games, Social, Shorts, Live
  // =========================================================================

  const stubPages = [
    { path: '/entertainment/videos', title: 'Videos', icon: '\u{1F4FA}', desc: 'Watch trending videos, short films, documentaries, and more.' },
    { path: '/entertainment/music', title: 'Music', icon: '\u{1F3B5}', desc: 'Stream music, create playlists, and discover new artists.' },
    { path: '/entertainment/games', title: 'Games', icon: '\u{1F3AE}', desc: 'Play fun games, join tournaments, and challenge friends.' },
    { path: '/entertainment/social', title: 'Social', icon: '\u{1F4E3}', desc: 'Connect with friends, share posts, and build your network.' },
    { path: '/entertainment/shorts', title: 'Shorts', icon: '\u{1F4F9}', desc: 'Watch and create short-form entertainment content.' },
    { path: '/entertainment/live', title: 'Live', icon: '\u{1F534}', desc: 'Watch live streams and interact in real-time.' }
  ];

  for (const stub of stubPages) {
    app.get(stub.path, requireAuth, ah(async (req, res) => {
      const user = req.session.user;
      const tid = user.tenant_id;
      const email = user.email;
      const settings = await getUserSettings(tid, email);
      const lang = settings.language || 'en';

      const content = `
        ${renderNav(lang, stub.title)}
        <div class="ent-container">
          <div class="ent-hero" style="padding:40px 20px">
            <h1 style="font-size:36px;margin-bottom:8px">${stub.icon} ${esc(stub.title)}</h1>
            <p style="font-size:18px;opacity:.9">${esc(stub.desc)}</p>
          </div>
          <div class="ent-card" style="text-align:center;padding:60px 20px">
            <div style="font-size:64px;margin-bottom:16px">${stub.icon}</div>
            <h2 style="font-size:24px;margin-bottom:8px">Coming Soon</h2>
            <p class="ent-muted" style="max-width:400px;margin:0 auto">The ${esc(stub.title.toLowerCase())} section is being built. Check back soon for amazing content!</p>
            <a href="/entertainment/hub" class="ent-btn" style="margin-top:20px">\u{1F3E0} Back to Hub</a>
          </div>
        </div>
      `;
      res.send(entPage(stub.title, content, settings, lang));
    }));
  }

  // =========================================================================
  // DONE
  // =========================================================================

  logger.info('[Entertainment] PWA module loaded with 13 features, ' + MIGRATIONS.length + ' DB tables, ' + SUPPORTED_LANGS.length + ' languages, ' + ACHIEVEMENT_DEFS.length + ' achievements');
};
