/**
 * Carpool Coordination Module
 * School SaaS Portal - Parent Carpooling Coordination System
 *
 * Features:
 *   1. Carpool Groups  - create/join groups by area, max members, schedules
 *   2. Matching Algorithm - auto-suggest by proximity, schedule, class
 *   3. Ride Scheduling - weekly schedule, rotate drivers, handle absences
 *   4. Route Planning  - pickup order, ETA per stop
 *   5. Parent Profiles  - name, phone, car, license, insurance, rating
 *   6. Emergency Contacts - backup contacts, medical notes
 *   7. Communication   - group messaging, ride confirmations, delays
 *   8. Safety          - check-in/check-out, notifications, late alerts
 *   9. Cost Sharing    - fuel tracking, split costs, monthly summary
 *  10. Analytics       - CO2 saved, rides, cost savings, participation
 *
 * Routes prefix: /school/carpool/
 */

'use strict';

module.exports = function (app, pool, opts) {
  // ── helpers provided by the host platform ──────────────────────────
  const esc = opts.esc || function (sql, params) { return [sql, params || []]; };
  const renderPage = opts.renderPage || function (req, res, view, data) {
    res.render(view, Object.assign({ user: req.session.user }, data || {}));
  };
  const ah = opts.ah || function (fn) { return function (req, res, next) { fn(req, res, next).catch(next); }; };
  const requireAuth = opts.requireAuth || function (req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
  };
  const audit = opts.audit || function (req, action, detail) {
    pool.query(
      'INSERT INTO audit_log (tenant_id, user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?,NOW())',
      [req.session.user.tenant_id, req.session.user.id, action, detail || '', req.ip]
    ).catch(() => {});
  };

  // ── constants ──────────────────────────────────────────────────────
  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const MAX_GROUP_MEMBERS_DEFAULT = 6;
  const LATE_THRESHOLD_MINUTES = 10;
  const AVG_CO2_PER_KM = 0.21; // kg CO2 per km per car
  const FUEL_COST_PER_KM = 0.12; // USD approximate
  const PARENT_ROLE_DRIVER = 'driver';
  const PARENT_ROLE_RIDER = 'rider';
  const RIDE_STATUS_SCHEDULED = 'scheduled';
  const RIDE_STATUS_IN_PROGRESS = 'in_progress';
  const RIDE_STATUS_COMPLETED = 'completed';
  const RIDE_STATUS_CANCELLED = 'cancelled';
  const MSG_TYPES = ['general', 'delay', 'absence', 'emergency', 'confirmation'];

  // ── query helpers ──────────────────────────────────────────────────
  function tenantWhere(extra) {
    return 'tenant_id = ?' + (extra ? ' AND ' + extra : '');
  }

  function tenantParams(extraParams) {
    return (extraParams || []).slice(); // caller prepends tenant_id
  }

  function paginate(req) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 25));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
  }

  function flashMsg(req, type, msg) {
    if (req.session) req.session.flash = req.session.flash || {};
    req.session.flash[type] = msg;
  }

  function getFlash(req) {
    const f = (req.session && req.session.flash) || {};
    req.session.flash = {};
    return f;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowStr() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  // ── UI theme helpers ───────────────────────────────────────────────
  function ecoTheme() {
    return {
      primary: '#2e7d32',
      primaryLight: '#60ad5e',
      primaryDark: '#005005',
      accent: '#66bb6a',
      surface: '#f1f8e9',
      hero: 'linear-gradient(135deg, #1b5e20 0%, #388e3c 50%, #66bb6a 100%)',
      carIcon: '🚗',
      leafIcon: '🍃',
      shieldIcon: '🛡️',
      chartIcon: '📊',
      walletIcon: '💰',
    };
  }

  function navItems(active) {
    const links = [
      { label: 'Dashboard', href: '/school/carpool/', id: 'dashboard' },
      { label: 'My Groups', href: '/school/carpool/groups', id: 'groups' },
      { label: 'Find Match', href: '/school/carpool/matching', id: 'matching' },
      { label: 'Schedule', href: '/school/carpool/schedule', id: 'schedule' },
      { label: 'Routes', href: '/school/carpool/routes', id: 'routes' },
      { label: 'Profile', href: '/school/carpool/profile', id: 'profile' },
      { label: 'Emergency', href: '/school/carpool/emergency', id: 'emergency' },
      { label: 'Messages', href: '/school/carpool/messages', id: 'messages' },
      { label: 'Check-in/out', href: '/school/carpool/checkin', id: 'checkin' },
      { label: 'Costs', href: '/school/carpool/costs', id: 'costs' },
      { label: 'Analytics', href: '/school/carpool/analytics', id: 'analytics' },
      { label: 'Settings', href: '/school/carpool/settings', id: 'settings' },
    ];
    links.forEach(function (l) { l.active = l.id === active; });
    return links;
  }

  // ====================================================================
  //  ROUTE 1 - DASHBOARD
  // ====================================================================
  app.get('/school/carpool/', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    // Active group memberships for this parent
    const [groups] = await pool.query(
      `SELECT cg.*, cm.role, cm.joined_at
       FROM carpool_groups cg
       JOIN carpool_members cm ON cm.group_id = cg.id AND cm.user_id = ?
       WHERE cg.tenant_id = ? AND cg.status = 'active'
       ORDER BY cg.area ASC`, [uid, tid]
    );

    // Today's rides
    const [rides] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       WHERE cr.tenant_id = ? AND cr.ride_date = ? AND cr.status IN ('scheduled','in_progress')
       ORDER BY cr.departure_time ASC`, [tid, todayStr()]
    );

    // Unread messages count
    const [msgCount] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM carpool_messages
       WHERE tenant_id = ? AND group_id IN (
         SELECT group_id FROM carpool_members WHERE user_id = ? AND tenant_id = ?
       ) AND sender_id != ? AND is_read = 0`, [tid, uid, tid, uid]
    );

    // Quick stats
    const [stats] = await pool.query(
      `SELECT
         COUNT(DISTINCT cr.id) AS total_rides,
         COALESCE(SUM(cr.distance_km),0) AS total_km,
         COALESCE(SUM(cr.distance_km * ?),0) AS co2_saved
       FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ?
       WHERE cr.tenant_id = ? AND cr.status = 'completed'`, [AVG_CO2_PER_KM, uid, tid]
    );

    renderPage(req, res, 'school/carpool/dashboard', {
      title: 'Carpool Dashboard',
      theme: theme,
      nav: navItems('dashboard'),
      flash: getFlash(req),
      groups: groups,
      rides: rides,
      unreadMessages: (msgCount[0] && msgCount[0].cnt) || 0,
      totalRides: (stats[0] && stats[0].total_rides) || 0,
      totalKm: (stats[0] && stats[0].total_km) || 0,
      co2Saved: (stats[0] && stats[0].co2_saved) || 0,
    });
  }));

  // ====================================================================
  //  ROUTE 2 - GROUPS  (list, create, view, join, leave)
  // ====================================================================

  // List groups
  app.get('/school/carpool/groups', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const pg = paginate(req);
    const theme = ecoTheme();

    const where = [tid];
    let extra = '';
    if (req.query.area) { extra += ' AND cg.area LIKE ?'; where.push('%' + req.query.area + '%'); }
    if (req.query.status) { extra += ' AND cg.status = ?'; where.push(req.query.status); }

    const [groups] = await pool.query(
      `SELECT cg.*,
         (SELECT COUNT(*) FROM carpool_members cm WHERE cm.group_id = cg.id) AS member_count,
         (SELECT COUNT(*) FROM carpool_members cm WHERE cm.group_id = cg.id AND cm.user_id = ?) AS is_member
       FROM carpool_groups cg
       WHERE cg.tenant_id = ?${extra}
       ORDER BY cg.created_at DESC LIMIT ? OFFSET ?`,
      [uid].concat(where).concat([pg.limit, pg.offset])
    );

    const [total] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM carpool_groups cg WHERE cg.tenant_id = ?${extra}`,
      where
    );

    renderPage(req, res, 'school/carpool/groups', {
      title: 'Carpool Groups',
      theme: theme,
      nav: navItems('groups'),
      flash: getFlash(req),
      groups: groups,
      page: pg.page,
      totalPages: Math.ceil((total[0] && total[0].cnt || 0) / pg.limit),
    });
  }));

  // Create group form
  app.get('/school/carpool/groups/create', requireAuth, ah(async function (req, res) {
    const theme = ecoTheme();
    renderPage(req, res, 'school/carpool/group-form', {
      title: 'Create Carpool Group',
      theme: theme,
      nav: navItems('groups'),
      flash: getFlash(req),
      group: null,
    });
  }));

  // Create group POST
  app.post('/school/carpool/groups/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const {
      name, description, area, school_zone, max_members,
      morning_departure, afternoon_departure, notes
    } = req.body;

    if (!name || !area) {
      flashMsg(req, 'error', 'Group name and area are required.');
      return res.redirect('/school/carpool/groups/create');
    }

    const maxMem = Math.min(12, Math.max(2, parseInt(max_members, 10) || MAX_GROUP_MEMBERS_DEFAULT));

    const [result] = await pool.query(
      `INSERT INTO carpool_groups
       (tenant_id, name, description, area, school_zone, max_members,
        morning_departure, afternoon_departure, notes, status, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [tid, name, description || '', area, school_zone || '', maxMem,
       morning_departure || '07:30', afternoon_departure || '15:30', notes || '',
       'active', uid]
    );

    const groupId = result.insertId;

    // Creator becomes admin member and driver
    await pool.query(
      `INSERT INTO carpool_members (tenant_id, group_id, user_id, role, status, joined_at)
       VALUES (?,?,?,?,?,NOW())`,
      [tid, groupId, uid, 'admin', 'active']
    );

    audit(req, 'carpool_group_create', 'Created group: ' + name);
    flashMsg(req, 'success', 'Carpool group created successfully!');
    res.redirect('/school/carpool/groups/' + groupId);
  }));

  // View single group
  app.get('/school/carpool/groups/:id', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();
    const groupId = parseInt(req.params.id, 10);

    const [groups] = await pool.query(
      `SELECT cg.*, u.display_name AS creator_name
       FROM carpool_groups cg
       LEFT JOIN users u ON u.id = cg.created_by
       WHERE cg.tenant_id = ? AND cg.id = ?`, [tid, groupId]
    );

    if (!groups.length) {
      flashMsg(req, 'error', 'Group not found.');
      return res.redirect('/school/carpool/groups');
    }

    const group = groups[0];

    const [members] = await pool.query(
      `SELECT cm.*, u.display_name, u.email, u.phone
       FROM carpool_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.tenant_id = ? AND cm.group_id = ? AND cm.status = 'active'
       ORDER BY cm.role DESC, cm.joined_at ASC`, [tid, groupId]
    );

    const [schedules] = await pool.query(
      `SELECT * FROM carpool_schedules
       WHERE tenant_id = ? AND group_id = ?
       ORDER BY day_of_week, departure_time ASC`, [tid, groupId]
    );

    const [upcomingRides] = await pool.query(
      `SELECT cr.*, u.display_name AS driver_name
       FROM carpool_rides cr
       LEFT JOIN users u ON u.id = cr.driver_id
       WHERE cr.tenant_id = ? AND cr.group_id = ? AND cr.ride_date >= ?
       ORDER BY cr.ride_date ASC, cr.departure_time ASC LIMIT 10`,
      [tid, groupId, todayStr()]
    );

    renderPage(req, res, 'school/carpool/group-detail', {
      title: group.name,
      theme: theme,
      nav: navItems('groups'),
      flash: getFlash(req),
      group: group,
      members: members,
      schedules: schedules,
      upcomingRides: upcomingRides,
      isMember: members.some(function (m) { return m.user_id === uid; }),
      daysOfWeek: DAYS_OF_WEEK,
    });
  }));

  // Edit group
  app.get('/school/carpool/groups/:id/edit', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const groupId = parseInt(req.params.id, 10);
    const theme = ecoTheme();

    const [groups] = await pool.query(
      'SELECT * FROM carpool_groups WHERE tenant_id = ? AND id = ?', [tid, groupId]
    );
    if (!groups.length) {
      flashMsg(req, 'error', 'Group not found.');
      return res.redirect('/school/carpool/groups');
    }

    renderPage(req, res, 'school/carpool/group-form', {
      title: 'Edit Group',
      theme: theme,
      nav: navItems('groups'),
      flash: getFlash(req),
      group: groups[0],
    });
  }));

  // Edit group POST
  app.post('/school/carpool/groups/:id/edit', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const groupId = parseInt(req.params.id, 10);
    const { name, description, area, school_zone, max_members,
      morning_departure, afternoon_departure, notes } = req.body;

    await pool.query(
      `UPDATE carpool_groups SET name=?, description=?, area=?, school_zone=?,
       max_members=?, morning_departure=?, afternoon_departure=?, notes=?, updated_at=NOW()
       WHERE tenant_id = ? AND id = ?`,
      [name, description || '', area, school_zone || '',
       Math.min(12, Math.max(2, parseInt(max_members, 10) || MAX_GROUP_MEMBERS_DEFAULT)),
       morning_departure || '07:30', afternoon_departure || '15:30',
       notes || '', tid, groupId]
    );

    audit(req, 'carpool_group_update', 'Updated group ID ' + groupId);
    flashMsg(req, 'success', 'Group updated.');
    res.redirect('/school/carpool/groups/' + groupId);
  }));

  // Delete (archive) group
  app.post('/school/carpool/groups/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const groupId = parseInt(req.params.id, 10);

    await pool.query(
      `UPDATE carpool_groups SET status = 'archived', updated_at = NOW()
       WHERE tenant_id = ? AND id = ?`, [tid, groupId]
    );
    await pool.query(
      `UPDATE carpool_members SET status = 'inactive' WHERE tenant_id = ? AND group_id = ?`,
      [tid, groupId]
    );

    audit(req, 'carpool_group_delete', 'Archived group ID ' + groupId);
    flashMsg(req, 'success', 'Group archived.');
    res.redirect('/school/carpool/groups');
  }));

  // Join group
  app.post('/school/carpool/groups/:id/join', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const groupId = parseInt(req.params.id, 10);
    const role = req.body.role === PARENT_ROLE_DRIVER ? PARENT_ROLE_DRIVER : PARENT_ROLE_RIDER;

    // Check not already a member
    const [existing] = await pool.query(
      `SELECT id FROM carpool_members WHERE tenant_id = ? AND group_id = ? AND user_id = ? AND status = 'active'`,
      [tid, groupId, uid]
    );
    if (existing.length) {
      flashMsg(req, 'error', 'You are already a member.');
      return res.redirect('/school/carpool/groups/' + groupId);
    }

    // Check max members
    const [group] = await pool.query(
      'SELECT max_members FROM carpool_groups WHERE tenant_id = ? AND id = ?', [tid, groupId]
    );
    if (group.length) {
      const [count] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM carpool_members WHERE tenant_id = ? AND group_id = ? AND status = ?',
        [tid, groupId, 'active']
      );
      if (count[0].cnt >= group[0].max_members) {
        flashMsg(req, 'error', 'Group is full.');
        return res.redirect('/school/carpool/groups/' + groupId);
      }
    }

    await pool.query(
      `INSERT INTO carpool_members (tenant_id, group_id, user_id, role, status, joined_at)
       VALUES (?,?,?,?,?,NOW())`, [tid, groupId, uid, role, 'active']
    );

    audit(req, 'carpool_group_join', 'Joined group ID ' + groupId + ' as ' + role);
    flashMsg(req, 'success', 'Joined group!');
    res.redirect('/school/carpool/groups/' + groupId);
  }));

  // Leave group
  app.post('/school/carpool/groups/:id/leave', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const groupId = parseInt(req.params.id, 10);

    await pool.query(
      `UPDATE carpool_members SET status = 'inactive' WHERE tenant_id = ? AND group_id = ? AND user_id = ?`,
      [tid, groupId, uid]
    );

    audit(req, 'carpool_group_leave', 'Left group ID ' + groupId);
    flashMsg(req, 'success', 'You have left the group.');
    res.redirect('/school/carpool/groups');
  }));

  // Remove member (admin)
  app.post('/school/carpool/groups/:groupId/remove/:userId', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const groupId = parseInt(req.params.groupId, 10);
    const targetUserId = parseInt(req.params.userId, 10);

    await pool.query(
      `UPDATE carpool_members SET status = 'inactive'
       WHERE tenant_id = ? AND group_id = ? AND user_id = ?`,
      [tid, groupId, targetUserId]
    );

    audit(req, 'carpool_member_remove', 'Removed user ' + targetUserId + ' from group ' + groupId);
    flashMsg(req, 'success', 'Member removed.');
    res.redirect('/school/carpool/groups/' + groupId);
  }));

  // ====================================================================
  //  ROUTE 3 - MATCHING ALGORITHM
  // ====================================================================
  app.get('/school/carpool/matching', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    // Get current user's profile for matching context
    const [profile] = await pool.query(
      `SELECT * FROM carpool_parent_profiles WHERE tenant_id = ? AND user_id = ?`, [tid, uid]
    );

    // Find compatible groups based on area, schedule, class
    const [matches] = await pool.query(
      `SELECT cg.*,
         (SELECT COUNT(*) FROM carpool_members cm2 WHERE cm2.group_id = cg.id AND cm2.status = 'active') AS member_count,
         CASE
           WHEN ? != '' THEN (cg.area = ?)
           ELSE 0
         END AS area_match,
         CASE
           WHEN ? != '' THEN (cg.school_zone = ?)
           ELSE 0
         END AS zone_match
       FROM carpool_groups cg
       WHERE cg.tenant_id = ? AND cg.status = 'active'
         AND cg.id NOT IN (
           SELECT cm3.group_id FROM carpool_members cm3
           WHERE cm3.user_id = ? AND cm3.tenant_id = ? AND cm3.status = 'active'
         )
         AND (SELECT COUNT(*) FROM carpool_members cm4 WHERE cm4.group_id = cg.id AND cm4.status = 'active') < cg.max_members
       ORDER BY area_match DESC, zone_match DESC, cg.member_count ASC
       LIMIT 20`,
      [
        (profile[0] && profile[0].area) || '', (profile[0] && profile[0].area) || '',
        (profile[0] && profile[0].school_zone) || '', (profile[0] && profile[0].school_zone) || '',
        tid, uid, tid
      ]
    );

    // Score each match
    var scored = matches.map(function (m) {
      var score = 0;
      if (m.area_match) score += 40;
      if (m.zone_match) score += 30;
      // penalize nearly-full groups
      var fillRatio = m.member_count / m.max_members;
      if (fillRatio < 0.5) score += 15;
      else if (fillRatio < 0.75) score += 10;
      else score += 5;
      m.matchScore = Math.min(100, score);
      return m;
    }).sort(function (a, b) { return b.matchScore - a.matchScore; });

    renderPage(req, res, 'school/carpool/matching', {
      title: 'Find a Carpool Match',
      theme: theme,
      nav: navItems('matching'),
      flash: getFlash(req),
      matches: scored,
      hasProfile: profile.length > 0,
    });
  }));

  // ====================================================================
  //  ROUTE 4 - SCHEDULE MANAGEMENT
  // ====================================================================

  // View schedules
  app.get('/school/carpool/schedule', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    const [schedules] = await pool.query(
      `SELECT cs.*, cg.name AS group_name
       FROM carpool_schedules cs
       JOIN carpool_groups cg ON cg.id = cs.group_id
       JOIN carpool_members cm ON cm.group_id = cs.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cs.tenant_id = ?
       ORDER BY cs.day_of_week, cs.departure_time ASC`, [uid, tid, tid]
    );

    // Build schedule grid
    var grid = {};
    DAYS_OF_WEEK.forEach(function (d) { grid[d] = []; });
    schedules.forEach(function (s) {
      var day = DAYS_OF_WEEK[s.day_of_week];
      if (day) grid[day].push(s);
    });

    renderPage(req, res, 'school/carpool/schedule', {
      title: 'Ride Schedule',
      theme: theme,
      nav: navItems('schedule'),
      flash: getFlash(req),
      grid: grid,
      daysOfWeek: DAYS_OF_WEEK,
    });
  }));

  // Create schedule
  app.post('/school/carpool/schedule/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { group_id, day_of_week, direction, departure_time, recurrence } = req.body;

    if (!group_id || day_of_week === undefined) {
      flashMsg(req, 'error', 'Group and day are required.');
      return res.redirect('/school/carpool/schedule');
    }

    // Verify membership
    const [mem] = await pool.query(
      `SELECT id FROM carpool_members WHERE tenant_id = ? AND group_id = ? AND user_id = ? AND status = 'active'`,
      [tid, group_id, uid]
    );
    if (!mem.length) {
      flashMsg(req, 'error', 'Not a member of that group.');
      return res.redirect('/school/carpool/schedule');
    }

    await pool.query(
      `INSERT INTO carpool_schedules
       (tenant_id, group_id, day_of_week, direction, departure_time, recurrence, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [tid, group_id, parseInt(day_of_week, 10), direction || 'morning',
       departure_time || '07:30', recurrence || 'weekly', uid]
    );

    audit(req, 'carpool_schedule_create', 'Schedule created for group ' + group_id);
    flashMsg(req, 'success', 'Schedule added.');
    res.redirect('/school/carpool/schedule');
  }));

  // Delete schedule
  app.post('/school/carpool/schedule/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    await pool.query(
      'DELETE FROM carpool_schedules WHERE tenant_id = ? AND id = ?',
      [tid, parseInt(req.params.id, 10)]
    );
    flashMsg(req, 'success', 'Schedule removed.');
    res.redirect('/school/carpool/schedule');
  }));

  // ====================================================================
  //  ROUTE 5 - RIDE SCHEDULING (individual rides from schedules)
  // ====================================================================
  app.get('/school/carpool/rides', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();
    const pg = paginate(req);
    const dateFilter = req.query.date || todayStr();

    const [rides] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name,
         (SELECT COUNT(*) FROM carpool_stops cs WHERE cs.ride_id = cr.id) AS stop_count
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.ride_date = ?
       ORDER BY cr.departure_time ASC LIMIT ? OFFSET ?`,
      [uid, tid, tid, dateFilter, pg.limit, pg.offset]
    );

    renderPage(req, res, 'school/carpool/rides', {
      title: 'Rides',
      theme: theme,
      nav: navItems('schedule'),
      flash: getFlash(req),
      rides: rides,
      dateFilter: dateFilter,
      page: pg.page,
    });
  }));

  // Create a ride
  app.post('/school/carpool/rides/create', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { group_id, ride_date, direction, departure_time, driver_id, notes } = req.body;

    if (!group_id || !ride_date) {
      flashMsg(req, 'error', 'Group and date are required.');
      return res.redirect('/school/carpool/schedule');
    }

    await pool.query(
      `INSERT INTO carpool_rides
       (tenant_id, group_id, ride_date, direction, departure_time, driver_id, distance_km, status, notes, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,'',?,NOW())`,
      [tid, parseInt(group_id, 10), ride_date, direction || 'morning',
       departure_time || '07:30', driver_id ? parseInt(driver_id, 10) : uid,
       0, RIDE_STATUS_SCHEDULED, uid]
    );

    audit(req, 'carpool_ride_create', 'Ride created for ' + ride_date);
    flashMsg(req, 'success', 'Ride scheduled!');
    res.redirect('/school/carpool/schedule');
  }));

  // Generate weekly rides from schedule
  app.post('/school/carpool/schedule/generate-week', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { group_id, week_start } = req.body;

    if (!group_id || !week_start) {
      flashMsg(req, 'error', 'Group and week start date are required.');
      return res.redirect('/school/carpool/schedule');
    }

    // Get schedules for this group
    const [schedules] = await pool.query(
      `SELECT * FROM carpool_schedules WHERE tenant_id = ? AND group_id = ?`, [tid, group_id]
    );

    // Get driver members for rotation
    const [drivers] = await pool.query(
      `SELECT user_id FROM carpool_members
       WHERE tenant_id = ? AND group_id = ? AND status = 'active' AND role IN ('admin','driver')
       ORDER BY joined_at ASC`, [tid, group_id]
    );

    if (!drivers.length) {
      flashMsg(req, 'error', 'No drivers in this group.');
      return res.redirect('/school/carpool/schedule');
    }

    var startDate = new Date(week_start);
    var inserted = 0;
    var driverIdx = 0;

    for (var d = 0; d < 5; d++) { // Monday-Friday
      var rideDate = new Date(startDate);
      rideDate.setDate(rideDate.getDate() + d);
      var dateStr = rideDate.toISOString().slice(0, 10);

      schedules.forEach(function (sch) {
        if (sch.day_of_week !== d) return;
        var driverId = drivers[driverIdx % drivers.length].user_id;

        pool.query(
          `INSERT IGNORE INTO carpool_rides
           (tenant_id, group_id, ride_date, direction, departure_time, driver_id, distance_km, status, notes, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,'',?,NOW())`,
          [tid, group_id, dateStr, sch.direction, sch.departure_time, driverId,
           0, RIDE_STATUS_SCHEDULED, uid]
        ).catch(function () {});

        driverIdx++;
        inserted++;
      });
    }

    audit(req, 'carpool_week_generate', 'Generated ' + inserted + ' rides for week of ' + week_start);
    flashMsg(req, 'success', inserted + ' rides generated for the week!');
    res.redirect('/school/carpool/schedule');
  }));

  // Mark absence
  app.post('/school/carpool/rides/:id/absence', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.id, 10);
    const { passenger_id, reason } = req.body;

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,?,NOW())`,
      [tid, rideId, parseInt(passenger_id, 10), 'absence', reason || 'Parent reported absence']
    );

    // Send message to group
    const [ride] = await pool.query(
      `SELECT cr.group_id, cg.name AS group_name FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       WHERE cr.tenant_id = ? AND cr.id = ?`, [tid, rideId]
    );
    if (ride.length) {
      await pool.query(
        `INSERT INTO carpool_messages (tenant_id, group_id, sender_id, msg_type, content, created_at)
         VALUES (?,?,?,'absence',?,NOW())`,
        [tid, ride[0].group_id, req.session.user.id,
         'A passenger will be absent for the ride on ' + (ride[0].ride_date || 'today') + '. Reason: ' + (reason || 'Not specified')]
      );
    }

    audit(req, 'carpool_absence', 'Absence reported for ride ' + rideId);
    flashMsg(req, 'success', 'Absence noted and group notified.');
    res.redirect('back');
  }));

  // ====================================================================
  //  ROUTE 6 - ROUTE PLANNING (stops, order, ETA)
  // ====================================================================
  app.get('/school/carpool/routes', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();
    const rideId = req.query.ride_id;

    if (!rideId) {
      // Show upcoming rides with routes
      const [rides] = await pool.query(
        `SELECT cr.*, cg.name AS group_name,
           (SELECT COUNT(*) FROM carpool_stops cs WHERE cs.ride_id = cr.id) AS stop_count
         FROM carpool_rides cr
         JOIN carpool_groups cg ON cg.id = cr.group_id
         JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
         WHERE cr.tenant_id = ? AND cr.ride_date >= ?
         ORDER BY cr.ride_date ASC, cr.departure_time ASC LIMIT 20`,
        [uid, tid, tid, todayStr()]
      );

      renderPage(req, res, 'school/carpool/routes', {
        title: 'Route Planning',
        theme: theme,
        nav: navItems('routes'),
        flash: getFlash(req),
        rides: rides,
        stops: [],
        selectedRide: null,
      });
      return;
    }

    // Show stops for specific ride
    const [ride] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       WHERE cr.tenant_id = ? AND cr.id = ?`, [tid, rideId]
    );

    const [stops] = await pool.query(
      `SELECT cs.*, u.display_name AS passenger_name
       FROM carpool_stops cs
       LEFT JOIN users u ON u.id = cs.passenger_id
       WHERE cs.tenant_id = ? AND cs.ride_id = ?
       ORDER BY cs.stop_order ASC`, [tid, rideId]
    );

    renderPage(req, res, 'school/carpool/routes', {
      title: 'Route Planning',
      theme: theme,
      nav: navItems('routes'),
      flash: getFlash(req),
      rides: [],
      stops: stops,
      selectedRide: ride[0] || null,
    });
  }));

  // Add stop
  app.post('/school/carpool/routes/stops/add', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const { ride_id, passenger_id, address, lat, lng, pickup_time, stop_order } = req.body;

    if (!ride_id || !address) {
      flashMsg(req, 'error', 'Ride and address are required.');
      return res.redirect('/school/carpool/routes?ride_id=' + ride_id);
    }

    await pool.query(
      `INSERT INTO carpool_stops
       (tenant_id, ride_id, passenger_id, address, latitude, longitude, pickup_time, stop_order, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [tid, parseInt(ride_id, 10), passenger_id ? parseInt(passenger_id, 10) : null,
       address, lat || null, lng || null,
       pickup_time || null, parseInt(stop_order, 10) || 0]
    );

    audit(req, 'carpool_stop_add', 'Stop added for ride ' + ride_id);
    flashMsg(req, 'success', 'Stop added to route.');
    res.redirect('/school/carpool/routes?ride_id=' + ride_id);
  }));

  // Update stop ETA
  app.post('/school/carpool/routes/stops/:id/update', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const stopId = parseInt(req.params.id, 10);
    const { pickup_time, stop_order, address, lat, lng } = req.body;

    await pool.query(
      `UPDATE carpool_stops SET pickup_time = ?, stop_order = ?, address = ?, latitude = ?, longitude = ?, updated_at = NOW()
       WHERE tenant_id = ? AND id = ?`,
      [pickup_time, parseInt(stop_order, 10) || 0, address,
       lat || null, lng || null, tid, stopId]
    );

    flashMsg(req, 'success', 'Stop updated.');
    res.redirect('back');
  }));

  // Remove stop
  app.post('/school/carpool/routes/stops/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const stopId = parseInt(req.params.id, 10);

    await pool.query(
      'DELETE FROM carpool_stops WHERE tenant_id = ? AND id = ?', [tid, stopId]
    );

    flashMsg(req, 'success', 'Stop removed.');
    res.redirect('back');
  }));

  // Auto-optimize stop order (nearest-neighbor heuristic)
  app.post('/school/carpool/routes/:rideId/optimize', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.rideId, 10);

    const [stops] = await pool.query(
      `SELECT * FROM carpool_stops WHERE tenant_id = ? AND ride_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY stop_order ASC`, [tid, rideId]
    );

    if (stops.length < 2) {
      flashMsg(req, 'info', 'Need at least 2 stops with coordinates to optimize.');
      return res.redirect('/school/carpool/routes?ride_id=' + rideId);
    }

    // Nearest-neighbor TSP heuristic using Haversine
    function haversine(lat1, lon1, lat2, lon2) {
      var R = 6371;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    var visited = {};
    var ordered = [];
    var current = stops[0];
    ordered.push(current);
    visited[current.id] = true;

    while (ordered.length < stops.length) {
      var nearest = null;
      var nearestDist = Infinity;
      stops.forEach(function (s) {
        if (visited[s.id]) return;
        var dist = haversine(current.latitude, current.longitude, s.latitude, s.longitude);
        if (dist < nearestDist) { nearestDist = dist; nearest = s; }
      });
      if (nearest) {
        ordered.push(nearest);
        visited[nearest.id] = true;
        current = nearest;
      } else break;
    }

    // Update order and calculate ETAs
    var cumulativeTime = 0;
    for (var i = 0; i < ordered.length; i++) {
      cumulativeTime += 3; // 3 min per stop
      var etaH = 7 + Math.floor(cumulativeTime / 60);
      var etaM = cumulativeTime % 60;
      var etaStr = (etaH < 10 ? '0' : '') + etaH + ':' + (etaM < 10 ? '0' : '') + etaM;

      await pool.query(
        'UPDATE carpool_stops SET stop_order = ?, pickup_time = ? WHERE tenant_id = ? AND id = ?',
        [i + 1, etaStr, tid, ordered[i].id]
      );
    }

    // Update ride distance
    var totalDist = 0;
    for (var j = 1; j < ordered.length; j++) {
      totalDist += haversine(ordered[j - 1].latitude, ordered[j - 1].longitude,
        ordered[j].latitude, ordered[j].longitude);
    }
    await pool.query(
      'UPDATE carpool_rides SET distance_km = ROUND(?,1) WHERE tenant_id = ? AND id = ?',
      [totalDist, tid, rideId]
    );

    audit(req, 'carpool_route_optimize', 'Route optimized for ride ' + rideId);
    flashMsg(req, 'success', 'Route optimized! Estimated distance: ' + totalDist.toFixed(1) + ' km');
    res.redirect('/school/carpool/routes?ride_id=' + rideId);
  }));

  // ====================================================================
  //  ROUTE 7 - PARENT PROFILES
  // ====================================================================
  app.get('/school/carpool/profile', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    const [profiles] = await pool.query(
      'SELECT * FROM carpool_parent_profiles WHERE tenant_id = ? AND user_id = ?', [tid, uid]
    );

    // Get rating info
    const [rating] = await pool.query(
      `SELECT COALESCE(AVG(rating),0) AS avg_rating, COUNT(*) AS rating_count
       FROM carpool_ride_logs
       WHERE tenant_id = ? AND user_id = ? AND action = 'rating'`, [tid, uid]
    );

    renderPage(req, res, 'school/carpool/profile', {
      title: 'Parent Profile',
      theme: theme,
      nav: navItems('profile'),
      flash: getFlash(req),
      profile: profiles[0] || null,
      avgRating: (rating[0] && rating[0].avg_rating) || 0,
      ratingCount: (rating[0] && rating[0].rating_count) || 0,
    });
  }));

  // Save profile
  app.post('/school/carpool/profile', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const {
      full_name, phone, alt_phone, address, area, school_zone,
      children_names, children_classes,
      car_make, car_model, car_color, car_plate, car_capacity,
      license_number, insurance_provider, insurance_policy, insurance_expiry,
      preferred_role, availability_notes
    } = req.body;

    const [existing] = await pool.query(
      'SELECT id FROM carpool_parent_profiles WHERE tenant_id = ? AND user_id = ?', [tid, uid]
    );

    var data = {
      full_name: full_name || '',
      phone: phone || '',
      alt_phone: alt_phone || '',
      address: address || '',
      area: area || '',
      school_zone: school_zone || '',
      children_names: children_names || '',
      children_classes: children_classes || '',
      car_make: car_make || '',
      car_model: car_model || '',
      car_color: car_color || '',
      car_plate: car_plate || '',
      car_capacity: parseInt(car_capacity, 10) || 4,
      license_number: license_number || '',
      insurance_provider: insurance_provider || '',
      insurance_policy: insurance_policy || '',
      insurance_expiry: insurance_expiry || null,
      preferred_role: preferred_role || 'rider',
      availability_notes: availability_notes || '',
      updated_at: nowStr(),
    };

    if (existing.length) {
      await pool.query(
        'UPDATE carpool_parent_profiles SET ? WHERE tenant_id = ? AND user_id = ?',
        [data, tid, uid]
      );
    } else {
      data.tenant_id = tid;
      data.user_id = uid;
      data.created_at = nowStr();
      await pool.query('INSERT INTO carpool_parent_profiles SET ?', data);
    }

    audit(req, 'carpool_profile_update', 'Profile updated');
    flashMsg(req, 'success', 'Profile saved.');
    res.redirect('/school/carpool/profile');
  }));

  // Rate a parent
  app.post('/school/carpool/profile/:userId/rate', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const targetUserId = parseInt(req.params.userId, 10);
    const { rating, ride_id, comment } = req.body;
    var score = Math.min(5, Math.max(1, parseInt(rating, 10)));

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, rating, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [tid, parseInt(ride_id, 10) || null, targetUserId, 'rating',
       comment || '', score, req.session.user.id]
    );

    flashMsg(req, 'success', 'Rating submitted.');
    res.redirect('back');
  }));

  // ====================================================================
  //  ROUTE 8 - EMERGENCY CONTACTS
  // ====================================================================
  app.get('/school/carpool/emergency', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    const [contacts] = await pool.query(
      `SELECT * FROM carpool_emergency_contacts
       WHERE tenant_id = ? AND parent_id = ?
       ORDER BY priority ASC, name ASC`, [tid, uid]
    );

    renderPage(req, res, 'school/carpool/emergency', {
      title: 'Emergency Contacts',
      theme: theme,
      nav: navItems('emergency'),
      flash: getFlash(req),
      contacts: contacts,
    });
  }));

  // Add emergency contact
  app.post('/school/carpool/emergency/add', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { name, relationship, phone, alt_phone, email, address, medical_notes, priority, is_primary } = req.body;

    await pool.query(
      `INSERT INTO carpool_emergency_contacts
       (tenant_id, parent_id, name, relationship, phone, alt_phone, email, address, medical_notes, priority, is_primary, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [tid, uid, name, relationship || '', phone, alt_phone || '', email || '',
       address || '', medical_notes || '',
       parseInt(priority, 10) || 1, is_primary === '1' ? 1 : 0]
    );

    audit(req, 'carpool_emergency_add', 'Emergency contact added: ' + name);
    flashMsg(req, 'success', 'Emergency contact added.');
    res.redirect('/school/carpool/emergency');
  }));

  // Edit emergency contact
  app.post('/school/carpool/emergency/:id/edit', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const contactId = parseInt(req.params.id, 10);
    const { name, relationship, phone, alt_phone, email, address, medical_notes, priority, is_primary } = req.body;

    await pool.query(
      `UPDATE carpool_emergency_contacts
       SET name=?, relationship=?, phone=?, alt_phone=?, email=?, address=?,
           medical_notes=?, priority=?, is_primary=?, updated_at=NOW()
       WHERE tenant_id = ? AND id = ?`,
      [name, relationship || '', phone, alt_phone || '', email || '',
       address || '', medical_notes || '',
       parseInt(priority, 10) || 1, is_primary === '1' ? 1 : 0, tid, contactId]
    );

    flashMsg(req, 'success', 'Emergency contact updated.');
    res.redirect('/school/carpool/emergency');
  }));

  // Delete emergency contact
  app.post('/school/carpool/emergency/:id/delete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    await pool.query(
      'DELETE FROM carpool_emergency_contacts WHERE tenant_id = ? AND id = ?',
      [tid, parseInt(req.params.id, 10)]
    );
    flashMsg(req, 'success', 'Emergency contact removed.');
    res.redirect('/school/carpool/emergency');
  }));

  // ====================================================================
  //  ROUTE 9 - MESSAGING (group messaging, confirmations, delays)
  // ====================================================================
  app.get('/school/carpool/messages', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();
    const pg = paginate(req);

    // Get groups user belongs to
    const [myGroups] = await pool.query(
      `SELECT cm.group_id, cg.name AS group_name
       FROM carpool_members cm
       JOIN carpool_groups cg ON cg.id = cm.group_id
       WHERE cm.tenant_id = ? AND cm.user_id = ? AND cm.status = 'active'`, [tid, uid]
    );

    var groupIds = myGroups.map(function (g) { return g.group_id; });

    var messages = [];
    if (groupIds.length) {
      var placeholders = groupIds.map(function () { return '?'; }).join(',');

      // Mark as read
      await pool.query(
        `UPDATE carpool_messages SET is_read = 1
         WHERE tenant_id = ? AND group_id IN (${placeholders}) AND sender_id != ? AND is_read = 0`,
        [tid].concat(groupIds).concat([uid])
      );

      const [msgRows] = await pool.query(
        `SELECT cm.*, u.display_name AS sender_name, cg.name AS group_name
         FROM carpool_messages cm
         JOIN users u ON u.id = cm.sender_id
         JOIN carpool_groups cg ON cg.id = cm.group_id
         WHERE cm.tenant_id = ? AND cm.group_id IN (${placeholders})
         ORDER BY cm.created_at DESC LIMIT ? OFFSET ?`,
        [tid].concat(groupIds).concat([pg.limit, pg.offset])
      );
      messages = msgRows;
    }

    renderPage(req, res, 'school/carpool/messages', {
      title: 'Messages',
      theme: theme,
      nav: navItems('messages'),
      flash: getFlash(req),
      messages: messages,
      groups: myGroups,
      page: pg.page,
    });
  }));

  // Send message
  app.post('/school/carpool/messages/send', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { group_id, msg_type, content } = req.body;

    if (!group_id || !content) {
      flashMsg(req, 'error', 'Group and message are required.');
      return res.redirect('/school/carpool/messages');
    }

    var msgType = msg_type || 'general';
    if (MSG_TYPES.indexOf(msgType) === -1) msgType = 'general';

    await pool.query(
      `INSERT INTO carpool_messages (tenant_id, group_id, sender_id, msg_type, content, is_read, created_at)
       VALUES (?,?,?,?,?,0,NOW())`,
      [tid, parseInt(group_id, 10), uid, msgType, content]
    );

    audit(req, 'carpool_message_send', msgType + ' message to group ' + group_id);

    // Auto-create ride confirmation if type is confirmation
    if (msgType === 'confirmation') {
      var [ride] = await pool.query(
        `SELECT id FROM carpool_rides WHERE tenant_id = ? AND group_id = ? AND ride_date = ? AND status = 'scheduled'
         LIMIT 1`,
        [tid, parseInt(group_id, 10), todayStr()]
      );
      if (ride.length) {
        await pool.query(
          `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
           VALUES (?,?,?,?,NOW())`,
          [tid, ride[0].id, uid, 'confirmed', content]
        );
      }
    }

    flashMsg(req, 'success', 'Message sent.');
    res.redirect('/school/carpool/messages');
  }));

  // Send delay notification
  app.post('/school/carpool/messages/delay', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { group_id, ride_id, delay_minutes, reason } = req.body;

    var mins = parseInt(delay_minutes, 10) || 5;
    var content = '🚗 Delay Alert: ' + mins + ' minutes late. ' + (reason || 'Running behind schedule.');

    await pool.query(
      `INSERT INTO carpool_messages (tenant_id, group_id, sender_id, msg_type, content, is_read, created_at)
       VALUES (?,?,?,?,?,0,NOW())`,
      [tid, parseInt(group_id, 10), uid, 'delay', content]
    );

    if (ride_id) {
      await pool.query(
        `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
         VALUES (?,?,?,?,NOW())`,
        [tid, parseInt(ride_id, 10), uid, 'delay', mins + ' min delay: ' + (reason || '')]
      );

      // Check if exceeds late threshold
      if (mins >= LATE_THRESHOLD_MINUTES) {
        await pool.query(
          `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
           VALUES (?,?,?,?,NOW())`,
          [tid, parseInt(ride_id, 10), uid, 'late_alert', mins + ' min delay exceeded ' + LATE_THRESHOLD_MINUTES + ' min threshold']
        );
      }
    }

    audit(req, 'carpool_delay_notify', 'Delay ' + mins + ' min for group ' + group_id);
    flashMsg(req, 'success', 'Delay notification sent to group.');
    res.redirect('/school/carpool/messages');
  }));

  // ====================================================================
  //  ROUTE 10 - CHECK-IN / CHECK-OUT
  // ====================================================================
  app.get('/school/carpool/checkin', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    // Today's rides the user is involved in
    const [rides] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name,
         (SELECT GROUP_CONCAT(cs.address ORDER BY cs.stop_order SEPARATOR ' → ')
          FROM carpool_stops cs WHERE cs.ride_id = cr.id) AS route_summary
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.ride_date = ?
       ORDER BY cr.departure_time ASC`, [uid, tid, tid, todayStr()]
    );

    // Get check-in logs for today
    var rideIds = rides.map(function (r) { return r.id; });
    var logs = [];
    if (rideIds.length) {
      var ph = rideIds.map(function () { return '?'; }).join(',');
      const [logRows] = await pool.query(
        `SELECT crl.*, u.display_name AS user_name
         FROM carpool_ride_logs crl
         JOIN users u ON u.id = crl.user_id
         WHERE crl.tenant_id = ? AND crl.ride_id IN (${ph}) AND crl.action IN ('check_in','check_out')
         ORDER BY crl.created_at DESC`,
        [tid].concat(rideIds)
      );
      logs = logRows;
    }

    renderPage(req, res, 'school/carpool/checkin', {
      title: 'Ride Check-in/out',
      theme: theme,
      nav: navItems('checkin'),
      flash: getFlash(req),
      rides: rides,
      logs: logs,
    });
  }));

  // Check-in
  app.post('/school/carpool/checkin/:rideId/checkin', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.rideId, 10);
    const { passenger_id, location, notes } = req.body;

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,NOW())`,
      [tid, rideId, parseInt(passenger_id, 10) || req.session.user.id,
       'check_in', (location || '') + (notes ? ' - ' + notes : '')]
    );

    // Update ride status to in_progress if not already
    await pool.query(
      `UPDATE carpool_rides SET status = ? WHERE tenant_id = ? AND id = ? AND status = ?`,
      [RIDE_STATUS_IN_PROGRESS, tid, rideId, RIDE_STATUS_SCHEDULED]
    );

    audit(req, 'carpool_checkin', 'Check-in for ride ' + rideId);
    flashMsg(req, 'success', 'Checked in successfully!');
    res.redirect('/school/carpool/checkin');
  }));

  // Check-out
  app.post('/school/carpool/checkin/:rideId/checkout', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.rideId, 10);
    const { passenger_id, location, notes } = req.body;

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,NOW())`,
      [tid, rideId, parseInt(passenger_id, 10) || req.session.user.id,
       'check_out', (location || '') + (notes ? ' - ' + notes : '')]
    );

    audit(req, 'carpool_checkout', 'Check-out for ride ' + rideId);
    flashMsg(req, 'success', 'Checked out successfully!');
    res.redirect('/school/carpool/checkin');
  }));

  // Complete ride
  app.post('/school/carpool/checkin/:rideId/complete', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.rideId, 10);
    const { actual_distance } = req.body;

    await pool.query(
      `UPDATE carpool_rides SET status = ?, distance_km = COALESCE(?, distance_km), completed_at = NOW()
       WHERE tenant_id = ? AND id = ?`,
      [RIDE_STATUS_COMPLETED, actual_distance ? parseFloat(actual_distance) : null, tid, rideId]
    );

    audit(req, 'carpool_ride_complete', 'Ride ' + rideId + ' completed');
    flashMsg(req, 'success', 'Ride marked as completed.');
    res.redirect('/school/carpool/checkin');
  }));

  // Cancel ride
  app.post('/school/carpool/checkin/:rideId/cancel', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.rideId, 10);
    const { reason } = req.body;

    await pool.query(
      `UPDATE carpool_rides SET status = ? WHERE tenant_id = ? AND id = ?`,
      [RIDE_STATUS_CANCELLED, tid, rideId]
    );

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,NOW())`,
      [tid, rideId, req.session.user.id, 'cancelled', reason || 'Ride cancelled']
    );

    audit(req, 'carpool_ride_cancel', 'Ride ' + rideId + ' cancelled');
    flashMsg(req, 'success', 'Ride cancelled and group notified.');
    res.redirect('/school/carpool/checkin');
  }));

  // Late alert check (run periodically or on demand)
  app.get('/school/carpool/checkin/late-check', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    var now = new Date();
    var thresholdTime = new Date(now.getTime() - LATE_THRESHOLD_MINUTES * 60000);
    var timeStr = thresholdTime.toTimeString().slice(0, 5);

    const [lateRides] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.ride_date = ? AND cr.status = 'scheduled'
         AND cr.departure_time < ?
       ORDER BY cr.departure_time ASC`,
      [uid, tid, tid, todayStr(), timeStr]
    );

    // Send late alert messages
    lateRides.forEach(function (ride) {
      pool.query(
        `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
         VALUES (?,?,?,?,NOW())`,
        [tid, ride.id, uid, 'late_alert', 'Auto-generated: Ride past departure by ' + LATE_THRESHOLD_MINUTES + '+ min']
      ).catch(function () {});
    });

    res.json({ late_count: lateRides.length, rides: lateRides });
  }));

  // ====================================================================
  //  ROUTE 11 - COST SHARING
  // ====================================================================
  app.get('/school/carpool/costs', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();
    var month = req.query.month || todayStr().slice(0, 7); // YYYY-MM

    // Rides this month for user's groups
    const [rides] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.ride_date LIKE ? AND cr.status IN ('completed','in_progress')
       ORDER BY cr.ride_date ASC`, [uid, tid, tid, month + '%']
    );

    var totalKm = 0;
    var totalFuelCost = 0;
    var totalCO2 = 0;
    rides.forEach(function (r) {
      totalKm += r.distance_km || 0;
      totalFuelCost += (r.distance_km || 0) * FUEL_COST_PER_KM;
      totalCO2 += (r.distance_km || 0) * AVG_CO2_PER_KM;
    });

    // Get member count for each group to calculate split
    var costBreakdown = {};
    rides.forEach(function (r) {
      if (!costBreakdown[r.group_id]) {
        costBreakdown[r.group_id] = {
          group_name: r.group_name,
          km: 0, fuel_cost: 0, ride_count: 0,
        };
      }
      costBreakdown[r.group_id].km += r.distance_km || 0;
      costBreakdown[r.group_id].fuel_cost += (r.distance_km || 0) * FUEL_COST_PER_KM;
      costBreakdown[r.group_id].ride_count++;
    });

    // Get member counts
    var groupIds = Object.keys(costBreakdown);
    if (groupIds.length) {
      var ph = groupIds.map(function () { return '?'; }).join(',');
      const [memberCounts] = await pool.query(
        `SELECT group_id, COUNT(*) AS cnt FROM carpool_members
         WHERE tenant_id = ? AND group_id IN (${ph}) AND status = 'active'
         GROUP BY group_id`,
        [tid].concat(groupIds)
      );
      memberCounts.forEach(function (mc) {
        if (costBreakdown[mc.group_id]) {
          costBreakdown[mc.group_id].members = mc.cnt;
          costBreakdown[mc.group_id].cost_per_member = costBreakdown[mc.group_id].fuel_cost / mc.cnt;
        }
      });
    }

    renderPage(req, res, 'school/carpool/costs', {
      title: 'Cost Sharing',
      theme: theme,
      nav: navItems('costs'),
      flash: getFlash(req),
      month: month,
      rides: rides,
      totalKm: totalKm.toFixed(1),
      totalFuelCost: totalFuelCost.toFixed(2),
      totalCO2: totalCO2.toFixed(2),
      costBreakdown: costBreakdown,
      fuelCostPerKm: FUEL_COST_PER_KM,
    });
  }));

  // Log fuel expense
  app.post('/school/carpool/costs/log-fuel', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { ride_id, fuel_liters, fuel_cost, odometer } = req.body;

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, fuel_liters, fuel_cost, created_at)
       VALUES (?,?,?,?,?,?,NOW())`,
      [tid, parseInt(ride_id, 10), uid, 'fuel_log',
       'Fuel: ' + fuel_liters + 'L, Cost: $' + fuel_cost + (odometer ? ', ODO: ' + odometer + 'km' : ''),
       parseFloat(fuel_liters) || 0, parseFloat(fuel_cost) || 0]
    );

    audit(req, 'carpool_fuel_log', 'Fuel logged for ride ' + ride_id);
    flashMsg(req, 'success', 'Fuel expense logged.');
    res.redirect('/school/carpool/costs');
  }));

  // Monthly summary
  app.get('/school/carpool/costs/summary', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const months = req.query.months ? parseInt(req.query.months, 10) : 6;

    const [summary] = await pool.query(
      `SELECT DATE_FORMAT(cr.ride_date, '%Y-%m') AS month,
         COUNT(DISTINCT cr.id) AS ride_count,
         COALESCE(SUM(cr.distance_km),0) AS total_km,
         COALESCE(SUM(cr.distance_km * ?),2) AS total_fuel_cost,
         COALESCE(SUM(cr.distance_km * ?),2) AS co2_saved
       FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.status = 'completed'
         AND cr.ride_date >= DATE_SUB(NOW(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(cr.ride_date, '%Y-%m')
       ORDER BY month DESC`,
      [FUEL_COST_PER_KM, AVG_CO2_PER_KM, uid, tid, tid, months]
    );

    res.json({ months: months, data: summary });
  }));

  // ====================================================================
  //  ROUTE 12 - ANALYTICS
  // ====================================================================
  app.get('/school/carpool/analytics', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    // Overall stats for this parent
    const [overall] = await pool.query(
      `SELECT
         COUNT(DISTINCT cr.id) AS total_rides,
         COALESCE(SUM(cr.distance_km),0) AS total_km,
         COALESCE(SUM(CASE WHEN cr.direction = 'morning' THEN 1 ELSE 0 END),0) AS morning_rides,
         COALESCE(SUM(CASE WHEN cr.direction = 'afternoon' THEN 1 ELSE 0 END),0) AS afternoon_rides,
         COALESCE(SUM(cr.distance_km * ?),2) AS co2_saved_kg,
         COALESCE(SUM(cr.distance_km * ?),2) AS fuel_cost_saved
       FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.status = 'completed'`,
      [AVG_CO2_PER_KM, FUEL_COST_PER_KM, uid, tid, tid]
    );

    // Monthly trend
    const [monthly] = await pool.query(
      `SELECT DATE_FORMAT(cr.ride_date, '%Y-%m') AS month,
         COUNT(DISTINCT cr.id) AS rides,
         COALESCE(SUM(cr.distance_km),0) AS km,
         COALESCE(SUM(cr.distance_km * ?),2) AS co2
       FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.status = 'completed'
         AND cr.ride_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(cr.ride_date, '%Y-%m')
       ORDER BY month ASC`,
      [AVG_CO2_PER_KM, uid, tid, tid]
    );

    // Group participation
    const [participation] = await pool.query(
      `SELECT cg.name AS group_name,
         COUNT(DISTINCT cr.id) AS rides,
         COALESCE(SUM(cr.distance_km),0) AS km
       FROM carpool_members cm
       JOIN carpool_groups cg ON cg.id = cm.group_id
       LEFT JOIN carpool_rides cr ON cr.group_id = cm.group_id AND cr.status = 'completed'
       WHERE cm.tenant_id = ? AND cm.user_id = ? AND cm.status = 'active'
       GROUP BY cm.group_id
       ORDER BY rides DESC`,
      [tid, uid]
    );

    // Check-in compliance
    const [compliance] = await pool.query(
      `SELECT
         COUNT(DISTINCT CASE WHEN cr.status = 'completed' THEN cr.id END) AS completed_rides,
         COUNT(DISTINCT CASE WHEN crl.action = 'check_in' THEN crl.ride_id END) AS rides_with_checkin
       FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       LEFT JOIN carpool_ride_logs crl ON crl.ride_id = cr.id AND crl.action = 'check_in'
       WHERE cr.tenant_id = ? AND cr.status = 'completed'
         AND cr.ride_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH)`,
      [uid, tid, tid]
    );

    // Average rating
    const [avgRating] = await pool.query(
      `SELECT COALESCE(AVG(rating),0) AS avg_rating FROM carpool_ride_logs
       WHERE tenant_id = ? AND user_id = ? AND action = 'rating'`, [tid, uid]
    );

    var o = overall[0] || {};
    var c = compliance[0] || {};
    var complianceRate = c.completed_rides > 0
      ? Math.round((c.rides_with_checkin / c.completed_rides) * 100) : 100;

    renderPage(req, res, 'school/carpool/analytics', {
      title: 'Carpool Analytics',
      theme: theme,
      nav: navItems('analytics'),
      flash: getFlash(req),
      totalRides: o.total_rides || 0,
      totalKm: (o.total_km || 0).toFixed(1),
      morningRides: o.morning_rides || 0,
      afternoonRides: o.afternoon_rides || 0,
      co2Saved: (o.co2_saved_kg || 0).toFixed(2),
      fuelCostSaved: (o.fuel_cost_saved || 0).toFixed(2),
      monthly: monthly,
      participation: participation,
      complianceRate: complianceRate,
      avgRating: (avgRating[0] && avgRating[0].avg_rating) || 0,
      // Equivalent trees planted metric
      treesEquiv: ((o.co2_saved_kg || 0) / 21).toFixed(1), // ~21kg CO2 absorbed per tree per year
    });
  }));

  // Analytics API for charts
  app.get('/school/carpool/analytics/data', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const period = req.query.period || '6m';

    var monthsBack = 6;
    if (period === '1y') monthsBack = 12;
    else if (period === '3m') monthsBack = 3;

    const [data] = await pool.query(
      `SELECT DATE_FORMAT(cr.ride_date, '%Y-%m') AS month,
         COUNT(DISTINCT cr.id) AS rides,
         COALESCE(SUM(cr.distance_km),0) AS km,
         COALESCE(SUM(cr.distance_km * ?),2) AS co2_kg,
         COALESCE(SUM(cr.distance_km * ?),2) AS cost_saved
       FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.status = 'completed'
         AND cr.ride_date >= DATE_SUB(NOW(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(cr.ride_date, '%Y-%m')
       ORDER BY month ASC`,
      [AVG_CO2_PER_KM, FUEL_COST_PER_KM, uid, tid, tid, monthsBack]
    );

    res.json({ period: period, data: data });
  }));

  // ====================================================================
  //  ROUTE 13 - SETTINGS
  // ====================================================================
  app.get('/school/carpool/settings', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();

    const [settings] = await pool.query(
      `SELECT * FROM carpool_settings WHERE tenant_id = ? AND user_id = ?`, [tid, uid]
    );

    var s = {};
    if (settings.length) {
      s = settings[0];
    }

    renderPage(req, res, 'school/carpool/settings', {
      title: 'Carpool Settings',
      theme: theme,
      nav: navItems('settings'),
      flash: getFlash(req),
      settings: s,
      defaultLateThreshold: LATE_THRESHOLD_MINUTES,
      msgTypes: MSG_TYPES,
    });
  }));

  // Save settings
  app.post('/school/carpool/settings', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const {
      notify_ride_reminder, notify_delay, notify_absence, notify_checkin,
      notify_message, notify_late_alert, notify_weekly_summary,
      reminder_minutes_before, late_threshold_minutes,
      default_group_visibility, auto_join_matching
    } = req.body;

    var data = {
      notify_ride_reminder: req.body.notify_ride_reminder === '1' ? 1 : 0,
      notify_delay: req.body.notify_delay === '1' ? 1 : 0,
      notify_absence: req.body.notify_absence === '1' ? 1 : 0,
      notify_checkin: req.body.notify_checkin === '1' ? 1 : 0,
      notify_message: req.body.notify_message === '1' ? 1 : 0,
      notify_late_alert: req.body.notify_late_alert === '1' ? 1 : 0,
      notify_weekly_summary: req.body.notify_weekly_summary === '1' ? 1 : 0,
      reminder_minutes_before: parseInt(reminder_minutes_before, 10) || 15,
      late_threshold_minutes: parseInt(late_threshold_minutes, 10) || LATE_THRESHOLD_MINUTES,
      default_group_visibility: default_group_visibility || 'group',
      auto_join_matching: auto_join_matching === '1' ? 1 : 0,
      updated_at: nowStr(),
    };

    const [existing] = await pool.query(
      'SELECT id FROM carpool_settings WHERE tenant_id = ? AND user_id = ?', [tid, uid]
    );

    if (existing.length) {
      await pool.query(
        'UPDATE carpool_settings SET ? WHERE tenant_id = ? AND user_id = ?',
        [data, tid, uid]
      );
    } else {
      data.tenant_id = tid;
      data.user_id = uid;
      data.created_at = nowStr();
      await pool.query('INSERT INTO carpool_settings SET ?', data);
    }

    audit(req, 'carpool_settings_update', 'Notification settings updated');
    flashMsg(req, 'success', 'Settings saved.');
    res.redirect('/school/carpool/settings');
  }));

  // ====================================================================
  //  ROUTE 14 - API endpoints for AJAX calls
  // ====================================================================

  // API: Get group members (for dropdowns)
  app.get('/school/carpool/api/group/:groupId/members', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const groupId = parseInt(req.params.groupId, 10);

    const [members] = await pool.query(
      `SELECT cm.*, u.display_name, u.email, u.phone, u.avatar_url
       FROM carpool_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.tenant_id = ? AND cm.group_id = ? AND cm.status = 'active'`,
      [tid, groupId]
    );

    res.json({ members: members });
  }));

  // API: Get ride details with stops
  app.get('/school/carpool/api/ride/:rideId', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const rideId = parseInt(req.params.rideId, 10);

    const [rides] = await pool.query(
      `SELECT cr.*, cg.name AS group_name, u.display_name AS driver_name
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       WHERE cr.tenant_id = ? AND cr.id = ?`, [tid, rideId]
    );

    if (!rides.length) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    const [stops] = await pool.query(
      `SELECT cs.*, u.display_name AS passenger_name
       FROM carpool_stops cs
       LEFT JOIN users u ON u.id = cs.passenger_id
       WHERE cs.tenant_id = ? AND cs.ride_id = ?
       ORDER BY cs.stop_order ASC`, [tid, rideId]
    );

    const [logs] = await pool.query(
      `SELECT crl.*, u.display_name AS user_name
       FROM carpool_ride_logs crl
       LEFT JOIN users u ON u.id = crl.user_id
       WHERE crl.tenant_id = ? AND crl.ride_id = ?
       ORDER BY crl.created_at ASC`, [tid, rideId]
    );

    res.json({ ride: rides[0], stops: stops, logs: logs });
  }));

  // API: Get user's groups (for dropdowns)
  app.get('/school/carpool/api/my-groups', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    const [groups] = await pool.query(
      `SELECT cg.id, cg.name, cg.area, cm.role
       FROM carpool_groups cg
       JOIN carpool_members cm ON cm.group_id = cg.id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cg.tenant_id = ? AND cg.status = 'active'
       ORDER BY cg.name ASC`,
      [uid, tid, tid]
    );

    res.json({ groups: groups });
  }));

  // API: Dashboard stats summary
  app.get('/school/carpool/api/dashboard-stats', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    const [groups] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM carpool_groups cg
       JOIN carpool_members cm ON cm.group_id = cg.id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cg.tenant_id = ? AND cg.status = 'active'`, [uid, tid, tid]
    );

    const [rides] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM carpool_rides cr
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.ride_date = ? AND cr.status IN ('scheduled','in_progress')`,
      [uid, tid, tid, todayStr()]
    );

    const [msgs] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM carpool_messages cm
       WHERE cm.tenant_id = ? AND cm.group_id IN (
         SELECT cm2.group_id FROM carpool_members cm2 WHERE cm2.user_id = ? AND cm2.tenant_id = ?
       ) AND cm.sender_id != ? AND cm.is_read = 0`,
      [tid, uid, tid, uid]
    );

    res.json({
      activeGroups: (groups[0] && groups[0].cnt) || 0,
      todayRides: (rides[0] && rides[0].cnt) || 0,
      unreadMessages: (msgs[0] && msgs[0].cnt) || 0,
    });
  }));

  // API: Search for matches
  app.get('/school/carpool/api/search-matches', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    var area = req.query.area || '';
    var schoolZone = req.query.school_zone || '';
    var direction = req.query.direction || 'morning';

    var params = [tid, uid, tid];
    var where = 'cg.tenant_id = ? AND cg.status = \'active\' AND cg.id NOT IN ' +
      '(SELECT cm.group_id FROM carpool_members cm WHERE cm.user_id = ? AND cm.tenant_id = ?)';

    if (area) {
      where += ' AND cg.area LIKE ?';
      params.push('%' + area + '%');
    }
    if (schoolZone) {
      where += ' AND cg.school_zone = ?';
      params.push(schoolZone);
    }

    const [matches] = await pool.query(
      `SELECT cg.*,
         (SELECT COUNT(*) FROM carpool_members cm2 WHERE cm2.group_id = cg.id AND cm2.status = 'active') AS member_count
       FROM carpool_groups cg
       WHERE ${where}
       ORDER BY cg.area ASC LIMIT 20`,
      params
    );

    res.json({ matches: matches, query: { area: area, school_zone: schoolZone } });
  }));

  // API: Nearby parents for matching
  app.get('/school/carpool/api/nearby-parents', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    var lat = parseFloat(req.query.lat);
    var lng = parseFloat(req.query.lng);
    var radiusKm = Math.min(50, Math.max(1, parseFloat(req.query.radius) || 10));

    if (isNaN(lat) || isNaN(lng)) {
      return res.json({ parents: [], error: 'lat/lng required' });
    }

    // Haversine in SQL (MySQL 5.7+)
    const [parents] = await pool.query(
      `SELECT pp.*, u.display_name, u.email,
         (6371 * ACOS(COS(RADIANS(?)) * COS(RADIANS(pp.latitude)) *
           COS(RADIANS(pp.longitude) - RADIANS(?)) +
           SIN(RADIANS(?)) * SIN(RADIANS(pp.latitude)))) AS distance_km
       FROM carpool_parent_profiles pp
       JOIN users u ON u.id = pp.user_id
       WHERE pp.tenant_id = ? AND pp.user_id != ? AND pp.latitude IS NOT NULL
       HAVING distance_km <= ?
       ORDER BY distance_km ASC LIMIT 20`,
      [lat, lng, lat, tid, req.session.user.id, radiusKm]
    );

    res.json({ parents: parents, radius_km: radiusKm });
  }));

  // ====================================================================
  //  ROUTE 15 - Batch operations
  // ====================================================================

  // Batch generate rides for all groups
  app.post('/school/carpool/schedule/generate-all', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { week_start } = req.body;

    if (!week_start) {
      flashMsg(req, 'error', 'Week start date is required.');
      return res.redirect('/school/carpool/schedule');
    }

    // Get all schedules for user's groups
    const [schedules] = await pool.query(
      `SELECT cs.*, cg.id AS group_id
       FROM carpool_schedules cs
       JOIN carpool_members cm ON cm.group_id = cs.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       JOIN carpool_groups cg ON cg.id = cs.group_id
       WHERE cs.tenant_id = ?`, [uid, tid, tid]
    );

    // Get drivers per group
    var groupDrivers = {};
    const [drivers] = await pool.query(
      `SELECT cm.group_id, cm.user_id
       FROM carpool_members cm
       JOIN carpool_groups cg ON cg.id = cm.group_id AND cg.tenant_id = ?
       JOIN carpool_members cm2 ON cm2.group_id = cg.id AND cm2.user_id = ? AND cm2.tenant_id = ?
       WHERE cm.tenant_id = ? AND cm.status = 'active' AND cm.role IN ('admin','driver')`,
      [tid, uid, tid, tid]
    );
    drivers.forEach(function (d) {
      if (!groupDrivers[d.group_id]) groupDrivers[d.group_id] = [];
      groupDrivers[d.group_id].push(d.user_id);
    });

    var startDate = new Date(week_start);
    var inserted = 0;

    for (var d = 0; d < 5; d++) {
      var rideDate = new Date(startDate);
      rideDate.setDate(rideDate.getDate() + d);
      var dateStr = rideDate.toISOString().slice(0, 10);

      schedules.forEach(function (sch) {
        if (sch.day_of_week !== d) return;
        var groupDrvs = groupDrivers[sch.group_id] || [uid];
        var driverId = groupDrvs[0] || uid;

        pool.query(
          `INSERT IGNORE INTO carpool_rides
           (tenant_id, group_id, ride_date, direction, departure_time, driver_id, distance_km, status, notes, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,'',?,NOW())`,
          [tid, sch.group_id, dateStr, sch.direction, sch.departure_time, driverId,
           0, RIDE_STATUS_SCHEDULED, uid]
        ).catch(function () {});
        inserted++;
      });
    }

    audit(req, 'carpool_batch_generate', 'Batch generated rides for week of ' + week_start);
    flashMsg(req, 'success', inserted + ' rides generated across all your groups!');
    res.redirect('/school/carpool/schedule');
  }));

  // ====================================================================
  //  ROUTE 16 - Webhook for external notifications
  // ====================================================================
  app.post('/school/carpool/webhook/notify', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { event_type, ride_id, message } = req.body;

    var validEvents = ['ride_reminder', 'ride_started', 'ride_completed', 'delay', 'absence', 'emergency'];
    if (validEvents.indexOf(event_type) === -1) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    await pool.query(
      `INSERT INTO carpool_ride_logs (tenant_id, ride_id, user_id, action, detail, created_at)
       VALUES (?,?,?,?,NOW())`,
      [tid, parseInt(ride_id, 10) || null, uid, 'webhook_' + event_type, message || event_type]
    );

    res.json({ success: true, event: event_type });
  }));

  // ====================================================================
  //  ROUTE 17 - Admin: Tenant-wide carpool stats
  // ====================================================================
  app.get('/school/carpool/admin/stats', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const theme = ecoTheme();

    // Tenant-wide stats
    const [stats] = await pool.query(
      `SELECT
         COUNT(DISTINCT cg.id) AS total_groups,
         (SELECT COUNT(*) FROM carpool_members WHERE tenant_id = ? AND status = 'active') AS total_members,
         COUNT(DISTINCT cr.id) AS total_rides,
         COALESCE(SUM(cr.distance_km),0) AS total_km,
         COALESCE(SUM(cr.distance_km * ?),2) AS co2_saved
       FROM carpool_groups cg
       LEFT JOIN carpool_rides cr ON cr.group_id = cg.id AND cr.status = 'completed'
       WHERE cg.tenant_id = ? AND cg.status = 'active'`,
      [tid, AVG_CO2_PER_KM, tid]
    );

    // Top groups
    const [topGroups] = await pool.query(
      `SELECT cg.name, cg.area,
         COUNT(DISTINCT cr.id) AS ride_count,
         COALESCE(SUM(cr.distance_km),0) AS total_km,
         (SELECT COUNT(*) FROM carpool_members cm2 WHERE cm2.group_id = cg.id AND cm2.status = 'active') AS members
       FROM carpool_groups cg
       LEFT JOIN carpool_rides cr ON cr.group_id = cg.id AND cr.status = 'completed'
       WHERE cg.tenant_id = ? AND cg.status = 'active'
       GROUP BY cg.id ORDER BY ride_count DESC LIMIT 10`,
      [tid]
    );

    res.json({
      stats: stats[0] || {},
      topGroups: topGroups,
    });
  }));

  // ====================================================================
  //  ROUTE 18 - Export data
  // ====================================================================
  app.get('/school/carpool/export/rides', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    var format = req.query.format || 'json';
    var from = req.query.from || todayStr().slice(0, 8) + '01';
    var to = req.query.to || todayStr();

    const [rides] = await pool.query(
      `SELECT cr.ride_date, cr.direction, cr.departure_time, cr.status,
         cr.distance_km, cg.name AS group_name, u.display_name AS driver_name
       FROM carpool_rides cr
       JOIN carpool_groups cg ON cg.id = cr.group_id
       LEFT JOIN users u ON u.id = cr.driver_id
       JOIN carpool_members cm ON cm.group_id = cr.group_id AND cm.user_id = ? AND cm.tenant_id = ?
       WHERE cr.tenant_id = ? AND cr.ride_date BETWEEN ? AND ?
       ORDER BY cr.ride_date ASC, cr.departure_time ASC`,
      [uid, tid, tid, from, to]
    );

    audit(req, 'carpool_export', 'Exported rides data');

    if (format === 'csv') {
      var headers = 'Date,Direction,Departure,Status,Distance(km),Group,Driver\n';
      var rows = rides.map(function (r) {
        return [r.ride_date, r.direction, r.departure_time, r.status, r.distance_km,
          '"' + (r.group_name || '').replace(/"/g, '""') + '"',
          '"' + (r.driver_name || '').replace(/"/g, '""') + '"'
        ].join(',');
      }).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=carpool-rides.csv');
      res.send(headers + rows);
    } else {
      res.json({ from: from, to: to, count: rides.length, rides: rides });
    }
  }));

  // ====================================================================
  //  ROUTE 19 - Parent directory (viewable within groups)
  // ====================================================================
  app.get('/school/carpool/directory', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const theme = ecoTheme();
    var groupId = req.query.group_id;

    var whereClause = 'pp.tenant_id = ? AND pp.user_id != ?';
    var params = [tid, uid];

    if (groupId) {
      whereClause += ' AND pp.user_id IN (SELECT cm.user_id FROM carpool_members cm WHERE cm.group_id = ? AND cm.tenant_id = ? AND cm.status = \'active\')';
      params.push(parseInt(groupId, 10), tid);
    }

    const [parents] = await pool.query(
      `SELECT pp.*, u.display_name, u.email, u.phone, u.avatar_url
       FROM carpool_parent_profiles pp
       JOIN users u ON u.id = pp.user_id
       WHERE ${whereClause}
       ORDER BY pp.area ASC, u.display_name ASC`,
      params
    );

    renderPage(req, res, 'school/carpool/directory', {
      title: 'Parent Directory',
      theme: theme,
      nav: navItems('groups'),
      flash: getFlash(req),
      parents: parents,
      selectedGroup: groupId,
    });
  }));

  // ====================================================================
  //  ROUTE 20 - Invite parent to group
  // ====================================================================
  app.post('/school/carpool/groups/:groupId/invite', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const groupId = parseInt(req.params.groupId, 10);
    const { invitee_email, message } = req.body;

    if (!invitee_email) {
      flashMsg(req, 'error', 'Email address is required.');
      return res.redirect('/school/carpool/groups/' + groupId);
    }

    // Look up user by email
    const [users] = await pool.query(
      `SELECT id, display_name FROM users WHERE email = ? AND tenant_id = ? LIMIT 1`,
      [invitee_email, tid]
    );

    if (!users.length) {
      flashMsg(req, 'error', 'No user found with that email in your school.');
      return res.redirect('/school/carpool/groups/' + groupId);
    }

    // Send invite message
    await pool.query(
      `INSERT INTO carpool_messages (tenant_id, group_id, sender_id, msg_type, content, recipient_id, is_read, created_at)
       VALUES (?,?,?,?,?,?,'0',NOW())`,
      [tid, groupId, req.session.user.id, 'general',
       '🎉 You have been invited to join the carpool group! ' + (message || ''),
       users[0].id]
    );

    audit(req, 'carpool_invite', 'Invited ' + invitee_email + ' to group ' + groupId);
    flashMsg(req, 'success', 'Invitation sent to ' + users[0].display_name + '!');
    res.redirect('/school/carpool/groups/' + groupId);
  }));

  // ====================================================================
  //  ROUTE 21 - Accept/decline invite
  // ====================================================================
  app.post('/school/carpool/invite/:messageId/accept', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const msgId = parseInt(req.params.messageId, 10);

    const [msg] = await pool.query(
      `SELECT * FROM carpool_messages WHERE tenant_id = ? AND id = ? AND recipient_id = ?`,
      [tid, msgId, uid]
    );

    if (!msg.length) {
      flashMsg(req, 'error', 'Invitation not found.');
      return res.redirect('/school/carpool/messages');
    }

    await pool.query(
      `INSERT INTO carpool_members (tenant_id, group_id, user_id, role, status, joined_at)
       VALUES (?,?,?,?,'active',NOW())
       ON DUPLICATE KEY UPDATE status = 'active'`,
      [tid, msg[0].group_id, uid, 'rider']
    );

    await pool.query(
      `UPDATE carpool_messages SET is_read = 1 WHERE tenant_id = ? AND id = ?`, [tid, msgId]
    );

    audit(req, 'carpool_invite_accept', 'Accepted invite to group ' + msg[0].group_id);
    flashMsg(req, 'success', 'You joined the carpool group!');
    res.redirect('/school/carpool/groups/' + msg[0].group_id);
  }));

  app.post('/school/carpool/invite/:messageId/decline', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const msgId = parseInt(req.params.messageId, 10);

    await pool.query(
      `UPDATE carpool_messages SET is_read = 1 WHERE tenant_id = ? AND id = ?`, [tid, msgId]
    );

    flashMsg(req, 'info', 'Invitation declined.');
    res.redirect('/school/carpool/messages');
  }));

  // ====================================================================
  //  ROUTE 22 - Driver rotation helper
  // ====================================================================
  app.post('/school/carpool/schedule/rotate-drivers', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { group_id, week_start } = req.body;

    if (!group_id || !week_start) {
      flashMsg(req, 'error', 'Group and week start date required.');
      return res.redirect('/school/carpool/schedule');
    }

    var groupId = parseInt(group_id, 10);

    // Verify user is admin
    const [mem] = await pool.query(
      `SELECT role FROM carpool_members WHERE tenant_id = ? AND group_id = ? AND user_id = ? AND status = 'active'`,
      [tid, groupId, uid]
    );
    if (!mem.length || mem[0].role !== 'admin') {
      flashMsg(req, 'error', 'Only group admins can rotate drivers.');
      return res.redirect('/school/carpool/schedule');
    }

    // Get drivers
    const [drivers] = await pool.query(
      `SELECT user_id FROM carpool_members
       WHERE tenant_id = ? AND group_id = ? AND status = 'active' AND role IN ('admin','driver')
       ORDER BY joined_at ASC`, [tid, groupId]
    );

    if (drivers.length < 2) {
      flashMsg(req, 'error', 'Need at least 2 drivers to rotate.');
      return res.redirect('/school/carpool/schedule');
    }

    // Get rides for the week
    var startDate = new Date(week_start);
    var endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 4); // Friday
    var endDateStr = endDate.toISOString().slice(0, 10);
    var startDateStr = startDate.toISOString().slice(0, 10);

    const [rides] = await pool.query(
      `SELECT id FROM carpool_rides
       WHERE tenant_id = ? AND group_id = ? AND ride_date BETWEEN ? AND ? AND status = 'scheduled'
       ORDER BY ride_date ASC, departure_time ASC`,
      [tid, groupId, startDateStr, endDateStr]
    );

    // Assign drivers in round-robin
    rides.forEach(function (ride, idx) {
      var driverId = drivers[idx % drivers.length].user_id;
      pool.query(
        'UPDATE carpool_rides SET driver_id = ? WHERE tenant_id = ? AND id = ?',
        [driverId, tid, ride.id]
      ).catch(function () {});
    });

    audit(req, 'carpool_driver_rotate', 'Rotated drivers for group ' + groupId + ' week of ' + week_start);
    flashMsg(req, 'success', 'Drivers rotated for the week! (' + drivers.length + ' drivers, ' + rides.length + ' rides)');
    res.redirect('/school/carpool/schedule');
  }));

  // ====================================================================
  //  ROUTE 23 - Profile avatar helper
  // ====================================================================
  app.get('/school/carpool/api/member-avatar/:userId', requireAuth, ah(async function (req, res) {
    const tid = req.session.user.tenant_id;
    const targetId = parseInt(req.params.userId, 10);

    const [profile] = await pool.query(
      `SELECT pp.car_color, pp.car_make, pp.car_model, u.display_name, u.avatar_url
       FROM carpool_parent_profiles pp
       JOIN users u ON u.id = pp.user_id
       WHERE pp.tenant_id = ? AND pp.user_id = ?`,
      [tid, targetId]
    );

    if (!profile.length) {
      return res.json({ initials: '??', color: '#999', car: null });
    }

    var p = profile[0];
    var initials = (p.display_name || '??').split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);

    res.json({
      initials: initials,
      color: p.car_color || '#2e7d32',
      car: p.car_make && p.car_model ? p.car_color + ' ' + p.car_make + ' ' + p.car_model : null,
      avatar_url: p.avatar_url,
      name: p.display_name,
    });
  }));

  // ====================================================================
  //  HELPER: SQL schema for documentation / migration reference
  // ====================================================================

  /**
   * CREATE TABLE carpool_groups (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   name VARCHAR(200) NOT NULL,
   *   description TEXT,
   *   area VARCHAR(200),
   *   school_zone VARCHAR(100),
   *   max_members INT DEFAULT 6,
   *   morning_departure TIME DEFAULT '07:30:00',
   *   afternoon_departure TIME DEFAULT '15:30:00',
   *   notes TEXT,
   *   status ENUM('active','archived','inactive') DEFAULT 'active',
   *   created_by INT,
   *   created_at DATETIME,
   *   updated_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_area (tenant_id, area),
   *   INDEX idx_status (tenant_id, status)
   * );
   *
   * CREATE TABLE carpool_members (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   group_id INT NOT NULL,
   *   user_id INT NOT NULL,
   *   role ENUM('admin','driver','rider') DEFAULT 'rider',
   *   status ENUM('active','inactive') DEFAULT 'active',
   *   joined_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_group (tenant_id, group_id),
   *   INDEX idx_user (tenant_id, user_id)
   * );
   *
   * CREATE TABLE carpool_schedules (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   group_id INT NOT NULL,
   *   day_of_week TINYINT NOT NULL COMMENT '0=Monday...4=Friday',
   *   direction ENUM('morning','afternoon') DEFAULT 'morning',
   *   departure_time TIME,
   *   recurrence ENUM('weekly','biweekly','once') DEFAULT 'weekly',
   *   created_by INT,
   *   created_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_group (tenant_id, group_id)
   * );
   *
   * CREATE TABLE carpool_rides (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   group_id INT NOT NULL,
   *   ride_date DATE NOT NULL,
   *   direction ENUM('morning','afternoon') DEFAULT 'morning',
   *   departure_time TIME,
   *   driver_id INT,
   *   distance_km DECIMAL(8,1) DEFAULT 0,
   *   status ENUM('scheduled','in_progress','completed','cancelled') DEFAULT 'scheduled',
   *   notes TEXT,
   *   created_by INT,
   *   created_at DATETIME,
   *   completed_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_group_date (tenant_id, group_id, ride_date),
   *   INDEX idx_driver (tenant_id, driver_id),
   *   INDEX idx_status (tenant_id, status, ride_date)
   * );
   *
   * CREATE TABLE carpool_stops (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   ride_id INT NOT NULL,
   *   passenger_id INT,
   *   address VARCHAR(300),
   *   latitude DECIMAL(10,7),
   *   longitude DECIMAL(10,7),
   *   pickup_time TIME,
   *   stop_order INT DEFAULT 0,
   *   created_at DATETIME,
   *   updated_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_ride (tenant_id, ride_id)
   * );
   *
   * CREATE TABLE carpool_emergency_contacts (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   parent_id INT NOT NULL,
   *   name VARCHAR(200),
   *   relationship VARCHAR(100),
   *   phone VARCHAR(50),
   *   alt_phone VARCHAR(50),
   *   email VARCHAR(200),
   *   address TEXT,
   *   medical_notes TEXT,
   *   priority INT DEFAULT 1,
   *   is_primary TINYINT DEFAULT 0,
   *   created_at DATETIME,
   *   updated_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_parent (tenant_id, parent_id)
   * );
   *
   * CREATE TABLE carpool_messages (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   group_id INT NOT NULL,
   *   sender_id INT NOT NULL,
   *   recipient_id INT,
   *   msg_type ENUM('general','delay','absence','emergency','confirmation') DEFAULT 'general',
   *   content TEXT,
   *   is_read TINYINT DEFAULT 0,
   *   created_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_group (tenant_id, group_id),
   *   INDEX idx_recipient (tenant_id, recipient_id, is_read)
   * );
   *
   * CREATE TABLE carpool_ride_logs (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   ride_id INT,
   *   user_id INT,
   *   action VARCHAR(50) COMMENT 'check_in,check_out,absence,delay,late_alert,cancelled,confirmed,rating,fuel_log,webhook_*',
   *   detail TEXT,
   *   rating TINYINT,
   *   fuel_liters DECIMAL(8,2),
   *   fuel_cost DECIMAL(10,2),
   *   created_by INT,
   *   created_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_ride (tenant_id, ride_id),
   *   INDEX idx_user (tenant_id, user_id),
   *   INDEX idx_action (tenant_id, action)
   * );
   *
   * CREATE TABLE carpool_parent_profiles (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   user_id INT NOT NULL UNIQUE,
   *   full_name VARCHAR(200),
   *   phone VARCHAR(50),
   *   alt_phone VARCHAR(50),
   *   address TEXT,
   *   area VARCHAR(200),
   *   school_zone VARCHAR(100),
   *   children_names TEXT,
   *   children_classes TEXT,
   *   car_make VARCHAR(100),
   *   car_model VARCHAR(100),
   *   car_color VARCHAR(50),
   *   car_plate VARCHAR(50),
   *   car_capacity INT DEFAULT 4,
   *   license_number VARCHAR(100),
   *   insurance_provider VARCHAR(200),
   *   insurance_policy VARCHAR(200),
   *   insurance_expiry DATE,
   *   latitude DECIMAL(10,7),
   *   longitude DECIMAL(10,7),
   *   preferred_role ENUM('driver','rider','both') DEFAULT 'rider',
   *   availability_notes TEXT,
   *   created_at DATETIME,
   *   updated_at DATETIME,
   *   INDEX idx_tenant (tenant_id),
   *   INDEX idx_area (tenant_id, area)
   * );
   *
   * CREATE TABLE carpool_settings (
   *   id INT AUTO_INCREMENT PRIMARY KEY,
   *   tenant_id INT NOT NULL,
   *   user_id INT NOT NULL UNIQUE,
   *   notify_ride_reminder TINYINT DEFAULT 1,
   *   notify_delay TINYINT DEFAULT 1,
   *   notify_absence TINYINT DEFAULT 1,
   *   notify_checkin TINYINT DEFAULT 1,
   *   notify_message TINYINT DEFAULT 1,
   *   notify_late_alert TINYINT DEFAULT 1,
   *   notify_weekly_summary TINYINT DEFAULT 0,
   *   reminder_minutes_before INT DEFAULT 15,
   *   late_threshold_minutes INT DEFAULT 10,
   *   default_group_visibility ENUM('school','group','private') DEFAULT 'group',
   *   auto_join_matching TINYINT DEFAULT 0,
   *   created_at DATETIME,
   *   updated_at DATETIME,
   *   INDEX idx_tenant (tenant_id)
   * );
   */

  // ====================================================================
  //  MODULE INIT COMPLETE
  // ====================================================================
  console.log('[carpool-coordination] Module loaded with ' + 23 + ' route handlers under /school/carpool/');
};
