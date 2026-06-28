/**
 * Migration 000002 — Remaining schema (all other tables + ALTERs + indexes + seeds)
 *
 * This is the "lift and shift" migration: every CREATE TABLE / ALTER TABLE /
 * CREATE INDEX / INSERT statement from server.js that is NOT in 000001 is run
 * here, verbatim. This achieves 100% schema parity with the pre-refactor boot-time
 * migrations that used to run via db.migrateQuery().
 *
 * Statement count by type:
 *   ALTER TABLE: 351
 *   CREATE INDEX: 152
 *   CREATE TABLE: 337
 *   CREATE UNIQUE: 2
 *   INSERT INTO: 233
 *
 * IMPORTANT: This file is ~1075 pgm.sql() calls. It is verbose by design —
 * the goal is parity, not beauty. A future task should refactor this into multiple
 * feature-grouped migration files using the pgm.createTable() JS API. See worklog.
 */
module.exports = {
  up: (pgm) => {
    // server.js line 1895
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_tenant_student ON attendance(tenant_id, student_id)`);
    // server.js line 1896
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_fees_tenant_student ON fees(tenant_id, student_id)`);
    // server.js line 1897
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_exam_student ON marks(exam_id, student_id)`);
    // server.js line 1898
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_tenant ON marks(tenant_id)`);
    // server.js line 1899
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_students_tenant_class ON students(tenant_id, class)`);
    // server.js line 1900
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payments_tenant_status ON payments(tenant_id, status)`);
    // server.js line 1901
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference)`);
    // server.js line 1902
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_email)`);
    // server.js line 1903
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)`);
    // server.js line 1904
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id)`);
    // server.js line 1905
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_church_attendance_tenant_member ON church_attendance(tenant_id, member_id)`);
    // server.js line 1906
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id)`);
    // server.js line 1907
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_email)`);
    // server.js line 1910
    pgm.sql(`INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`);
    // server.js line 1925
    pgm.sql(`ALTER TABLE org_finance ADD COLUMN IF NOT EXISTS category VARCHAR(255)`);
    // server.js line 1926
    pgm.sql(`CREATE TABLE IF NOT EXISTS resolution_votes (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, resolution_id INT NOT NULL, voter_email TEXT NOT NULL, direction TEXT NOT NULL, voted_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(resolution_id, voter_email))`);
    // server.js line 1927
    pgm.sql(`CREATE TABLE IF NOT EXISTS committees (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255) NOT NULL, description TEXT, chairperson VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1928
    pgm.sql(`CREATE TABLE IF NOT EXISTS committee_members (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, committee_id INT NOT NULL, member_id INT NOT NULL, role VARCHAR(100) DEFAULT 'member', joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(committee_id, member_id))`);
    // server.js line 1929
    pgm.sql(`CREATE TABLE IF NOT EXISTS finance_categories (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255) NOT NULL, type VARCHAR(20) NOT NULL, budget_amount NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1930
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_rsvps (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, event_id INT NOT NULL, member_id INT, name VARCHAR(255) NOT NULL, response VARCHAR(20) DEFAULT 'yes', responded_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1932
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_tasks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, assigned_to INTEGER REFERENCES members(id) ON DELETE SET NULL, assigned_by TEXT, priority VARCHAR(20) DEFAULT 'medium', status VARCHAR(20) DEFAULT 'pending', due_date DATE, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1933
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_task_comments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, task_id INTEGER REFERENCES org_tasks(id) ON DELETE CASCADE, comment TEXT NOT NULL, commented_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1935
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_notifications (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, message TEXT, link TEXT, is_read BOOLEAN DEFAULT false, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1937
    pgm.sql(`ALTER TABLE committees ADD COLUMN IF NOT EXISTS meeting_day VARCHAR(20)`);
    // server.js line 1938
    pgm.sql(`ALTER TABLE committees ADD COLUMN IF NOT EXISTS meeting_time VARCHAR(10)`);
    // server.js line 1940
    pgm.sql(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false`);
    // server.js line 1941
    pgm.sql(`ALTER TABLE events ADD COLUMN IF NOT EXISTS recurring_pattern VARCHAR(20)`);
    // server.js line 1942
    pgm.sql(`ALTER TABLE events ADD COLUMN IF NOT EXISTS recurring_end_date DATE`);
    // server.js line 1944
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_attachments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, entity_type VARCHAR(50) NOT NULL, entity_id INTEGER NOT NULL, file_name TEXT NOT NULL, file_url TEXT NOT NULL, file_type VARCHAR(100), file_size INTEGER DEFAULT 0, uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1946
    pgm.sql(`CREATE TABLE IF NOT EXISTS meeting_action_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, meeting_id INTEGER REFERENCES meeting_minutes(id) ON DELETE CASCADE, description TEXT NOT NULL, assigned_to INTEGER REFERENCES members(id) ON DELETE SET NULL, due_date DATE, status VARCHAR(20) DEFAULT 'pending', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1948
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_health_scores (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, score INTEGER DEFAULT 0, member_health INTEGER DEFAULT 0, finance_health INTEGER DEFAULT 0, task_health INTEGER DEFAULT 0, event_health INTEGER DEFAULT 0, computed_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id))`);
    // server.js line 1950
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_meeting_minutes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, meeting_date DATE NOT NULL, meeting_type VARCHAR(20) DEFAULT 'General', venue TEXT DEFAULT '', agenda TEXT DEFAULT '', content TEXT NOT NULL, decisions TEXT DEFAULT '', action_items TEXT DEFAULT '', attendee_count INTEGER DEFAULT 0, recorded_by INTEGER REFERENCES members(id) ON DELETE SET NULL, next_meeting_date DATE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1952
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT DEFAULT '', survey_type VARCHAR(20) DEFAULT 'survey', is_anonymous BOOLEAN DEFAULT false, questions JSONB DEFAULT '[]', is_active BOOLEAN DEFAULT true, closes_at TIMESTAMPTZ, max_responses INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1953
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_survey_responses (id SERIAL PRIMARY KEY, survey_id INTEGER REFERENCES org_surveys(id) ON DELETE CASCADE, respondent_email TEXT NOT NULL, answers JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1955
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_discussions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category VARCHAR(30) DEFAULT 'General', content TEXT NOT NULL, author_email TEXT NOT NULL, is_pinned BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1956
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_discussion_replies (id SERIAL PRIMARY KEY, discussion_id INTEGER REFERENCES org_discussions(id) ON DELETE CASCADE, content TEXT NOT NULL, author_email TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1958
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_email_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, template_type VARCHAR(30) DEFAULT 'custom', subject TEXT DEFAULT '', body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1960
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_broadcasts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, subject TEXT NOT NULL, message TEXT NOT NULL, channel VARCHAR(20) DEFAULT 'notification', priority VARCHAR(10) DEFAULT 'normal', target VARCHAR(20) DEFAULT 'all', recipient_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1962
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_data_backups (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, description TEXT DEFAULT '', record_count INTEGER DEFAULT 0, file_size INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 1964
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS can_manage_finance BOOLEAN DEFAULT false`);
    // server.js line 1965
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS can_manage_members BOOLEAN DEFAULT false`);
    // server.js line 1966
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS can_manage_events BOOLEAN DEFAULT false`);
    // server.js line 1967
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false`);
    // server.js line 1970
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT`);
    // server.js line 1971
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT`);
    // server.js line 1972
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain TEXT`);
    // server.js line 1977
    pgm.sql(`ALTER TABLE tenants ALTER COLUMN subdomain SET NOT NULL`);
    // server.js line 1978
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false`);
    // server.js line 1979
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false`);
    // server.js line 1980
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
    // server.js line 1981
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
    // server.js line 1982
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS has_fundraising BOOLEAN DEFAULT false`);
    // server.js line 1983
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wallet_balance INTEGER DEFAULT 0`);
    // server.js line 1984
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 1985
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT`);
    // server.js line 1986
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT`);
    // server.js line 1987
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    // server.js line 1988
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`);
    // server.js line 1989
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`);
    // server.js line 1990
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS health_institution_type TEXT DEFAULT NULL`);
    // server.js line 1991
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT NULL`);
    // server.js line 1993
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 1994
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
    // server.js line 1995
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
    // server.js line 1996
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    // server.js line 1997
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`);
    // server.js line 1998
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false`);
    // server.js line 1999
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
    // server.js line 2000
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
    // server.js line 2001
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT false`);
    // server.js line 2002
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    // server.js line 2007
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_no TEXT`);
    // server.js line 2008
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS class TEXT`);
    // server.js line 2009
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS stream TEXT`);
    // server.js line 2010
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_name TEXT`);
    // server.js line 2011
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_phone TEXT`);
    // server.js line 2012
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    // server.js line 2013
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    // server.js line 2014
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email TEXT`);
    // server.js line 2016
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS paid INTEGER DEFAULT 0`);
    // server.js line 2017
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS term TEXT`);
    // server.js line 2018
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS year INTEGER`);
    // server.js line 2019
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    // server.js line 2021
    pgm.sql(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 2023
    pgm.sql(`ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 2024
    pgm.sql(`ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT`);
    // server.js line 2026
    pgm.sql(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subdomain_key`);
    // server.js line 2028
    pgm.sql(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key`);
    // server.js line 2031
    pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_key ON tenants(subdomain)`);
    // server.js line 2032
    pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email)`);
    // server.js line 2034
    pgm.sql(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_fkey`);
    // server.js line 2035
    pgm.sql(`ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`);
    // server.js line 2037
    pgm.sql(`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, key_hash TEXT UNIQUE, name TEXT, scopes TEXT[], last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2038
    pgm.sql(`CREATE TABLE IF NOT EXISTS webhook_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event TEXT, payload JSONB, status INTEGER, response TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2039
    pgm.sql(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT false)`);
    // server.js line 2043
    pgm.sql(`CREATE TABLE IF NOT EXISTS staff (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, email TEXT UNIQUE NOT NULL, password TEXT, password_hash TEXT, name TEXT NOT NULL, role TEXT DEFAULT 'teacher', approved BOOLEAN DEFAULT true, banned BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 2045
    pgm.sql(`CREATE TABLE IF NOT EXISTS timetable (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, class TEXT NOT NULL, day TEXT NOT NULL, period INTEGER NOT NULL, subject TEXT NOT NULL, teacher TEXT, start_time TEXT, end_time TEXT)`);
    // server.js line 2047
    pgm.sql(`CREATE TABLE IF NOT EXISTS grading_scales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, min_score INTEGER NOT NULL, max_score INTEGER NOT NULL, grade TEXT NOT NULL, comment TEXT)`);
    // server.js line 2049
    pgm.sql(`CREATE TABLE IF NOT EXISTS fee_structures (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, class TEXT NOT NULL, term TEXT NOT NULL, amount INTEGER NOT NULL, year INTEGER)`);
    // server.js line 2051
    pgm.sql(`CREATE TABLE IF NOT EXISTS church_members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, role TEXT, joined_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 2053
    pgm.sql(`CREATE TABLE IF NOT EXISTS donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT, method TEXT, reference TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 2055
    pgm.sql(`CREATE TABLE IF NOT EXISTS parent_links (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, parent_email TEXT NOT NULL, parent_phone TEXT, UNIQUE(student_id, parent_email))`);
    // server.js line 2057
    pgm.sql(`CREATE TABLE IF NOT EXISTS sign_in_out (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, staff_id INTEGER REFERENCES staff(id), name TEXT NOT NULL, role TEXT, clock_in TIMESTAMPTZ, clock_out TIMESTAMPTZ, date DATE DEFAULT CURRENT_DATE, notes TEXT)`);
    // server.js line 2058
    pgm.sql(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, title TEXT NOT NULL, message TEXT, type TEXT DEFAULT 'info', read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2059
    pgm.sql(`CREATE TABLE IF NOT EXISTS fee_receipts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, fee_id INTEGER REFERENCES fees(id), receipt_no TEXT UNIQUE, student_id INTEGER REFERENCES students(id), amount INTEGER NOT NULL, paid INTEGER NOT NULL, method TEXT, received_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2061
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone TEXT`);
    // server.js line 2062
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS subject TEXT`);
    // server.js line 2064
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS gender TEXT`);
    // server.js line 2066
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS payment_method TEXT`);
    // server.js line 2067
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS receipt_no TEXT`);
    // server.js line 2069
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
    // server.js line 2070
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
    // server.js line 2073
    pgm.sql(`ALTER TABLE sermons ADD COLUMN IF NOT EXISTS date DATE DEFAULT CURRENT_DATE`);
    // server.js line 2074
    pgm.sql(`ALTER TABLE sermons ADD COLUMN IF NOT EXISTS series TEXT`);
    // server.js line 2075
    pgm.sql(`ALTER TABLE sermons ADD COLUMN IF NOT EXISTS audio_url TEXT`);
    // server.js line 2076
    pgm.sql(`ALTER TABLE sermons ADD COLUMN IF NOT EXISTS video_url TEXT`);
    // server.js line 2078
    pgm.sql(`ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS title TEXT`);
    // server.js line 2079
    pgm.sql(`ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 2080
    pgm.sql(`ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS requested_by TEXT`);
    // server.js line 2081
    pgm.sql(`ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false`);
    // server.js line 2082
    pgm.sql(`ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS is_answered BOOLEAN DEFAULT false`);
    // server.js line 2083
    pgm.sql(`ALTER TABLE prayer_requests ADD COLUMN IF NOT EXISTS prayer_count INTEGER DEFAULT 0`);
    // server.js line 2085
    pgm.sql(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE`);
    // server.js line 2086
    pgm.sql(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE`);
    // server.js line 2087
    pgm.sql(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS manager TEXT`);
    // server.js line 2089
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS attendee_name TEXT`);
    // server.js line 2090
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS attendee_email TEXT`);
    // server.js line 2091
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS attendee_phone TEXT`);
    // server.js line 2092
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS ticket_code TEXT UNIQUE`);
    // server.js line 2093
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
    // server.js line 2094
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT false`);
    // server.js line 2095
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ`);
    // server.js line 2096
    pgm.sql(`ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 2098
    pgm.sql(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2099
    pgm.sql(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT`);
    // server.js line 2100
    pgm.sql(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2101
    pgm.sql(`ALTER TABLE login_history ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2102
    pgm.sql(`ALTER TABLE student_portal_sessions ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2103
    pgm.sql(`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2104
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2105
    pgm.sql(`ALTER TABLE gallery_photos ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2106
    pgm.sql(`ALTER TABLE public_posts ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2107
    pgm.sql(`ALTER TABLE clinic_prescription_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2108
    pgm.sql(`ALTER TABLE retail_sale_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2110
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_secret TEXT`);
    // server.js line 2111
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`);
    // server.js line 2112
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT false`);
    // server.js line 2114
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
    // server.js line 2115
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT true`);
    // server.js line 2117
    pgm.sql(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_date DATE DEFAULT CURRENT_DATE`);
    // server.js line 2119
    pgm.sql(`ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS staff_id INTEGER`);
    // server.js line 2120
    pgm.sql(`ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS teacher_name TEXT`);
    // server.js line 2121
    pgm.sql(`ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS slot_date DATE`);
    // server.js line 2122
    pgm.sql(`ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 15`);
    // server.js line 2123
    pgm.sql(`ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS notes TEXT`);
    // server.js line 2124
    pgm.sql(`ALTER TABLE ptc_slots ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'`);
    // server.js line 2125
    pgm.sql(`ALTER TABLE ptc_bookings ADD COLUMN IF NOT EXISTS slot_id INTEGER`);
    // server.js line 2126
    pgm.sql(`ALTER TABLE ptc_bookings ADD COLUMN IF NOT EXISTS parent_name TEXT`);
    // server.js line 2127
    pgm.sql(`ALTER TABLE ptc_bookings ADD COLUMN IF NOT EXISTS parent_phone TEXT`);
    // server.js line 2128
    pgm.sql(`ALTER TABLE ptc_bookings ADD COLUMN IF NOT EXISTS concerns TEXT`);
    // server.js line 2130
    pgm.sql(`ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS staff_id INTEGER`);
    // server.js line 2131
    pgm.sql(`ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS lesson_date DATE`);
    // server.js line 2132
    pgm.sql(`ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'`);
    // server.js line 2134
    pgm.sql(`ALTER TABLE sibling_discounts ADD COLUMN IF NOT EXISTS student_id INTEGER`);
    // server.js line 2135
    pgm.sql(`ALTER TABLE sibling_discounts ADD COLUMN IF NOT EXISTS sibling_count INTEGER`);
    // server.js line 2136
    pgm.sql(`ALTER TABLE sibling_discounts ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'fee'`);
    // server.js line 2139
    pgm.sql(`CREATE TABLE IF NOT EXISTS subscriptions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, plan TEXT DEFAULT 'free', amount INTEGER DEFAULT 0, currency TEXT DEFAULT 'UGX', status TEXT DEFAULT 'active', started_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ, payment_method TEXT, reference TEXT)`);
    // server.js line 2140
    pgm.sql(`CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, amount INTEGER NOT NULL, method TEXT, reference TEXT, status TEXT DEFAULT 'pending', description TEXT, plan TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2141
    pgm.sql(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan TEXT`);
    // server.js line 2143
    pgm.sql(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT false`);
    // server.js line 2144
    pgm.sql(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_attempts INTEGER DEFAULT 0`);
    // server.js line 2145
    pgm.sql(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_renewal_attempt TIMESTAMPTZ`);
    // server.js line 2147
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id)`);
    // server.js line 2148
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_no ON invoices(invoice_no)`);
    // server.js line 2149
    pgm.sql(`CREATE TABLE IF NOT EXISTS renewal_logs (id SERIAL PRIMARY KEY, subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, attempt INTEGER DEFAULT 1, status TEXT DEFAULT 'pending', payment_method TEXT, error_message TEXT, next_retry_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2150
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_renewal_logs_sub ON renewal_logs(subscription_id)`);
    // server.js line 2151
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_renewal_logs_tenant ON renewal_logs(tenant_id)`);
    // server.js line 2153
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
    // server.js line 2154
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approved_by INTEGER`);
    // server.js line 2155
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
    // server.js line 2157
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_from_name TEXT`);
    // server.js line 2158
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_reply_to TEXT`);
    // server.js line 2159
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dashboard_layout JSONB DEFAULT '[]'::jsonb`);
    // server.js line 2160
    pgm.sql(`CREATE TABLE IF NOT EXISTS approval_workflows (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, entity_type TEXT NOT NULL DEFAULT 'general', steps JSONB NOT NULL DEFAULT '[]'::jsonb, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2161
    pgm.sql(`CREATE TABLE IF NOT EXISTS approval_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, workflow_id INTEGER REFERENCES approval_workflows(id) ON DELETE SET NULL, entity_type TEXT NOT NULL, entity_id INTEGER, entity_title TEXT, requester_email TEXT, current_step INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', steps_data JSONB DEFAULT '[]'::jsonb, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2162
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id)`);
    // server.js line 2163
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)`);
    // server.js line 2164
    pgm.sql(`CREATE TABLE IF NOT EXISTS settings_audit_log (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, setting_key TEXT NOT NULL, old_value TEXT, new_value TEXT, changed_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2165
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_settings_audit_tenant ON settings_audit_log(tenant_id)`);
    // server.js line 2166
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_settings_audit_key ON settings_audit_log(setting_key)`);
    // server.js line 2168
    pgm.sql(`CREATE TABLE IF NOT EXISTS webhooks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, url TEXT NOT NULL, events TEXT[], secret TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2170
    pgm.sql(`CREATE TABLE IF NOT EXISTS church_attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id), service_name TEXT, date DATE DEFAULT CURRENT_DATE, present BOOLEAN DEFAULT true, UNIQUE(tenant_id, member_id, service_name, date))`);
    // server.js line 2172
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_id INTEGER`);
    // server.js line 2173
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_tithe BOOLEAN DEFAULT false`);
    // server.js line 2175
    pgm.sql(`ALTER TABLE church_members ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
    // server.js line 2176
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
    // server.js line 2177
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
    // server.js line 2179
    pgm.sql(`ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)`);
    // server.js line 2180
    pgm.sql(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)`);
    // server.js line 2182
    pgm.sql(`CREATE TABLE IF NOT EXISTS purchase_orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, po_no TEXT, supplier TEXT, items JSONB, total INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2184
    pgm.sql(`CREATE TABLE IF NOT EXISTS tax_records (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, period TEXT NOT NULL, taxable_amount INTEGER DEFAULT 0, tax_rate INTEGER DEFAULT 18, tax_amount INTEGER DEFAULT 0, tax_type TEXT DEFAULT 'VAT', filed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2186
    pgm.sql(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode TEXT`);
    // server.js line 2187
    pgm.sql(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS qr_code TEXT`);
    // server.js line 2188
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS barcode TEXT`);
    // server.js line 2190
    pgm.sql(`CREATE TABLE IF NOT EXISTS bill_reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, amount INTEGER DEFAULT 0, due_date DATE, category TEXT, recurring TEXT, notes TEXT, paid BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2192
    pgm.sql(`CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, file_url TEXT, file_type TEXT, category TEXT, uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2197
    pgm.sql(`CREATE TABLE IF NOT EXISTS income_records (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, source TEXT NOT NULL, amount INTEGER NOT NULL, category TEXT, description TEXT, received_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2199
    pgm.sql(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, raised INTEGER DEFAULT 0, start_date DATE, end_date DATE, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2200
    pgm.sql(`CREATE TABLE IF NOT EXISTS campaign_pledges (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT, amount INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, pledged_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2202
    pgm.sql(`CREATE TABLE IF NOT EXISTS role_permissions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, role_name TEXT NOT NULL, permissions JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, role_name))`);
    // server.js line 2204
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color TEXT`);
    // server.js line 2205
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS secondary_color TEXT`);
    // server.js line 2206
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS accent_color TEXT`);
    // server.js line 2207
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS font_family TEXT`);
    // server.js line 2209
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en'`);
    // server.js line 2210
    pgm.sql(`CREATE TABLE IF NOT EXISTS translations (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(lang, key))`);
    // server.js line 2212
    pgm.sql(`CREATE TABLE IF NOT EXISTS platform_status (id SERIAL PRIMARY KEY, service TEXT NOT NULL UNIQUE, status TEXT DEFAULT 'operational', message TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2213
    pgm.sql(`INSERT INTO platform_status (service, status) VALUES ('api', 'operational'), ('database', 'operational'), ('email', 'operational'), ('sms', 'operational') ON CONFLICT (service) DO NOTHING`);
    // server.js line 2218
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT[]`);
    // server.js line 2219
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER`);
    // server.js line 2220
    pgm.sql(`CREATE TABLE IF NOT EXISTS trusted_devices (id SERIAL PRIMARY KEY, user_id INTEGER, device_hash TEXT, name TEXT, last_used TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2221
    pgm.sql(`CREATE TABLE IF NOT EXISTS email_queue (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, to_email TEXT NOT NULL, subject TEXT, body TEXT, html BOOLEAN DEFAULT false, status TEXT DEFAULT 'queued', attempts INTEGER DEFAULT 0, sent_at TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2222
    pgm.sql(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS html BOOLEAN DEFAULT false`);
    // server.js line 2223
    pgm.sql(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`);
    // server.js line 2224
    pgm.sql(`CREATE TABLE IF NOT EXISTS sms_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, phone TEXT NOT NULL, message TEXT, status TEXT DEFAULT 'queued', sent_at TIMESTAMPTZ, error TEXT, trigger_type TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2227
    pgm.sql(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_url TEXT`);
    // server.js line 2228
    pgm.sql(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS image_url TEXT`);
    // server.js line 2229
    pgm.sql(`CREATE TABLE IF NOT EXISTS campaign_updates (id SERIAL PRIMARY KEY, campaign_id INTEGER, title TEXT NOT NULL, content TEXT, update_type TEXT DEFAULT 'general', is_public BOOLEAN DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2230
    pgm.sql(`CREATE TABLE IF NOT EXISTS volunteer_hours (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES members(id), hours NUMERIC DEFAULT 0, activity TEXT, date DATE DEFAULT CURRENT_DATE, approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2231
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_tickets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES events(id) ON DELETE CASCADE, ticket_type TEXT DEFAULT 'general', price INTEGER DEFAULT 0, quantity_sold INTEGER DEFAULT 0, quantity_total INTEGER DEFAULT 100)`);
    // server.js line 2232
    pgm.sql(`CREATE TABLE IF NOT EXISTS ticket_sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES events(id), ticket_type TEXT, buyer_name TEXT, buyer_phone TEXT, buyer_email TEXT, amount INTEGER, payment_method TEXT, payment_ref TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2233
    pgm.sql(`CREATE TABLE IF NOT EXISTS chart_of_accounts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, parent_id INTEGER, balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, code))`);
    // server.js line 2234
    pgm.sql(`CREATE TABLE IF NOT EXISTS ledger_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, account_id INTEGER REFERENCES chart_of_accounts(id), debit INTEGER DEFAULT 0, credit INTEGER DEFAULT 0, description TEXT, reference TEXT, entry_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2237
    pgm.sql(`CREATE TABLE IF NOT EXISTS document_folders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, parent_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2238
    pgm.sql(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id INTEGER`);
    // server.js line 2239
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS tax_deductible BOOLEAN DEFAULT false`);
    // server.js line 2240
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_sent BOOLEAN DEFAULT false`);
    // server.js line 2243
    pgm.sql(`CREATE TABLE IF NOT EXISTS suppliers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2244
    pgm.sql(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)`);
    // server.js line 2245
    pgm.sql(`CREATE TABLE IF NOT EXISTS branches (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, location TEXT, manager TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2246
    pgm.sql(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id)`);
    // server.js line 2247
    pgm.sql(`CREATE TABLE IF NOT EXISTS inventory_transfers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, inventory_id INTEGER REFERENCES inventory(id), from_branch INTEGER REFERENCES branches(id), to_branch INTEGER REFERENCES branches(id), quantity INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2248
    pgm.sql(`CREATE TABLE IF NOT EXISTS loyalty_points (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, customer_id INTEGER REFERENCES customers(id), points INTEGER DEFAULT 0, earned_from TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2249
    pgm.sql(`CREATE TABLE IF NOT EXISTS sms_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, message TEXT, target_group TEXT, status TEXT DEFAULT 'draft', sent_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2250
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS white_label BOOLEAN DEFAULT false`);
    // server.js line 2251
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`);
    // server.js line 2254
    pgm.sql(`CREATE TABLE IF NOT EXISTS investments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT, amount INTEGER DEFAULT 0, current_value INTEGER DEFAULT 0, start_date DATE, maturity_date DATE, interest_rate NUMERIC DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2255
    pgm.sql(`CREATE TABLE IF NOT EXISTS debt_payoff (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, total_owed INTEGER DEFAULT 0, interest_rate NUMERIC DEFAULT 0, min_payment INTEGER DEFAULT 0, monthly_payment INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2256
    pgm.sql(`CREATE TABLE IF NOT EXISTS momo_payments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, phone TEXT NOT NULL, amount INTEGER NOT NULL, reference TEXT, status TEXT DEFAULT 'pending', type TEXT DEFAULT 'mtn', external_ref TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(reference))`);
    // server.js line 2257
    pgm.sql(`ALTER TABLE bill_reminders ADD COLUMN IF NOT EXISTS last_notified TIMESTAMPTZ`);
    // server.js line 2258
    pgm.sql(`ALTER TABLE bill_reminders ADD COLUMN IF NOT EXISTS auto_notify BOOLEAN DEFAULT false`);
    // server.js line 2261
    pgm.sql(`CREATE TABLE IF NOT EXISTS automation_rules (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, trigger_event TEXT NOT NULL, condition TEXT, action TEXT NOT NULL, action_params JSONB, active BOOLEAN DEFAULT true, last_fired TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2262
    pgm.sql(`CREATE TABLE IF NOT EXISTS integration_configs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service TEXT NOT NULL, config JSONB, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2263
    pgm.sql(`CREATE TABLE IF NOT EXISTS calendar_events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, source TEXT, external_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2264
    pgm.sql(`CREATE TABLE IF NOT EXISTS oauth_clients (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, client_id TEXT UNIQUE, client_secret TEXT, name TEXT, redirect_uris TEXT[], created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2267
    pgm.sql(`CREATE TABLE IF NOT EXISTS ai_insights (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, type TEXT NOT NULL, insight TEXT, confidence NUMERIC DEFAULT 0, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2268
    pgm.sql(`CREATE TABLE IF NOT EXISTS report_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, config JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2269
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS dropout_risk TEXT`);
    // server.js line 2270
    pgm.sql(`ALTER TABLE fees ADD COLUMN IF NOT EXISTS default_risk TEXT`);
    // server.js line 2273
    pgm.sql(`CREATE TABLE IF NOT EXISTS marketplace_plugins (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT, price INTEGER DEFAULT 0, author TEXT, icon_url TEXT, config JSONB, active BOOLEAN DEFAULT true, downloads INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2274
    pgm.sql(`CREATE TABLE IF NOT EXISTS tenant_plugins (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, plugin_id INTEGER REFERENCES marketplace_plugins(id), status TEXT DEFAULT 'active', installed_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, plugin_id))`);
    // server.js line 2275
    pgm.sql(`CREATE TABLE IF NOT EXISTS ad_impressions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, ad_type TEXT, impressions INTEGER DEFAULT 0, revenue INTEGER DEFAULT 0, date DATE DEFAULT CURRENT_DATE)`);
    // server.js line 2276
    pgm.sql(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false`);
    // server.js line 2277
    pgm.sql(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS peer_to_peer BOOLEAN DEFAULT false`);
    // server.js line 2278
    pgm.sql(`CREATE TABLE IF NOT EXISTS peer_fundraisers (id SERIAL PRIMARY KEY, campaign_id INTEGER, name TEXT NOT NULL, email TEXT, phone TEXT, goal INTEGER DEFAULT 0, raised INTEGER DEFAULT 0, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2281
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`);
    // server.js line 2282
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'UG'`);
    // server.js line 2283
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id TEXT`);
    // server.js line 2284
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registration_no TEXT`);
    // server.js line 2285
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en'`);
    // server.js line 2286
    pgm.sql(`CREATE TABLE IF NOT EXISTS government_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, report_type TEXT, period TEXT, data JSONB, submitted BOOLEAN DEFAULT false, submitted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2287
    pgm.sql(`CREATE TABLE IF NOT EXISTS biometric_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_type TEXT, user_id INTEGER, biometric_type TEXT, verified BOOLEAN DEFAULT false, device_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2288
    pgm.sql(`CREATE TABLE IF NOT EXISTS compliance_audits (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, audit_type TEXT, status TEXT DEFAULT 'pending', findings JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2290
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'welcome', 'Mukwano') ON CONFLICT DO NOTHING`);
    // server.js line 2291
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'dashboard', 'Olutimbe') ON CONFLICT DO NOTHING`);
    // server.js line 2292
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'students', 'Abayizi') ON CONFLICT DO NOTHING`);
    // server.js line 2293
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'fees', 'Ebisasulo') ON CONFLICT DO NOTHING`);
    // server.js line 2294
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'attendance', 'Okujja') ON CONFLICT DO NOTHING`);
    // server.js line 2295
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'reports', 'Ebirowoozo') ON CONFLICT DO NOTHING`);
    // server.js line 2296
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'login', 'Yingira') ON CONFLICT DO NOTHING`);
    // server.js line 2297
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'register', 'Wandikira') ON CONFLICT DO NOTHING`);
    // server.js line 2298
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'logout', 'Woloka') ON CONFLICT DO NOTHING`);
    // server.js line 2299
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'notifications', 'Ebyogerwa') ON CONFLICT DO NOTHING`);
    // server.js line 2300
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'settings', 'Enteekateeka') ON CONFLICT DO NOTHING`);
    // server.js line 2301
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'profile', 'Omutindo') ON CONFLICT DO NOTHING`);
    // server.js line 2302
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'search', 'Noonya') ON CONFLICT DO NOTHING`);
    // server.js line 2303
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'save', 'Tereka') ON CONFLICT DO NOTHING`);
    // server.js line 2304
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'cancel', 'Sazaamu') ON CONFLICT DO NOTHING`);
    // server.js line 2305
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'delete', 'Sangula') ON CONFLICT DO NOTHING`);
    // server.js line 2306
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'edit', 'Kyusa') ON CONFLICT DO NOTHING`);
    // server.js line 2307
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'add', 'Yongera') ON CONFLICT DO NOTHING`);
    // server.js line 2308
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'members', 'Abamemba') ON CONFLICT DO NOTHING`);
    // server.js line 2309
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'inventory', 'Ebiryo') ON CONFLICT DO NOTHING`);
    // server.js line 2310
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'invoices', 'Empapula') ON CONFLICT DO NOTHING`);
    // server.js line 2311
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'payments', 'Ensasula') ON CONFLICT DO NOTHING`);
    // server.js line 2312
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'donations', 'Ebirabo') ON CONFLICT DO NOTHING`);
    // server.js line 2313
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'events', 'Ebikwatako') ON CONFLICT DO NOTHING`);
    // server.js line 2314
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'classes', 'Obuyigirize') ON CONFLICT DO NOTHING`);
    // server.js line 2315
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'exams', 'Ebiwandiiko') ON CONFLICT DO NOTHING`);
    // server.js line 2316
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'marks', 'Obudde') ON CONFLICT DO NOTHING`);
    // server.js line 2317
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'total', 'Ensengeka') ON CONFLICT DO NOTHING`);
    // server.js line 2318
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'name', 'Erinnya') ON CONFLICT DO NOTHING`);
    // server.js line 2319
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'email', 'Imeeli') ON CONFLICT DO NOTHING`);
    // server.js line 2320
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'phone', 'Namba ya simu') ON CONFLICT DO NOTHING`);
    // server.js line 2321
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'password', 'Kasita y''okusinga') ON CONFLICT DO NOTHING`);
    // server.js line 2322
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'amount', 'Omundu') ON CONFLICT DO NOTHING`);
    // server.js line 2323
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'date', 'Olunaku') ON CONFLICT DO NOTHING`);
    // server.js line 2324
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'description', 'Ekiwandiiko') ON CONFLICT DO NOTHING`);
    // server.js line 2325
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'status', 'Embeera') ON CONFLICT DO NOTHING`);
    // server.js line 2326
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'actions', 'Eby''okukola') ON CONFLICT DO NOTHING`);
    // server.js line 2327
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'no_data', 'Tewali data') ON CONFLICT DO NOTHING`);
    // server.js line 2328
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'success', 'Kyetuuse') ON CONFLICT DO NOTHING`);
    // server.js line 2329
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'error', 'Kiremya') ON CONFLICT DO NOTHING`);
    // server.js line 2330
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'loading', 'Kutegereza') ON CONFLICT DO NOTHING`);
    // server.js line 2331
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'help', 'Obuyambi') ON CONFLICT DO NOTHING`);
    // server.js line 2332
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'billing', 'Okusasula') ON CONFLICT DO NOTHING`);
    // server.js line 2333
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('lg', 'upgrade', 'Simulisa') ON CONFLICT DO NOTHING`);
    // server.js line 2334
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('sw', 'welcome', 'Karibu') ON CONFLICT DO NOTHING`);
    // server.js line 2335
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('sw', 'dashboard', 'Dashibodi') ON CONFLICT DO NOTHING`);
    // server.js line 2336
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('sw', 'students', 'Wanafunzi') ON CONFLICT DO NOTHING`);
    // server.js line 2337
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('sw', 'fees', 'Ada') ON CONFLICT DO NOTHING`);
    // server.js line 2338
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('sw', 'attendance', 'Mahudhuri') ON CONFLICT DO NOTHING`);
    // server.js line 2339
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('sw', 'reports', 'Ripoti') ON CONFLICT DO NOTHING`);
    // server.js line 2340
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('fr', 'welcome', 'Bienvenue') ON CONFLICT DO NOTHING`);
    // server.js line 2341
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('fr', 'dashboard', 'Tableau de bord') ON CONFLICT DO NOTHING`);
    // server.js line 2342
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('fr', 'students', 'Etudiants') ON CONFLICT DO NOTHING`);
    // server.js line 2343
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('fr', 'fees', 'Frais') ON CONFLICT DO NOTHING`);
    // server.js line 2344
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('fr', 'attendance', 'Présence') ON CONFLICT DO NOTHING`);
    // server.js line 2345
    pgm.sql(`INSERT INTO translations (lang, key, value) VALUES ('fr', 'reports', 'Rapports') ON CONFLICT DO NOTHING`);
    // server.js line 2348
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS first_name TEXT`);
    // server.js line 2349
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS last_name TEXT`);
    // server.js line 2350
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS first_name TEXT`);
    // server.js line 2351
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS last_name TEXT`);
    // server.js line 2352
    pgm.sql(`ALTER TABLE church_members ADD COLUMN IF NOT EXISTS first_name TEXT`);
    // server.js line 2353
    pgm.sql(`ALTER TABLE church_members ADD COLUMN IF NOT EXISTS last_name TEXT`);
    // server.js line 2354
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS first_name TEXT`);
    // server.js line 2355
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_name TEXT`);
    // server.js line 2356
    pgm.sql(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT`);
    // server.js line 2357
    pgm.sql(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name TEXT`);
    // server.js line 2359
    pgm.sql(`CREATE TABLE IF NOT EXISTS relationships (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, person_type TEXT NOT NULL, person_id INTEGER NOT NULL, related_type TEXT NOT NULL, related_id INTEGER NOT NULL, relation TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2361
    pgm.sql(`CREATE TABLE IF NOT EXISTS custom_fields (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, field_name TEXT NOT NULL, field_type TEXT DEFAULT 'text', options JSONB, required BOOLEAN DEFAULT false, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2362
    pgm.sql(`CREATE TABLE IF NOT EXISTS custom_field_values (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, field_id INTEGER REFERENCES custom_fields(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, value TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2364
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2365
    pgm.sql(`ALTER TABLE members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2366
    pgm.sql(`ALTER TABLE church_members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2367
    pgm.sql(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2368
    pgm.sql(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2369
    pgm.sql(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2370
    pgm.sql(`ALTER TABLE donations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2371
    pgm.sql(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    // server.js line 2373
    pgm.sql(`CREATE TABLE IF NOT EXISTS version_history (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, action TEXT NOT NULL, old_data JSONB, new_data JSONB, changed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2375
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_students_tenant ON students(tenant_id)`);
    // server.js line 2376
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_students_class ON students(class)`);
    // server.js line 2377
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_fees_tenant ON fees(tenant_id)`);
    // server.js line 2378
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id)`);
    // server.js line 2379
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)`);
    // server.js line 2380
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id)`);
    // server.js line 2381
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_exam ON marks(exam_id)`);
    // server.js line 2382
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id)`);
    // server.js line 2384
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`);
    // server.js line 2385
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id)`);
    // server.js line 2386
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id)`);
    // server.js line 2387
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_donations_tenant ON donations(tenant_id)`);
    // server.js line 2389
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)`);
    // server.js line 2392
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
    // server.js line 2393
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory(tenant_id)`);
    // server.js line 2394
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_church_members_tenant ON church_members(tenant_id)`);
    // server.js line 2395
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_custom_fields_entity ON custom_fields(tenant_id, entity_type)`);
    // server.js line 2396
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_custom_field_values ON custom_field_values(entity_type, entity_id)`);
    // server.js line 2397
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_version_history_entity ON version_history(tenant_id, entity_type, entity_id)`);
    // server.js line 2398
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_relationships ON relationships(tenant_id, person_type, person_id)`);
    // server.js line 2400
    pgm.sql(`CREATE TABLE IF NOT EXISTS backup_log (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, backup_url TEXT, size_bytes INTEGER, status TEXT DEFAULT 'completed', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2402
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN DEFAULT false`);
    // server.js line 2403
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS setup_steps JSONB`);
    // server.js line 2405
    pgm.sql(`CREATE TABLE IF NOT EXISTS grants (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, funder TEXT, amount INTEGER DEFAULT 0, deadline DATE, status TEXT DEFAULT 'identified', description TEXT, source_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2409
    pgm.sql(`CREATE TABLE IF NOT EXISTS feature_flags (id SERIAL PRIMARY KEY, feature_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, version TEXT, category TEXT, requirements TEXT, is_active BOOLEAN DEFAULT false, activated_by TEXT, activated_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2410
    pgm.sql(`ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS min_plan TEXT DEFAULT 'free'`);
    // server.js line 2411
    pgm.sql(`ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS portal TEXT DEFAULT 'platform'`);
    // server.js line 2413
    pgm.sql(`CREATE TABLE IF NOT EXISTS feature_access_overrides (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, feature_key TEXT NOT NULL, granted_by TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, feature_key))`);
    // server.js line 2414
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_feature_overrides_tenant ON feature_access_overrides(tenant_id)`);
    // server.js line 2416
    pgm.sql(`CREATE TABLE IF NOT EXISTS custom_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, slug TEXT NOT NULL, content TEXT, header_html TEXT, footer_html TEXT, stamp_url TEXT, stamp_position TEXT DEFAULT 'bottom-right', badge_text TEXT, badge_color TEXT DEFAULT '#4f46e5', signature_name TEXT, signature_image_url TEXT, signature_position TEXT DEFAULT 'bottom-left', is_published BOOLEAN DEFAULT false, created_by TEXT, updated_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, slug))`);
    // server.js line 2418
    pgm.sql(`CREATE TABLE IF NOT EXISTS document_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, header_html TEXT, footer_html TEXT, stamp_url TEXT, stamp_position TEXT DEFAULT 'bottom-right', badge_text TEXT, badge_color TEXT DEFAULT '#4f46e5', signature_name TEXT, signature_image_url TEXT, signature_position TEXT DEFAULT 'bottom-left', logo_url TEXT, watermark_text TEXT, watermark_opacity NUMERIC DEFAULT 0.1, paper_size TEXT DEFAULT 'A4', margin_top INTEGER DEFAULT 20, margin_bottom INTEGER DEFAULT 20, margin_left INTEGER DEFAULT 15, margin_right INTEGER DEFAULT 15, css TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2420
    pgm.sql(`CREATE TABLE IF NOT EXISTS ussd_sessions (id SERIAL PRIMARY KEY, session_id TEXT NOT NULL, phone TEXT, tenant_id INTEGER, current_menu TEXT, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ, UNIQUE(session_id))`);
    // server.js line 2422
    pgm.sql(`CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, endpoint TEXT NOT NULL, keys JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(endpoint))`);
    // server.js line 2424
    pgm.sql(`CREATE TABLE IF NOT EXISTS offline_sync_queue (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, data JSONB, synced BOOLEAN DEFAULT false, synced_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2426
    pgm.sql(`CREATE TABLE IF NOT EXISTS scheduled_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, report_type TEXT, frequency TEXT DEFAULT 'daily', recipients TEXT, format TEXT DEFAULT 'csv', last_run TIMESTAMPTZ, next_run TIMESTAMPTZ, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2428
    pgm.sql(`CREATE TABLE IF NOT EXISTS analytics_events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_type TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, data JSONB, user_email TEXT, session_id TEXT, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2430
    pgm.sql(`CREATE TABLE IF NOT EXISTS plugin_registry (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, plugin_key TEXT NOT NULL, name TEXT NOT NULL, version TEXT, description TEXT, config JSONB, is_active BOOLEAN DEFAULT true, installed_by TEXT, installed_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, plugin_key))`);
    // server.js line 2432
    pgm.sql(`CREATE TABLE IF NOT EXISTS sms_opt_outs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, phone TEXT NOT NULL, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, phone))`);
    // server.js line 2434
    pgm.sql(`CREATE TABLE IF NOT EXISTS deep_links (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, path TEXT NOT NULL, params JSONB, short_code TEXT UNIQUE, click_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2436
    pgm.sql(`CREATE TABLE IF NOT EXISTS data_exports (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, format TEXT DEFAULT 'json', tables TEXT[], status TEXT DEFAULT 'pending', file_url TEXT, size_bytes INTEGER, requested_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`);
    // server.js line 2438
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain TEXT`);
    // server.js line 2439
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_verified BOOLEAN DEFAULT false`);
    // server.js line 2440
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS app_name TEXT`);
    // server.js line 2441
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS support_email TEXT`);
    // server.js line 2442
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS support_phone TEXT`);
    // server.js line 2443
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS privacy_policy_url TEXT`);
    // server.js line 2444
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS terms_url TEXT`);
    // server.js line 2445
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_message TEXT`);
    // server.js line 2447
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_js TEXT`);
    // server.js line 2449
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant ON analytics_events(tenant_id)`);
    // server.js line 2450
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type)`);
    // server.js line 2451
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(feature_key)`);
    // server.js line 2452
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_custom_pages_slug ON custom_pages(tenant_id, slug)`);
    // server.js line 2453
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_offline_sync_tenant ON offline_sync_queue(tenant_id, synced)`);
    // server.js line 2454
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant ON push_subscriptions(tenant_id)`);
    // server.js line 2455
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next ON scheduled_reports(next_run) WHERE active = true`);
    // server.js line 2456
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_phone ON sms_opt_outs(phone)`);
    // server.js line 2458
    pgm.sql(`ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS reference TEXT`);
    // server.js line 2459
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sms_logs_reference ON sms_logs(reference)`);
    // server.js line 2461
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('plan_enforcement', 'Plan Enforcement', 'Block free plan at 50 students', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2462
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('usage_limits', 'Usage Limits', 'Auto-block when plan limit exceeded', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2463
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('auto_backup', 'Auto Daily Backup', 'pg_dump to Cloudinary at 2am UTC', '3.0', 'core', 'CLOUDINARY_URL env var', true) ON CONFLICT DO NOTHING`);
    // server.js line 2465
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('soft_delete', 'Soft Delete', 'Deleted items can be restored within 30 days', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2466
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('version_history', 'Version History', 'Track all data changes with undo support', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2467
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('pagination', 'Pagination', '50 rows per page on all lists', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2468
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('rate_limiting', 'Rate Limiting', 'Block API abuse with rate limits', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2469
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('seo_meta', 'SEO Meta Tags', 'Open Graph and Twitter cards for all pages', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2470
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('setup_checklist', 'Setup Checklist', 'Onboard wizard for new tenants', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2471
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('pretty_urls', 'Pretty URLs', '/c/water-project style public pages', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2472
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('user_guide', 'User Guide', '/guide page to reduce support tickets', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2473
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('grant_scraper', 'Grant Scraper', 'Track and apply for funding opportunities', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2474
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('video_compression', 'Video Compression', '720p eager transform via Cloudinary', '3.0', 'core', 'CLOUDINARY_URL env var', false) ON CONFLICT DO NOTHING`);
    // server.js line 2475
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('custom_fields', 'Custom Fields', 'Tenant adds custom fields like Blood Type', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2476
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('relationships', 'Relationships', 'John brother of Mary tracking', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2477
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('name_splitting', 'Name Splitting', 'First name and last name columns', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2478
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('pwa_install', 'PWA Install', 'Add to home screen prompt', '3.0', 'core', 'manifest.json + sw.js', true) ON CONFLICT DO NOTHING`);
    // server.js line 2479
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('csv_import', 'CSV Import', 'Import 1000 students via CSV', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2480
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('privacy_terms', 'Privacy & Terms', 'Legal requirement pages', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2481
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('ussd_menus', 'USSD Menus', 'Mobile USSD access for feature phones', '4.0', 'uganda', 'Africa Talking USSD enabled', false) ON CONFLICT DO NOTHING`);
    // server.js line 2482
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('sms_opt_out', 'SMS Opt-Out', 'Allow recipients to opt out of SMS', '4.0', 'uganda', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2483
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('local_languages', 'Local Languages', 'Luganda, Swahili, French translations', '4.0', 'uganda', 'Translations seeded', true) ON CONFLICT DO NOTHING`);
    // server.js line 2484
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('uneb_integration', 'UNEB Integration', 'Uganda National Examinations Board', '4.0', 'uganda', 'UNEB API credentials', false) ON CONFLICT DO NOTHING`);
    // server.js line 2485
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('nira_verification', 'NIRA Verification', 'National ID verification', '4.0', 'uganda', 'NIRA API credentials', false) ON CONFLICT DO NOTHING`);
    // server.js line 2486
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('advanced_analytics', 'Advanced Analytics', 'Detailed analytics dashboard with charts', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2487
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('scheduled_reports', 'Scheduled Reports', 'Auto-send reports on schedule', '5.0', 'enterprise', 'GMAIL_USER + GMAIL_PASS env vars', false) ON CONFLICT DO NOTHING`);
    // server.js line 2488
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('online_exams', 'Online Exams & Quizzes', 'Create, publish, and auto-grade assessments', '6.0', 'ecosystem', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2489
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('whatsapp_integration', 'WhatsApp Integration', 'Send messages via WhatsApp Business API', '6.0', 'ecosystem', 'WhatsApp Business API credentials', true) ON CONFLICT DO NOTHING`);
    // server.js line 2490
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('multi_branch', 'Multi-Branch Management', 'Manage multiple branches and stock transfers', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2491
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('enhanced_clinic', 'Enhanced Clinic Portal', 'Full patient management, consultations, prescriptions, reports', '6.0', 'ecosystem', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2492
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('momo_payments', 'Mobile Money', 'MTN MoMo and Airtel Money integration', '5.0', 'enterprise', 'MoMo API credentials', true) ON CONFLICT DO NOTHING`);
    // server.js line 2493
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('multi_currency', 'Multi-Currency', 'UGX, KES, TZS, RWF, USD support', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2494
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('automation_engine', 'Automation Engine', 'If-then rules for automated actions', '6.0', 'ecosystem', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2495
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('oauth2', 'OAuth2 Login', 'Google and Microsoft OAuth', '6.0', 'ecosystem', 'GOOGLE_CLIENT_ID or MS_CLIENT_ID', false) ON CONFLICT DO NOTHING`);
    // server.js line 2496
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('graphql_api', 'GraphQL API', '/api/v2/graphql endpoint', '6.0', 'ecosystem', 'API key (Basic plan+)', true) ON CONFLICT DO NOTHING`);
    // server.js line 2497
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('webhook_retry', 'Webhook Retry', 'Auto-retry failed webhook deliveries', '6.0', 'ecosystem', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2498
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('plugin_marketplace', 'Plugin Marketplace', 'Install community plugins', '6.0', 'ecosystem', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2499
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('ai_comments', 'AI Report Comments', 'Auto-generate report card comments', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2500
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('fee_prediction', 'Fee Default Prediction', 'AI-powered risk analysis', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2501
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('dropout_risk', 'Dropout Risk Analysis', 'Identify students at risk', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2502
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('demand_forecast', 'Demand Forecasting', 'Predict future inventory needs', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2503
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('churn_prediction', 'Churn Prediction', 'Identify members at risk of leaving', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2504
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('giving_trends', 'Giving Trends AI', 'AI-powered donation analysis', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2505
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('engagement_scoring', 'Engagement Scoring', 'Member engagement analysis', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2506
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('push_notifications', 'Push Notifications', 'Browser push notification support', '8.0', 'mobile', 'VAPID keys', true) ON CONFLICT DO NOTHING`);
    // server.js line 2507
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('offline_sync', 'Offline Sync', 'Work offline with auto-sync', '8.0', 'mobile', 'Service Worker', true) ON CONFLICT DO NOTHING`);
    // server.js line 2508
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('deep_linking', 'Deep Linking', 'Short codes for mobile app links', '8.0', 'mobile', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2509
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('camera_integration', 'Camera Integration', 'Scan barcodes and documents via camera', '8.0', 'mobile', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2510
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('peer_fundraising', 'Peer-to-Peer Fundraising', 'Individual fundraising campaigns', '8.0', 'mobile', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2511
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('app_store', 'App Store', 'Browse and install integrations', '8.0', 'mobile', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2512
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('saml_sso', 'SAML SSO', 'Enterprise single sign-on', '9.0', 'platform', 'SAML IdP configuration', false) ON CONFLICT DO NOTHING`);
    // server.js line 2513
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('soc2', 'SOC2 Compliance', 'Security compliance dashboard', '9.0', 'platform', 'Security audit completed', false) ON CONFLICT DO NOTHING`);
    // server.js line 2514
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('white_label', 'White Label', 'Custom domain and branding', '9.0', 'platform', 'Custom domain configured', false) ON CONFLICT DO NOTHING`);
    // server.js line 2515
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('plugin_sdk', 'Plugin SDK', 'Build custom plugins', '9.0', 'platform', 'Developer account', false) ON CONFLICT DO NOTHING`);
    // server.js line 2516
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('data_portability', 'Data Portability', 'Export all data in standard formats', '9.0', 'platform', 'None', false) ON CONFLICT DO NOTHING`);
    // server.js line 2517
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('page_editor', 'Page Editor', 'User-editable pages with stamps and signatures', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2518
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('document_templates', 'Document Templates', 'Customize receipts, reports with headers/footers/stamps', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2519
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('government_dashboards', 'Government Dashboards', 'Anonymized aggregate data for regulators', '9.0', 'platform', 'super_admin only', false) ON CONFLICT DO NOTHING`);
    // server.js line 2520
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('inventory_management', 'Inventory & Stock Management', 'Full inventory tracking with categories, suppliers, purchase orders, low-stock alerts', '11.0', 'enterprise', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2521
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('parent_portal', 'Parent/Student Self-Service Portal', 'Parents and students can view grades, attendance, fees, and communicate online', '11.0', 'enterprise', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2522
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('advanced_analytics_v2', 'Advanced Analytics Dashboard', 'Visual charts and KPIs for schools, businesses, churches, and clinics', '11.0', 'enterprise', 'None', true, 'pro') ON CONFLICT DO NOTHING`);
    // server.js line 2523
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('receipt_builder', 'Document & Receipt Builder', 'Customizable receipt/invoice templates with headers, footers, and auto-numbering', '11.0', 'core', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2524
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('event_calendar', 'Event Calendar & Booking', 'Full calendar with event creation, RSVP, booking, and reminders', '12.0', 'ecosystem', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2525
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('campaign_manager', 'SMS/Email Campaign Manager', 'Create and manage SMS and email campaigns for mass communication', '12.0', 'ecosystem', 'SMS gateway or SMTP setup', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2526
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('qr_attendance', 'QR Code Attendance', 'QR-based check-in and check-out for attendance tracking', '12.0', 'mobile', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2527
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('finance_dashboard', 'Finance Dashboard & Chart of Accounts', 'Double-entry bookkeeping with chart of accounts and journal entries', '12.0', 'enterprise', 'None', true, 'pro') ON CONFLICT DO NOTHING`);
    // server.js line 2528
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('staff_appraisal_v2', 'Staff Performance & Appraisals v2', 'Configurable KPI-based staff appraisal with scoring', '12.0', 'core', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2532
    pgm.sql(`CREATE TABLE IF NOT EXISTS transport_routes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, route_name TEXT NOT NULL, driver_name TEXT, driver_phone TEXT, vehicle_plate TEXT, capacity INTEGER DEFAULT 30, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2533
    pgm.sql(`CREATE TABLE IF NOT EXISTS transport_assignments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, route_id INTEGER REFERENCES transport_routes(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, pick_up_point TEXT, drop_off_point TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2535
    pgm.sql(`CREATE TABLE IF NOT EXISTS discipline_incidents (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, incident_date DATE DEFAULT CURRENT_DATE, type TEXT NOT NULL, description TEXT, action_taken TEXT, reported_by TEXT, status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2537
    pgm.sql(`CREATE TABLE IF NOT EXISTS homework (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, subject TEXT NOT NULL, title TEXT NOT NULL, description TEXT, due_date DATE, class_name TEXT, assigned_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2538
    pgm.sql(`CREATE TABLE IF NOT EXISTS homework_submissions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, homework_id INTEGER REFERENCES homework(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, submission_text TEXT, score NUMERIC, submitted_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2540
    pgm.sql(`CREATE TABLE IF NOT EXISTS school_events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_date DATE, end_date DATE, event_type TEXT DEFAULT 'event', location TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2542
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_health (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE UNIQUE, blood_group TEXT, allergies TEXT, conditions TEXT, emergency_contact TEXT, emergency_phone TEXT, last_checkup DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2543
    pgm.sql(`CREATE TABLE IF NOT EXISTS health_visits (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, visit_date DATE DEFAULT CURRENT_DATE, complaint TEXT, diagnosis TEXT, treatment TEXT, seen_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2545
    pgm.sql(`CREATE TABLE IF NOT EXISTS alumni (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, graduation_year INTEGER, class_name TEXT, occupation TEXT, address TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2547
    pgm.sql(`CREATE TABLE IF NOT EXISTS library_books (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, author TEXT, isbn TEXT, category TEXT, copies_total INTEGER DEFAULT 1, copies_available INTEGER DEFAULT 1, shelf_location TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2548
    pgm.sql(`CREATE TABLE IF NOT EXISTS library_borrows (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, book_id INTEGER REFERENCES library_books(id) ON DELETE CASCADE, borrower_name TEXT NOT NULL, borrower_type TEXT DEFAULT 'student', borrower_id INTEGER, borrow_date DATE DEFAULT CURRENT_DATE, due_date DATE, return_date DATE, fine INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2551
    pgm.sql(`CREATE TABLE IF NOT EXISTS choir_members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id) ON DELETE CASCADE, voice_part TEXT, role TEXT DEFAULT 'member', joined_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, member_id))`);
    // server.js line 2552
    pgm.sql(`CREATE TABLE IF NOT EXISTS worship_songs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, author TEXT, key_signature TEXT, tempo TEXT, lyrics TEXT, category TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2554
    pgm.sql(`CREATE TABLE IF NOT EXISTS sacraments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, type TEXT NOT NULL, member_id INTEGER REFERENCES church_members(id) ON DELETE SET NULL, date DATE, officiant TEXT, location TEXT, witnesses TEXT, certificate_no TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2556
    pgm.sql(`CREATE TABLE IF NOT EXISTS cell_groups (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, leader TEXT, meeting_day TEXT, meeting_time TEXT, location TEXT, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2557
    pgm.sql(`CREATE TABLE IF NOT EXISTS cell_group_members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, group_id INTEGER REFERENCES cell_groups(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id) ON DELETE CASCADE, role TEXT DEFAULT 'member', joined_date DATE DEFAULT CURRENT_DATE, UNIQUE(tenant_id, group_id, member_id))`);
    // server.js line 2559
    pgm.sql(`CREATE TABLE IF NOT EXISTS volunteer_roles (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, role_name TEXT NOT NULL, description TEXT, schedule TEXT, slots INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2560
    pgm.sql(`CREATE TABLE IF NOT EXISTS volunteer_assignments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, role_id INTEGER REFERENCES volunteer_roles(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id) ON DELETE CASCADE, date_assigned DATE DEFAULT CURRENT_DATE, status TEXT DEFAULT 'active')`);
    // server.js line 2567
    pgm.sql(`CREATE TABLE IF NOT EXISTS payroll_runs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, month TEXT NOT NULL, total_gross INTEGER DEFAULT 0, total_deductions INTEGER DEFAULT 0, total_net INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2568
    pgm.sql(`CREATE TABLE IF NOT EXISTS payroll_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, run_id INTEGER REFERENCES payroll_runs(id) ON DELETE CASCADE, employee_name TEXT NOT NULL, gross_salary INTEGER DEFAULT 0, paye INTEGER DEFAULT 0, nssf_employee INTEGER DEFAULT 0, nssf_employer INTEGER DEFAULT 0, other_deductions INTEGER DEFAULT 0, net_pay INTEGER DEFAULT 0, bank_account TEXT)`);
    // server.js line 2570
    pgm.sql(`CREATE TABLE IF NOT EXISTS leave_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, employee_name TEXT NOT NULL, leave_type TEXT NOT NULL, start_date DATE, end_date DATE, days INTEGER, reason TEXT, status TEXT DEFAULT 'pending', approved_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2573
    pgm.sql(`CREATE TABLE IF NOT EXISTS project_tasks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, assignee TEXT, status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'medium', due_date DATE, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2575
    pgm.sql(`CREATE TABLE IF NOT EXISTS crm_leads (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT, source TEXT, stage TEXT DEFAULT 'new', value INTEGER DEFAULT 0, notes TEXT, assigned_to TEXT, next_follow_up DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2577
    pgm.sql(`CREATE TABLE IF NOT EXISTS stock_takes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, date DATE DEFAULT CURRENT_DATE, status TEXT DEFAULT 'in_progress', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2578
    pgm.sql(`CREATE TABLE IF NOT EXISTS stock_take_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, take_id INTEGER REFERENCES stock_takes(id) ON DELETE CASCADE, item_name TEXT NOT NULL, system_qty INTEGER DEFAULT 0, physical_qty INTEGER DEFAULT 0, variance INTEGER DEFAULT 0, notes TEXT)`);
    // server.js line 2580
    pgm.sql(`CREATE TABLE IF NOT EXISTS warranties (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_name TEXT NOT NULL, serial_number TEXT, purchase_date DATE, expiry_date DATE, vendor TEXT, warranty_type TEXT, value INTEGER DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2583
    pgm.sql(`CREATE TABLE IF NOT EXISTS board_resolutions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, resolution_text TEXT, proposed_by TEXT, seconded_by TEXT, meeting_date DATE, vote_for INTEGER DEFAULT 0, vote_against INTEGER DEFAULT 0, vote_abstain INTEGER DEFAULT 0, status TEXT DEFAULT 'proposed', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2585
    pgm.sql(`CREATE TABLE IF NOT EXISTS assets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, category TEXT, purchase_date DATE, purchase_value INTEGER DEFAULT 0, current_value INTEGER DEFAULT 0, depreciation_rate NUMERIC DEFAULT 0, location TEXT, custodian TEXT, condition TEXT DEFAULT 'good', serial_number TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2587
    pgm.sql(`CREATE TABLE IF NOT EXISTS partners (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT DEFAULT 'donor', email TEXT, phone TEXT, organization TEXT, engagement_score INTEGER DEFAULT 0, total_contributions INTEGER DEFAULT 0, last_contact DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2589
    pgm.sql(`CREATE TABLE IF NOT EXISTS ticketed_events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_date DATE, venue TEXT, capacity INTEGER DEFAULT 100, price INTEGER DEFAULT 0, tickets_sold INTEGER DEFAULT 0, qr_enabled BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2590
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_tickets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES ticketed_events(id) ON DELETE CASCADE, attendee_name TEXT NOT NULL, attendee_email TEXT, attendee_phone TEXT, ticket_code TEXT UNIQUE, status TEXT DEFAULT 'active', checked_in BOOLEAN DEFAULT false, checked_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2593
    pgm.sql(`CREATE TABLE IF NOT EXISTS workflows (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, trigger_type TEXT NOT NULL, trigger_config JSONB, steps JSONB, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2594
    pgm.sql(`CREATE TABLE IF NOT EXISTS workflow_instances (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE, current_step INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', data JSONB, initiated_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2596
    pgm.sql(`CREATE TABLE IF NOT EXISTS chat_channels (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT DEFAULT 'group', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2597
    pgm.sql(`CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, channel_id INTEGER REFERENCES chat_channels(id) ON DELETE CASCADE, sender_email TEXT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2598
    pgm.sql(`CREATE TABLE IF NOT EXISTS channel_members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, channel_id INTEGER REFERENCES chat_channels(id) ON DELETE CASCADE, user_email TEXT NOT NULL, UNIQUE(tenant_id, channel_id, user_email))`);
    // server.js line 2600
    pgm.sql(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, assignee TEXT, priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'todo', due_date DATE, created_by TEXT, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2605
    pgm.sql(`CREATE TABLE IF NOT EXISTS activity_feed (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, description TEXT, metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2607
    pgm.sql(`CREATE TABLE IF NOT EXISTS surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, questions JSONB, is_active BOOLEAN DEFAULT true, responses_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2608
    pgm.sql(`CREATE TABLE IF NOT EXISTS survey_responses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, survey_id INTEGER REFERENCES surveys(id) ON DELETE CASCADE, respondent_email TEXT, answers JSONB, submitted_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2610
    pgm.sql(`CREATE TABLE IF NOT EXISTS email_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, category TEXT DEFAULT 'general', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2612
    pgm.sql(`CREATE TABLE IF NOT EXISTS qr_codes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, label TEXT NOT NULL, target_url TEXT, qr_data TEXT, scan_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2614
    pgm.sql(`CREATE TABLE IF NOT EXISTS certificates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, template_name TEXT NOT NULL, recipient_name TEXT NOT NULL, recipient_email TEXT, issue_date DATE DEFAULT CURRENT_DATE, certificate_no TEXT UNIQUE, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2616
    pgm.sql(`CREATE TABLE IF NOT EXISTS signing_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, document_title TEXT NOT NULL, document_url TEXT, signer_email TEXT NOT NULL, signer_name TEXT, status TEXT DEFAULT 'pending', signed_at TIMESTAMPTZ, signature_data TEXT, requested_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2618
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_prefs JSONB`);
    // server.js line 2620
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS education_levels TEXT[] DEFAULT '{"nursery","kindergarten","primary","o_level","a_level","university","vocational"}'`);
    // server.js line 2621
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS education_level TEXT DEFAULT 'primary'`);
    // server.js line 2623
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS boarding_status TEXT DEFAULT 'day'`);
    // server.js line 2624
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS previous_school TEXT`);
    // server.js line 2625
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS hostel_name TEXT`);
    // server.js line 2626
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS dormitory TEXT`);
    // server.js line 2627
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS bed_number TEXT`);
    // server.js line 2628
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS meal_plan TEXT DEFAULT 'full'`);
    // server.js line 2629
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_relation TEXT`);
    // server.js line 2630
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS pickup_person TEXT`);
    // server.js line 2631
    pgm.sql(`ALTER TABLE students ADD COLUMN IF NOT EXISTS pickup_phone TEXT`);
    // server.js line 2632
    pgm.sql(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS education_level TEXT`);
    // server.js line 2633
    pgm.sql(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS term TEXT DEFAULT 'term1'`);
    // server.js line 2634
    pgm.sql(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS year INTEGER`);
    // server.js line 2635
    pgm.sql(`ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS education_level TEXT`);
    // server.js line 2636
    pgm.sql(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS education_level TEXT`);
    // server.js line 2638
    pgm.sql(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2639
    pgm.sql(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_email TEXT`);
    // server.js line 2640
    pgm.sql(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'info'`);
    // server.js line 2641
    pgm.sql(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN DEFAULT false`);
    // server.js line 2644
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_staff (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT NOT NULL DEFAULT 'doctor', specialization TEXT, license_no TEXT, department TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2646
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_queue (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER, patient_name TEXT NOT NULL, queue_number INTEGER DEFAULT 0, priority TEXT DEFAULT 'normal', complaint TEXT, vitals JSONB, triage_notes TEXT, status TEXT DEFAULT 'waiting', seen_by INTEGER REFERENCES clinic_staff(id), created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2648
    pgm.sql(`CREATE TABLE IF NOT EXISTS consultations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER, patient_name TEXT NOT NULL, doctor_id INTEGER REFERENCES clinic_staff(id), queue_id INTEGER REFERENCES patient_queue(id), chief_complaint TEXT, history TEXT, examination TEXT, diagnosis TEXT, treatment_plan TEXT, follow_up_date DATE, notes TEXT, status TEXT DEFAULT 'in_progress', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2650
    pgm.sql(`CREATE TABLE IF NOT EXISTS prescriptions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, consultation_id INTEGER REFERENCES consultations(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER, patient_name TEXT NOT NULL, doctor_id INTEGER REFERENCES clinic_staff(id), doctor_name TEXT, diagnosis TEXT, notes TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2652
    pgm.sql(`CREATE TABLE IF NOT EXISTS prescription_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, prescription_id INTEGER REFERENCES prescriptions(id) ON DELETE CASCADE, medicine_name TEXT NOT NULL, dosage TEXT, frequency TEXT, duration TEXT, quantity INTEGER DEFAULT 1, instructions TEXT, substitutes TEXT, status TEXT DEFAULT 'pending', dispensed_by INTEGER REFERENCES clinic_staff(id), dispensed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2654
    pgm.sql(`CREATE TABLE IF NOT EXISTS pharmacy_dispensing (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, prescription_id INTEGER REFERENCES prescriptions(id) ON DELETE CASCADE, item_id INTEGER REFERENCES prescription_items(id) ON DELETE CASCADE, pharmacist_id INTEGER REFERENCES clinic_staff(id), patient_name TEXT, medicine_name TEXT, dosage TEXT, quantity_dispensed INTEGER DEFAULT 0, batch_number TEXT, expiry_date DATE, notes TEXT, dispensed_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2656
    pgm.sql(`CREATE TABLE IF NOT EXISTS lab_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, consultation_id INTEGER REFERENCES consultations(id), patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER, patient_name TEXT NOT NULL, doctor_id INTEGER REFERENCES clinic_staff(id), doctor_name TEXT, test_name TEXT NOT NULL, test_category TEXT, urgency TEXT DEFAULT 'routine', clinical_notes TEXT, status TEXT DEFAULT 'requested', requested_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2658
    pgm.sql(`CREATE TABLE IF NOT EXISTS lab_results (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, lab_request_id INTEGER REFERENCES lab_requests(id) ON DELETE CASCADE, lab_technician_id INTEGER REFERENCES clinic_staff(id), result_value TEXT, result_numeric NUMERIC, unit TEXT, reference_range TEXT, interpretation TEXT, is_abnormal BOOLEAN DEFAULT false, verified_by INTEGER REFERENCES clinic_staff(id), verified_at TIMESTAMPTZ, notes TEXT, reported_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2660
    pgm.sql(`CREATE TABLE IF NOT EXISTS pharmacy_inventory (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, medicine_name TEXT NOT NULL, generic_name TEXT, category TEXT, quantity INTEGER DEFAULT 0, unit_price INTEGER DEFAULT 0, batch_number TEXT, manufacturer TEXT, expiry_date DATE, reorder_level INTEGER DEFAULT 10, location TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2662
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_beds (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, bed_number TEXT NOT NULL, ward TEXT NOT NULL DEFAULT 'General Ward', bed_type TEXT DEFAULT 'Standard', daily_rate INTEGER DEFAULT 0, patient_name TEXT, reason TEXT, status TEXT DEFAULT 'available', assigned_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2665
    pgm.sql(`CREATE TABLE IF NOT EXISTS school_levels (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, level_name TEXT NOT NULL, level_code TEXT NOT NULL, level_order INTEGER DEFAULT 0, description TEXT, min_age INTEGER, max_age INTEGER, has_streams BOOLEAN DEFAULT true, has_boarding BOOLEAN DEFAULT true, assessment_type TEXT DEFAULT 'exam_based', curriculum TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2667
    pgm.sql(`CREATE TABLE IF NOT EXISTS hostels (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, gender TEXT DEFAULT 'mixed', capacity INTEGER DEFAULT 50, current_occupancy INTEGER DEFAULT 0, warden TEXT, warden_phone TEXT, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2669
    pgm.sql(`CREATE TABLE IF NOT EXISTS hostel_rooms (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, hostel_id INTEGER REFERENCES hostels(id) ON DELETE CASCADE, room_number TEXT NOT NULL, capacity INTEGER DEFAULT 4, current_occupancy INTEGER DEFAULT 0, room_type TEXT DEFAULT 'dormitory', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2671
    pgm.sql(`CREATE TABLE IF NOT EXISTS hostel_assignments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, hostel_id INTEGER REFERENCES hostels(id), room_id INTEGER REFERENCES hostel_rooms(id), bed_number TEXT, assigned_date DATE DEFAULT CURRENT_DATE, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2673
    pgm.sql(`CREATE TABLE IF NOT EXISTS meal_plans (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, meals_per_day INTEGER DEFAULT 3, price INTEGER DEFAULT 0, includes_breakfast BOOLEAN DEFAULT true, includes_lunch BOOLEAN DEFAULT true, includes_dinner BOOLEAN DEFAULT true, includes_snacks BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2675
    pgm.sql(`CREATE TABLE IF NOT EXISTS meal_attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), meal_date DATE DEFAULT CURRENT_DATE, meal_type TEXT, present BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, student_id, meal_date, meal_type))`);
    // server.js line 2677
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_tracks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, track_name TEXT NOT NULL, level_code TEXT, subjects TEXT[], description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2679
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_track_assignments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, track_id INTEGER REFERENCES student_tracks(id) ON DELETE CASCADE, assigned_date DATE DEFAULT CURRENT_DATE, status TEXT DEFAULT 'active', UNIQUE(tenant_id, student_id, track_id))`);
    // server.js line 2682
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_transport_routes_tenant ON transport_routes(tenant_id)`);
    // server.js line 2683
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_discipline_tenant ON discipline_incidents(tenant_id)`);
    // server.js line 2684
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_homework_tenant ON homework(tenant_id)`);
    // server.js line 2685
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_school_events_tenant ON school_events(tenant_id)`);
    // server.js line 2686
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_student_health_tenant ON student_health(tenant_id)`);
    // server.js line 2687
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_alumni_tenant ON alumni(tenant_id)`);
    // server.js line 2688
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_library_books_tenant ON library_books(tenant_id)`);
    // server.js line 2689
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_choir_members_tenant ON choir_members(tenant_id)`);
    // server.js line 2690
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sacraments_tenant ON sacraments(tenant_id)`);
    // server.js line 2691
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_cell_groups_tenant ON cell_groups(tenant_id)`);
    // server.js line 2692
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_volunteer_roles_tenant ON volunteer_roles(tenant_id)`);
    // server.js line 2693
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sermons_tenant ON sermons(tenant_id)`);
    // server.js line 2694
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_prayer_requests_tenant ON prayer_requests(tenant_id)`);
    // server.js line 2695
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant ON payroll_runs(tenant_id)`);
    // server.js line 2696
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant ON leave_requests(tenant_id)`);
    // server.js line 2697
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id)`);
    // server.js line 2698
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant ON crm_leads(tenant_id)`);
    // server.js line 2699
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_stock_takes_tenant ON stock_takes(tenant_id)`);
    // server.js line 2700
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_warranties_tenant ON warranties(tenant_id)`);
    // server.js line 2701
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_board_resolutions_tenant ON board_resolutions(tenant_id)`);
    // server.js line 2702
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id)`);
    // server.js line 2703
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_partners_tenant ON partners(tenant_id)`);
    // server.js line 2704
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_ticketed_events_tenant ON ticketed_events(tenant_id)`);
    // server.js line 2705
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows(tenant_id)`);
    // server.js line 2706
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_chat_channels_tenant ON chat_channels(tenant_id)`);
    // server.js line 2707
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id)`);
    // server.js line 2708
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_activity_feed_tenant ON activity_feed(tenant_id)`);
    // server.js line 2709
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_surveys_tenant ON surveys(tenant_id)`);
    // server.js line 2710
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_email_templates_tenant ON email_templates(tenant_id)`);
    // server.js line 2711
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_qr_codes_tenant ON qr_codes(tenant_id)`);
    // server.js line 2712
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_certificates_tenant ON certificates(tenant_id)`);
    // server.js line 2713
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_signing_requests_tenant ON signing_requests(tenant_id)`);
    // server.js line 2714
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_staff_tenant ON clinic_staff(tenant_id)`);
    // server.js line 2715
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_queue_tenant ON patient_queue(tenant_id)`);
    // server.js line 2716
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_consultations_tenant ON consultations(tenant_id)`);
    // server.js line 2717
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant ON prescriptions(tenant_id)`);
    // server.js line 2718
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_prescription_items_tenant ON prescription_items(tenant_id)`);
    // server.js line 2719
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pharmacy_dispensing_tenant ON pharmacy_dispensing(tenant_id)`);
    // server.js line 2720
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_lab_requests_tenant ON lab_requests(tenant_id)`);
    // server.js line 2721
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_lab_results_tenant ON lab_results(tenant_id)`);
    // server.js line 2722
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pharmacy_inventory_tenant ON pharmacy_inventory(tenant_id)`);
    // server.js line 2723
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_school_levels_tenant ON school_levels(tenant_id)`);
    // server.js line 2724
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_hostels_tenant ON hostels(tenant_id)`);
    // server.js line 2725
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_hostel_rooms_tenant ON hostel_rooms(tenant_id)`);
    // server.js line 2726
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_hostel_assignments_tenant ON hostel_assignments(tenant_id)`);
    // server.js line 2727
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_meal_plans_tenant ON meal_plans(tenant_id)`);
    // server.js line 2728
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_meal_attendance_tenant ON meal_attendance(tenant_id)`);
    // server.js line 2729
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_student_tracks_tenant ON student_tracks(tenant_id)`);
    // server.js line 2732
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('transport', 'School Transport', 'Manage bus routes and student assignments', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2733
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('discipline', 'Discipline Tracking', 'Track student behavior incidents and actions', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2734
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('homework', 'Homework & Assignments', 'Assign, submit and grade homework', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2735
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('school_calendar', 'School Calendar', 'Events, term dates and holidays', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2736
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('health_records', 'Health Records', 'Student medical info and clinic visits', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2737
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('alumni', 'Alumni Network', 'Graduated students tracking and networking', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2738
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('library', 'Library Management', 'Books, borrowing, returns and fines', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2739
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('choir', 'Choir & Worship Team', 'Roster, songs and scheduling', '4.0', 'uganda', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2740
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('sacraments', 'Sacrament Records', 'Baptism, marriage, funeral records', '4.0', 'uganda', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2741
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('cell_groups', 'Cell Groups', 'Small groups, leaders and meetings', '4.0', 'uganda', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2742
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('volunteers', 'Volunteer Scheduling', 'Roles, schedules and availability', '4.0', 'uganda', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2743
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('sermons', 'Sermon Archive', 'Sermon notes, audio and series tracking', '4.0', 'uganda', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2744
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('prayer_requests', 'Prayer Requests', 'Submit, track and mark answered', '4.0', 'uganda', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2745
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('payroll', 'Payroll Management', 'Salary calculations, payslips, deductions', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2746
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('hr_leave', 'HR & Leave Management', 'Leave requests, balances and approval', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2747
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('projects', 'Project Management', 'Projects, tasks, milestones and deadlines', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2748
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('crm', 'CRM & Leads', 'Lead tracking, pipeline and follow-ups', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2749
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('stock_take', 'Stock Take', 'Physical inventory counts vs system', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2750
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('warranties', 'Warranty Tracking', 'Product warranties and expiry alerts', '5.0', 'enterprise', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2751
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('board_resolutions', 'Board Resolutions', 'Decisions, votes and meeting minutes', '6.0', 'ecosystem', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2752
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('asset_management', 'Asset Management', 'Fixed assets, depreciation and locations', '6.0', 'ecosystem', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2753
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('partners', 'Partner & Donor Management', 'Donor profiles and engagement', '6.0', 'ecosystem', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2754
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('event_ticketing', 'Event Ticketing', 'Paid events, QR tickets and check-in', '6.0', 'ecosystem', 'Flutterwave for paid events', false) ON CONFLICT DO NOTHING`);
    // server.js line 2755
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('workflows', 'Workflow Engine', 'Approval workflows and automation', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2756
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('chat', 'Internal Chat', 'Messaging between platform users', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2757
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('task_manager', 'Task Manager', 'Tasks, assignments and deadlines', '7.0', 'ai', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2758
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('two_fa', 'Two-Factor Auth', 'TOTP-based 2FA for accounts', '8.0', 'mobile', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2759
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('activity_feed', 'Activity Feed', 'Real-time activity timeline', '8.0', 'mobile', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2760
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('global_search', 'Global Search', 'Search across all data types', '8.0', 'mobile', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2761
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('dark_mode', 'Dark Mode', 'Toggle light/dark theme', '8.0', 'mobile', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2762
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('surveys', 'Surveys & Feedback', 'Create forms and collect responses', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2763
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('email_templates', 'Email Templates', 'Customizable email templates', '9.0', 'platform', 'GMAIL_USER + GMAIL_PASS', false) ON CONFLICT DO NOTHING`);
    // server.js line 2764
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('qr_codes', 'QR Code Generator', 'Generate QR codes for anything', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2765
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('certificates', 'Digital Certificates', 'Auto-generated completion certificates', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2766
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('document_signing', 'Document Signing', 'Request and verify signatures', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2767
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('watermarks', 'Watermark Support', 'Add watermarks to documents', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2768
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('duplicate_detection', 'Duplicate Detection', 'Find duplicate records', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2769
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('bulk_operations', 'Bulk Operations', 'Mass edit, delete and export', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2770
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('dashboard_customize', 'Dashboard Customization', 'Reorder and customize dashboard cards', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2771
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('keyboard_shortcuts', 'Keyboard Shortcuts', 'Quick navigation with keyboard', '9.0', 'platform', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2773
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('clinic_workflow', 'Clinic Workflow', 'Doctor-Pharmacist-Lab role-based medical workflow', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2774
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('clinic_pharmacy', 'Clinic Pharmacy', 'Pharmacy inventory and dispensing', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2775
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('clinic_lab', 'Clinic Laboratory', 'Lab requests, results and verification', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2776
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('student_specialization', 'Student Specialization', 'Boarding/Day, tracks and level classification', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2777
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('school_levels', 'School Levels Manager', 'Kindergarten through University level setup', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2778
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('hostel_management', 'Hostel Management', 'Dormitories, rooms and assignments', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2779
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('meal_management', 'Meal Management', 'Meal plans and boarding meal attendance', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2780
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('patient_queue', 'Patient Queue', 'Triage and queue management for clinic', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2781
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('quotations', 'Quotations', 'Create and manage price quotations for customers', '3.0', 'business', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2782
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('deliveries', 'Deliveries', 'Track order dispatch and delivery status', '3.0', 'business', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2783
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('public_site', 'Public Website', 'Build a public-facing website with pages', '3.0', 'core', 'None', true) ON CONFLICT DO NOTHING`);
    // server.js line 2784
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('fundraising', 'Fundraising', 'Launch campaigns and collect donations', '3.0', 'core', 'None', true, 'basic') ON CONFLICT DO NOTHING`);
    // server.js line 2786
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('entertainment_hub', 'Entertainment Hub', 'Videos, music, news and auto-scraped content', '3.0', 'core', 'z-ai-web-dev-sdk', true) ON CONFLICT DO NOTHING`);
    // server.js line 2787
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('web_scraping', 'Web Scraping', 'Auto-import news and events from external sites', '3.0', 'core', 'z-ai-web-dev-sdk', true) ON CONFLICT DO NOTHING`);
    // server.js line 2789
    pgm.sql(`CREATE TABLE IF NOT EXISTS daily_adverts (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, image_url TEXT, link_url TEXT, position TEXT DEFAULT 'homepage', start_date DATE, end_date DATE, is_active BOOLEAN DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2790
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 2791
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'homepage'`);
    // server.js line 2792
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS created_by TEXT`);
    // server.js line 2793
    pgm.sql(`CREATE TABLE IF NOT EXISTS blog_posts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, slug TEXT UNIQUE, title TEXT NOT NULL, content TEXT NOT NULL, excerpt TEXT, image_url TEXT, category TEXT DEFAULT 'news', author TEXT, is_published BOOLEAN DEFAULT false, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2794
    pgm.sql(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_verified BOOLEAN DEFAULT false`);
    // server.js line 2795
    pgm.sql(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 2796
    pgm.sql(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 2798
    pgm.sql(`ALTER TABLE developer_revenue ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 2799
    pgm.sql(`ALTER TABLE developer_revenue ADD COLUMN IF NOT EXISTS source TEXT`);
    // server.js line 2800
    pgm.sql(`ALTER TABLE developer_revenue ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 2801
    pgm.sql(`ALTER TABLE developer_revenue ADD COLUMN IF NOT EXISTS details TEXT`);
    // server.js line 2802
    pgm.sql(`ALTER TABLE developer_revenue ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    // server.js line 2804
    pgm.sql(`ALTER TABLE subscription_plans DROP COLUMN IF EXISTS plan_key`);
    // server.js line 2805
    pgm.sql(`ALTER TABLE subscription_plans DROP COLUMN IF EXISTS key`);
    // server.js line 2807
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS title TEXT`);
    // server.js line 2808
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS image_url TEXT`);
    // server.js line 2809
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS link_url TEXT`);
    // server.js line 2810
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS start_date DATE`);
    // server.js line 2811
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS end_date DATE`);
    // server.js line 2812
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    // server.js line 2813
    pgm.sql(`ALTER TABLE daily_adverts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 2815
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS slug TEXT`);
    // server.js line 2816
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS excerpt TEXT`);
    // server.js line 2817
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS image_url TEXT`);
    // server.js line 2818
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'news'`);
    // server.js line 2819
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author TEXT`);
    // server.js line 2820
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false`);
    // server.js line 2821
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`);
    // server.js line 2822
    pgm.sql(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 2824
    pgm.sql(`CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2825
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('site_name', 'Comfort') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2826
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('site_tagline', 'The Operating System for African Institutions') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2827
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('support_email', 'support@ssewasswa.onrender.com') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2828
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('support_phone', '') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2829
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('google_verification', 'ou1SW4UV8CGS6odvi35dMaVIagaQGgFu91BpaXI7CIQ') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    // server.js line 2830
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('developer_phone', '') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2831
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('developer_email', 'admin@ssewasswa.com') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2832
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('whatsapp_link', '') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2833
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('twitter_link', '') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2834
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('facebook_link', '') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2835
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('footer_text', 'All rights reserved.') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2836
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('ad_revenue_per_view', '50') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2837
    pgm.sql(`INSERT INTO platform_settings (key, value) VALUES ('premium_resource_price', '2000') ON CONFLICT (key) DO NOTHING`);
    // server.js line 2861
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'book'`);
    // server.js line 2862
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS subject TEXT`);
    // server.js line 2863
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS class_level TEXT`);
    // server.js line 2864
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS file_url TEXT`);
    // server.js line 2865
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS file_type TEXT`);
    // server.js line 2866
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS cover_image TEXT`);
    // server.js line 2867
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS source TEXT`);
    // server.js line 2868
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS author TEXT`);
    // server.js line 2869
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true`);
    // server.js line 2870
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS price INTEGER DEFAULT 0`);
    // server.js line 2871
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0`);
    // server.js line 2872
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`);
    // server.js line 2873
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS scraped_from TEXT`);
    // server.js line 2874
    pgm.sql(`ALTER TABLE educational_resources ADD COLUMN IF NOT EXISTS created_by TEXT`);
    // server.js line 2933
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stamp_url TEXT`);
    // server.js line 2934
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signature_url TEXT`);
    // server.js line 2935
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS badge_text TEXT`);
    // server.js line 2936
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#4f46e5'`);
    // server.js line 2937
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS hero_image_url TEXT`);
    // server.js line 2938
    pgm.sql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS welcome_message TEXT`);
    // server.js line 2939
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT`);
    // server.js line 2940
    pgm.sql(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    // server.js line 2942
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
    // server.js line 2943
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`);
    // server.js line 2944
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly'`);
    // server.js line 2945
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features TEXT`);
    // server.js line 2946
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 5`);
    // server.js line 2947
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_students INTEGER DEFAULT 100`);
    // server.js line 2948
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    // server.js line 2949
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_name TEXT`);
    // server.js line 2950
    pgm.sql(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS description TEXT`);
    // server.js line 2951
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
    // server.js line 2952
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS section_type TEXT DEFAULT 'hero'`);
    // server.js line 2953
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS subtitle TEXT`);
    // server.js line 2954
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS content TEXT`);
    // server.js line 2955
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS image_url TEXT`);
    // server.js line 2956
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS video_url TEXT`);
    // server.js line 2957
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS button_text TEXT`);
    // server.js line 2958
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS button_link TEXT`);
    // server.js line 2959
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS background_color TEXT DEFAULT '#4f46e5'`);
    // server.js line 2960
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS text_color TEXT DEFAULT 'white'`);
    // server.js line 2961
    pgm.sql(`ALTER TABLE homepage_sections ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true`);
    // server.js line 2962
    pgm.sql(`ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);
    // server.js line 2963
    pgm.sql(`ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS options JSONB`);
    // server.js line 2964
    pgm.sql(`ALTER TABLE custom_fields ADD COLUMN IF NOT EXISTS required BOOLEAN DEFAULT false`);
    // server.js line 2966
    pgm.sql(`ALTER TABLE photo_galleries ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'events'`);
    // server.js line 2967
    pgm.sql(`ALTER TABLE photo_galleries ADD COLUMN IF NOT EXISTS created_by TEXT`);
    // server.js line 2968
    pgm.sql(`ALTER TABLE photo_galleries ADD COLUMN IF NOT EXISTS cover_url TEXT`);
    // server.js line 2969
    pgm.sql(`ALTER TABLE gallery_photos ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    // server.js line 2970
    pgm.sql(`ALTER TABLE gallery_photos ADD COLUMN IF NOT EXISTS caption TEXT`);
    // server.js line 2971
    pgm.sql(`ALTER TABLE gallery_photos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 2975
    pgm.sql(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_type TEXT`);
    // server.js line 2976
    pgm.sql(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by TEXT`);
    // server.js line 2978
    pgm.sql(`CREATE TABLE IF NOT EXISTS fee_reminder_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER UNIQUE, auto_notify BOOLEAN DEFAULT false, frequency TEXT DEFAULT 'weekly', days_before INTEGER DEFAULT 7, enabled_channels TEXT[] DEFAULT '{sms,email}', last_run TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2979
    pgm.sql(`ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS trigger_type TEXT`);
    // server.js line 2980
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('auto_fee_reminders', 'Automated Fee Reminders', 'Hourly auto SMS/email reminders for outstanding fees', '3.0', 'core', 'Worker process running', true) ON CONFLICT DO NOTHING`);
    // server.js line 2982
    pgm.sql(`ALTER TABLE notifications RENAME COLUMN read TO is_read`);
    // server.js line 2983
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active, min_plan) VALUES ('notification_center', 'Notification Center', 'In-app notification bell with history, mark-read, and preferences', '11.0', 'core', 'None', true, 'free') ON CONFLICT DO NOTHING`);
    // server.js line 2985
    pgm.sql(`CREATE TABLE IF NOT EXISTS document_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, template_type TEXT DEFAULT 'receipt', header_text TEXT, footer_text TEXT, logo_url TEXT, background_color TEXT DEFAULT '#ffffff', text_color TEXT DEFAULT '#1e293b', show_logo BOOLEAN DEFAULT true, show_stamp BOOLEAN DEFAULT false, stamp_text TEXT, auto_number_prefix TEXT, next_number INTEGER DEFAULT 1, is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 2986
    pgm.sql(`CREATE TABLE IF NOT EXISTS generated_documents (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, template_id INTEGER REFERENCES document_templates(id) ON DELETE SET NULL, doc_number TEXT, doc_type TEXT, title TEXT, content JSONB, recipient_name TEXT, recipient_email TEXT, amount NUMERIC DEFAULT 0, status TEXT DEFAULT 'draft', generated_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 3036
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_appointment_reminders_tenant ON appointment_reminders(tenant_id)`);
    // server.js line 3037
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_appointment_reminders_appt ON appointment_reminders(appointment_id)`);
    // server.js line 3038
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_tenant ON payment_transactions(tenant_id)`);
    // server.js line 3039
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice ON payment_transactions(invoice_id)`);
    // server.js line 3040
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status)`);
    // server.js line 3041
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('appointment_reminders', 'SMS/WhatsApp Appointment Reminders', 'Automated and manual appointment reminders via SMS and WhatsApp', '16.0', 'core', 'SMS gateway configured', true) ON CONFLICT DO NOTHING`);
    // server.js line 3042
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ('payment_collection', 'Payment Collection for Consultations & Pharmacy', 'Collect payments via MTN MoMo, Airtel Money, and Flutterwave', '16.0', 'enterprise', 'Flutterwave API keys', true) ON CONFLICT DO NOTHING`);
    // server.js line 3100
    pgm.sql(`ALTER TABLE \${uc.table} ADD CONSTRAINT \${uc.constraint} UNIQUE (\${uc.columns})`);
    // server.js line 3242
    pgm.sql(`INSERT INTO tenants(name,type,email,verified,approved,subdomain) VALUES('Dev Master','individual',$1,true,true,'dev-master') ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
    // server.js line 3245
    pgm.sql(`INSERT INTO users(tenant_id,email,password,password_hash,role,approved) VALUES($1,$2,$3,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password,password_hash=EXCLUDED.password,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`);
    // server.js line 3248
    pgm.sql(`INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`);
    // server.js line 3250
    pgm.sql(`INSERT INTO users(tenant_id,email,password_hash,role,approved) VALUES($1,$2,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`);
    // server.js line 3268
    pgm.sql(`INSERT INTO tenants(name,type,email,verified,approved,subdomain) VALUES('Comfort Zone','school',$1,true,true,'comfort-zone') ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
    // server.js line 9752
    pgm.sql(`INSERT INTO \${table}(\${cols.join(',')}) VALUES(\${placeholders}) ON CONFLICT DO NOTHING`);
    // server.js line 16038
    pgm.sql(`INSERT INTO fee_reminder_settings(tenant_id, auto_notify, frequency, days_before, enabled_channels, updated_at) VALUES($1, $2, $3, $4, $5, NOW()) ON CONFLICT (tenant_id) DO UPDATE SET auto_notify = $2, frequency = $3, days_before = $4, enabled_channels = $5, updated_at = NOW()`);
    // server.js line 22745
    pgm.sql(`INSERT INTO org_health_scores(tenant_id,score,member_health,finance_health,task_health,event_health,computed_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (tenant_id) DO UPDATE SET score=$2,member_health=$3,finance_health=$4,task_health=$5,event_health=$6,computed_at=NOW()`);
    // server.js line 24671
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_portal_sessions (id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, token TEXT, device TEXT, last_active TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24672
    pgm.sql(`CREATE TABLE IF NOT EXISTS admissions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, applicant_name TEXT NOT NULL, email TEXT, phone TEXT, dob DATE, gender TEXT, applied_level TEXT, applied_class TEXT, previous_school TEXT, guardian_name TEXT, guardian_phone TEXT, documents JSONB, status TEXT DEFAULT 'applied', reviewed_by TEXT, review_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24673
    pgm.sql(`CREATE TABLE IF NOT EXISTS graduations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, academic_year TEXT, term TEXT, level TEXT, class_name TEXT, student_count INTEGER DEFAULT 0, graduation_date DATE, venue TEXT, notes TEXT, status TEXT DEFAULT 'planned', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24674
    pgm.sql(`CREATE TABLE IF NOT EXISTS graduation_students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, graduation_id INTEGER REFERENCES graduations(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, honors TEXT, gpa NUMERIC, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(graduation_id, student_id))`);
    // server.js line 24675
    pgm.sql(`CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, code TEXT, category TEXT, education_level TEXT, is_compulsory BOOLEAN DEFAULT true, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24676
    pgm.sql(`CREATE TABLE IF NOT EXISTS class_subjects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, class_name TEXT NOT NULL, subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE, teacher_id INTEGER REFERENCES staff(id), education_level TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24677
    pgm.sql(`CREATE TABLE IF NOT EXISTS exam_seating (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, exam_id INTEGER REFERENCES exams(id), subject TEXT, room TEXT, seat_start INTEGER, seat_end INTEGER, capacity INTEGER DEFAULT 30, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24678
    pgm.sql(`CREATE TABLE IF NOT EXISTS ptc_bookings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, teacher_id INTEGER REFERENCES staff(id), parent_email TEXT NOT NULL, student_id INTEGER REFERENCES students(id), slot_date DATE, slot_time TEXT, duration INTEGER DEFAULT 15, status TEXT DEFAULT 'booked', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24679
    pgm.sql(`CREATE TABLE IF NOT EXISTS ptc_slots (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, teacher_id INTEGER REFERENCES staff(id), date DATE, start_time TEXT, end_time TEXT, slot_duration INTEGER DEFAULT 15, is_available BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24680
    pgm.sql(`CREATE TABLE IF NOT EXISTS lesson_plans (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, subject TEXT NOT NULL, class_name TEXT, topic TEXT NOT NULL, objectives TEXT, materials TEXT, activities TEXT, assessment TEXT, notes TEXT, teacher TEXT, week TEXT, term TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24681
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_id_cards (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, card_number TEXT UNIQUE, issue_date DATE DEFAULT CURRENT_DATE, expiry_date DATE, photo_url TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24682
    pgm.sql(`CREATE TABLE IF NOT EXISTS visitors (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, id_number TEXT, phone TEXT, purpose TEXT, person_to_see TEXT, vehicle_plate TEXT, check_in TIMESTAMPTZ DEFAULT NOW(), check_out TIMESTAMPTZ, status TEXT DEFAULT 'checked_in', gate_pass_code TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24683
    pgm.sql(`CREATE TABLE IF NOT EXISTS gate_passes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), reason TEXT, destination TEXT, authorized_by TEXT, pass_date DATE DEFAULT CURRENT_DATE, return_date DATE, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24684
    pgm.sql(`CREATE TABLE IF NOT EXISTS school_shop_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, category TEXT, price INTEGER DEFAULT 0, stock INTEGER DEFAULT 0, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24685
    pgm.sql(`CREATE TABLE IF NOT EXISTS school_shop_sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_id INTEGER REFERENCES school_shop_items(id), buyer_name TEXT, buyer_type TEXT DEFAULT 'student', quantity INTEGER DEFAULT 1, total INTEGER DEFAULT 0, sold_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24686
    pgm.sql(`CREATE TABLE IF NOT EXISTS sibling_discounts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, family_name TEXT NOT NULL, discount_percent INTEGER DEFAULT 10, student_ids INTEGER[], notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24687
    pgm.sql(`CREATE TABLE IF NOT EXISTS scholarships (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT DEFAULT 'merit', coverage_percent INTEGER DEFAULT 100, student_id INTEGER REFERENCES students(id), criteria TEXT, awarded_date DATE DEFAULT CURRENT_DATE, expiry_date DATE, sponsor TEXT, amount INTEGER DEFAULT 0, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24688
    pgm.sql(`CREATE TABLE IF NOT EXISTS staff_appraisals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE, period TEXT, criteria JSONB, scores JSONB, total_score NUMERIC DEFAULT 0, comments TEXT, appraiser TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24689
    pgm.sql(`CREATE TABLE IF NOT EXISTS maintenance_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, location TEXT, priority TEXT DEFAULT 'medium', description TEXT, reported_by TEXT, assigned_to TEXT, status TEXT DEFAULT 'reported', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24690
    pgm.sql(`CREATE TABLE IF NOT EXISTS lost_found (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_name TEXT NOT NULL, description TEXT, location TEXT, date_found DATE DEFAULT CURRENT_DATE, found_by TEXT, claimed_by TEXT, claim_date DATE, status TEXT DEFAULT 'unclaimed', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24691
    pgm.sql(`CREATE TABLE IF NOT EXISTS photo_galleries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_date DATE, cover_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24692
    pgm.sql(`CREATE TABLE IF NOT EXISTS gallery_photos (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, gallery_id INTEGER REFERENCES photo_galleries(id) ON DELETE CASCADE, url TEXT NOT NULL, caption TEXT, uploaded_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24693
    pgm.sql(`CREATE TABLE IF NOT EXISTS newsletters (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, recipients TEXT, status TEXT DEFAULT 'draft', sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24694
    pgm.sql(`CREATE TABLE IF NOT EXISTS rubrics (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, subject TEXT, education_level TEXT, criteria JSONB, max_score INTEGER DEFAULT 100, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24695
    pgm.sql(`CREATE TABLE IF NOT EXISTS competency_assessments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), subject TEXT, competency TEXT, level TEXT DEFAULT 'developing', assessed_by TEXT, assessed_date DATE DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24696
    pgm.sql(`CREATE TABLE IF NOT EXISTS curriculum_maps (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, subject TEXT NOT NULL, level TEXT, objectives JSONB, topics JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24697
    pgm.sql(`CREATE TABLE IF NOT EXISTS welfare_records (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id), type TEXT DEFAULT 'benevolence', amount INTEGER DEFAULT 0, description TEXT, date DATE DEFAULT CURRENT_DATE, approved_by TEXT, status TEXT DEFAULT 'approved', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24698
    pgm.sql(`CREATE TABLE IF NOT EXISTS building_funds (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, target INTEGER DEFAULT 0, raised INTEGER DEFAULT 0, start_date DATE, end_date DATE, milestones JSONB, description TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24699
    pgm.sql(`CREATE TABLE IF NOT EXISTS building_fund_contributions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, fund_id INTEGER REFERENCES building_funds(id) ON DELETE CASCADE, donor_name TEXT, amount INTEGER DEFAULT 0, method TEXT, date DATE DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24700
    pgm.sql(`CREATE TABLE IF NOT EXISTS membership_transfers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id), from_church TEXT, to_church TEXT, reason TEXT, letter_url TEXT, status TEXT DEFAULT 'pending', approved_by TEXT, transfer_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24701
    pgm.sql(`CREATE TABLE IF NOT EXISTS balance_sheets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, period TEXT NOT NULL, as_of_date DATE DEFAULT CURRENT_DATE, assets_total INTEGER DEFAULT 0, liabilities_total INTEGER DEFAULT 0, equity_total INTEGER DEFAULT 0, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24702
    pgm.sql(`CREATE TABLE IF NOT EXISTS committees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, purpose TEXT, chairperson TEXT, secretary TEXT, members JSONB, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24703
    pgm.sql(`CREATE TABLE IF NOT EXISTS committee_meetings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, committee_id INTEGER REFERENCES committees(id) ON DELETE CASCADE, title TEXT, meeting_date DATE, agenda TEXT, minutes TEXT, attendees JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24704
    pgm.sql(`CREATE TABLE IF NOT EXISTS policy_documents (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, content TEXT, version INTEGER DEFAULT 1, effective_date DATE, review_date DATE, approved_by TEXT, status TEXT DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24705
    pgm.sql(`CREATE TABLE IF NOT EXISTS policy_acknowledgments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, policy_id INTEGER REFERENCES policy_documents(id) ON DELETE CASCADE, user_email TEXT, acknowledged_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(policy_id, user_email))`);
    // server.js line 24706
    pgm.sql(`CREATE TABLE IF NOT EXISTS forum_topics (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, author_email TEXT, content TEXT, pinned BOOLEAN DEFAULT false, locked BOOLEAN DEFAULT false, views INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24707
    pgm.sql(`CREATE TABLE IF NOT EXISTS forum_replies (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, topic_id INTEGER REFERENCES forum_topics(id) ON DELETE CASCADE, author_email TEXT, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24708
    pgm.sql(`CREATE TABLE IF NOT EXISTS suggestions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, type TEXT DEFAULT 'suggestion', title TEXT NOT NULL, description TEXT, submitted_by TEXT, is_anonymous BOOLEAN DEFAULT false, priority TEXT DEFAULT 'medium', assigned_to TEXT, response TEXT, status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24709
    pgm.sql(`CREATE TABLE IF NOT EXISTS login_history (id SERIAL PRIMARY KEY, user_email TEXT, ip_address TEXT, user_agent TEXT, success BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24710
    pgm.sql(`CREATE TABLE IF NOT EXISTS requisitions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, items JSONB, total_estimate INTEGER DEFAULT 0, requested_by TEXT, department TEXT, priority TEXT DEFAULT 'normal', approved_by TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24711
    pgm.sql(`CREATE TABLE IF NOT EXISTS sponsorships (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, partner_id INTEGER REFERENCES partners(id), student_id INTEGER REFERENCES students(id), amount INTEGER DEFAULT 0, frequency TEXT DEFAULT 'one_time', start_date DATE, end_date DATE, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24712
    pgm.sql(`CREATE TABLE IF NOT EXISTS journal_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, date DATE DEFAULT CURRENT_DATE, description TEXT, reference TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24713
    pgm.sql(`CREATE TABLE IF NOT EXISTS livestream_links (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service_name TEXT, platform TEXT, url TEXT NOT NULL, scheduled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24714
    pgm.sql(`CREATE TABLE IF NOT EXISTS meeting_agendas (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, meeting_id INTEGER REFERENCES meeting_minutes(id) ON DELETE CASCADE, item_text TEXT NOT NULL, order_no INTEGER DEFAULT 1, completed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24715
    pgm.sql(`CREATE TABLE IF NOT EXISTS incidents (id SERIAL PRIMARY KEY, service TEXT, title TEXT NOT NULL, status TEXT DEFAULT 'investigating', created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ)`);
    // server.js line 24716
    pgm.sql(`CREATE TABLE IF NOT EXISTS quotations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, quote_no TEXT, customer_name TEXT, customer_contact TEXT, items JSONB, total INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', valid_until DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24717
    pgm.sql(`CREATE TABLE IF NOT EXISTS deliveries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, order_no TEXT, customer_name TEXT, customer_address TEXT, items JSONB, driver_name TEXT, vehicle TEXT, status TEXT DEFAULT 'pending', dispatched_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24718
    pgm.sql(`CREATE TABLE IF NOT EXISTS public_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, slug TEXT NOT NULL, page_type TEXT DEFAULT 'page', page_order INTEGER DEFAULT 1, content TEXT, hero_title TEXT, hero_subtitle TEXT, meta_description TEXT, is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, slug))`);
    // server.js line 24719
    pgm.sql(`CREATE TABLE IF NOT EXISTS fundraising_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, deadline DATE, category TEXT DEFAULT 'general', organizer TEXT, contact_phone TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24720
    pgm.sql(`CREATE TABLE IF NOT EXISTS campaign_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, donor_name TEXT, amount INTEGER DEFAULT 0, method TEXT DEFAULT 'cash', message TEXT, donated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24721
    pgm.sql(`CREATE TABLE IF NOT EXISTS scraped_content (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, source TEXT, title TEXT, summary TEXT, url TEXT, category TEXT DEFAULT 'news', scraped_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, title, source))`);
    // server.js line 24722
    pgm.sql(`CREATE TABLE IF NOT EXISTS scrape_sources (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, category TEXT DEFAULT 'news', scrape_type TEXT DEFAULT 'rss', selector TEXT, max_items INTEGER DEFAULT 20, is_active BOOLEAN DEFAULT true, last_scraped_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24723
    pgm.sql(`CREATE TABLE IF NOT EXISTS shop_orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, order_no TEXT NOT NULL, buyer_email TEXT, buyer_name TEXT, buyer_phone TEXT, items JSONB NOT NULL, total INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', payment_method TEXT, payment_ref TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(order_no))`);
    // server.js line 24724
    pgm.sql(`CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, donor_email TEXT, donor_phone TEXT, amount INTEGER NOT NULL, currency TEXT DEFAULT 'UGX', schedule TEXT DEFAULT 'monthly', next_date DATE, last_processed DATE, campaign_id INTEGER REFERENCES fundraising_campaigns(id), payment_method TEXT, status TEXT DEFAULT 'active', total_donated INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24725
    pgm.sql(`CREATE TABLE IF NOT EXISTS fundraising_investors (id SERIAL PRIMARY KEY, user_email TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, phone TEXT, organization TEXT, investor_type TEXT DEFAULT 'individual' CHECK (investor_type IN ('individual','corporate','ngo','foundation','angel','venture')), interests TEXT[] DEFAULT '{}', total_invested INTEGER DEFAULT 0, campaigns_supported INTEGER DEFAULT 0, is_verified BOOLEAN DEFAULT false, bio TEXT, website TEXT, profile_image TEXT, preferred_categories TEXT[] DEFAULT '{}', min_investment INTEGER DEFAULT 0, max_investment INTEGER DEFAULT 0, preferred_currency TEXT DEFAULT 'UGX', notification_prefs JSONB DEFAULT '{"email":true,"in_app":true,"sms":false}', created_at TIMESTAMPTZ DEFAULT NOW(), last_active TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24726
    pgm.sql(`CREATE TABLE IF NOT EXISTS investor_offers (id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, investor_email TEXT REFERENCES fundraising_investors(user_email) ON DELETE CASCADE, amount_offered INTEGER NOT NULL, offer_status TEXT DEFAULT 'pending' CHECK (offer_status IN ('pending','accepted','countered','declined','withdrawn')), message TEXT, counter_amount INTEGER, terms TEXT, offered_at TIMESTAMPTZ DEFAULT NOW(), responded_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24727
    pgm.sql(`CREATE TABLE IF NOT EXISTS investment_transactions (id SERIAL PRIMARY KEY, offer_id INTEGER REFERENCES investor_offers(id) ON DELETE CASCADE, investor_email TEXT REFERENCES fundraising_investors(user_email), campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, amount INTEGER NOT NULL, transaction_type TEXT DEFAULT 'donation' CHECK (transaction_type IN ('donation','investment','grant','loan','pledge_payment')), payment_method TEXT DEFAULT 'mobile_money', payment_ref TEXT, status TEXT DEFAULT 'completed' CHECK (status IN ('completed','pending','failed','refunded')), platform_fee INTEGER DEFAULT 0, net_amount INTEGER DEFAULT 0, currency TEXT DEFAULT 'UGX', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24728
    pgm.sql(`CREATE TABLE IF NOT EXISTS campaign_updates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, update_type TEXT DEFAULT 'general' CHECK (update_type IN ('general','milestone','urgent','financial','thank_you','media')), is_public BOOLEAN DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 24729
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true`);
    // server.js line 24730
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS image_url TEXT`);
    // server.js line 24731
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS video_url TEXT`);
    // server.js line 24732
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS location TEXT`);
    // server.js line 24733
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS investment_tiers JSONB DEFAULT '[]'`);
    // server.js line 24734
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS min_investment INTEGER DEFAULT 0`);
    // server.js line 24735
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`);
    // server.js line 24736
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS urgency_level TEXT DEFAULT 'normal' CHECK (urgency_level IN ('low','normal','high','urgent','critical'))`);
    // server.js line 24737
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false`);
    // server.js line 24738
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS views_count INTEGER DEFAULT 0`);
    // server.js line 24739
    pgm.sql(`ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS investor_count INTEGER DEFAULT 0`);
    // server.js line 24740
    pgm.sql(`ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 24741
    pgm.sql(`ALTER TABLE campaign_pledges ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 24742
    pgm.sql(`ALTER TABLE peer_fundraisers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 24743
    pgm.sql(`ALTER TABLE campaign_updates ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 24744
    pgm.sql(`ALTER TABLE investor_offers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 24745
    pgm.sql(`ALTER TABLE investment_transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    // server.js line 24746
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_campaign_donations_campaign ON campaign_donations(campaign_id)`);
    // server.js line 24747
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_campaign_donations_tenant ON campaign_donations(tenant_id)`);
    // server.js line 24748
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_campaign_pledges_tenant ON campaign_pledges(tenant_id)`);
    // server.js line 24749
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_investor_offers_campaign ON investor_offers(campaign_id)`);
    // server.js line 24750
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_investor_offers_tenant ON investor_offers(tenant_id)`);
    // server.js line 24751
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_investment_transactions_tenant ON investment_transactions(tenant_id)`);
    // server.js line 24752
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_campaign_updates_tenant ON campaign_updates(tenant_id)`);
    // server.js line 24759
    pgm.sql(`ALTER TABLE public_pages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 24760
    pgm.sql(`ALTER TABLE school_shop_items ADD COLUMN IF NOT EXISTS image_url TEXT`);
    // server.js line 24761
    pgm.sql(`ALTER TABLE school_shop_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    // server.js line 24762
    pgm.sql(`ALTER TABLE school_shop_items ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'each'`);
    // server.js line 24777
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_dashboard_workers_tenant ON dashboard_workers(tenant_id)`);
    // server.js line 24829
    pgm.sql(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`);
    // server.js line 32383
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_allergies (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, allergen TEXT NOT NULL, reaction TEXT, severity TEXT DEFAULT 'moderate', onset_date DATE, verified_by TEXT, notes TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32385
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_chronic_conditions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, condition_name TEXT NOT NULL, icd_code TEXT, diagnosed_date DATE, treating_doctor TEXT, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32387
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_vitals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, visit_id INTEGER, temperature NUMERIC, blood_pressure_systolic INTEGER, blood_pressure_diastolic INTEGER, heart_rate INTEGER, respiratory_rate INTEGER, weight NUMERIC, height NUMERIC, bmi NUMERIC, oxygen_saturation INTEGER, pain_level INTEGER DEFAULT 0, recorded_by TEXT, notes TEXT, recorded_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32389
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_immunizations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, vaccine_name TEXT NOT NULL, dose_number INTEGER DEFAULT 1, administered_date DATE, administered_by TEXT, batch_number TEXT, next_dose_date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32391
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_medications (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, medication_name TEXT NOT NULL, dosage TEXT, frequency TEXT, start_date DATE, end_date DATE, prescribed_by TEXT, reason TEXT, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32393
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, invoice_number TEXT NOT NULL, total_amount INTEGER DEFAULT 0, paid_amount INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, insurance_cover INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', due_date DATE, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32395
    pgm.sql(`CREATE TABLE IF NOT EXISTS invoice_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, invoice_id INTEGER REFERENCES patient_invoices(id) ON DELETE CASCADE, description TEXT NOT NULL, quantity INTEGER DEFAULT 1, unit_price INTEGER DEFAULT 0, total_price INTEGER DEFAULT 0, category TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32397
    pgm.sql(`CREATE TABLE IF NOT EXISTS insurance_providers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, code TEXT, type TEXT DEFAULT 'private', contact_phone TEXT, contact_email TEXT, address TEXT, coverage_percentage INTEGER DEFAULT 80, requires_preauth BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32399
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_insurance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, provider_id INTEGER REFERENCES insurance_providers(id), policy_number TEXT, member_number TEXT, group_number TEXT, effective_date DATE, expiry_date DATE, coverage_percentage INTEGER, is_primary BOOLEAN DEFAULT true, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32401
    pgm.sql(`CREATE TABLE IF NOT EXISTS insurance_claims (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, provider_id INTEGER REFERENCES insurance_providers(id), invoice_id INTEGER REFERENCES patient_invoices(id), claim_number TEXT, amount_claimed INTEGER DEFAULT 0, amount_approved INTEGER DEFAULT 0, status TEXT DEFAULT 'submitted', rejection_reason TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ, notes TEXT)`);
    // server.js line 32403
    pgm.sql(`CREATE TABLE IF NOT EXISTS drug_interactions (id SERIAL PRIMARY KEY, drug_a TEXT NOT NULL, drug_b TEXT NOT NULL, severity TEXT DEFAULT 'moderate', description TEXT, recommendation TEXT, evidence_level TEXT DEFAULT 'established', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32405
    pgm.sql(`CREATE TABLE IF NOT EXISTS tenant_country_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, country_code TEXT DEFAULT 'UG', currency TEXT DEFAULT 'UGX', timezone TEXT DEFAULT 'Africa/Kampala', language TEXT DEFAULT 'en', preferred_payment TEXT DEFAULT 'mtn_momo', flutterwave_enabled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32407
    pgm.sql(`CREATE TABLE IF NOT EXISTS stock_transfers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), product_id INTEGER, product_name TEXT NOT NULL, from_branch TEXT NOT NULL, to_branch TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT DEFAULT 'pending', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`);
    // server.js line 32409
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_appointments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), patient_name TEXT NOT NULL, patient_type TEXT DEFAULT 'patient', patient_id INTEGER, phone TEXT, appointment_date DATE NOT NULL, appointment_time TIME NOT NULL, doctor_name TEXT, reason TEXT, status TEXT DEFAULT 'scheduled', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), reminder_sent BOOLEAN DEFAULT false)`);
    // server.js line 32411
    pgm.sql(`CREATE TABLE IF NOT EXISTS discharge_summaries (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, patient_type VARCHAR(20), patient_id INTEGER, patient_name VARCHAR(255), admission_date DATE, discharge_date DATE DEFAULT CURRENT_DATE, primary_diagnosis TEXT, secondary_diagnoses TEXT[], treatments TEXT[], discharge_medications JSONB, lab_results JSONB, vitals_at_discharge JSONB, follow_up_date DATE, follow_up_instructions TEXT, discharge_condition VARCHAR(20) DEFAULT 'stable', attending_doctor VARCHAR(255), doctor_license VARCHAR(100), notes TEXT, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 32423
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_allergies_tenant ON patient_allergies(tenant_id)`);
    // server.js line 32424
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient ON patient_allergies(patient_type, patient_id)`);
    // server.js line 32425
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_chronic_tenant ON patient_chronic_conditions(tenant_id)`);
    // server.js line 32426
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_vitals_tenant ON patient_vitals(tenant_id)`);
    // server.js line 32427
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_immunizations_tenant ON patient_immunizations(tenant_id)`);
    // server.js line 32428
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_medications_tenant ON patient_medications(tenant_id)`);
    // server.js line 32429
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_invoices_tenant ON patient_invoices(tenant_id)`);
    // server.js line 32430
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)`);
    // server.js line 32431
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_insurance_providers_tenant ON insurance_providers(tenant_id)`);
    // server.js line 32432
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_insurance_tenant ON patient_insurance(tenant_id)`);
    // server.js line 32433
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_insurance_claims_tenant ON insurance_claims(tenant_id)`);
    // server.js line 32434
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_drug_interactions_drugs ON drug_interactions(drug_a, drug_b)`);
    // server.js line 32435
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_tenant_country_settings ON tenant_country_settings(tenant_id)`);
    // server.js line 32436
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_appointments_tenant ON clinic_appointments(tenant_id)`);
    // server.js line 32437
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_appointments_date ON clinic_appointments(appointment_date)`);
    // server.js line 32438
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_appointments_status ON clinic_appointments(status)`);
    // server.js line 32439
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_discharge_summaries_tenant ON discharge_summaries(tenant_id)`);
    // server.js line 32440
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_discharge_summaries_patient ON discharge_summaries(patient_type, patient_id)`);
    // server.js line 32448
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance(tenant_id)`);
    // server.js line 32450
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON subscriptions(tenant_id, status)`);
    // server.js line 32456
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sms_logs_tenant ON sms_logs(tenant_id)`);
    // server.js line 33572
    pgm.sql(`INSERT INTO discharge_summaries(tenant_id,patient_type,patient_id,patient_name,admission_date,discharge_date,primary_diagnosis,secondary_diagnoses,treatments,discharge_medications,lab_results,vitals_at_discharge,follow_up_date,follow_up_instructions,discharge_condition,attending_doctor,doctor_license,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`);
    // server.js line 35580
    pgm.sql(`CREATE TABLE IF NOT EXISTS leave_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_email VARCHAR(255) NOT NULL, leave_type VARCHAR(50) NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, days NUMERIC(5,1) NOT NULL, reason TEXT, status VARCHAR(20) NOT NULL DEFAULT 'pending', approver_email VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // server.js line 35581
    pgm.sql(`CREATE TABLE IF NOT EXISTS expense_claims (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_email VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, amount NUMERIC(12,2) NOT NULL, category VARCHAR(100) NOT NULL, description TEXT, receipt_url VARCHAR(500), status VARCHAR(20) NOT NULL DEFAULT 'pending', approver_email VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // server.js line 35582
    pgm.sql(`CREATE TABLE IF NOT EXISTS visitors (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name VARCHAR(255) NOT NULL, phone VARCHAR(50), purpose TEXT NOT NULL, host_name VARCHAR(255) NOT NULL, badge_number VARCHAR(50), check_in TIMESTAMPTZ NOT NULL DEFAULT NOW(), check_out TIMESTAMPTZ, status VARCHAR(10) NOT NULL DEFAULT 'in')`);
    // server.js line 35583
    pgm.sql(`CREATE TABLE IF NOT EXISTS assets (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name VARCHAR(255) NOT NULL, category VARCHAR(100) NOT NULL, serial_number VARCHAR(255), location VARCHAR(255), status VARCHAR(20) NOT NULL DEFAULT 'available', assigned_to VARCHAR(255), purchase_date DATE, purchase_price NUMERIC(12,2), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // server.js line 35584
    pgm.sql(`CREATE TABLE IF NOT EXISTS feedback_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_email VARCHAR(255) NOT NULL, category VARCHAR(100) NOT NULL, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), subject VARCHAR(255) NOT NULL, message TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'open', response TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // server.js line 35585
    pgm.sql(`CREATE TABLE IF NOT EXISTS user_notes (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_email VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT, priority VARCHAR(10) NOT NULL DEFAULT 'medium', is_done BOOLEAN NOT NULL DEFAULT FALSE, due_date DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // server.js line 35586
    pgm.sql(`CREATE TABLE IF NOT EXISTS announcements (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_email VARCHAR(255) NOT NULL, title VARCHAR(255) NOT NULL, content TEXT NOT NULL, priority VARCHAR(20) NOT NULL DEFAULT 'normal', target_audience VARCHAR(20) NOT NULL DEFAULT 'all', pinned BOOLEAN NOT NULL DEFAULT FALSE, expires_at DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    // server.js line 36793
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_sickbays_tenant ON clinic_sickbays(tenant_id)`);
    // server.js line 36794
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_sickbay_visits_tenant ON clinic_sickbay_visits(tenant_id)`);
    // server.js line 36795
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_clinic_sickbay_visits_date ON clinic_sickbay_visits(visit_date)`);
    // server.js line 36808
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sickbay_units_tenant ON sickbay_units(tenant_id)`);
    // server.js line 36809
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sickbay_visits_tenant ON sickbay_visits(tenant_id)`);
    // server.js line 36815
    pgm.sql(`CREATE TABLE IF NOT EXISTS inventory_categories (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, name))`);
    // server.js line 36816
    pgm.sql(`CREATE TABLE IF NOT EXISTS inventory_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category_id INTEGER REFERENCES inventory_categories(id) ON DELETE SET NULL, sku TEXT, name TEXT NOT NULL, description TEXT, unit TEXT DEFAULT 'pcs', cost_price NUMERIC DEFAULT 0, selling_price NUMERIC DEFAULT 0, current_stock NUMERIC DEFAULT 0, min_stock_level NUMERIC DEFAULT 5, max_stock_level NUMERIC DEFAULT 1000, location TEXT, supplier TEXT, image_url TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36817
    pgm.sql(`CREATE TABLE IF NOT EXISTS inventory_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_id INTEGER REFERENCES inventory_items(id) ON DELETE CASCADE, transaction_type TEXT NOT NULL, quantity NUMERIC NOT NULL, unit_cost NUMERIC DEFAULT 0, reference TEXT, notes TEXT, performed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36818
    pgm.sql(`CREATE TABLE IF NOT EXISTS inventory_suppliers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, contact_person TEXT, email TEXT, phone TEXT, address TEXT, notes TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36819
    pgm.sql(`CREATE TABLE IF NOT EXISTS purchase_orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, supplier_id INTEGER REFERENCES inventory_suppliers(id) ON DELETE SET NULL, po_number TEXT UNIQUE, status TEXT DEFAULT 'pending', expected_date DATE, notes TEXT, total_amount NUMERIC DEFAULT 0, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36820
    pgm.sql(`CREATE TABLE IF NOT EXISTS purchase_order_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE, item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL, item_name TEXT, quantity NUMERIC DEFAULT 0, unit_cost NUMERIC DEFAULT 0, received_qty NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36821
    pgm.sql(`CREATE TABLE IF NOT EXISTS stock_adjustments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_id INTEGER REFERENCES inventory_items(id) ON DELETE CASCADE, adjustment_type TEXT NOT NULL, quantity NUMERIC NOT NULL, reason TEXT, performed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36826
    pgm.sql(`CREATE TABLE IF NOT EXISTS parent_accounts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, parent_name TEXT NOT NULL, parent_email TEXT UNIQUE, parent_phone TEXT, relation TEXT DEFAULT 'parent', access_code TEXT UNIQUE, is_active BOOLEAN DEFAULT true, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36827
    pgm.sql(`CREATE TABLE IF NOT EXISTS parent_login_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, parent_id INTEGER REFERENCES parent_accounts(id) ON DELETE CASCADE, ip_address TEXT, user_agent TEXT, logged_in_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 36828
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_portal_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, portal_enabled BOOLEAN DEFAULT true, allow_grade_view BOOLEAN DEFAULT true, allow_attendance_view BOOLEAN DEFAULT true, allow_fees_view BOOLEAN DEFAULT true, allow_report_download BOOLEAN DEFAULT true, allow_communication BOOLEAN DEFAULT true, welcome_message TEXT DEFAULT 'Welcome to the Student Portal')`);
    // server.js line 36829
    pgm.sql(`CREATE TABLE IF NOT EXISTS parent_messages (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, parent_id INTEGER REFERENCES parent_accounts(id) ON DELETE CASCADE, subject TEXT NOT NULL, message TEXT NOT NULL, from_parent BOOLEAN DEFAULT true, is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 37306
    pgm.sql(`INSERT INTO tenants (name, type, email, verified, approved, subdomain, has_fundraising) VALUES ($1,$2,$3,true,true,$4,true) RETURNING id`);
    // server.js line 37307
    pgm.sql(`INSERT INTO subscriptions (tenant_id, plan, status) VALUES ($1,'enterprise','active') ON CONFLICT DO NOTHING`);
    // server.js line 37363
    pgm.sql(`INSERT INTO tenants (name, type, email, verified, approved, subdomain, has_fundraising) VALUES ($1, $2, $3, true, true, $4, true) RETURNING id, name, type`);
    // server.js line 37366
    pgm.sql(`INSERT INTO subscriptions (tenant_id, plan, status) VALUES ($1, 'enterprise', 'active')`);
    // server.js line 37707
    pgm.sql(`INSERT INTO inventory_items(tenant_id,category_id,sku,name,description,unit,cost_price,selling_price,current_stock,min_stock_level,max_stock_level,location,supplier) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`);
    // server.js line 39563
    pgm.sql(`INSERT INTO quizzes (tenant_id,title,description,subject,class_name,duration_minutes,passing_score,randomize_questions,show_results,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`);
    // server.js line 39618
    pgm.sql(`INSERT INTO quiz_questions (quiz_id,question_text,question_type,options,correct_answer,points,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`);
    // server.js line 39710
    pgm.sql(`INSERT INTO quiz_attempts (tenant_id,quiz_id,student_email,student_name,answers,score,total_points,passed,submitted_at,time_spent_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)`);
    // server.js line 39843
    pgm.sql(`INSERT INTO whatsapp_messages (tenant_id,direction,recipient,recipient_name,template_name,message_text,status) VALUES ($1,'outbound',$2,$3,$4,$5,'sent')`);
    // server.js line 39856
    pgm.sql(`INSERT INTO whatsapp_messages (tenant_id,direction,recipient,template_name,message_text,status) VALUES ($1,'outbound',$2,$3,$4,'sent')`);
    // server.js line 39978
    pgm.sql(`INSERT INTO scheduled_reports (tenant_id,name,report_type,frequency,recipients,next_run,is_active) VALUES ($1,$2,$3,$4,$5,NOW() + interval '\${interval}',true)`);
    // server.js line 40031
    pgm.sql(`INSERT INTO report_history (tenant_id,scheduled_report_id,report_type,recipients,status) VALUES ($1,$2,$3,$4,'sent')`);
    // server.js line 40034
    pgm.sql(`INSERT INTO report_history (tenant_id,scheduled_report_id,report_type,recipients,status,error_message) VALUES ($1,$2,$3,$4,'failed',$5)`);
    // server.js line 40099
    pgm.sql(`INSERT INTO branches (tenant_id,name,code,location,manager_name,manager_email,phone,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`);
    // server.js line 40133
    pgm.sql(`INSERT INTO branch_transfers (tenant_id,from_branch_id,to_branch_id,item_type,item_id,quantity,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`);
    // server.js line 40289
    pgm.sql(`INSERT INTO clinic_patients (tenant_id,patient_id,full_name,date_of_birth,gender,phone,address,blood_type,allergies,emergency_contact,emergency_phone,insurance_provider,insurance_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`);
    // server.js line 40391
    pgm.sql(`INSERT INTO clinic_appointments (tenant_id,patient_id,appointment_date,appointment_time,doctor_name,department,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`);
    // server.js line 40474
    pgm.sql(`INSERT INTO clinic_consultations (tenant_id,patient_id,appointment_id,doctor_name,chief_complaint,history,examination,diagnosis,weight,temperature,blood_pressure,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`);
    // server.js line 40505
    pgm.sql(`INSERT INTO clinic_prescriptions (tenant_id,consultation_id,patient_id,prescribed_by,notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`);
    // server.js line 40515
    pgm.sql(`INSERT INTO clinic_prescription_items (prescription_id,medication_name,dosage,frequency,duration,instructions) VALUES ($1,$2,$3,$4,$5,$6)`);
    // server.js line 40674
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_webhook_del_next ON webhook_deliveries(next_retry) WHERE status='failed'`);
    // server.js line 40686
    pgm.sql(`CREATE TABLE IF NOT EXISTS calendar_events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_type TEXT DEFAULT 'event', start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ, all_day BOOLEAN DEFAULT false, location TEXT, color TEXT DEFAULT '#6366f1', max_attendees INTEGER DEFAULT 0, is_recurring BOOLEAN DEFAULT false, recurring_pattern TEXT, recurring_end_date DATE, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40687
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_attendees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE, attendee_name TEXT NOT NULL, attendee_email TEXT, attendee_phone TEXT, status TEXT DEFAULT 'confirmed', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, event_id, attendee_email))`);
    // server.js line 40688
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_bookings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE, booker_name TEXT NOT NULL, booker_email TEXT, booker_phone TEXT, tickets INTEGER DEFAULT 1, amount NUMERIC DEFAULT 0, payment_status TEXT DEFAULT 'pending', reference TEXT, booked_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40689
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES calendar_events(id) ON DELETE CASCADE, reminder_time TIMESTAMPTZ, sent BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40704
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS name TEXT`);
    // server.js line 40705
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT DEFAULT 'sms'`);
    // server.js line 40706
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS subject TEXT`);
    // server.js line 40707
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS message TEXT`);
    // server.js line 40708
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS target_group TEXT`);
    // server.js line 40709
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS recipient_count INTEGER DEFAULT 0`);
    // server.js line 40710
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0`);
    // server.js line 40711
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0`);
    // server.js line 40712
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`);
    // server.js line 40713
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
    // server.js line 40714
    pgm.sql(`ALTER TABLE sms_campaigns ADD COLUMN IF NOT EXISTS created_by TEXT`);
    // server.js line 40715
    pgm.sql(`CREATE TABLE IF NOT EXISTS sms_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, campaign_type TEXT DEFAULT 'sms', subject TEXT, message TEXT NOT NULL, target_group TEXT, status TEXT DEFAULT 'draft', recipient_count INTEGER DEFAULT 0, sent_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40716
    pgm.sql(`ALTER TABLE campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_campaign_id_fkey`);
    // server.js line 40717
    pgm.sql(`CREATE TABLE IF NOT EXISTS campaign_recipients (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES sms_campaigns(id) ON DELETE CASCADE, recipient_name TEXT, recipient_phone TEXT, recipient_email TEXT, status TEXT DEFAULT 'pending', sent_at TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40718
    pgm.sql(`CREATE TABLE IF NOT EXISTS qr_checkins (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, person_name TEXT NOT NULL, person_id INTEGER, person_type TEXT, qr_code TEXT UNIQUE, checked_in_at TIMESTAMPTZ DEFAULT NOW(), checked_out_at TIMESTAMPTZ, location TEXT, device_info TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40719
    pgm.sql(`CREATE TABLE IF NOT EXISTS chart_of_accounts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, account_code TEXT UNIQUE, account_name TEXT NOT NULL, account_type TEXT DEFAULT 'asset', description TEXT, parent_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL, balance NUMERIC DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40720
    pgm.sql(`CREATE TABLE IF NOT EXISTS journal_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, entry_date DATE DEFAULT CURRENT_DATE, description TEXT, account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL, debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, reference TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 40721
    pgm.sql(`CREATE TABLE IF NOT EXISTS staff_appraisals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, staff_id INTEGER, staff_name TEXT NOT NULL, appraisal_period TEXT NOT NULL, criteria JSONB, overall_score NUMERIC DEFAULT 0, rating TEXT DEFAULT 'satisfactory', strengths TEXT, improvements TEXT, goals TEXT, appraiser TEXT, status TEXT DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT NOW(), submitted_at TIMESTAMPTZ)`);
    // server.js line 41388
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_portal_users_tenant_phone ON patient_portal_users(tenant_id, phone)`);
    // server.js line 41389
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_sessions_token ON patient_sessions(session_token)`);
    // server.js line 41390
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_sessions_expires ON patient_sessions(expires_at)`);
    // server.js line 41391
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_prescription_refills_tenant ON prescription_refill_requests(tenant_id)`);
    // server.js line 41936
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_queue (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), patient_name TEXT, patient_id INTEGER, complaint TEXT, token_number INTEGER DEFAULT 1, status TEXT DEFAULT 'waiting', priority TEXT DEFAULT 'normal', created_at TIMESTAMP DEFAULT NOW(), started_at TIMESTAMP, completed_at TIMESTAMP, doctor_id INTEGER)`);
    // server.js line 41937
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_prescriptions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), patient_id INTEGER, patient_name TEXT, diagnosis TEXT, medications JSONB DEFAULT '[]', notes TEXT, prescribed_by TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 41938
    pgm.sql(`CREATE TABLE IF NOT EXISTS sick_bay (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), student_name TEXT, student_id INTEGER, complaint TEXT, temperature TEXT, treatment TEXT, nurse_name TEXT, checked_in TIMESTAMP DEFAULT NOW(), checked_out TIMESTAMP, status TEXT DEFAULT 'in_bay')`);
    // server.js line 41940
    pgm.sql(`CREATE TABLE IF NOT EXISTS product_reviews (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, product_id INTEGER NOT NULL, reviewer_name TEXT, rating INTEGER DEFAULT 5 CHECK (rating BETWEEN 1 AND 5), review_text TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 41941
    pgm.sql(`CREATE TABLE IF NOT EXISTS order_tracking (id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id), status TEXT DEFAULT 'placed', tracking_number TEXT, notes TEXT, updated_at TIMESTAMP DEFAULT NOW(), updated_by TEXT)`);
    // server.js line 41942
    pgm.sql(`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), name TEXT, key_hash TEXT, key_prefix TEXT(8), created_at TIMESTAMP DEFAULT NOW(), last_used TIMESTAMP, is_active BOOLEAN DEFAULT true)`);
    // server.js line 41943
    pgm.sql(`CREATE TABLE IF NOT EXISTS webhooks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), url TEXT NOT NULL, events TEXT[] DEFAULT '{}', secret TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 41944
    pgm.sql(`CREATE TABLE IF NOT EXISTS user_2fa (email TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, secret TEXT, enabled BOOLEAN DEFAULT false, backup_codes TEXT[] DEFAULT '{}')`);
    // server.js line 41945
    pgm.sql(`CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_email TEXT, action TEXT NOT NULL, details TEXT, ip_address TEXT, user_agent TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 41946
    pgm.sql(`CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id), endpoint TEXT NOT NULL, p256dh_key TEXT, auth_key TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    // server.js line 41947
    pgm.sql(`CREATE TABLE IF NOT EXISTS notification_preferences (user_email TEXT NOT NULL, tenant_id INTEGER NOT NULL REFERENCES tenants(id), email_notifs BOOLEAN DEFAULT true, sms_notifs BOOLEAN DEFAULT true, push_notifs BOOLEAN DEFAULT true, inapp_notifs BOOLEAN DEFAULT true, categories JSONB DEFAULT '{"payments":true,"assignments":true,"events":true,"announcements":true,"emergencies":true}', PRIMARY KEY (user_email, tenant_id))`);
    // server.js line 41949
    pgm.sql(`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), patient_name VARCHAR(255) NOT NULL, patient_id INTEGER, patient_type VARCHAR(20) DEFAULT 'student', referring_doctor VARCHAR(255), receiving_facility VARCHAR(255), receiving_facility_contact VARCHAR(255), referral_category VARCHAR(50) DEFAULT 'specialist', urgency VARCHAR(20) DEFAULT 'routine', reason TEXT, clinical_notes TEXT, diagnosis TEXT, status VARCHAR(20) DEFAULT 'pending', accepted_by VARCHAR(255), accepted_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 41951
    pgm.sql(`CREATE TABLE IF NOT EXISTS telehealth_consultations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), patient_name VARCHAR(255) NOT NULL, patient_id INTEGER, patient_phone VARCHAR(20), doctor_id INTEGER REFERENCES clinic_staff(id), doctor_name VARCHAR(255), scheduled_date DATE, scheduled_time TIME, duration_minutes INTEGER DEFAULT 30, meeting_link TEXT, meeting_id VARCHAR(255) UNIQUE, status VARCHAR(20) DEFAULT 'scheduled', subjective TEXT, objective TEXT, assessment TEXT, plan TEXT, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 41957
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS patient_insurance_id INTEGER REFERENCES patient_insurance(id)`);
    // server.js line 41958
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS provider_name VARCHAR(255)`);
    // server.js line 41959
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS service_type VARCHAR(100)`);
    // server.js line 41960
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS diagnosis TEXT`);
    // server.js line 41961
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS total_amount BIGINT DEFAULT 0`);
    // server.js line 41962
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS covered_amount BIGINT DEFAULT 0`);
    // server.js line 41963
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS patient_amount BIGINT DEFAULT 0`);
    // server.js line 41964
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS approved_amount BIGINT DEFAULT 0`);
    // server.js line 41965
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`);
    // server.js line 41966
    pgm.sql(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // server.js line 42002
    pgm.sql(`ALTER TABLE \${table} ENABLE ROW LEVEL SECURITY`);
    // server.js line 42356
    pgm.sql(`INSERT INTO notification_preferences (user_email,tenant_id,email_notifs,sms_notifs,push_notifs,inapp_notifs) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_email,tenant_id) DO UPDATE SET email_notifs=$3,sms_notifs=$4,push_notifs=$5,inapp_notifs=$6`);
    // server.js line 43250
    pgm.sql(`INSERT INTO sms_logs(tenant_id,phone,message,status,trigger_type) VALUES($1,$2,$3,'queued','fee_reminder_auto')`);
    // server.js line 43357
    pgm.sql(`INSERT INTO renewal_logs(subscription_id, tenant_id, attempt, status, payment_method, next_retry_at, created_at) VALUES($1,$2,$3,'in_progress',$4,$5,NOW())`);
    // server.js line 45235
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_roles_tid ON rbac_roles(tenant_id)`);
    // server.js line 45236
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_perms_tid ON rbac_permissions(tenant_id)`);
    // server.js line 45237
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_perms_cat ON rbac_permissions(tenant_id, category)`);
    // server.js line 45238
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_rp_rid ON rbac_role_permissions(role_id)`);
    // server.js line 45239
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_ur_email ON rbac_user_roles(user_email)`);
    // server.js line 45240
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_audit_tid ON rbac_permission_audit(tenant_id)`);
    // server.js line 45241
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_rbac_audit_created ON rbac_permission_audit(created_at DESC)`);
    // server.js line 45296
    pgm.sql(`INSERT INTO rbac_permissions (tenant_id,permission_key,permission_name,category,description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`);
    // server.js line 45319
    pgm.sql(`INSERT INTO rbac_roles (tenant_id,role_name,description,is_system,priority,color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`);
    // server.js line 45346
    pgm.sql(`INSERT INTO rbac_permission_audit (tenant_id,action,user_email,target_email,role_id,permission_id,details,ip_address,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`);
    // server.js line 45590
    pgm.sql(`INSERT INTO rbac_roles (tenant_id,role_name,description,priority,color) VALUES ($1,$2,$3,$4,$5) RETURNING id`);
    // server.js line 46268
    pgm.sql(`ALTER TABLE user_invitations ADD COLUMN status VARCHAR(20) DEFAULT 'pending'`);
    // server.js line 46276
    pgm.sql(`ALTER TABLE user_invitations ADD COLUMN message TEXT`);
    // server.js line 46280
    pgm.sql(`ALTER TABLE user_invitations ADD COLUMN rejected_at TIMESTAMPTZ`);
    // server.js line 46294
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email)`);
    // server.js line 46755
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_saved_filters_page ON saved_filters(tenant_id, user_id, page)`);
    // server.js line 2839
    pgm.sql(`CREATE TABLE IF NOT EXISTS educational_resources ( id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'book', subject TEXT, class_level TEXT, file_url TEXT, file_type TEXT, cover_image TEXT, source TEXT, author TEXT, is_free BOOLEAN DEFAULT true, price INTEGER DEFAULT 0, download_count INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, scraped_from TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(title, scraped_from) )`);
    // server.js line 2876
    pgm.sql(`CREATE TABLE IF NOT EXISTS dev_posts ( id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, post_type TEXT DEFAULT 'announcement', image_url TEXT, link_url TEXT, is_pinned BOOLEAN DEFAULT false, is_published BOOLEAN DEFAULT true, views INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 2889
    pgm.sql(`CREATE TABLE IF NOT EXISTS subscription_plans ( id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT, description TEXT, price INTEGER DEFAULT 0, currency TEXT DEFAULT 'UGX', billing_cycle TEXT DEFAULT 'monthly', features TEXT, max_users INTEGER DEFAULT 5, max_students INTEGER DEFAULT 100, is_active BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 2904
    pgm.sql(`CREATE TABLE IF NOT EXISTS tenant_uploads ( id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, file_name TEXT NOT NULL, file_type TEXT, file_url TEXT NOT NULL, category TEXT DEFAULT 'document', description TEXT, uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 2915
    pgm.sql(`CREATE TABLE IF NOT EXISTS homepage_sections ( id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, section_type TEXT DEFAULT 'hero', title TEXT, subtitle TEXT, content TEXT, image_url TEXT, video_url TEXT, button_text TEXT, button_link TEXT, background_color TEXT DEFAULT '#4f46e5', text_color TEXT DEFAULT 'white', sort_order INTEGER DEFAULT 0, is_visible BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 2990
    pgm.sql(`CREATE TABLE IF NOT EXISTS appointment_reminders ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), appointment_id INTEGER REFERENCES clinic_appointments(id), patient_name VARCHAR(255), phone VARCHAR(20), reminder_type VARCHAR(20) DEFAULT 'sms', message TEXT, sent_at TIMESTAMPTZ DEFAULT NOW(), status VARCHAR(20) DEFAULT 'sent' )`);
    // server.js line 3001
    pgm.sql(`CREATE TABLE IF NOT EXISTS reminder_settings ( tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id), enabled BOOLEAN DEFAULT true, hours_before INTEGER DEFAULT 24, sms_enabled BOOLEAN DEFAULT true, whatsapp_enabled BOOLEAN DEFAULT false, sms_template TEXT DEFAULT 'Reminder: You have an appointment at {facility_name} on {date} at {time} with Dr. {doctor}. Reply CANCEL to cancel.', whatsapp_template TEXT DEFAULT 'Hello {patient_name}! This is a reminder about your appointment at {facility_name} on {date} at {time} with Dr. {doctor}. Please arrive 15 minutes early.' )`);
    // server.js line 3011
    pgm.sql(`CREATE TABLE IF NOT EXISTS payment_transactions ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), invoice_id INTEGER REFERENCES patient_invoices(id), patient_name VARCHAR(255), phone VARCHAR(20), amount BIGINT NOT NULL DEFAULT 0, currency VARCHAR(10) DEFAULT 'UGX', payment_method VARCHAR(30) DEFAULT 'mobile_money', provider VARCHAR(30) DEFAULT 'flutterwave', provider_ref VARCHAR(255), status VARCHAR(20) DEFAULT 'pending', paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 3026
    pgm.sql(`CREATE TABLE IF NOT EXISTS payment_settings ( tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id), flutterwave_public_key TEXT, flutterwave_secret_key TEXT, mobile_money_enabled BOOLEAN DEFAULT true, card_enabled BOOLEAN DEFAULT true, bank_enabled BOOLEAN DEFAULT false, auto_send_receipt BOOLEAN DEFAULT true, receipt_template TEXT DEFAULT 'Thank you for your payment of {amount} UGX to {facility_name}. Invoice: {invoice_number}. Receipt ref: {ref}.' )`);
    // server.js line 11536
    pgm.sql(`CREATE TABLE IF NOT EXISTS support_requests ( id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 16494
    pgm.sql(`CREATE TABLE IF NOT EXISTS nira_verifications ( id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER, nin TEXT NOT NULL, student_name TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 24764
    pgm.sql(`CREATE TABLE IF NOT EXISTS dashboard_workers ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, username TEXT NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','content_manager','task_manager','full_worker')), is_active BOOLEAN NOT NULL DEFAULT true, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, username) )`);
    // server.js line 24778
    pgm.sql(`CREATE TABLE IF NOT EXISTS worker_audit_logs ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, worker_id INTEGER NOT NULL REFERENCES dashboard_workers(id) ON DELETE CASCADE, worker_username TEXT NOT NULL, action TEXT NOT NULL, details TEXT, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 31755
    pgm.sql(`CREATE TABLE IF NOT EXISTS student_accounts ( id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE UNIQUE, password TEXT NOT NULL, temp_password TEXT, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 32003
    pgm.sql(`CREATE TABLE IF NOT EXISTS church_accounts ( id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES church_members(id) ON DELETE CASCADE UNIQUE, password TEXT NOT NULL, temp_password TEXT, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36668
    pgm.sql(`CREATE TABLE IF NOT EXISTS quizzes ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, description TEXT, subject VARCHAR(255), class_name VARCHAR(100), duration_minutes INTEGER DEFAULT 30, passing_score INTEGER DEFAULT 50, is_published BOOLEAN DEFAULT false, randomize_questions BOOLEAN DEFAULT false, show_results BOOLEAN DEFAULT true, created_by VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36676
    pgm.sql(`CREATE TABLE IF NOT EXISTS quiz_questions ( id SERIAL PRIMARY KEY, quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, question_text TEXT NOT NULL, question_type VARCHAR(20) NOT NULL DEFAULT 'multiple_choice', options JSONB, correct_answer TEXT, points INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0 )`);
    // server.js line 36681
    pgm.sql(`CREATE TABLE IF NOT EXISTS quiz_attempts ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, quiz_id INTEGER NOT NULL REFERENCES quizzes(id), student_email VARCHAR(255) NOT NULL, student_name VARCHAR(255), answers JSONB, score NUMERIC(5,1), total_points INTEGER, passed BOOLEAN, started_at TIMESTAMPTZ DEFAULT NOW(), submitted_at TIMESTAMPTZ, time_spent_seconds INTEGER DEFAULT 0 )`);
    // server.js line 36689
    pgm.sql(`CREATE TABLE IF NOT EXISTS whatsapp_config ( id SERIAL PRIMARY KEY, tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE, phone_number_id VARCHAR(255), business_account_id VARCHAR(255), access_token TEXT, verify_token TEXT, webhook_url TEXT, is_enabled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36695
    pgm.sql(`CREATE TABLE IF NOT EXISTS whatsapp_messages ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, message_id VARCHAR(255), direction VARCHAR(10) NOT NULL DEFAULT 'outbound', recipient VARCHAR(255) NOT NULL, recipient_name VARCHAR(255), template_name VARCHAR(255), template_params JSONB, message_text TEXT, status VARCHAR(20) DEFAULT 'sent', wa_message_id VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36703
    pgm.sql(`CREATE TABLE IF NOT EXISTS whatsapp_templates ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, category VARCHAR(50) DEFAULT 'utility', template_body TEXT NOT NULL, sample_params TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36710
    pgm.sql(`CREATE TABLE IF NOT EXISTS scheduled_reports ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, report_type VARCHAR(100) NOT NULL, frequency VARCHAR(20) NOT NULL DEFAULT 'weekly', recipients TEXT NOT NULL, last_run TIMESTAMPTZ, next_run TIMESTAMPTZ, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36718
    pgm.sql(`CREATE TABLE IF NOT EXISTS report_history ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, scheduled_report_id INTEGER REFERENCES scheduled_reports(id) ON DELETE CASCADE, report_type VARCHAR(100), generated_at TIMESTAMPTZ DEFAULT NOW(), recipients TEXT, status VARCHAR(20) DEFAULT 'sent', error_message TEXT )`);
    // server.js line 36725
    pgm.sql(`CREATE TABLE IF NOT EXISTS branches ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, code VARCHAR(50), location TEXT, manager_name VARCHAR(255), manager_email VARCHAR(255), phone VARCHAR(50), is_active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36732
    pgm.sql(`CREATE TABLE IF NOT EXISTS branch_transfers ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, from_branch_id INTEGER REFERENCES branches(id), to_branch_id INTEGER REFERENCES branches(id), item_type VARCHAR(50) NOT NULL, item_id INTEGER NOT NULL, quantity INTEGER DEFAULT 1, status VARCHAR(20) DEFAULT 'pending', notes TEXT, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36740
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_patients ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, patient_id VARCHAR(50) NOT NULL UNIQUE, full_name VARCHAR(255) NOT NULL, date_of_birth DATE, gender VARCHAR(10), phone VARCHAR(50), address TEXT, blood_type VARCHAR(10), allergies TEXT, emergency_contact VARCHAR(255), emergency_phone VARCHAR(50), insurance_provider VARCHAR(255), insurance_number VARCHAR(100), created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36749
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_appointments ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, patient_id INTEGER REFERENCES clinic_patients(id) ON DELETE CASCADE, appointment_date DATE NOT NULL, appointment_time TIME, doctor_name VARCHAR(255), department VARCHAR(100), reason TEXT, status VARCHAR(20) DEFAULT 'scheduled', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36757
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_consultations ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, patient_id INTEGER REFERENCES clinic_patients(id) ON DELETE CASCADE, appointment_id INTEGER REFERENCES clinic_appointments(id), doctor_name VARCHAR(255), chief_complaint TEXT, history TEXT, examination TEXT, diagnosis TEXT, vital_signs JSONB, weight NUMERIC(5,1), temperature NUMERIC(4,1), blood_pressure VARCHAR(20), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36766
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_prescriptions ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, consultation_id INTEGER REFERENCES clinic_consultations(id) ON DELETE CASCADE, patient_id INTEGER REFERENCES clinic_patients(id) ON DELETE CASCADE, prescribed_by VARCHAR(255), status VARCHAR(20) DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36773
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_prescription_items ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, prescription_id INTEGER NOT NULL REFERENCES clinic_prescriptions(id) ON DELETE CASCADE, medication_name VARCHAR(255) NOT NULL, dosage VARCHAR(100), frequency VARCHAR(100), duration VARCHAR(100), instructions TEXT )`);
    // server.js line 36778
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_sickbays ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, sickbay_type TEXT NOT NULL DEFAULT 'general', location TEXT, capacity INTEGER DEFAULT 10, current_patients INTEGER DEFAULT 0, in_charge TEXT, phone TEXT, description TEXT, operating_hours TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36785
    pgm.sql(`CREATE TABLE IF NOT EXISTS clinic_sickbay_visits ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, sickbay_id INTEGER NOT NULL REFERENCES clinic_sickbays(id) ON DELETE CASCADE, patient_name TEXT NOT NULL, patient_type TEXT DEFAULT 'walk_in', patient_id INTEGER, complaint TEXT, diagnosis TEXT, treatment TEXT, seen_by TEXT, visit_date DATE DEFAULT CURRENT_DATE, visit_time TIME DEFAULT CURRENT_TIME, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36796
    pgm.sql(`CREATE TABLE IF NOT EXISTS sickbay_units ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, location TEXT, capacity INTEGER DEFAULT 5, in_charge TEXT, phone TEXT, description TEXT, operating_hours TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36801
    pgm.sql(`CREATE TABLE IF NOT EXISTS sickbay_visits ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, sickbay_id INTEGER REFERENCES sickbay_units(id) ON DELETE SET NULL, patient_name TEXT NOT NULL, visit_type TEXT DEFAULT 'first_aid', seen_by TEXT, visit_date DATE DEFAULT CURRENT_DATE, visit_time TIME DEFAULT CURRENT_TIME, complaint TEXT, treatment TEXT, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36843
    pgm.sql(`CREATE TABLE IF NOT EXISTS crm_leads ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), company VARCHAR(255), source VARCHAR(100), status VARCHAR(50) DEFAULT 'new', priority VARCHAR(20) DEFAULT 'medium', estimated_value DECIMAL(12,2) DEFAULT 0, assigned_to VARCHAR(255), notes TEXT, last_contact TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36851
    pgm.sql(`CREATE TABLE IF NOT EXISTS crm_activities ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, lead_id INTEGER REFERENCES crm_leads(id) ON DELETE CASCADE, activity_type VARCHAR(50) NOT NULL, subject TEXT NOT NULL, notes TEXT, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 36857
    pgm.sql(`CREATE TABLE IF NOT EXISTS crm_contacts ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), company VARCHAR(255), type VARCHAR(50) DEFAULT 'prospect', address TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 37061
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_tickets ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, description TEXT, category VARCHAR(100), venue VARCHAR(255), event_date DATE, event_time TIME, total_tickets INTEGER DEFAULT 100, tickets_sold INTEGER DEFAULT 0, price DECIMAL(10,2) DEFAULT 0, currency VARCHAR(10) DEFAULT 'UGX', status VARCHAR(50) DEFAULT 'draft', image_url TEXT, created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 37070
    pgm.sql(`CREATE TABLE IF NOT EXISTS event_registrations ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES event_tickets(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), ticket_type VARCHAR(50) DEFAULT 'general', quantity INTEGER DEFAULT 1, amount_paid DECIMAL(10,2) DEFAULT 0, payment_ref VARCHAR(255), status VARCHAR(50) DEFAULT 'confirmed', checked_in BOOLEAN DEFAULT false, qr_code TEXT, registered_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 40648
    pgm.sql(`CREATE TABLE IF NOT EXISTS short_links ( id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, code VARCHAR(20) UNIQUE NOT NULL, target_url TEXT NOT NULL, label VARCHAR(255), clicks INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_by VARCHAR(255), expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 40655
    pgm.sql(`CREATE TABLE IF NOT EXISTS link_clicks ( id SERIAL PRIMARY KEY, link_id INTEGER REFERENCES short_links(id) ON DELETE CASCADE, ip_address TEXT, user_agent TEXT, referrer TEXT, clicked_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 40659
    pgm.sql(`CREATE TABLE IF NOT EXISTS webhook_endpoints ( id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, url TEXT NOT NULL, events TEXT[], secret VARCHAR(255), is_active BOOLEAN DEFAULT true, last_triggered TIMESTAMPTZ, total_deliveries INTEGER DEFAULT 0, total_failures INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 40666
    pgm.sql(`CREATE TABLE IF NOT EXISTS webhook_deliveries ( id SERIAL PRIMARY KEY, endpoint_id INTEGER REFERENCES webhook_endpoints(id) ON DELETE CASCADE, tenant_id INTEGER NOT NULL, event_type VARCHAR(100), payload JSONB, status VARCHAR(20) DEFAULT 'pending', response_code INTEGER, attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3, next_retry TIMESTAMPTZ, last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), delivered_at TIMESTAMPTZ )`);
    // server.js line 40675
    pgm.sql(`CREATE TABLE IF NOT EXISTS installed_plugins ( id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, plugin_key VARCHAR(100) NOT NULL, is_active BOOLEAN DEFAULT true, installed_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, plugin_key) )`);
    // server.js line 41349
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_portal_users ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, phone VARCHAR(20) NOT NULL, full_name VARCHAR(255), email VARCHAR(255), date_of_birth DATE, gender VARCHAR(20), blood_type VARCHAR(10), emergency_contact_name VARCHAR(255), emergency_contact_phone VARCHAR(20), address TEXT, otp_code VARCHAR(10), otp_expires TIMESTAMPTZ, is_verified BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, phone) )`);
    // server.js line 41368
    pgm.sql(`CREATE TABLE IF NOT EXISTS patient_sessions ( id SERIAL PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patient_portal_users(id) ON DELETE CASCADE, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, session_token TEXT NOT NULL, device_info TEXT, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days' )`);
    // server.js line 41378
    pgm.sql(`CREATE TABLE IF NOT EXISTS prescription_refill_requests ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, patient_portal_user_id INTEGER REFERENCES patient_portal_users(id) ON DELETE CASCADE, prescription_id INTEGER NOT NULL, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 43211
    pgm.sql(`CREATE TABLE IF NOT EXISTS fee_reminder_settings ( id SERIAL PRIMARY KEY, tenant_id INTEGER UNIQUE, auto_notify BOOLEAN DEFAULT false, frequency TEXT DEFAULT 'weekly', days_before INTEGER DEFAULT 7, enabled_channels TEXT[] DEFAULT '{sms,email}', last_run TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() )`);
    // server.js line 44079
    pgm.sql(`CREATE TABLE IF NOT EXISTS sso_configs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, provider_name TEXT NOT NULL, protocol TEXT DEFAULT 'saml', entry_point TEXT, certificate TEXT, issuer TEXT, audience TEXT, client_id TEXT, client_secret_encrypted TEXT, auth_endpoint TEXT, token_endpoint TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 45207
    pgm.sql(`CREATE TABLE IF NOT EXISTS rbac_roles ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0, role_name VARCHAR(80) NOT NULL, description TEXT, is_system BOOLEAN DEFAULT false, priority INTEGER DEFAULT 50, color VARCHAR(7) DEFAULT '#4f46e5', created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 45212
    pgm.sql(`CREATE TABLE IF NOT EXISTS rbac_permissions ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0, permission_key VARCHAR(100) NOT NULL, permission_name VARCHAR(150) NOT NULL, category VARCHAR(50) NOT NULL, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, permission_key))`);
    // server.js line 45218
    pgm.sql(`CREATE TABLE IF NOT EXISTS rbac_role_permissions ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0, role_id INTEGER NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE, permission_id INTEGER NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(role_id, permission_id))`);
    // server.js line 45224
    pgm.sql(`CREATE TABLE IF NOT EXISTS rbac_user_roles ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0, user_email VARCHAR(200) NOT NULL, role_id INTEGER NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE, assigned_by VARCHAR(200), assigned_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, role_id))`);
    // server.js line 45229
    pgm.sql(`CREATE TABLE IF NOT EXISTS rbac_permission_audit ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0, action VARCHAR(50) NOT NULL, user_email VARCHAR(200), target_email VARCHAR(200), role_id INTEGER, permission_id INTEGER, details TEXT, ip_address VARCHAR(50), created_at TIMESTAMPTZ DEFAULT NOW())`);
    // server.js line 46743
    pgm.sql(`CREATE TABLE IF NOT EXISTS saved_filters ( id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(100) NOT NULL, page VARCHAR(100) NOT NULL, filters JSONB NOT NULL, is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() )`);
  },
  down: () => {
    // Reverse of this migration is a no-op for safety — the schema was created
    // incrementally over many app versions and dropping it would lose user data.
    // Use `npm run migrate:down` with caution; prefer creating a new forward
    // migration that undoes the specific change you need reverted.
  },
};
