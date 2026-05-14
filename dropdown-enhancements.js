/**
 * dropdown-enhancements.js
 *
 * Comprehensive dropdown select module for the Comfort Platform.
 * Converts categorical text inputs to styled <select> dropdowns across all forms.
 *
 * Usage in server.js:
 *   const dropdowns = require('./dropdown-enhancements')(app, pool, logger);
 *   // Then use: dropdowns.generateSelectHTML(...), dropdowns.injectDropdowns(...), etc.
 *
 * Middleware usage:
 *   app.use('/school', dropdowns.dropdownMiddleware);
 *   // res.locals.dropdowns is now available in all /school/* routes
 */

'use strict';

// ============================================================
// 1. DROPDOWN_OPTIONS — Static option mappings per field/context
// ============================================================

const DROPDOWN_OPTIONS = {

  // ---- Universal fields ----
  gender: {
    _context: 'universal',
    options: ['Male', 'Female'],
  },

  // ---- Student fields ----
  stream: {
    _context: 'student',
    options: ['North', 'South', 'East', 'West', 'A', 'B', 'C', 'D'],
  },
  student_status: {
    _context: 'student',
    field: 'status',
    options: ['Active', 'Inactive', 'Graduated', 'Transferred', 'Suspended'],
  },
  religion: {
    _context: 'student',
    options: ['Catholic', 'Protestant', 'Muslim', 'Seventh-Day Adventist', 'Orthodox', 'Hindu', 'Other'],
  },
  blood_group: {
    _context: 'student',
    options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  },
  nationality: {
    _context: 'student',
    options: ['Ugandan', 'Kenyan', 'Tanzanian', 'Rwandan', 'South Sudanese', 'Other'],
  },

  // ---- Fee fields ----
  fee_type: {
    _context: 'fee',
    options: ['Tuition', 'Exam', 'Library', 'Lab', 'Sports', 'Transport', 'Hostel', 'Uniform', 'Medical', 'Activity'],
  },
  fee_status: {
    _context: 'fee',
    field: 'status',
    options: ['Pending', 'Partial', 'Paid', 'Overdue', 'Waived'],
  },
  payment_method: {
    _context: 'fee',
    options: ['Cash', 'Mobile Money (MTN)', 'Mobile Money (Airtel)', 'Bank Transfer', 'Cheque'],
  },
  term: {
    _context: 'school',
    options: ['Term 1', 'Term 2', 'Term 3', 'Annual'],
  },

  // ---- Attendance fields ----
  attendance_status: {
    _context: 'attendance',
    field: 'status',
    options: ['Present', 'Absent', 'Late', 'Excused', 'Sick'],
  },

  // ---- Mark/Grade fields ----
  grade: {
    _context: 'marks',
    options: ['A', 'B', 'C', 'D', 'F', 'D1', 'D2', 'C3', 'C4', 'C5', 'C6', 'P7', 'P8', 'F9'],
  },

  // ---- Church Member fields ----
  membership_status: {
    _context: 'church',
    options: ['Active', 'Inactive', 'Visiting', 'Transferred', 'Deceased'],
  },
  marital_status: {
    _context: 'church',
    options: ['Single', 'Married', 'Widowed', 'Divorced'],
  },
  church_role: {
    _context: 'church',
    field: 'role',
    options: ['Pastor', 'Elder', 'Deacon', 'Deaconess', 'Member', 'Youth', 'Volunteer'],
  },
  sacrament_type: {
    _context: 'church',
    options: ['Baptism', 'Confirmation', 'Holy Communion', 'Marriage', 'Holy Orders', 'Anointing of the Sick'],
  },

  // ---- Business/Inventory fields ----
  inventory_category: {
    _context: 'inventory',
    field: 'category',
    options: ['Electronics', 'Furniture', 'Stationery', 'Equipment', 'Supplies', 'Food', 'Clothing', 'Other'],
  },
  inventory_status: {
    _context: 'inventory',
    field: 'status',
    options: ['In Stock', 'Low Stock', 'Out of Stock', 'Discontinued'],
  },
  payment_status: {
    _context: 'business',
    options: ['Paid', 'Unpaid', 'Partial', 'Overdue'],
  },

  // ---- Priority (generic, used in multiple contexts) ----
  priority: {
    _context: 'universal',
    options: ['Low', 'Medium', 'High', 'Urgent'],
  },
  priority_critical: {
    _context: 'universal',
    field: 'priority',
    options: ['Low', 'Medium', 'High', 'Critical'],
  },
  priority_3: {
    _context: 'universal',
    field: 'priority',
    options: ['Normal', 'Important', 'Urgent'],
  },

  // ---- Clinic fields ----
  blood_type: {
    _context: 'clinic',
    options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  },
  clinic_priority: {
    _context: 'clinic',
    field: 'priority',
    options: ['Normal', 'Urgent', 'Emergency'],
  },
  clinic_status: {
    _context: 'clinic',
    field: 'status',
    options: ['Waiting', 'In Progress', 'Completed', 'Cancelled'],
  },

  // ---- Event fields ----
  event_type: {
    _context: 'event',
    options: ['Meeting', 'Workshop', 'Sports', 'Cultural', 'Religious', 'Academic', 'Fundraiser', 'Social', 'Conference'],
  },
  event_status: {
    _context: 'event',
    field: 'status',
    options: ['Upcoming', 'Ongoing', 'Completed', 'Cancelled'],
  },
  visibility: {
    _context: 'event',
    options: ['Public', 'Private', 'Invite Only'],
  },

  // ---- HR/Staff fields ----
  department: {
    _context: 'hr',
    options: ['Administration', 'Academic', 'Finance', 'HR', 'IT', 'Operations', 'Maintenance', 'Support'],
  },
  employee_status: {
    _context: 'hr',
    options: ['Active', 'On Leave', 'Suspended', 'Terminated', 'Probation'],
  },
  leave_type: {
    _context: 'hr',
    options: ['Annual', 'Sick', 'Maternity', 'Paternity', 'Emergency', 'Study', 'Unpaid', 'Compassionate'],
  },
  leave_status: {
    _context: 'hr',
    options: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
  },

  // ---- CRM fields ----
  lead_status: {
    _context: 'crm',
    field: 'status',
    options: ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'],
  },
  lead_source: {
    _context: 'crm',
    options: ['Website', 'Referral', 'Social Media', 'Advertisement', 'Event', 'Cold Call', 'Walk-in'],
  },
  crm_priority: {
    _context: 'crm',
    field: 'priority',
    options: ['Low', 'Medium', 'High', 'Critical'],
  },

  // ---- Expense fields ----
  expense_category: {
    _context: 'expense',
    field: 'category',
    options: ['Rent', 'Utilities', 'Salaries', 'Supplies', 'Travel', 'Maintenance', 'Marketing', 'Insurance', 'Miscellaneous'],
  },
  expense_status: {
    _context: 'expense',
    field: 'status',
    options: ['Pending', 'Approved', 'Rejected', 'Paid'],
  },

  // ---- Project fields ----
  project_status: {
    _context: 'project',
    field: 'status',
    options: ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'],
  },

  // ---- Support Ticket fields ----
  ticket_status: {
    _context: 'support',
    field: 'status',
    options: ['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'],
  },
  ticket_category: {
    _context: 'support',
    field: 'category',
    options: ['General', 'IT', 'HR', 'Finance', 'Facilities'],
  },

  // ---- Incident Report fields ----
  incident_status: {
    _context: 'incident',
    field: 'status',
    options: ['Open', 'Investigating', 'Resolved'],
  },

  // ---- Maintenance Request fields ----
  maintenance_category: {
    _context: 'maintenance',
    field: 'category',
    options: ['Plumbing', 'Electrical', 'Furniture', 'Building/Structural', 'Equipment', 'Cleaning', 'Other'],
  },

  // ---- Fundraising / Church Donation fields ----
  fundraising_category: {
    _context: 'fundraising',
    field: 'category',
    options: ['General', 'Building Fund', 'Education', 'Medical', 'Church Project', 'Community', 'Emergency Relief'],
  },

  // ---- Clinic Drug/Pharmacy fields ----
  drug_category: {
    _context: 'clinic',
    field: 'category',
    options: ['Analgesic', 'Antibiotic', 'Antimalarial', 'Antiviral', 'Vitamin/Supplement', 'Other'],
  },

  // ---- Music/Worship fields ----
  voice_part: {
    _context: 'church',
    field: 'voice_part',
    options: ['Soprano', 'Alto', 'Tenor', 'Bass', 'Lead'],
  },
  music_category: {
    _context: 'church',
    field: 'category',
    options: ['Praise', 'Worship', 'Hymn', 'Christmas', 'Easter', 'Other'],
  },

  // ---- Choir Role fields ----
  choir_role: {
    _context: 'church',
    field: 'role',
    options: ['Member', 'Leader', 'Director'],
  },

  // ---- Announcements/Notices fields ----
  announcement_category: {
    _context: 'general',
    field: 'category',
    options: ['News', 'Announcement', 'Event', 'General'],
  },

  // ---- Educational Resources fields ----
  resource_category: {
    _context: 'education',
    field: 'category',
    options: ['Book', 'Past Paper', 'Notes', 'Study Notes', 'Syllabus', 'Guide / Manual', 'Other'],
  },

  // ---- Procurement/Purchase Order fields ----
  procurement_category: {
    _context: 'business',
    field: 'category',
    options: ['IT Equipment', 'Furniture', 'Vehicle', 'Lab Equipment', 'Office Equipment', 'Infrastructure', 'Other'],
  },

  // ---- Expense Claim fields ----
  claim_category: {
    _context: 'hr',
    field: 'category',
    options: ['Travel', 'Meals', 'Office Supplies', 'Equipment', 'Training', 'Utilities', 'Maintenance', 'Other'],
  },

  // ---- Feedback/Suggestion fields ----
  feedback_category: {
    _context: 'general',
    field: 'category',
    options: ['General', 'Facilities', 'Academics', 'HR / Personnel', 'IT Support', 'Safety', 'Suggestion', 'Complaint'],
  },

  // ---- Library fields ----
  library_category: {
    _context: 'education',
    field: 'category',
    options: ['Books', 'Stationery', 'Uniform', 'Supplies', 'Other'],
  },

  // ---- Supply Order fields ----
  supply_category: {
    _context: 'business',
    field: 'category',
    options: ['Office Supplies', 'Equipment', 'Maintenance', 'Food & Catering', 'Transport', 'Other'],
  },
};

