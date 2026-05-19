/* ============================================================
   UI Foundation — Client-side Toast, Loading, Button State
   Ssewasswa Platform
   Vanilla JS — no framework dependencies
   ============================================================ */
(function() {
  'use strict';

  // ── TOAST SYSTEM ──────────────────────────────────────────

  var MAX_VISIBLE = 5;
  var container = null;
  var activeToasts = [];

  var ICONS = {
    success: '\u2713',  // ✓
    error:   '\u2715',  // ✕
    warning: '\u26A0',  // ⚠
    info:    '\u2139'   // ℹ
  };

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.id = 'ui-toast-container';
      container.setAttribute('role', 'alert');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  function removeToast(toastEl) {
    if (toastEl._dismissed) return;
    toastEl._dismissed = true;

    // Clear auto-dismiss timer
    if (toastEl._timer) {
      clearTimeout(toastEl._timer);
      toastEl._timer = null;
    }
    if (toastEl._progressTimer) {
      clearInterval(toastEl._progressTimer);
      toastEl._progressTimer = null;
    }

    // Animate out
    toastEl.classList.add('ui-toast-dismissing');

    setTimeout(function() {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
      var idx = activeToasts.indexOf(toastEl);
      if (idx > -1) activeToasts.splice(idx, 1);
    }, 300);
  }

  /**
   * Show a toast notification.
   * @param {string} message  — The message text
   * @param {string} type     — 'success' | 'error' | 'warning' | 'info'
   * @param {number} duration — Auto-dismiss in ms, 0 = no auto-dismiss
   */
  window.showToast = function(message, type, duration) {
    type = type || 'info';
    duration = (duration !== undefined) ? duration : 4000;

    // Validate type
    if (!ICONS[type]) type = 'info';

    var c = getContainer();

    // Enforce max visible — remove oldest if exceeded
    while (activeToasts.length >= MAX_VISIBLE) {
      removeToast(activeToasts[0]);
    }

    // Build toast element
    var toast = document.createElement('div');
    toast.className = 'ui-toast ui-toast--' + type;
    toast.setAttribute('role', 'alert');

    // Icon
    var iconEl = document.createElement('div');
    iconEl.className = 'ui-toast-icon';
    iconEl.textContent = ICONS[type];
    toast.appendChild(iconEl);

    // Body
    var body = document.createElement('div');
    body.className = 'ui-toast-body';
    body.textContent = message;
    toast.appendChild(body);

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ui-toast-close';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function(e) {
      e.stopPropagation();
      removeToast(toast);
    };
    toast.appendChild(closeBtn);

    // Click to dismiss
    toast.onclick = function() {
      removeToast(toast);
    };

    // Progress bar (for auto-dismiss)
    var progressBar = null;
    if (duration > 0) {
      progressBar = document.createElement('div');
      progressBar.className = 'ui-toast-progress';
      progressBar.style.width = '100%';
      toast.appendChild(progressBar);
    }

    c.appendChild(toast);
    activeToasts.push(toast);

    // Auto-dismiss with progress bar
    if (duration > 0) {
      var startTime = Date.now();
      var progressInterval = 50; // update every 50ms

      toast._progressTimer = setInterval(function() {
        var elapsed = Date.now() - startTime;
        var remaining = Math.max(0, 1 - (elapsed / duration));
        if (progressBar) {
          progressBar.style.width = (remaining * 100) + '%';
        }
        if (elapsed >= duration) {
          removeToast(toast);
        }
      }, progressInterval);

      // Fallback timer in case progress timer drifts
      toast._timer = setTimeout(function() {
        removeToast(toast);
      }, duration + 200);
    }

    return toast;
  };

  // Convenience methods
  window.showToast.success = function(message, duration) {
    return window.showToast(message, 'success', duration);
  };
  window.showToast.error = function(message, duration) {
    return window.showToast(message, 'error', duration);
  };
  window.showToast.warning = function(message, duration) {
    return window.showToast(message, 'warning', duration);
  };
  window.showToast.info = function(message, duration) {
    return window.showToast(message, 'info', duration);
  };

  // ── LOADING OVERLAY ───────────────────────────────────────

  var loadingEl = null;

  /**
   * Show a full-screen loading overlay.
   * @param {string} message — Loading message text
   */
  window.showLoading = function(message) {
    message = message || 'Loading...';

    // Remove existing if present
    if (loadingEl) {
      hideLoadingImmediate();
    }

    loadingEl = document.createElement('div');
    loadingEl.id = 'ui-loading-overlay';
    loadingEl.setAttribute('role', 'alert');
    loadingEl.setAttribute('aria-busy', 'true');

    var spinner = document.createElement('div');
    spinner.className = 'ui-loading-spinner';
    loadingEl.appendChild(spinner);

    var msgEl = document.createElement('div');
    msgEl.className = 'ui-loading-message';
    msgEl.textContent = message;
    loadingEl.appendChild(msgEl);

    document.body.appendChild(loadingEl);

    // Prevent scrolling
    document.body.style.overflow = 'hidden';
  };

  function hideLoadingImmediate() {
    if (loadingEl) {
      loadingEl.classList.add('ui-loading-dismissing');
      var el = loadingEl;
      loadingEl = null;
      setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 200);
      document.body.style.overflow = '';
    }
  }

  /**
   * Hide the loading overlay.
   */
  window.hideLoading = function() {
    hideLoadingImmediate();
  };

  // ── BUTTON STATE MANAGEMENT ───────────────────────────────

  /**
   * Toggle a button's loading state.
   * @param {HTMLElement} btn      — The button element
   * @param {boolean} loading      — true = show loading, false = restore
   * @param {string} loadingText   — Text to show while loading (default "Processing...")
   */
  window.setButtonLoading = function(btn, loading, loadingText) {
    if (!btn) return;
    loadingText = loadingText || 'Processing...';

    if (loading) {
      // Save original state
      btn._uiOriginalText = btn.textContent;
      btn._uiOriginalDisabled = btn.disabled;

      // Apply loading state
      btn.disabled = true;
      btn.classList.add('ui-btn-loading');

      // Insert spinner
      var spinner = document.createElement('span');
      spinner.className = 'ui-btn-spinner';

      // Detect if button has dark or light background
      var computed = window.getComputedStyle(btn);
      var bg = computed.backgroundColor;
      var isLight = false;
      // Simple heuristic: if background color is light, use dark spinner
      if (bg) {
        var match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          var brightness = (parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000;
          isLight = brightness > 128;
        }
      }
      // For outline buttons with no background
      if (btn.classList.contains('btn-outline')) isLight = true;

      if (isLight) {
        spinner.classList.add('btn-spinner-dark');
      }

      btn.textContent = '';
      btn.appendChild(spinner);
      btn.appendChild(document.createTextNode(loadingText));

    } else {
      // Restore original state
      btn.disabled = btn._uiOriginalDisabled || false;
      btn.classList.remove('ui-btn-loading');

      // Remove spinner if present
      var existingSpinner = btn.querySelector('.ui-btn-spinner');
      if (existingSpinner) existingSpinner.remove();

      // Restore text
      if (btn._uiOriginalText !== undefined) {
        btn.textContent = btn._uiOriginalText;
      }

      // Clean up
      delete btn._uiOriginalText;
      delete btn._uiOriginalDisabled;
    }
  };

  // ── SKELETON HELPER ───────────────────────────────────────

  /**
   * Create a skeleton placeholder element.
   * @param {string} type — 'text' | 'card' | 'avatar' | 'table-row'
   * @param {object} opts — Optional: { count: number } to create multiple
   * @returns {HTMLElement|DocumentFragment}
   */
  window.createSkeleton = function(type, opts) {
    opts = opts || {};
    var count = opts.count || 1;
    var frag = document.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var el = document.createElement('div');
      el.className = 'skeleton skeleton-' + type;
      el.setAttribute('aria-hidden', 'true');
      frag.appendChild(el);
    }

    return count === 1 ? frag.firstChild : frag;
  };

  // ── AUTO-INIT ─────────────────────────────────────────────
  // Pre-create the container so toasts are ready immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', getContainer);
  } else {
    getContainer();
  }

})();

