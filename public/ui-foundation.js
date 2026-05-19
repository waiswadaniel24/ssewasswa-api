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

  // Try WebSocket first — listen for dashboard:refresh and dashboard:update events
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
          // Enhanced: handle direct data payloads without HTTP round-trip
          if (data.type === 'dashboard:update' && data.data) {
            Object.keys(data.data).forEach(function(key) {
              var el = document.querySelector('[data-stat="' + key + '"]');
              if (el) {
                var oldVal = el.textContent.trim();
                var newVal = formatStatValue(data.data[key]);
                if (oldVal !== newVal) {
                  el.textContent = newVal;
                  el.style.transition = 'background 0.3s';
                  el.style.background = 'rgba(16, 185, 129, 0.15)';
                  el.style.borderRadius = '4px';
                  setTimeout(function() { el.style.background = ''; }, 1500);
                  // Show toast for significant changes
                  var oldNum = parseInt(oldVal.replace(/[^\d-]/g, ''));
                  var newNum = parseInt(newVal.replace(/[^\d-]/g, ''));
                  if (!isNaN(oldNum) && !isNaN(newNum) && Math.abs(newNum - oldNum) > 0) {
                    if (typeof showToast === 'function') showToast('Dashboard updated', 'info', 2000);
                  }
                }
              }
            });
          }
        } catch(err) {}
      });
      wsRefreshEnabled = true;
      console.log('[Dashboard Auto-Refresh] WebSocket listener attached (with dashboard:update support)');
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

