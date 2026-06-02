// ============================================================
// === EMAIL VERIFICATION SYSTEM — 6-digit code verification ===
// ============================================================
// Provides email verification via 6-digit codes, status checking,
// and a middleware to require verified emails for certain actions.

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts = {}) {
  const esc = opts.esc || (s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const sendEmail = opts.sendEmail || (() => {});
  const audit = opts.audit || (() => {});
  const ah = opts.ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Authentication required' });
    next();
  });

  // ============================================================
  // IN-MEMORY RATE LIMITER (1 verification email per minute per address)
  // ============================================================
  const _sendRateLimit = new Map(); // email -> { sentAt }
  const SEND_COOLDOWN_MS = 60 * 1000; // 1 minute

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'EmailVerification', `CREATE TABLE IF NOT EXISTS email_verifications (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        code VARCHAR(6) NOT NULL,
        verified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )`);
      await migrateQuery(pool, 'EmailVerification', `CREATE INDEX IF NOT EXISTS idx_email_ver_email ON email_verifications(email)`);
      await migrateQuery(pool, 'EmailVerification', `CREATE INDEX IF NOT EXISTS idx_email_ver_email_code ON email_verifications(email, code)`);
      await migrateQuery(pool, 'EmailVerification', `CREATE INDEX IF NOT EXISTS idx_email_ver_expires ON email_verifications(expires_at)`);
      console.log('[EmailVerification] Migrations applied');
    } catch (e) {
      /* migration OK */
    }
  })();

  // ============================================================
  // HELPERS
  // ============================================================

  /** Generate a 6-digit verification code */
  function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /** Clean up expired verification codes (called periodically) */
  async function cleanupExpired() {
    try {
      await pool.query('DELETE FROM email_verifications WHERE expires_at < NOW()');
    } catch (e) { /* ignore cleanup errors */ }
  }

  // Run cleanup every 10 minutes
  setInterval(cleanupExpired, 10 * 60 * 1000);

  // ============================================================
  // ROUTES
  // ============================================================

  // 1. POST /api/verify-email/send — Generate and send a 6-digit code
  app.post('/api/verify-email/send', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const email = (req.body.email || user.email || '').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Valid email address required' });
    }

    // Rate limit: 1 per minute per email
    const lastSent = _sendRateLimit.get(email);
    if (lastSent && (Date.now() - lastSent.sentAt) < SEND_COOLDOWN_MS) {
      const waitMs = SEND_COOLDOWN_MS - (Date.now() - lastSent.sentAt);
      return res.status(429).json({
        success: false,
        error: `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code`,
        retryAfterMs: waitMs
      });
    }

    // Check if already verified
    const existingVerified = (await pool.query(
      `SELECT 1 FROM email_verifications WHERE email = $1 AND verified = true LIMIT 1`,
      [email]
    )).rows[0];
    if (existingVerified) {
      return res.json({ success: true, message: 'Email is already verified' });
    }

    // Invalidate any previous pending codes for this email
    await pool.query(
      `UPDATE email_verifications SET verified = true WHERE email = $1 AND verified = false AND expires_at > NOW()`,
      [email]
    );

    // Generate new code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      `INSERT INTO email_verifications (email, code, verified, expires_at) VALUES ($1, $2, false, $3)`,
      [email, code, expiresAt]
    );

    // Send the verification email
    const emailHtml = `
      <div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#10b981;margin:0">Comfort Zone</h1>
          <p style="color:#64748b">Email Verification</p>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center">
          <p style="margin:0 0 16px;color:#374151">Your verification code is:</p>
          <div style="font-size:36px;font-weight:700;letter-spacing:6px;color:#10b981;background:#f0fdf4;padding:16px;border-radius:8px;border:2px dashed #10b981">${esc(code)}</div>
          <p style="margin:16px 0 0;color:#64748b;font-size:13px">This code expires in 15 minutes. If you did not request this, please ignore this email.</p>
        </div>
        <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px">Comfort Zone — All-in-one management platform</p>
      </div>
    `;

    const emailSent = await sendEmail(email, 'Your Verification Code — Comfort Zone', emailHtml);

    if (!emailSent) {
      // If email couldn't be sent, still record the code but warn
      console.warn('[EmailVerification] Failed to send verification email to:', email);
      // Don't fail the request — the code is stored and could be checked manually
    }

    // Update rate limit tracker
    _sendRateLimit.set(email, { sentAt: Date.now() });

    // Audit log
    audit(email, 'verification_code_sent', `Verification code sent to ${email}`);

    res.json({
      success: true,
      message: 'Verification code sent to your email',
      expires_in_seconds: 900 // 15 minutes
    });
  }));

  // 2. POST /api/verify-email/confirm — Validate the code, mark email as verified
  app.post('/api/verify-email/confirm', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const email = (req.body.email || user.email || '').trim().toLowerCase();
    const code = (req.body.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: 'Code must be 6 digits' });
    }

    // Find the most recent unexpired, unverified code for this email
    const record = (await pool.query(
      `SELECT * FROM email_verifications
       WHERE email = $1 AND code = $2 AND verified = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    )).rows[0];

    if (!record) {
      // Check if already verified
      const alreadyVerified = (await pool.query(
        `SELECT 1 FROM email_verifications WHERE email = $1 AND verified = true LIMIT 1`,
        [email]
      )).rows[0];
      if (alreadyVerified) {
        return res.json({ success: true, message: 'Email is already verified' });
      }
      return res.status(400).json({ success: false, error: 'Invalid or expired verification code' });
    }

    // Mark as verified
    await pool.query(
      `UPDATE email_verifications SET verified = true WHERE id = $1`,
      [record.id]
    );

    // Invalidate all other pending codes for this email
    await pool.query(
      `UPDATE email_verifications SET verified = true WHERE email = $1 AND verified = false`,
      [email]
    );

    // Audit log
    audit(email, 'email_verified', `Email ${email} verified successfully`);

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  }));

  // 3. GET /api/verify-email/status?email=xxx — Check if an email is verified
  app.get('/api/verify-email/status', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const email = (req.query.email || user.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email parameter required' });
    }

    // Only allow checking own email (or super_admin can check any)
    if (email !== user.email && user.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'You can only check your own email verification status' });
    }

    const verified = (await pool.query(
      `SELECT 1 FROM email_verifications WHERE email = $1 AND verified = true LIMIT 1`,
      [email]
    )).rows[0];

    const pendingCode = (await pool.query(
      `SELECT expires_at FROM email_verifications WHERE email = $1 AND verified = false AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
      [email]
    )).rows[0];

    res.json({
      success: true,
      email: email,
      verified: !!verified,
      has_pending_code: !!pendingCode,
      pending_code_expires_at: pendingCode?.expires_at || null
    });
  }));

  // ============================================================
  // MIDDLEWARE: requireVerifiedEmail
  // Use as: app.get('/protected-route', requireVerifiedEmail, handler)
  // Checks if the logged-in user's email is verified before allowing access.
  // ============================================================
  const requireVerifiedEmail = async (req, res, next) => {
    // Must be authenticated first
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const email = req.session.user.email;
    if (!email) {
      return res.status(403).json({ error: 'Email verification required', verified: false });
    }

    try {
      const verified = (await pool.query(
        `SELECT 1 FROM email_verifications WHERE email = $1 AND verified = true LIMIT 1`,
        [email]
      )).rows[0];

      if (verified) {
        return next();
      }

      // Not verified — check if this is an API request or a page request
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({
          error: 'Email verification required',
          verified: false,
          message: 'Please verify your email address before accessing this feature'
        });
      }

      // Page request — redirect to verification page
      return res.redirect('/verify-email?required=1');
    } catch (e) {
      console.error('[EmailVerification] Middleware error:', e.message);
      // On DB error, allow through to avoid blocking users
      return next();
    }
  };

  // ============================================================
  // VERIFICATION PAGE: GET /verify-email — UI for entering the code
  // ============================================================
  app.get('/verify-email', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const email = user.email;
    const isRequired = req.query.required === '1';

    // Check if already verified
    const verified = (await pool.query(
      `SELECT 1 FROM email_verifications WHERE email = $1 AND verified = true LIMIT 1`,
      [email]
    )).rows[0];

    if (verified) {
      return res.redirect('/dashboard');
    }

    const pageTitle = 'Verify Your Email';
    const pageContent = `
      <div style="max-width:460px;margin:60px auto;text-align:center">
        <div style="font-size:64px;margin-bottom:16px">&#128231;</div>
        <h1 style="font-size:28px;margin-bottom:8px;color:#1e293b">Verify Your Email</h1>
        <p style="color:#64748b;margin-bottom:24px">
          ${isRequired ? 'You need to verify your email before accessing this feature.' : 'Verify your email to unlock all features.'}
          <br>We'll send a 6-digit code to <strong>${esc(email)}</strong>
        </p>

        <div id="sendSection">
          <button id="sendBtn" onclick="sendCode()" style="background:#10b981;color:white;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;border:none;cursor:pointer;width:100%">
            Send Verification Code
          </button>
        </div>

        <div id="verifySection" style="display:none">
          <p style="color:#64748b;margin-bottom:12px;font-size:14px">Enter the 6-digit code sent to your email:</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
            <input id="c1" type="text" maxlength="1" class="code-input" oninput="onDigit(this,1)" style="width:48px;height:56px;text-align:center;font-size:24px;font-weight:700;border:2px solid #d1d5db;border-radius:10px;outline:none" onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#d1d5db'">
            <input id="c2" type="text" maxlength="1" class="code-input" oninput="onDigit(this,2)" style="width:48px;height:56px;text-align:center;font-size:24px;font-weight:700;border:2px solid #d1d5db;border-radius:10px;outline:none" onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#d1d5db'">
            <input id="c3" type="text" maxlength="1" class="code-input" oninput="onDigit(this,3)" style="width:48px;height:56px;text-align:center;font-size:24px;font-weight:700;border:2px solid #d1d5db;border-radius:10px;outline:none" onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#d1d5db'">
            <input id="c4" type="text" maxlength="1" class="code-input" oninput="onDigit(this,4)" style="width:48px;height:56px;text-align:center;font-size:24px;font-weight:700;border:2px solid #d1d5db;border-radius:10px;outline:none" onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#d1d5db'">
            <input id="c5" type="text" maxlength="1" class="code-input" oninput="onDigit(this,5)" style="width:48px;height:56px;text-align:center;font-size:24px;font-weight:700;border:2px solid #d1d5db;border-radius:10px;outline:none" onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#d1d5db'">
            <input id="c6" type="text" maxlength="1" class="code-input" oninput="onDigit(this,6)" style="width:48px;height:56px;text-align:center;font-size:24px;font-weight:700;border:2px solid #d1d5db;border-radius:10px;outline:none" onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#d1d5db'">
          </div>
          <button id="verifyBtn" onclick="verifyCode()" style="background:#10b981;color:white;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;border:none;cursor:pointer;width:100%">Verify Code</button>
          <div id="errorMsg" style="color:#ef4444;margin-top:12px;font-size:14px;display:none"></div>
          <p style="color:#94a3b8;font-size:13px;margin-top:12px">
            Didn't receive the code? <a href="#" onclick="sendCode();return false" style="color:#10b981;font-weight:600">Resend</a>
          </p>
        </div>

        <div id="successSection" style="display:none">
          <div style="font-size:64px;margin-bottom:16px">&#9989;</div>
          <h2 style="color:#10b981">Email Verified!</h2>
          <p style="color:#64748b;margin-bottom:16px">Your email has been successfully verified.</p>
          <a href="/dashboard" style="background:#10b981;color:white;padding:14px 32px;border-radius:10px;font-size:16px;font-weight:700;text-decoration:none;display:inline-block">Go to Dashboard</a>
        </div>

        <div id="loading" style="display:none;color:#64748b;margin-top:16px">Sending...</div>
      </div>
      <script>
        function onDigit(el,idx){
          el.value=el.value.replace(/[^0-9]/g,'');
          if(el.value&&idx<6){document.getElementById('c'+(idx+1)).focus()}
          if(idx===6&&el.value){verifyCode()}
        }
        function sendCode(){
          var btn=document.getElementById('sendBtn');
          var loading=document.getElementById('loading');
          btn.disabled=true;btn.textContent='Sending...';loading.style.display='block';
          fetch('/api/verify-email/send',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]')?.content||''},body:JSON.stringify({})})
            .then(function(r){return r.json()})
            .then(function(d){
              loading.style.display='none';
              if(d.success){
                document.getElementById('sendSection').style.display='none';
                document.getElementById('verifySection').style.display='block';
                document.getElementById('c1').focus();
              } else {
                btn.disabled=false;btn.textContent='Send Verification Code';
                alert(d.error||'Failed to send code');
              }
            })
            .catch(function(){
              loading.style.display='none';btn.disabled=false;btn.textContent='Send Verification Code';
              alert('Network error. Please try again.');
            });
        }
        function verifyCode(){
          var code='';
          for(var i=1;i<=6;i++){code+=document.getElementById('c'+i).value}
          if(code.length!==6){return}
          var btn=document.getElementById('verifyBtn');
          var errEl=document.getElementById('errorMsg');
          btn.disabled=true;btn.textContent='Verifying...';errEl.style.display='none';
          fetch('/api/verify-email/confirm',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]')?.content||''},body:JSON.stringify({code:code})})
            .then(function(r){return r.json()})
            .then(function(d){
              if(d.success){
                document.getElementById('verifySection').style.display='none';
                document.getElementById('successSection').style.display='block';
              } else {
                btn.disabled=false;btn.textContent='Verify Code';
                errEl.textContent=d.error||'Invalid code';errEl.style.display='block';
                for(var i=1;i<=6;i++){document.getElementById('c'+i).value=''}
                document.getElementById('c1').focus();
              }
            })
            .catch(function(){
              btn.disabled=false;btn.textContent='Verify Code';
              errEl.textContent='Network error';errEl.style.display='block';
            });
        }
      </script>
    `;

    // Try to use renderPage if available (from opts or global)
    const renderPage = opts.renderPage || (typeof renderPage !== 'undefined' ? renderPage : null);
    if (renderPage) {
      res.send(renderPage(pageTitle, pageContent, user, req));
    } else {
      // Fallback: minimal page wrapper
      res.send(`<!DOCTYPE html><html><head><title>${esc(pageTitle)}</title>
        <meta name="csrf-token" content="${req.csrfToken || req.session?.csrfToken || ''}">
        <style>body{font-family:system-ui;background:#f8fafc;color:#1e293b;margin:0;padding:20px}</style>
      </head><body>${pageContent}</body></html>`);
    }
  }));

  // Expose middleware for use by other modules
  return { requireVerifiedEmail };
};