// ============================================================
// 2. FIELD → DROPDOWN KEY RESOLUTION
//    Maps form field `name` attributes to the best DROPDOWN_OPTIONS key.
//    Also distinguishes dynamic fields that need DB queries.
// ============================================================

/**
 * Maps a form field name to its dropdown configuration.
 * @param {string} fieldName - The `name` attribute of the input/select
 * @param {string} [urlHint] - Optional URL path hint for disambiguation
 * @returns {{ key: string, dynamic: boolean, tableName?: string, columnName?: string, queryColumn?: string }|null}
 */
function resolveFieldConfig(fieldName, urlHint) {
  const name = (fieldName || '').trim().toLowerCase();

  // ---- Direct 1:1 mappings (field name → DROPDOWN_OPTIONS key) ----
  const directMap = {
    'gender': 'gender',
    'stream': 'stream',
    'religion': 'religion',
    'blood_group': 'blood_group',
    'nationality': 'nationality',
    'fee_type': 'fee_type',
    'payment_method': 'payment_method',
    'term': 'term',
    'grade': 'grade',
    'membership_status': 'membership_status',
    'marital_status': 'marital_status',
    'sacrament_type': 'sacrament_type',
    'payment_status': 'payment_status',
    'visibility': 'visibility',
    'blood_type': 'blood_type',
    'leave_type': 'leave_type',
    'leave_status': 'leave_status',
    'lead_source': 'lead_source',
    'event_type': 'event_type',
    'voice_part': 'voice_part',
    'transport_route': 'transport_route',
  };

  if (directMap[name]) {
    const key = directMap[name];
    if (key === 'transport_route') {
      return { key, dynamic: true, tableName: 'transport_routes', columnName: 'route_name' };
    }
    return { key, dynamic: false };
  }

  // ---- Context-sensitive mappings for `status` ----
  if (name === 'status') {
    const hint = (urlHint || '').toLowerCase();

    if (hint.includes('/fees') || hint.includes('/fee')) {
      return { key: 'fee_status', dynamic: false };
    }
    if (hint.includes('/attendance')) {
      return { key: 'attendance_status', dynamic: false };
    }
    if (hint.includes('/clinic') || hint.includes('/patient') || hint.includes('/appointment')) {
      return { key: 'clinic_status', dynamic: false };
    }
    if (hint.includes('/event') || hint.includes('/ticket')) {
      return { key: 'event_status', dynamic: false };
    }
    if (hint.includes('/leave') || hint.includes('/hr')) {
      return { key: 'leave_status', dynamic: false };
    }
    if (hint.includes('/expense') || hint.includes('/claim')) {
      return { key: 'expense_status', dynamic: false };
    }
    if (hint.includes('/project')) {
      return { key: 'project_status', dynamic: false };
    }
    if (hint.includes('/support') || hint.includes('/ticket')) {
      return { key: 'ticket_status', dynamic: false };
    }
    if (hint.includes('/incident')) {
      return { key: 'incident_status', dynamic: false };
    }
    if (hint.includes('/student') || hint.includes('/school')) {
      return { key: 'student_status', dynamic: false };
    }
    if (hint.includes('/crm') || hint.includes('/lead')) {
      return { key: 'lead_status', dynamic: false };
    }
    if (hint.includes('/inventory') || hint.includes('/stock')) {
      return { key: 'inventory_status', dynamic: false };
    }
    if (hint.includes('/church') || hint.includes('/member')) {
      // Could be membership_status; fall through to context-dependent default
      return { key: 'event_status', dynamic: false };
    }
    // Default status — generic set
    return { key: 'event_status', dynamic: false };
  }

  // ---- Context-sensitive mappings for `role` ----
  if (name === 'role') {
    const hint = (urlHint || '').toLowerCase();
    if (hint.includes('/church') || hint.includes('/member') || hint.includes('/choir') || hint.includes('/music')) {
      return { key: 'church_role', dynamic: false };
    }
    return null; // Roles are often contextual (admin/user/etc.) — leave as-is
  }

  // ---- Context-sensitive mappings for `category` ----
  if (name === 'category') {
    const hint = (urlHint || '').toLowerCase();
    if (hint.includes('/inventory') || hint.includes('/stock')) {
      return { key: 'inventory_category', dynamic: false };
    }
    if (hint.includes('/expense') || hint.includes('/claim')) {
      return { key: 'expense_category', dynamic: false };
    }
    if (hint.includes('/procurement') || hint.includes('/purchase') || hint.includes('/requisition')) {
      return { key: 'procurement_category', dynamic: false };
    }
    if (hint.includes('/maintenance')) {
      return { key: 'maintenance_category', dynamic: false };
    }
    if (hint.includes('/fundrais') || hint.includes('/donation') || hint.includes('/church')) {
      return { key: 'fundraising_category', dynamic: false };
    }
    if (hint.includes('/clinic') || hint.includes('/pharmacy') || hint.includes('/drug')) {
      return { key: 'drug_category', dynamic: false };
    }
    if (hint.includes('/announcement') || hint.includes('/notice')) {
      return { key: 'announcement_category', dynamic: false };
    }
    if (hint.includes('/resource') || hint.includes('/education') || hint.includes('/library')) {
      return { key: 'resource_category', dynamic: false };
    }
    if (hint.includes('/supply') || hint.includes('/order')) {
      return { key: 'supply_category', dynamic: false };
    }
    if (hint.includes('/feedback') || hint.includes('/suggestion')) {
      return { key: 'feedback_category', dynamic: false };
    }
    if (hint.includes('/music') || hint.includes('/choir') || hint.includes('/worship')) {
      return { key: 'music_category', dynamic: false };
    }
    // Category is very context-dependent; default: generic inventory
    return { key: 'inventory_category', dynamic: false };
  }

  // ---- Context-sensitive mappings for `priority` ----
  if (name === 'priority') {
    const hint = (urlHint || '').toLowerCase();
    if (hint.includes('/clinic') || hint.includes('/patient') || hint.includes('/appointment')) {
      return { key: 'clinic_priority', dynamic: false };
    }
    if (hint.includes('/crm') || hint.includes('/lead')) {
      return { key: 'crm_priority', dynamic: false };
    }
    if (hint.includes('/project') || hint.includes('/task')) {
      return { key: 'priority_critical', dynamic: false };
    }
    if (hint.includes('/maintenance') || hint.includes('/incident')) {
      return { key: 'priority_3', dynamic: false };
    }
    return { key: 'priority', dynamic: false };
  }

  // ---- Context-sensitive mappings for `department` ----
  if (name === 'department') {
    return { key: 'department', dynamic: false };
  }

  // ---- Dynamic fields ----
  if (name === 'class_name') {
    return { key: 'class_name', dynamic: true, tableName: 'students', columnName: 'class' };
  }
  if (name === 'employee_status') {
    return { key: 'employee_status', dynamic: false };
  }

  return null; // Not a dropdown field
}

