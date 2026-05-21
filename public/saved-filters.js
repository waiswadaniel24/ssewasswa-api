/**
 * Saved Filters — Client-side UI for saving, recalling, and managing filter combinations
 * on list pages (students, invoices, fees, payments, etc.)
 * Vanilla JS — no framework dependencies
 * Works via fetch() API calls to /api/filters/*
 */
(function () {
  'use strict';

  // ── STYLES ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sf-styles')) return;
    var style = document.createElement('style');
    style.id = 'sf-styles';
    style.textContent = [
      /* Filter button */
      '.sf-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;border:2px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;transition:all 0.2s ease;white-space:nowrap}',
      '.sf-btn:hover{border-color:var(--primary);color:var(--primary);background:var(--bg-card-hover)}',
      '.sf-btn .sf-icon{font-size:14px}',
      '.sf-btn .sf-arrow{font-size:9px;transition:transform 0.2s ease}',
      '.sf-btn.sf-open .sf-arrow{transform:rotate(180deg)}',
      /* Dropdown panel */
      '.sf-panel{display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:280px;max-width:360px;background:var(--bg-card);border:1px solid var(--border);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,0.15);z-index:1100;padding:0;animation:sfFadeIn 0.2s cubic-bezier(0.16,1,0.3,1)}',
      '.sf-panel.sf-visible{display:block}',
      '.sf-panel-header{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
      '.sf-panel-header h4{margin:0;font-size:13px;font-weight:700;color:var(--text)}',
      '.sf-panel-body{max-height:300px;overflow-y:auto;padding:6px}',
      '.sf-panel-footer{padding:8px 12px;border-top:1px solid var(--border);display:flex;gap:6px}',
      /* Filter item */
      '.sf-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:all 0.15s ease;font-size:13px}',
      '.sf-item:hover{background:var(--bg-card-hover)}',
      '.sf-item-name{flex:1;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.sf-item-default{font-size:10px;padding:2px 8px;border-radius:10px;background:var(--primary);color:white;font-weight:600;flex-shrink:0}',
      '.sf-item-actions{display:flex;gap:2px;opacity:0;transition:opacity 0.15s ease}',
      '.sf-item:hover .sf-item-actions{opacity:1}',
      '.sf-action-btn{background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:6px;font-size:12px;color:var(--text-muted);transition:all 0.15s ease}',
      '.sf-action-btn:hover{background:rgba(99,102,241,0.1);color:var(--primary)}',
      '.sf-action-btn.sf-delete:hover{background:rgba(239,68,68,0.1);color:var(--danger)}',
      /* Save button in footer */
      '.sf-save-btn{flex:1;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:600;border:none;cursor:pointer;transition:all 0.2s ease;display:flex;align-items:center;justify-content:center;gap:5px}',
      '.sf-save-btn.sf-primary{background:linear-gradient(135deg,var(--primary-dark),var(--primary-light));color:white;box-shadow:0 2px 8px rgba(99,102,241,0.25)}',
      '.sf-save-btn.sf-primary:hover{box-shadow:0 4px 16px rgba(99,102,241,0.35);transform:translateY(-1px)}',
      '.sf-save-btn.sf-outline{background:transparent;border:2px solid var(--border);color:var(--text)}',
      '.sf-save-btn.sf-outline:hover{border-color:var(--primary);color:var(--primary)}',
      /* Empty state */
      '.sf-empty{padding:24px 16px;text-align:center;color:var(--text-muted);font-size:13px}',
      '.sf-empty-icon{font-size:28px;margin-bottom:6px;opacity:0.5}',
      /* Save dialog */
      '.sf-dialog-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:2000;display:flex;align-items:center;justify-content:center;animation:sfFadeIn 0.15s ease}',
      '.sf-dialog{background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2);animation:sfSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)}',
      '.sf-dialog h3{margin:0 0 16px;font-size:16px;font-weight:700;color:var(--text)}',
      '.sf-dialog label{display:block;font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px}',
      '.sf-dialog input[type="text"]{width:100%;padding:12px 16px;margin:0 0 12px;border:2px solid var(--border);border-radius:10px;font-size:14px;background:var(--input-bg);color:var(--text)}',
      '.sf-dialog input[type="text"]:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 4px rgba(99,102,241,0.1)}',
      '.sf-dialog .sf-checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:var(--text);cursor:pointer}',
      '.sf-dialog .sf-checkbox-row input[type="checkbox"]{width:auto;margin:0;cursor:pointer}',
      '.sf-dialog-actions{display:flex;gap:8px;justify-content:flex-end}',
      '.sf-dialog-actions button{padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all 0.2s ease}',
      '.sf-dialog-actions .sf-cancel{background:transparent;border:2px solid var(--border);color:var(--text)}',
      '.sf-dialog-actions .sf-cancel:hover{border-color:var(--primary);color:var(--primary)}',
      '.sf-dialog-actions .sf-confirm{background:linear-gradient(135deg,var(--primary-dark),var(--primary-light));color:white;box-shadow:0 2px 8px rgba(99,102,241,0.25)}',
      '.sf-dialog-actions .sf-confirm:hover{box-shadow:0 4px 16px rgba(99,102,241,0.35)}',
      /* Bookmark indicator on the filter button */
      '.sf-bookmark{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;font-size:11px;background:linear-gradient(135deg,var(--primary),var(--accent));color:white;border-radius:4px;font-weight:700;position:relative;top:-1px;margin-left:2px}',
      /* Animations */
      '@keyframes sfFadeIn{from{opacity:0;transform:translateY(-8px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes sfSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}',
      /* Responsive */
      '@media(max-width:768px){.sf-panel{right:-60px;min-width:260px}.sf-item-actions{opacity:1}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── UTILITY: Get current page path for scoping filters ──────
  function getCurrentPage() {
    return window.location.pathname;
  }

  // ── UTILITY: Collect current filter values from the page ────
  function collectCurrentFilters() {
    var filters = {};
    // Look for common filter form patterns
    var filterForms = document.querySelectorAll('form[method="GET"], form.filter-form, form.search-form, form[action]');
    // Also look for standalone filter inputs not in forms
    var filterInputs = document.querySelectorAll(
      'input[name][type!="hidden"][type!="submit"][type!="button"], ' +
      'select[name], ' +
      'input[type="search"][name], ' +
      'input[name="q"], input[name="search"], input[name="status"], ' +
      'input[name="class"], input[name="term"], input[name="year"], ' +
      'input[name="from"], input[name="to"], input[name="start_date"], input[name="end_date"], ' +
      'select[name="status"], select[name="class"], select[name="term"], select[name="year"], ' +
      'select[name="type"], select[name="category"], select[name="role"]'
    );
    filterInputs.forEach(function (input) {
      var name = input.getAttribute('name');
      if (!name || name === '_csrf' || name === '_validated') return;
      var value = input.value;
      if (value && value.trim() !== '') {
        filters[name] = value;
      }
    });
    // Also capture query params from URL
    var urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach(function (value, key) {
      if (key !== 'page' && key !== 'limit' && value && value.trim() !== '') {
        if (!filters[key]) filters[key] = value;
      }
    });
    return filters;
  }

  // ── UTILITY: Apply filter values to form inputs ─────────────
  function applyFilters(filters) {
    if (!filters || typeof filters !== 'object') return;
    Object.keys(filters).forEach(function (key) {
      var input = document.querySelector('[name="' + key + '"]');
      if (input) {
        input.value = filters[key];
        // Trigger change event for any listeners
        var event = new Event('change', { bubbles: true });
        input.dispatchEvent(event);
        var inputEvent = new Event('input', { bubbles: true });
        input.dispatchEvent(inputEvent);
      }
    });
    // Find the first form and submit it
    var form = document.querySelector('form');
    if (form) {
      form.submit();
    }
  }

  // ── API CALLS ──────────────────────────────────────────────
  function apiCall(url, method, body) {
    var options = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    // Add CSRF token
    if (method && method !== 'GET') {
      options.headers['X-CSRF-Token'] = window.CSRF_TOKEN || '';
    }
    return fetch(url, options).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadFilters(page) {
    return apiCall('/api/filters/list?page=' + encodeURIComponent(page));
  }

  function saveFilter(name, page, filters, isDefault) {
    return apiCall('/api/filters/save', 'POST', { name: name, page: page, filters: filters, is_default: isDefault });
  }

  function deleteFilter(id) {
    return apiCall('/api/filters/delete/' + id, 'POST');
  }

  function setDefaultFilter(id) {
    return apiCall('/api/filters/default/' + id, 'POST');
  }

  // ── RENDER: Save dialog ────────────────────────────────────
  function showSaveDialog(page, filters) {
    var existingOverlay = document.querySelector('.sf-dialog-overlay');
    if (existingOverlay) existingOverlay.remove();

    var overlay = document.createElement('div');
    overlay.className = 'sf-dialog-overlay';
    var hasFilters = Object.keys(filters).length > 0;

    overlay.innerHTML =
      '<div class="sf-dialog">' +
        '<h3>💾 Save Current Filters</h3>' +
        (hasFilters ? '' : '<div style="padding:12px;background:rgba(245,158,11,0.1);border-radius:10px;margin-bottom:12px;font-size:13px;color:#92400e">⚠️ No active filters detected. Apply some filters first, then save them.</div>') +
        '<label>Filter Name</label>' +
        '<input type="text" id="sf-filter-name" placeholder="e.g. Active P7 Students" maxlength="100" autofocus>' +
        '<label class="sf-checkbox-row">' +
          '<input type="checkbox" id="sf-filter-default">' +
          'Set as default for this page' +
        '</label>' +
        '<div class="sf-dialog-actions">' +
          '<button class="sf-cancel" id="sf-cancel-save">Cancel</button>' +
          '<button class="sf-confirm" id="sf-confirm-save">Save Filter</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Focus the name input
    setTimeout(function () {
      var nameInput = document.getElementById('sf-filter-name');
      if (nameInput) nameInput.focus();
    }, 100);

    // Cancel
    document.getElementById('sf-cancel-save').addEventListener('click', function () {
      overlay.remove();
    });

    // Click overlay to close
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // Save
    document.getElementById('sf-confirm-save').addEventListener('click', function () {
      var name = (document.getElementById('sf-filter-name').value || '').trim();
      if (!name) {
        document.getElementById('sf-filter-name').style.borderColor = '#ef4444';
        document.getElementById('sf-filter-name').focus();
        return;
      }
      var isDefault = document.getElementById('sf-filter-default').checked;
      saveFilter(name, page, filters, isDefault).then(function (data) {
        if (data.success) {
          overlay.remove();
          if (typeof showToast === 'function') showToast('Filter "' + name + '" saved!', 'success');
          // Refresh the panel
          var panel = document.querySelector('.sf-panel');
          if (panel) refreshFilterList(panel, page);
        }
      }).catch(function () {
        if (typeof showToast === 'function') showToast('Error saving filter', 'error');
      });
    });

    // Enter key to save
    document.getElementById('sf-filter-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('sf-confirm-save').click();
      }
    });

    // Escape key to cancel
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') overlay.remove();
    });
  }

  // ── RENDER: Filter list in panel ───────────────────────────
  function renderFilterList(panelBody, filters, page) {
    if (!filters || filters.length === 0) {
      panelBody.innerHTML =
        '<div class="sf-empty">' +
          '<div class="sf-empty-icon">🔖</div>' +
          '<div>No saved filters yet</div>' +
          '<div style="margin-top:4px;font-size:11px;opacity:0.7">Apply filters and save them for quick access</div>' +
        '</div>';
      return;
    }

    var html = '';
    filters.forEach(function (f) {
      html +=
        '<div class="sf-item" data-filter-id="' + f.id + '">' +
          '<span class="sf-item-name" title="' + (f.name || '') + '">' +
            '🔖 ' + escapeHtml(f.name) +
          '</span>' +
          (f.is_default ? '<span class="sf-item-default">Default</span>' : '') +
          '<span class="sf-item-actions">' +
            '<button class="sf-action-btn" data-action="default" data-id="' + f.id + '" title="Set as default">⭐</button>' +
            '<button class="sf-action-btn sf-delete" data-action="delete" data-id="' + f.id + '" title="Delete filter">🗑</button>' +
          '</span>' +
        '</div>';
    });
    panelBody.innerHTML = html;

    // Apply filter on click
    panelBody.querySelectorAll('.sf-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        // Don't apply if clicking an action button
        if (e.target.closest('.sf-action-btn')) return;
        var id = parseInt(item.getAttribute('data-filter-id'));
        apiCall('/api/filters/apply/' + id, 'POST').then(function (data) {
          if (data.success && data.filter && data.filter.filters) {
            applyFilters(data.filter.filters);
          }
        }).catch(function () {
          if (typeof showToast === 'function') showToast('Error applying filter', 'error');
        });
      });
    });

    // Set as default
    panelBody.querySelectorAll('[data-action="default"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = parseInt(btn.getAttribute('data-id'));
        setDefaultFilter(id).then(function (data) {
          if (data.success) {
            if (typeof showToast === 'function') showToast('Default filter updated!', 'success');
            refreshFilterList(panelBody.closest('.sf-panel'), page);
          }
        }).catch(function () {
          if (typeof showToast === 'function') showToast('Error setting default', 'error');
        });
      });
    });

    // Delete
    panelBody.querySelectorAll('[data-action="delete"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = parseInt(btn.getAttribute('data-id'));
        var item = btn.closest('.sf-item');
        var name = item.querySelector('.sf-item-name').textContent.trim().replace('🔖 ', '');
        if (!confirm('Delete filter "' + name + '"?')) return;
        deleteFilter(id).then(function (data) {
          if (data.success) {
            if (typeof showToast === 'function') showToast('Filter deleted', 'info');
            refreshFilterList(panelBody.closest('.sf-panel'), page);
          }
        }).catch(function () {
          if (typeof showToast === 'function') showToast('Error deleting filter', 'error');
        });
      });
    });
  }

  // ── REFRESH filter list ────────────────────────────────────
  function refreshFilterList(panel, page) {
    var panelBody = panel.querySelector('.sf-panel-body');
    if (!panelBody) return;
    panelBody.innerHTML = '<div class="sf-empty"><div style="opacity:0.5">Loading...</div></div>';
    loadFilters(page).then(function (data) {
      if (data.success) {
        renderFilterList(panelBody, data.filters, page);
        // Update bookmark badge count
        updateBookmarkBadge(panel, data.filters.length);
      }
    }).catch(function () {
      panelBody.innerHTML = '<div class="sf-empty"><div>Error loading filters</div></div>';
    });
  }

  // ── Update bookmark badge on the button ────────────────────
  function updateBookmarkBadge(btn, count) {
    var existing = btn.querySelector('.sf-bookmark');
    if (existing) existing.remove();
    if (count > 0) {
      var badge = document.createElement('span');
      badge.className = 'sf-bookmark';
      badge.textContent = count > 9 ? '9+' : count;
      btn.appendChild(badge);
    }
  }

  // ── HTML escape utility ────────────────────────────────────
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── CLOSE all panels on outside click ──────────────────────
  document.addEventListener('click', function (e) {
    var panels = document.querySelectorAll('.sf-panel.sf-visible');
    panels.forEach(function (panel) {
      var wrapper = panel.closest('.sf-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        panel.classList.remove('sf-visible');
        var btn = wrapper.querySelector('.sf-btn');
        if (btn) btn.classList.remove('sf-open');
      }
    });
  });

  // ── KEYBOARD: Escape closes panels ─────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var panels = document.querySelectorAll('.sf-panel.sf-visible');
      panels.forEach(function (panel) {
        panel.classList.remove('sf-visible');
        var btn = panel.closest('.sf-wrapper').querySelector('.sf-btn');
        if (btn) btn.classList.remove('sf-open');
      });
      // Also close any save dialog
      var overlay = document.querySelector('.sf-dialog-overlay');
      if (overlay) overlay.remove();
    }
  });

  // ── INIT: Find filter forms and inject the saved filters UI ─
  function init() {
    var page = getCurrentPage();

    // Skip non-list pages
    var listPagePatterns = [
      '/school/students', '/invoicing/list', '/fees', '/payments/transactions',
      '/payments', '/invoices', '/church/members', '/members', '/staff',
      '/inventory', '/students', '/transactions', '/donations', '/expenses',
      '/appointments', '/patients', '/hr/employees', '/customers',
      '/crm/leads', '/support/tickets', '/library/books',
      '/events', '/projects', '/tasks', '/sermons', '/orders',
      '/school/fees', '/school/attendance', '/school/exams',
      '/fee', '/attendance', '/exam'
    ];

    var isListPage = listPagePatterns.some(function (pattern) {
      return page.indexOf(pattern) > -1;
    });

    // Also check for filter forms on any page
    var hasFilterInputs = document.querySelectorAll(
      'input[name="status"], select[name="status"], input[name="class"], select[name="class"], ' +
      'input[name="q"], input[name="search"], input[name="term"], select[name="term"]'
    ).length > 0;

    if (!isListPage && !hasFilterInputs) return;

    // Find the best place to insert the button
    // Look for page header, search bar, or form
    var pageHeader = document.querySelector('.page-header');
    var searchBar = document.querySelector('.search-bar');
    var filterForm = document.querySelector('form[method="GET"], form.filter-form, form.search-form');
    var pageActions = document.querySelector('.page-actions');

    // Determine insertion point
    var insertTarget = null;
    var insertMethod = 'append'; // or 'prepend'

    if (pageActions) {
      insertTarget = pageActions;
      insertMethod = 'prepend';
    } else if (pageHeader) {
      // Create page-actions div if not exists
      pageActions = document.createElement('div');
      pageActions.className = 'page-actions';
      pageHeader.appendChild(pageActions);
      insertTarget = pageActions;
      insertMethod = 'prepend';
    } else if (searchBar) {
      insertTarget = searchBar;
      insertMethod = 'append';
    } else if (filterForm) {
      // Insert before the form
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap';
      filterForm.parentNode.insertBefore(wrapper, filterForm);
      insertTarget = wrapper;
      insertMethod = 'append';
    } else {
      // Create a container at the top of main content
      var container = document.querySelector('.container') || document.querySelector('main');
      if (!container) return;
      var topBar = document.createElement('div');
      topBar.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap;justify-content:flex-end';
      container.insertBefore(topBar, container.firstChild);
      insertTarget = topBar;
      insertMethod = 'append';
    }

    // Create the saved filters button and dropdown
    var sfWrapper = document.createElement('div');
    sfWrapper.className = 'sf-wrapper';
    sfWrapper.style.cssText = 'position:relative;display:inline-block';

    var sfBtn = document.createElement('button');
    sfBtn.className = 'sf-btn';
    sfBtn.type = 'button';
    sfBtn.innerHTML = '<span class="sf-icon">🔖</span> Saved Filters <span class="sf-arrow">▾</span>';

    var sfPanel = document.createElement('div');
    sfPanel.className = 'sf-panel';
    sfPanel.innerHTML =
      '<div class="sf-panel-header">' +
        '<h4>Saved Filters</h4>' +
      '</div>' +
      '<div class="sf-panel-body">' +
        '<div class="sf-empty"><div style="opacity:0.5">Loading...</div></div>' +
      '</div>' +
      '<div class="sf-panel-footer">' +
        '<button class="sf-save-btn sf-primary" id="sf-save-current">' +
          '💾 Save Current Filters' +
        '</button>' +
      '</div>';

    sfWrapper.appendChild(sfBtn);
    sfWrapper.appendChild(sfPanel);

    if (insertMethod === 'prepend') {
      insertTarget.insertBefore(sfWrapper, insertTarget.firstChild);
    } else {
      insertTarget.appendChild(sfWrapper);
    }

    // Toggle panel
    sfBtn.addEventListener('click', function () {
      var isOpen = sfPanel.classList.contains('sf-visible');
      if (isOpen) {
        sfPanel.classList.remove('sf-visible');
        sfBtn.classList.remove('sf-open');
      } else {
        sfPanel.classList.add('sf-visible');
        sfBtn.classList.add('sf-open');
        refreshFilterList(sfPanel, page);
      }
    });

    // Save current filters button
    sfPanel.querySelector('#sf-save-current').addEventListener('click', function () {
      var filters = collectCurrentFilters();
      sfPanel.classList.remove('sf-visible');
      sfBtn.classList.remove('sf-open');
      showSaveDialog(page, filters);
    });

    // Load initial count for badge
    loadFilters(page).then(function (data) {
      if (data.success && data.filters.length > 0) {
        updateBookmarkBadge(sfBtn, data.filters.length);

        // Auto-apply default filter if no URL params exist
        var urlParams = new URLSearchParams(window.location.search);
        var hasExistingFilters = false;
        urlParams.forEach(function (value, key) {
          if (key !== 'page' && key !== 'limit' && value) hasExistingFilters = true;
        });

        if (!hasExistingFilters) {
          var defaultFilter = data.filters.find(function (f) { return f.is_default; });
          if (defaultFilter && defaultFilter.filters) {
            // Apply default filter by redirecting with query params
            var params = new URLSearchParams();
            Object.keys(defaultFilter.filters).forEach(function (key) {
              params.set(key, defaultFilter.filters[key]);
            });
            // Only redirect if there are actual filter values to apply
            if (params.toString()) {
              window.location.href = page + '?' + params.toString();
            }
          }
        }
      }
    }).catch(function () { /* silent fail */ });
  }

  // ── BOOTSTRAP ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      injectStyles();
      init();
    });
  } else {
    injectStyles();
    init();
  }

})();