// === Dashboard Auto-Refresh ===
(function() {
  'use strict';

  // Only activate on dashboard pages
  if (!document.querySelector('[data-dashboard]')) return;

  var refreshInterval = 60000; // 60 seconds
  var wsRefreshEnabled = false;
  var lastRefresh = 0;
  var MIN_REFRESH_GAP = 5000; // Don't refresh more than once per 5s

  // Try WebSocket first — listen for dashboard:refresh events
  function attachWsListener() {
    var ws = window._ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.addEventListener('message', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'dashboard:refresh') {
            var now = Date.now();
            if (now - lastRefresh > MIN_REFRESH_GAP) {
              lastRefresh = now;
              refreshDashboardData(data.section || 'all');
            }
          }
        } catch(err) {}
      });
      wsRefreshEnabled = true;
      console.log('[Dashboard Auto-Refresh] WebSocket listener attached');
    }
  }

  // Try immediately, then retry after WS connects
  attachWsListener();
  if (!wsRefreshEnabled) {
    // Poll for WS availability (it may connect after page load)
    var wsCheckInterval = setInterval(function() {
      if (window._ws && window._ws.readyState === WebSocket.OPEN) {
        attachWsListener();
        clearInterval(wsCheckInterval);
      }
    }, 2000);
    // Give up after 10s
    setTimeout(function() { clearInterval(wsCheckInterval); }, 10000);
  }

  // Polling fallback — refresh every 60s
  setInterval(function() {
    refreshDashboardData('all');
  }, refreshInterval);

  function refreshDashboardData(section) {
    fetch('/api/dashboard/stats')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        if (data && data.success && data.stats) {
          updateStatCards(data.stats);
        }
      })
      .catch(function(err) {
        // Silent fail — don't disrupt user
        console.warn('[Dashboard Auto-Refresh] Stats fetch failed:', err.message);
      });

    // Also refresh chart data if section is 'charts' or 'all'
    if (section === 'charts' || section === 'all') {
      refreshChartData();
    }
  }

  function updateStatCards(data) {
    Object.keys(data).forEach(function(key) {
      var el = document.querySelector('[data-stat="' + key + '"]');
      if (el) {
        var oldValue = el.textContent.trim();
        var newValue = formatStatValue(data[key]);
        if (oldValue !== newValue) {
          el.textContent = newValue;
          // Brief highlight animation
          el.style.transition = 'background 0.3s';
          el.style.background = 'rgba(16, 185, 129, 0.15)';
          el.style.borderRadius = '4px';
          setTimeout(function() { el.style.background = ''; }, 1500);
        }
      }
    });
  }

  function formatStatValue(val) {
    if (typeof val === 'number') {
      return val >= 1000000 ? (val/1000000).toFixed(1) + 'M'
           : val >= 1000 ? (val/1000).toFixed(1) + 'K'
           : val.toString();
    }
    if (typeof val === 'string' && val.indexOf('UGX') === -1 && !isNaN(parseInt(val))) {
      var num = parseInt(val);
      return 'UGX ' + (num >= 1000000 ? (num/1000000).toFixed(1) + 'M'
           : num >= 1000 ? (num/1000).toFixed(1) + 'K'
           : num.toLocaleString());
    }
    return val;
  }

  function refreshChartData() {
    // Refresh Chart.js charts if they exist
    var charts = window.Chart && Chart.instances;
    if (!charts) return;
    // For now, chart refresh is opt-in per dashboard page
    // Individual dashboards can override window._refreshDashboardCharts
    if (typeof window._refreshDashboardCharts === 'function') {
      window._refreshDashboardCharts();
    }
  }

  console.log('[Dashboard Auto-Refresh] Initialized (WS: ' + wsRefreshEnabled + ', polling: 60s)');
})();