// ============================================================
// 3. HELPER: HTML attribute string builder
// ============================================================

function buildAttrString(attrs) {
  if (!attrs) return '';
  if (typeof attrs === 'string') return attrs;
  if (typeof attrs === 'object') {
    return Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => `${escAttr(k)}="${v === true ? k : escAttr(String(v))}"`)
      .join(' ');
  }
  return '';
}

// ============================================================
// 4. generateSelectHTML — Static select generator
// ============================================================

/**
 * Generate a <select> element HTML string.
 *
 * @param {string} name - The name attribute for the select
 * @param {string[]|Object[]} options - Array of option values, or objects { value, label }
 * @param {string} [selectedValue] - Currently selected value (pre-selects the matching option)
 * @param {string} [placeholder] - Optional placeholder text for a disabled first option
 * @param {Object|string} [attributes] - Extra HTML attributes (id, class, required, onchange, etc.)
 *                                     If a string, used directly as attribute string.
 * @returns {string} Complete <select> HTML
 */
function generateSelectHTML(name, options, selectedValue, placeholder, attributes) {
  if (!name || !options || !Array.isArray(options) || options.length === 0) {
    return ''; // Silently return empty for invalid params
  }

  const attrStr = buildAttrString(attributes);
  const safeName = escAttr(name);
  const selectedNorm = normalizeSelected(selectedValue);

  // Default styling matching the platform's existing input/select pattern
  const defaultStyle = 'width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px';
  const hasStyle = attrStr.includes('style=');
  const finalAttr = hasStyle ? attrStr : (attrStr ? `${attrStr} style="${defaultStyle}"` : `style="${defaultStyle}"`);

  let html = `<select name="${safeName}" ${finalAttr}>`;

  // Optional placeholder/empty option
  if (placeholder) {
    html += `\n  <option value="">${escHTML(placeholder)}</option>`;
  }

  // Build options
  for (const opt of options) {
    let value, label;
    if (typeof opt === 'string') {
      value = opt;
      label = opt;
    } else if (opt && typeof opt === 'object') {
      value = opt.value !== undefined ? String(opt.value) : '';
      label = opt.label !== undefined ? String(opt.label) : value;
    } else {
      continue;
    }

    const safeValue = escAttr(value);
    const safeLabel = escHTML(label);
    const isSelected = selectedNorm !== null && value === selectedNorm ? ' selected' : '';

    html += `\n  <option value="${safeValue}"${isSelected}>${safeLabel}</option>`;
  }

  html += '\n</select>';
  return html;
}

