/**
 * FormValidator — Universal Client-Side Form Validation
 * Standalone, zero-dependency, works on Chrome 60+, Safari 12+, Firefox 60+.
 * Auto-attaches to all <form> elements on DOMContentLoaded.
 *
 * Usage:
 *   <script src="/form-validator.js"></script>
 *
 * Supported attributes:
 *   required              — field cannot be empty
 *   minlength="N"         — minimum character length
 *   maxlength="N"         — maximum character length
 *   pattern="regex"       — regex pattern (partial match)
 *   type="email"          — validates email format
 *   type="tel"            — validates Uganda phone (256/077/078/070/075/074/071/072/073/076/079)
 *   type="number"         — validates numeric
 *   min="N" / max="N"     — numeric range
 *   data-match="selector" — must match another field (e.g. confirm password)
 *   data-min-words="N"    — minimum word count
 *   data-ugx="true"       — validates as UGX currency amount
 *   data-no-special="true"— no special characters
 *
 * CSS classes added:
 *   .fv-invalid  — red border on invalid field
 *   .fv-valid    — green border on valid field
 *   .fv-error    — red error message element below field
 *   .fv-toast    — summary toast at top of page
 */
(function () {
  'use strict';

  // ── Custom rules registry ───────────────────────────────────
  var customRules = {};

  // ── Error messages ──────────────────────────────────────────
  var defaultMessages = {
    required: 'This field is required',
    email: 'Please enter a valid email address',
    tel: 'Please enter a valid Uganda phone number (e.g. +256 7XX XXX XXX)',
    number: 'Please enter a valid number',
    url: 'Please enter a valid URL',
    minlength: function (field) {
      return 'Minimum ' + field.getAttribute('minlength') + ' characters required';
    },
    maxlength: function (field) {
      return 'Maximum ' + field.getAttribute('maxlength') + ' characters allowed';
    },
    min: function (field) {
      return 'Minimum value is ' + field.getAttribute('min');
    },
    max: function (field) {
      return 'Maximum value is ' + field.getAttribute('max');
    },
    pattern: 'Invalid format',
    match: function (field) {
      return 'Does not match ' + (field.getAttribute('data-match-label') || 'the other field');
    },
    minWords: function (field) {
      return 'Minimum ' + field.getAttribute('data-min-words') + ' words required';
    },
    ugx: 'Please enter a valid UGX amount (e.g. 50000 or 50,000)',
    noSpecial: 'Special characters are not allowed',
    custom: 'Invalid value'
  };

  // ── Uganda phone regex ──────────────────────────────────────
  // Matches: +256, 256 followed by 7X... or 07X... patterns
  var ugPhoneRegex = /^(\+256|256|0)(7[0-9]{8}|3[0-9]{8})$/;

  // ── Email regex (practical, not RFC-5322-complete) ──────────
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ── UGX amount regex ────────────────────────────────────────
  var ugxRegex = /^[\d,]+(\.\d{1,2})?$/;

  // ── No-special-chars regex ──────────────────────────────────
  var noSpecialRegex = /^[a-zA-Z0-9\s]*$/;

  // ── Inject styles ───────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('fv-styles')) return;
    var style = document.createElement('style');
    style.id = 'fv-styles';
    style.textContent = [
      '.fv-invalid{border-color:#ef4444!important;box-shadow:0 0 0 3px rgba(239,68,68,0.12)!important}',
      '.fv-valid{border-color:#10b981!important}',
      '.fv-error{color:#ef4444;font-size:12px;font-weight:500;margin-top:4px;display:flex;align-items:center;gap:4px;animation:fvFadeIn 0.25s ease forwards}',
      '.fv-error::before{content:"\\2717";display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#fef2f2;color:#ef4444;font-size:10px;font-weight:700;flex-shrink:0}',
      '.fv-valid-icon{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#d1fae5;color:#059669;font-size:11px;font-weight:700;animation:fvPop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards}',
      '.fv-invalid-icon{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;animation:fvPop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards}',
      '.fv-field-wrap{position:relative}',
      '.fv-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;background:#fff;border:2px solid #ef4444;border-radius:12px;padding:14px 24px;box-shadow:0 16px 48px rgba(0,0,0,0.15);max-width:420px;width:90%;animation:fvSlideDown 0.35s cubic-bezier(0.16,1,0.3,1) forwards}',
      '.fv-toast-title{color:#dc2626;font-weight:700;font-size:15px;margin-bottom:6px;display:flex;align-items:center;gap:8px}',
      '.fv-toast-title::before{content:"\\26A0";font-size:18px}',
      '.fv-toast-list{color:#7f1d1d;font-size:13px;line-height:1.6}',
      '.fv-toast-close{position:absolute;top:10px;right:14px;background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8;padding:0;line-height:1}',
      '.fv-toast-close:hover{color:#1e293b}',
      '@keyframes fvFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes fvPop{from{opacity:0;transform:translateY(-50%) scale(0.5)}to{opacity:1;transform:translateY(-50%) scale(1)}}',
      '@keyframes fvSlideDown{from{opacity:0;transform:translateX(-50%) translateY(-20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
      '@media(prefers-reduced-motion:reduce){.fv-error,.fv-valid-icon,.fv-invalid-icon,.fv-toast{animation:none}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── Utility: wrap a field if not already wrapped ────────────
  function ensureWrap(field) {
    var parent = field.parentElement;
    if (parent && parent.classList.contains('fv-field-wrap')) return parent;
    var wrap = document.createElement('div');
    wrap.className = 'fv-field-wrap';
    wrap.style.position = 'relative';
    field.parentNode.insertBefore(wrap, field);
    wrap.appendChild(field);
    return wrap;
  }

  // ── Utility: get or create error element ────────────────────
  function getErrorEl(field) {
    var wrap = field.parentElement;
    if (!wrap || !wrap.classList.contains('fv-field-wrap')) wrap = ensureWrap(field);
    var existing = wrap.querySelector('.fv-error');
    if (existing) return existing;
    var el = document.createElement('div');
    el.className = 'fv-error';
    el.setAttribute('role', 'alert');
    wrap.appendChild(el);
    return el;
  }

  // ── Utility: remove status icon ─────────────────────────────
  function removeStatusIcon(field) {
    var wrap = field.parentElement;
    if (!wrap || !wrap.classList.contains('fv-field-wrap')) return;
    var icons = wrap.querySelectorAll('.fv-valid-icon, .fv-invalid-icon');
    for (var i = 0; i < icons.length; i++) icons[i].remove();
  }

  // ── Utility: add status icon ────────────────────────────────
  function addStatusIcon(field, isValid) {
    removeStatusIcon(field);
    var wrap = field.parentElement;
    if (!wrap || !wrap.classList.contains('fv-field-wrap')) return;
    // Don't add icon on empty non-required fields
    if (!field.value.trim() && !field.hasAttribute('required')) return;
    var icon = document.createElement('span');
    icon.className = isValid ? 'fv-valid-icon' : 'fv-invalid-icon';
    icon.textContent = isValid ? '\u2713' : '\u2717';
    wrap.appendChild(icon);
  }

  // ── Utility: strip non-digit chars for phone comparison ─────
  function stripPhone(s) {
    return s.replace(/[\s\-\(\)\+]/g, '');
  }

  // ── Validate a single field ─────────────────────────────────
  function validateField(field) {
    // Skip hidden, disabled, readonly, and button/submit/reset fields
    if (!field.offsetParent && field.type !== 'hidden') return { valid: true, errors: [] };
    if (field.disabled || field.readOnly) return { valid: true, errors: [] };
    var tag = field.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' && (field.type === 'submit' || field.type === 'button' || field.type === 'reset' || field.type === 'hidden' || field.type === 'image' || field.type === 'file')) return { valid: true, errors: [] };
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // ok
    } else {
      return { valid: true, errors: [] };
    }

    var value = field.value;
    var trimmed = value.trim();
    var errors = [];
    var type = (field.getAttribute('type') || '').toLowerCase();

    // required
    if (field.hasAttribute('required')) {
      if (tag === 'SELECT') {
        if (!trimmed) errors.push(typeof defaultMessages.required === 'function' ? defaultMessages.required(field) : defaultMessages.required);
      } else if (!trimmed) {
        errors.push(typeof defaultMessages.required === 'function' ? defaultMessages.required(field) : defaultMessages.required);
      }
    }

    // If empty and not required, skip remaining checks
    if (!trimmed && !field.hasAttribute('required')) {
      return { valid: true, errors: [] };
    }

    // type="email"
    if (type === 'email' && trimmed) {
      if (!emailRegex.test(trimmed)) {
        errors.push(typeof defaultMessages.email === 'function' ? defaultMessages.email(field) : defaultMessages.email);
      }
    }

    // type="tel" — Uganda phone validation
    if (type === 'tel' && trimmed) {
      var phoneClean = stripPhone(trimmed);
      if (!ugPhoneRegex.test(phoneClean)) {
        errors.push(typeof defaultMessages.tel === 'function' ? defaultMessages.tel(field) : defaultMessages.tel);
      }
    }

    // type="number"
    if (type === 'number' && trimmed) {
      if (isNaN(Number(trimmed))) {
        errors.push(typeof defaultMessages.number === 'function' ? defaultMessages.number(field) : defaultMessages.number);
      } else {
        var numVal = Number(trimmed);
        // min
        if (field.hasAttribute('min') && numVal < Number(field.getAttribute('min'))) {
          errors.push(typeof defaultMessages.min === 'function' ? defaultMessages.min(field) : defaultMessages.min);
        }
        // max
        if (field.hasAttribute('max') && numVal > Number(field.getAttribute('max'))) {
          errors.push(typeof defaultMessages.max === 'function' ? defaultMessages.max(field) : defaultMessages.max);
        }
      }
    }

    // minlength
    if (field.hasAttribute('minlength') && trimmed) {
      var minLen = parseInt(field.getAttribute('minlength'), 10);
      if (trimmed.length < minLen) {
        errors.push(typeof defaultMessages.minlength === 'function' ? defaultMessages.minlength(field) : defaultMessages.minlength);
      }
    }

    // maxlength
    if (field.hasAttribute('maxlength') && trimmed) {
      var maxLen = parseInt(field.getAttribute('maxlength'), 10);
      if (trimmed.length > maxLen) {
        errors.push(typeof defaultMessages.maxlength === 'function' ? defaultMessages.maxlength(field) : defaultMessages.maxlength);
      }
    }

    // pattern
    if (field.hasAttribute('pattern') && trimmed) {
      var re = new RegExp('^(?:' + field.getAttribute('pattern') + ')$');
      if (!re.test(trimmed)) {
        errors.push(typeof defaultMessages.pattern === 'function' ? defaultMessages.pattern(field) : defaultMessages.pattern);
      }
    }

    // data-match — must match another field
    if (field.hasAttribute('data-match') && trimmed) {
      var selector = field.getAttribute('data-match');
      var otherField = document.querySelector(selector);
      if (otherField && trimmed !== otherField.value) {
        errors.push(typeof defaultMessages.match === 'function' ? defaultMessages.match(field) : defaultMessages.match);
      }
    }

    // data-min-words
    if (field.hasAttribute('data-min-words') && trimmed) {
      var minWords = parseInt(field.getAttribute('data-min-words'), 10);
      var wordCount = trimmed.split(/\s+/).filter(Boolean).length;
      if (wordCount < minWords) {
        errors.push(typeof defaultMessages.minWords === 'function' ? defaultMessages.minWords(field) : defaultMessages.minWords);
      }
    }

    // data-ugx — UGX currency validation
    if (field.getAttribute('data-ugx') === 'true' && trimmed) {
      if (!ugxRegex.test(trimmed)) {
        errors.push(typeof defaultMessages.ugx === 'function' ? defaultMessages.ugx(field) : defaultMessages.ugx);
      }
    }

    // data-no-special — no special characters
    if (field.getAttribute('data-no-special') === 'true' && trimmed) {
      if (!noSpecialRegex.test(trimmed)) {
        errors.push(typeof defaultMessages.noSpecial === 'function' ? defaultMessages.noSpecial(field) : defaultMessages.noSpecial);
      }
    }

    // Custom rules
    var ruleName = field.getAttribute('data-fv-rule');
    if (ruleName && customRules[ruleName]) {
      var result = customRules[ruleName](trimmed, field);
      if (result === false) {
        errors.push(typeof defaultMessages.custom === 'function' ? defaultMessages.custom(field) : defaultMessages.custom);
      } else if (typeof result === 'string') {
        errors.push(result);
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ── Show / clear field state ────────────────────────────────
  function showFieldState(field, result) {
    ensureWrap(field);
    var errorEl = getErrorEl(field);

    if (result.valid) {
      field.classList.remove('fv-invalid');
      field.classList.add('fv-valid');
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      addStatusIcon(field, true);
    } else {
      field.classList.remove('fv-valid');
      field.classList.add('fv-invalid');
      errorEl.textContent = result.errors[0]; // show first error
      errorEl.style.display = '';
      addStatusIcon(field, false);
    }
  }

  function clearFieldState(field) {
    field.classList.remove('fv-invalid', 'fv-valid');
    var wrap = field.parentElement;
    if (wrap && wrap.classList.contains('fv-field-wrap')) {
      var errorEl = wrap.querySelector('.fv-error');
      if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
      var icons = wrap.querySelectorAll('.fv-valid-icon, .fv-invalid-icon');
      for (var i = 0; i < icons.length; i++) icons[i].remove();
    }
  }

  // ── Toast ───────────────────────────────────────────────────
  function showToast(form, invalidFields) {
    // Remove existing toast
    var existing = document.getElementById('fv-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'fv-toast';
    toast.className = 'fv-toast';
    toast.setAttribute('role', 'alert');

    var title = document.createElement('div');
    title.className = 'fv-toast-title';
    title.textContent = 'Please fix ' + invalidFields.length + ' error' + (invalidFields.length > 1 ? 's' : '');

    var list = document.createElement('div');
    list.className = 'fv-toast-list';
    var items = [];
    for (var i = 0; i < invalidFields.length && i < 5; i++) {
      var f = invalidFields[i].field;
      var label = f.getAttribute('placeholder') || f.getAttribute('name') || f.getAttribute('aria-label') || 'Field';
      items.push('\u2022 ' + label + ': ' + invalidFields[i].error);
    }
    if (invalidFields.length > 5) {
      items.push('... and ' + (invalidFields.length - 5) + ' more');
    }
    list.textContent = items.join('\n');
    list.style.whiteSpace = 'pre-line';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'fv-toast-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.onclick = function () { toast.remove(); };

    toast.appendChild(closeBtn);
    toast.appendChild(title);
    toast.appendChild(list);
    document.body.appendChild(toast);

    // Auto-dismiss after 6 seconds
    setTimeout(function () {
      if (toast.parentNode) {
        toast.style.animation = 'fvFadeIn 0.25s ease reverse forwards';
        setTimeout(function () { if (toast.parentNode) toast.remove(); }, 250);
      }
    }, 6000);

    // Scroll first invalid field into view
    if (invalidFields.length > 0) {
      invalidFields[0].field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      invalidFields[0].field.focus();
    }
  }

  // ── Validate entire form ────────────────────────────────────
  function validateForm(form) {
    var fields = form.querySelectorAll('input, textarea, select');
    var allValid = true;
    var invalidFields = [];

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var result = validateField(field);
      showFieldState(field, result);
      if (!result.valid) {
        allValid = false;
        invalidFields.push({ field: field, error: result.errors[0] });
      }
    }

    if (!allValid) {
      showToast(form, invalidFields);
    }

    return allValid;
  }

  // ── Attach to a form ────────────────────────────────────────
  function attachToForm(form) {
    if (form._fvAttached) return;
    form._fvAttached = true;

    var fields = form.querySelectorAll('input, textarea, select');

    // Wrap fields and attach real-time validation
    for (var i = 0; i < fields.length; i++) {
      (function (field) {
        // Skip hidden/submit/button/reset
        var tag = field.tagName;
        var type = (field.getAttribute('type') || '').toLowerCase();
        if (tag === 'BUTTON' || type === 'submit' || type === 'button' || type === 'reset' || type === 'hidden' || type === 'image' || type === 'file') return;

        ensureWrap(field);

        // Validate on blur
        field.addEventListener('blur', function () {
          if (field.value.trim()) { // only validate if user has typed something
            var result = validateField(field);
            showFieldState(field, result);
          }
        });

        // Validate on input (real-time after first interaction)
        var hasInteracted = false;
        field.addEventListener('input', function () {
          if (!hasInteracted) {
            hasInteracted = true;
          }
          // Only validate in real-time if field has been blurred at least once
          // or already has a validation class
          if (field.classList.contains('fv-invalid') || field.classList.contains('fv-valid') || hasInteracted) {
            var result = validateField(field);
            showFieldState(field, result);
          }
        });

        // Also validate when data-match target changes
        if (field.hasAttribute('data-match')) {
          var selector = field.getAttribute('data-match');
          var otherField = document.querySelector(selector);
          if (otherField) {
            otherField.addEventListener('input', function () {
              if (field.value.trim()) {
                var result = validateField(field);
                showFieldState(field, result);
              }
            });
          }
        }
      })(fields[i]);
    }

    // Intercept form submit
    form.addEventListener('submit', function (e) {
      // Remove any existing toast
      var existingToast = document.getElementById('fv-toast');
      if (existingToast) existingToast.remove();

      var isValid = validateForm(form);

      if (!isValid) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }

      // Add _validated=1 hidden field to signal server
      var validatedField = form.querySelector('input[name="_validated"]');
      if (!validatedField) {
        validatedField = document.createElement('input');
        validatedField.type = 'hidden';
        validatedField.name = '_validated';
        form.appendChild(validatedField);
      }
      validatedField.value = '1';

      // Disable submit buttons to prevent double-submit
      var submitBtns = form.querySelectorAll('button[type="submit"], input[type="submit"]');
      for (var j = 0; j < submitBtns.length; j++) {
        var btn = submitBtns[j];
        btn.disabled = true;
        btn._fvOriginalText = btn.textContent;
        btn.textContent = 'Submitting...';
        btn.style.opacity = '0.7';
      }

      // Re-enable after 10 seconds (safety net if page doesn't navigate)
      setTimeout(function () {
        for (var k = 0; k < submitBtns.length; k++) {
          submitBtns[k].disabled = false;
          if (submitBtns[k]._fvOriginalText) submitBtns[k].textContent = submitBtns[k]._fvOriginalText;
          submitBtns[k].style.opacity = '';
        }
      }, 10000);
    }, true); // capture phase to run before any other handlers
  }

  // ── Auto-attach on DOMContentLoaded ─────────────────────────
  function init() {
    injectStyles();
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      attachToForm(forms[i]);
    }
    // Watch for dynamically added forms
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var node = added[n];
            if (node.tagName === 'FORM') {
              attachToForm(node);
            } else if (node.querySelectorAll) {
              var subForms = node.querySelectorAll('form');
              for (var f = 0; f < subForms.length; f++) {
                attachToForm(subForms[f]);
              }
            }
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public API: FormValidator ───────────────────────────────
  window.FormValidator = {
    /**
     * Validate a specific form element
     * @param {HTMLFormElement} form
     * @returns {boolean} true if valid
     */
    validate: function (form) {
      if (typeof form === 'string') form = document.querySelector(form);
      if (!form) return false;
      return validateForm(form);
    },

    /**
     * Add a custom validation rule
     * @param {string} name — rule name (used as data-fv-rule="name")
     * @param {function} fn — validation function(value, field) => true|false|errorMessageString
     */
    addRule: function (name, fn) {
      if (typeof fn !== 'function') throw new Error('Rule must be a function');
      customRules[name] = fn;
    },

    /**
     * Reset validation state on a form
     * @param {HTMLFormElement} form
     */
    reset: function (form) {
      if (typeof form === 'string') form = document.querySelector(form);
      if (!form) return;
      var fields = form.querySelectorAll('input, textarea, select');
      for (var i = 0; i < fields.length; i++) {
        clearFieldState(fields[i]);
      }
      var toast = document.getElementById('fv-toast');
      if (toast) toast.remove();
    }
  };

})();