// === Dashboard Customization ===
(function() {
  'use strict';

  // Only activate on dashboard pages
  if (!document.querySelector('[data-dashboard]')) return;

  // Create the customization panel HTML and inject it
  var panel = document.createElement('div');
  panel.id = 'dashboard-customize-panel';
  panel.style.cssText = 'display:none;position:fixed;right:0;top:0;width:320px;height:100%;background:#1e293b;color:#fff;z-index:9990;padding:24px;overflow-y:auto;box-shadow:-4px 0 20px rgba(0,0,0,0.3);transition:transform 0.3s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
  panel.innerHTML = '<h3 style="margin:0 0 20px;font-size:18px">Customize Dashboard</h3>' +
    '<div id="widget-toggles" style="display:flex;flex-direction:column;gap:12px"></div>' +
    '<div style="margin-top:20px"><label style="display:block;margin-bottom:8px;font-size:14px;color:#94a3b8">Layout</label>' +
    '<select id="dashboard-layout" style="width:100%;padding:8px;background:#334155;color:#fff;border:1px solid #475569;border-radius:6px;font-size:14px">' +
    '<option value="default">Default (4 columns)</option>' +
    '<option value="2col">2 Columns</option>' +
    '<option value="3col">3 Columns</option>' +
    '<option value="full">Full Width</option>' +
    '</select></div>' +
    '<div style="margin-top:24px;display:flex;gap:8px">' +
    '<button onclick="saveDashboardPrefs()" style="flex:1;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Save</button>' +
    '<button onclick="resetDashboardPrefs()" style="flex:1;padding:10px;background:#64748b;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Reset</button>' +
    '<button onclick="toggleCustomizePanel()" style="padding:10px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Close</button>' +
    '</div>';
  document.body.appendChild(panel);

  // Add the "Customize" button next to each dashboard hero
  var dashboards = document.querySelectorAll('[data-dashboard]');
  dashboards.forEach(function(container) {
    var hero = container.querySelector('.hero, h1');
    if (hero && !container.querySelector('.dashboard-customize-btn')) {
      var btn = document.createElement('button');
      btn.className = 'dashboard-customize-btn';
      btn.innerHTML = '&#9881; Customize';
      btn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;z-index:10;backdrop-filter:blur(4px)';
      btn.onclick = function(e) { e.preventDefault(); window.toggleCustomizePanel(); };
      // Make the hero position relative so button is positioned correctly
      var heroParent = hero.closest('.hero') || hero.parentElement;
      if (heroParent) {
        heroParent.style.position = 'relative';
        heroParent.appendChild(btn);
      }
    }
  });

  // Load saved preferences on page load
  loadDashboardPrefs();

  // Toggle customization panel
  window.toggleCustomizePanel = function() {
    var panel = document.getElementById('dashboard-customize-panel');
    if (!panel) return;
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      populateWidgetToggles();
    } else {
      panel.style.display = 'none';
    }
  };

  // Populate toggle switches in the panel based on current widgets
  function populateWidgetToggles() {
    var togglesContainer = document.getElementById('widget-toggles');
    if (!togglesContainer) return;
    togglesContainer.innerHTML = '';
    var widgets = document.querySelectorAll('[data-widget]');
    widgets.forEach(function(el) {
      var widgetName = el.dataset.widget;
      var label = widgetName.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      var isVisible = el.style.display !== 'none';
      var toggleRow = document.createElement('div');
      toggleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #334155';
      toggleRow.innerHTML = '<span style="font-size:14px">' + label + '</span>' +
        '<label style="position:relative;display:inline-block;width:44px;height:24px">' +
        '<input type="checkbox" id="toggle-' + widgetName + '" ' + (isVisible ? 'checked' : '') +
        ' style="opacity:0;width:0;height:0" onchange="toggleWidget(\'' + widgetName + '\', this.checked)">' +
        '<span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:' + (isVisible ? '#4f46e5' : '#475569') + ';border-radius:24px;transition:0.3s"></span>' +
        '<span style="position:absolute;content:\'\';height:18px;width:18px;left:' + (isVisible ? '22px' : '4px') + ';bottom:3px;background:white;border-radius:50%;transition:0.3s"></span>' +
        '</label>';
      togglesContainer.appendChild(toggleRow);
    });
  }

  // Toggle a widget's visibility
  window.toggleWidget = function(widgetId, visible) {
    var el = document.querySelector('[data-widget="' + widgetId + '"]');
    if (el) {
      el.style.display = visible ? '' : 'none';
    }
    // Update toggle switch visual
    var toggle = document.getElementById('toggle-' + widgetId);
    if (toggle) {
      var slider = toggle.parentElement.querySelector('span:first-of-type');
      var dot = toggle.parentElement.querySelector('span:last-of-type');
      if (slider) slider.style.background = visible ? '#4f46e5' : '#475569';
      if (dot) dot.style.left = visible ? '22px' : '4px';
    }
  };

  // Load dashboard preferences from API
  window.loadDashboardPrefs = function() {
    fetch('/api/dashboard/prefs').then(function(r) { return r.json(); }).then(function(d) {
      // Apply layout
      var container = document.querySelector('[data-dashboard]');
      if (container && d.layout && d.layout !== 'default') {
        // Remove any existing layout classes
        container.className = container.className.replace(/dashboard-layout-\S+/g, '').trim();
        container.classList.add('dashboard-layout-' + d.layout);
        applyLayoutCSS(d.layout);
      }
      // Apply widget visibility
      if (d.widgets && Array.isArray(d.widgets)) {
        d.widgets.forEach(function(w) {
          var el = document.querySelector('[data-widget="' + w.id + '"]');
          if (el) el.style.display = w.visible ? '' : 'none';
        });
      }
    }).catch(function() { /* silent fail */ });
  };

  // Save dashboard preferences
  window.saveDashboardPrefs = function() {
    var widgets = [];
    document.querySelectorAll('[data-widget]').forEach(function(el) {
      var toggle = document.getElementById('toggle-' + el.dataset.widget);
      widgets.push({ id: el.dataset.widget, visible: toggle ? toggle.checked : true });
    });
    var layoutEl = document.getElementById('dashboard-layout');
    var layout = layoutEl ? layoutEl.value : 'default';
    fetch('/api/dashboard/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
      body: JSON.stringify({ widgets: widgets, layout: layout })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) {
        if (typeof showToast === 'function') showToast('Dashboard preferences saved!', 'success');
        toggleCustomizePanel();
        loadDashboardPrefs();
      }
    }).catch(function() {
      if (typeof showToast === 'function') showToast('Error saving preferences', 'error');
    });
  };

  // Reset dashboard preferences
  window.resetDashboardPrefs = function() {
    document.querySelectorAll('[data-widget]').forEach(function(el) { el.style.display = ''; });
    var container = document.querySelector('[data-dashboard]');
    if (container) container.className = container.className.replace(/dashboard-layout-\S+/g, '').trim();
    removeLayoutCSS();
    if (typeof showToast === 'function') showToast('Dashboard reset to default', 'info');
  };

  // Apply layout CSS dynamically
  function applyLayoutCSS(layout) {
    removeLayoutCSS();
    var style = document.createElement('style');
    style.id = 'dashboard-layout-style';
    var css = '';
    if (layout === '2col') {
      css = '[data-dashboard] .stats { grid-template-columns: repeat(2, 1fr) !important; }';
    } else if (layout === '3col') {
      css = '[data-dashboard] .stats { grid-template-columns: repeat(3, 1fr) !important; }';
    } else if (layout === 'full') {
      css = '[data-dashboard] .stats { grid-template-columns: 1fr !important; }';
    }
    if (css) {
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function removeLayoutCSS() {
    var existing = document.getElementById('dashboard-layout-style');
    if (existing) existing.remove();
  }

  console.log('[Dashboard Customization] Initialized');
})();