// ============================================================
// 5. generateSmartSelect — Dynamic select (queries DB)
// ============================================================

/**
 * Generate a <select> for dynamic fields (class_name, transport_route, etc.)
 * Queries the database for distinct values scoped to a tenant.
 *
 * @param {string} name - Field name
 * @param {number|string} tenantId - The tenant ID to scope the query
 * @param {Object} [opts]
 * @param {string} [opts.tableName] - DB table to query (overrides resolution)
 * @param {string} [opts.columnName] - DB column to query
 * @param {string} [opts.selectedValue] - Currently selected value
 * @param {string} [opts.placeholder] - Placeholder text
 * @param {Object|string} [opts.attributes] - Extra HTML attributes
 * @param {object} [opts.pool] - DB pool (defaults to module pool)
 * @returns {Promise<string>} Select HTML string
 */
async function generateSmartSelect(name, tenantId, opts) {
  opts = opts || {};
  const cfg = resolveFieldConfig(name);
  const tableName = opts.tableName || (cfg && cfg.tableName) || 'students';
  const columnName = opts.columnName || (cfg && cfg.columnName) || name;
  const dbPool = opts.pool || _pool;

  if (!dbPool) {
    return generateSelectHTML(name, [], opts.selectedValue, opts.placeholder || 'Select...', opts.attributes);
  }

  try {
    const safeTid = parseInt(tenantId, 10);
    if (isNaN(safeTid) || safeTid < 1) {
      return generateSelectHTML(name, [], opts.selectedValue, opts.placeholder || 'Select...', opts.attributes);
    }

    const result = await dbPool.query(
      `SELECT DISTINCT "${escSQL(columnName)}" AS val FROM "${escSQL(tableName)}" WHERE tenant_id = $1 AND "${escSQL(columnName)}" IS NOT NULL AND "${escSQL(columnName)}" != '' ORDER BY "${escSQL(columnName)}" ASC LIMIT 200`,
      [safeTid]
    );

    const dynamicOptions = result.rows.map(r => r.val).filter(Boolean);
    const selectedValue = opts.selectedValue;
    const placeholder = opts.placeholder || `Select ${name.replace(/_/g, ' ')}...`;

    return generateSelectHTML(name, dynamicOptions, selectedValue, placeholder, opts.attributes);
  } catch (err) {
    if (_logger) {
      _logger.error('generateSmartSelect query failed', { field: name, error: err.message });
    } else {
      console.error(`[dropdown-enhancements] generateSmartSelect failed for ${name}:`, err.message);
    }
    // Fallback: return empty select
    return generateSelectHTML(name, [], opts.selectedValue, opts.placeholder || 'Select...', opts.attributes);
  }
}

// ============================================================
// 6. injectDropdowns — HTML post-processor
// ============================================================

/**
 * Takes form HTML and replaces matching <input> fields with <select> dropdowns.
 * Also enhances existing <select> elements that match known dropdown fields.
 *
 * Replacement patterns handled:
 *  1. <input name="gender" ...>             → <select>
 *  2. <input name="status" ...>             → <select> (context-aware via URL hint)
 *  3. <input name="class_name" ...>         → dynamic <select> (async, requires await)
 *  4. <input name="category" ...>           → <select> (context-aware)
 *  5. <input name="priority" ...>           → <select> (context-aware)
 *  6. Existing <select> with known fields   → enriched (if options list differs)
 *
 * @param {string} html - The form HTML to process
 * @param {number|string} tenantId - Tenant ID for dynamic lookups
 * @param {Object} [opts]
 * @param {string} [opts.urlHint] - URL path for context disambiguation
 * @param {Object} [opts.overrides] - Manual field→options overrides { fieldName: ['opt1','opt2'] }
 * @param {Object} [opts.selectedValues] - Pre-selected values { fieldName: 'value' }
 * @returns {Promise<string>} HTML with inputs replaced by selects
 */
async function injectDropdowns(html, tenantId, opts) {
  if (!html || typeof html !== 'string') return html || '';
  opts = opts || {};

  // Step 1: Identify all <input> elements with name attributes that map to dropdowns
  const inputRegex = /<input\s+([^>]*?)name\s*=\s*["']([^"']+)["']([^>]*)>/gi;

  let result = html;
  let match;

  // Collect replacements to apply in reverse order (preserve indices)
  const replacements = [];

  while ((match = inputRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const beforeName = match[1];
    const fieldName = match[2].trim().toLowerCase();
    const afterName = match[3];
    const matchIndex = match.index;

    // Skip hidden inputs, submit buttons, file inputs, checkboxes, radios
    if (/\btype\s*=\s*["'](hidden|submit|file|checkbox|radio|image|reset|button)["']/i.test(beforeName + afterName)) {
      continue;
    }

    // Skip number, date, datetime, time, email, url, password, tel inputs
    if (/\btype\s*=\s*["'](number|date|datetime|time|email|url|password|tel|month|week|color|range)["']/i.test(beforeName + afterName)) {
      continue;
    }

    // Try to resolve this field to a dropdown config
    const cfg = resolveFieldConfig(fieldName, opts.urlHint);
    if (!cfg) continue;

    // Check for manual overrides
    let options = null;
    if (opts.overrides && opts.overrides[fieldName]) {
      options = opts.overrides[fieldName];
    }

    // Get selected value from existing input
    const valueMatch = (beforeName + afterName).match(/value\s*=\s*["']([^"']*)["']/i);
    const selectedValue = (opts.selectedValues && opts.selectedValues[fieldName]) || (valueMatch ? valueMatch[1] : '');

    // Extract existing attributes (id, class, required, etc.)
    const existingId = (beforeName + afterName).match(/id\s*=\s*["']([^"']*)["']/i);
    const existingClass = (beforeName + afterName).match(/class\s*=\s*["']([^"']*)["']/i);
    const isRequired = /\brequired\b/i.test(beforeName + afterName);

    const attrObj = {};
    if (existingId) attrObj.id = existingId[1];
    if (existingClass) attrObj.class = existingClass[1];
    if (isRequired) attrObj.required = true;

    if (cfg.dynamic && !options) {
      // Dynamic: query the DB
      try {
        const smartHTML = await generateSmartSelect(fieldName, tenantId, {
          tableName: cfg.tableName,
          columnName: cfg.columnName,
          selectedValue,
          placeholder: `Select ${fieldName.replace(/_/g, ' ')}...`,
          attributes: attrObj,
        });
        if (smartHTML) {
          replacements.push({ index: matchIndex, length: fullMatch.length, replacement: smartHTML });
        }
      } catch (err) {
        // Skip replacement if dynamic query fails
        if (_logger) _logger.warn('injectDropdowns: dynamic skip', { field: fieldName, error: err.message });
      }
    } else if (cfg.dynamic && options) {
      // Dynamic field with manual override — use override options
      const placeholderText = buildPlaceholder(fieldName, cfg.key);
      const selectHTML = generateSelectHTML(fieldName, options, selectedValue, placeholderText, attrObj);
      if (selectHTML) {
        replacements.push({ index: matchIndex, length: fullMatch.length, replacement: selectHTML });
      }
    } else if (!cfg.dynamic) {
      // Static: use DROPDOWN_OPTIONS
      const dropdownDef = DROPDOWN_OPTIONS[cfg.key];
      if (dropdownDef && dropdownDef.options) {
        const placeholderText = buildPlaceholder(fieldName, cfg.key);
        const selectHTML = generateSelectHTML(fieldName, dropdownDef.options, selectedValue, placeholderText, attrObj);
        if (selectHTML) {
          replacements.push({ index: matchIndex, length: fullMatch.length, replacement: selectHTML });
        }
      }
    }
  }

  // Apply replacements in reverse index order to preserve positions
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.substring(0, r.index) + r.replacement + result.substring(r.index + r.length);
  }

  return result;
}

/**
 * Build a readable placeholder for a field.
 */
function buildPlaceholder(fieldName, dropdownKey) {
  const labels = {
    gender: 'Select Gender',
    stream: 'Select Stream',
    student_status: 'Select Status',
    religion: 'Select Religion',
    blood_group: 'Select Blood Group',
    nationality: 'Select Nationality',
    fee_type: 'Select Fee Type',
    fee_status: 'Select Status',
    payment_method: 'Select Payment Method',
    term: 'Select Term',
    attendance_status: 'Select Status',
    grade: 'Select Grade',
    membership_status: 'Select Status',
    marital_status: 'Select Marital Status',
    church_role: 'Select Role',
    sacrament_type: 'Select Sacrament',
    inventory_category: 'Select Category',
    inventory_status: 'Select Status',
    payment_status: 'Select Payment Status',
    priority: 'Select Priority',
    priority_critical: 'Select Priority',
    priority_3: 'Select Priority',
    blood_type: 'Select Blood Type',
    clinic_priority: 'Select Priority',
    clinic_status: 'Select Status',
    event_type: 'Select Event Type',
    event_status: 'Select Status',
    visibility: 'Select Visibility',
    department: 'Select Department',
    employee_status: 'Select Status',
    leave_type: 'Select Leave Type',
    leave_status: 'Select Status',
    lead_status: 'Select Status',
    lead_source: 'Select Lead Source',
    crm_priority: 'Select Priority',
    expense_category: 'Select Category',
    expense_status: 'Select Status',
    project_status: 'Select Status',
    ticket_status: 'Select Status',
    ticket_category: 'Select Category',
    incident_status: 'Select Status',
    maintenance_category: 'Select Category',
    fundraising_category: 'Select Category',
    drug_category: 'Select Category',
    voice_part: 'Select Voice Part',
    music_category: 'Select Category',
    choir_role: 'Select Role',
    announcement_category: 'Select Category',
    resource_category: 'Select Category',
    procurement_category: 'Select Category',
    claim_category: 'Select Category',
    feedback_category: 'Select Category',
    library_category: 'Select Category',
    supply_category: 'Select Category',
  };
  return labels[dropdownKey] || `Select ${fieldName.replace(/_/g, ' ')}...`;
}

// ============================================================
// 7. dropdownMiddleware — Express middleware
// ============================================================

/**
 * Middleware that populates res.locals.dropdowns with pre-built select HTML
 * and dropdown option data for the current tenant.
 *
 * Usage:
 *   app.use('/school', dropdowns.dropdownMiddleware);
 *
 * Then in routes:
 *   res.locals.dropdowns.genderSelect    // <select name="gender">...</select>
 *   res.locals.dropdowns.options.gender  // ['Male', 'Female']
 *   res.locals.dropdowns.options.status  // context-aware
 */
function dropdownMiddleware(req, res, next) {
  const tenantId = (req.session && req.session.user && req.session.user.tenant_id) || null;

  // Build static options lookup (context-aware for polysemous fields)
  const options = {};

  // Gender — always available
  options.gender = (DROPDOWN_OPTIONS.gender && DROPDOWN_OPTIONS.gender.options) || [];

  // Status — resolve based on URL path
  const statusCfg = resolveFieldConfig('status', req.path);
  if (statusCfg && DROPDOWN_OPTIONS[statusCfg.key]) {
    options.status = DROPDOWN_OPTIONS[statusCfg.key].options;
  } else {
    options.status = ['Active', 'Inactive', 'Completed', 'Cancelled', 'Pending'];
  }

  // Common single-context fields
  const simpleFields = [
    'stream', 'religion', 'blood_group', 'nationality', 'fee_type', 'payment_method',
    'term', 'grade', 'membership_status', 'marital_status', 'sacrament_type',
    'payment_status', 'blood_type', 'leave_type', 'leave_status', 'lead_source',
    'event_type', 'visibility', 'department', 'employee_status', 'priority',
  ];
  for (const f of simpleFields) {
    if (DROPDOWN_OPTIONS[f]) {
      options[f] = DROPDOWN_OPTIONS[f].options;
    }
  }

  // Category — context-aware
  const catCfg = resolveFieldConfig('category', req.path);
  if (catCfg && DROPDOWN_OPTIONS[catCfg.key]) {
    options.category = DROPDOWN_OPTIONS[catCfg.key].options;
  }

  // Priority — context-aware
  const prioCfg = resolveFieldConfig('priority', req.path);
  if (prioCfg && DROPDOWN_OPTIONS[prioCfg.key]) {
    options.priority = DROPDOWN_OPTIONS[prioCfg.key].options;
  }

  // Build pre-rendered selects for the most common fields
  const selects = {};

  selects.gender = generateSelectHTML('gender', options.gender, null, 'Select Gender');
  selects.stream = generateSelectHTML('stream', options.stream, null, 'Select Stream');
  selects.term = generateSelectHTML('term', options.term, null, 'Select Term');
  selects.grade = generateSelectHTML('grade', options.grade, null, 'Select Grade');
  selects.payment_method = generateSelectHTML('payment_method', options.payment_method, null, 'Select Payment Method');
  selects.department = generateSelectHTML('department', options.department, null, 'Select Department');

  res.locals.dropdowns = {
    options,
    selects,
    tenantId,
    // Utility function to build a select for any known field
    buildSelect(fieldName, selectedValue, extraAttrs) {
      const cfg = resolveFieldConfig(fieldName, req.path);
      if (!cfg || cfg.dynamic) return '';
      const def = DROPDOWN_OPTIONS[cfg.key];
      if (!def) return '';
      return generateSelectHTML(fieldName, def.options, selectedValue, buildPlaceholder(fieldName, cfg.key), extraAttrs);
    },
    // Utility function to build a dynamic select (returns a promise)
    async buildSmartSelect(fieldName, selectedValue, extraAttrs) {
      return generateSmartSelect(fieldName, tenantId, { selectedValue, attributes: extraAttrs });
    },
    // The raw DROPDOWN_OPTIONS for advanced usage
    DROPDOWN_OPTIONS,
  };

  next();
}

// ============================================================
// 8. API ROUTES — REST endpoints for AJAX-powered selects
// ============================================================

function registerRoutes(app, pool, logger) {

  /**
   * GET /api/v1/dropdowns/:field_name
   * Returns static dropdown options for a given field name.
   * Query params: context (url hint), selected (current value)
   *
   * Example: GET /api/v1/dropdowns/status?context=/school/fees/add
   * Response: { field: "status", context: "fee", options: ["Pending","Partial","Paid","Overdue","Waived"] }
   */
  app.get('/api/v1/dropdowns/:field_name', (req, res) => {
    const fieldName = (req.params.field_name || '').trim().toLowerCase();
    const context = req.query.context || req.headers['referer'] || '';

    const cfg = resolveFieldConfig(fieldName, context);

    if (!cfg) {
      return res.status(404).json({
        error: 'No dropdown options found for field',
        field: fieldName,
        suggestion: 'Check the field name. Known fields: gender, status, stream, grade, term, category, priority, etc.',
      });
    }

    if (cfg.dynamic) {
      return res.json({
        field: fieldName,
        dynamic: true,
        tableName: cfg.tableName,
        columnName: cfg.columnName,
        message: 'This field requires tenant-scoped data. Use /api/v1/dropdowns/tenant/:table/:column',
      });
    }

    const def = DROPDOWN_OPTIONS[cfg.key];
    if (!def || !def.options) {
      return res.status(404).json({ error: 'Options not found', field: fieldName });
    }

    res.json({
      field: fieldName,
      dropdownKey: cfg.key,
      context: def._context,
      options: def.options,
      html: generateSelectHTML(fieldName, def.options, req.query.selected, buildPlaceholder(fieldName, cfg.key)),
    });
  });

  /**
   * GET /api/v1/dropdowns/tenant/:table/:column
   * Returns distinct values from a tenant's table column (for dynamic dropdowns).
   * Requires authentication.
   *
   * Example: GET /api/v1/dropdowns/tenant/students/class
   * Response: { field: "class", options: ["P.1","P.2","S.1","S.2",...] }
   */
  app.get('/api/v1/dropdowns/tenant/:table/:column', async (req, res) => {
    try {
      const table = (req.params.table || '').trim().toLowerCase();
      const column = (req.params.column || '').trim().toLowerCase();
      const tenantId = (req.session && req.session.user && req.session.user.tenant_id) ||
                       parseInt(req.query.tenant_id, 10);

      if (!tenantId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Validate table name against allowlist to prevent SQL injection
      const VALID_DYNAMIC_TABLES = new Set([
        'students', 'classes', 'transport_routes', 'inventory', 'subjects',
        'staff', 'church_members', 'crm_leads', 'crm_contacts', 'hr_departments',
        'projects', 'support_tickets', 'events', 'branches', 'assets',
        'fee_structures', 'grading_scales',
      ]);

      if (!VALID_DYNAMIC_TABLES.has(table)) {
        return res.status(400).json({
          error: 'Invalid table name',
          allowed: Array.from(VALID_DYNAMIC_TABLES).sort(),
        });
      }

      // Validate column name (alphanumeric + underscore only)
      if (!/^[a-z_][a-z0-9_]*$/.test(column)) {
        return res.status(400).json({ error: 'Invalid column name' });
      }

      const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
      const safeTid = parseInt(tenantId, 10);

      const result = await pool.query(
        `SELECT DISTINCT "${column}" AS val FROM "${table}" WHERE tenant_id = $1 AND "${column}" IS NOT NULL AND "${column}" != '' ORDER BY "${column}" ASC LIMIT ${limit}`,
        [safeTid]
      );

      const options = result.rows.map(r => r.val).filter(Boolean);

      res.json({
        field: column,
        table,
        tenant_id: safeTid,
        count: options.length,
        options,
        html: generateSelectHTML(column, options, req.query.selected, `Select ${column.replace(/_/g, ' ')}...`),
      });
    } catch (err) {
      logger.error('Dynamic dropdown query failed', {
        table: req.params.table,
        column: req.params.column,
        error: err.message,
      });
      res.status(500).json({ error: 'Failed to load dropdown options' });
    }
  });

  /**
   * GET /api/v1/dropdowns/schema
   * Returns the full DROPDOWN_OPTIONS schema for client-side rendering.
   * Useful for building dynamic forms on the frontend.
   */
  app.get('/api/v1/dropdowns/schema', (req, res) => {
    const schema = {};
    for (const [key, def] of Object.entries(DROPDOWN_OPTIONS)) {
      schema[key] = {
        context: def._context,
        field: def.field || key,
        options: def.options,
        dynamic: false,
      };
    }
    // Add dynamic fields
    schema.class_name = { context: 'student', field: 'class_name', dynamic: true, tableName: 'students', columnName: 'class' };
    schema.transport_route = { context: 'student', field: 'transport_route', dynamic: true, tableName: 'transport_routes', columnName: 'route_name' };

    res.json({ schema, version: '1.0.0' });
  });
}

// ============================================================
// 9. INTERNAL UTILITIES
// ============================================================

let _pool = null;
let _logger = null;

/** HTML-escape for text content (label text) */
function escHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML-escape for attribute values */
function escAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

/** SQL identifier sanitizer (column/table names) */
function escSQL(identifier) {
  if (!identifier || typeof identifier !== 'string') return '';
  // Only allow alphanumeric and underscores — reject anything else
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return identifier;
}

/** Normalize selected value for comparison */
function normalizeSelected(val) {
  if (val === null || val === undefined || val === '') return null;
  return String(val).trim();
}

// ============================================================
// 10. MODULE FACTORY
// ============================================================

/**
 * Initialize the dropdown enhancements module.
 *
 * @param {object} app - Express app instance
 * @param {object} pool - PostgreSQL pool (pg.Pool)
 * @param {object} logger - Logger object with .info/.warn/.error methods
 * @returns {{ generateSelectHTML, generateSmartSelect, injectDropdowns, dropdownMiddleware, DROPDOWN_OPTIONS, resolveFieldConfig }}
 */
module.exports = (app, pool, logger) => {
  _pool = pool || null;
  _logger = logger || { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

  // Register API routes
  if (app) {
    registerRoutes(app, _pool, _logger);
    _logger.info('dropdown-enhancements', { message: 'API routes registered at /api/v1/dropdowns/*' });
  }

  // Return the public API
  return {
    // Data
    DROPDOWN_OPTIONS,

    // Synchronous helpers
    generateSelectHTML,
    resolveFieldConfig,

    // Async helpers
    generateSmartSelect,
    injectDropdowns,

    // Middleware
    dropdownMiddleware,
  };
};
