/**
 * Migration 000001 — Initial schema (foundational tables)
 *
 * Extracted from server.js lines 1876-1923 (the original `migrations` array).
 * These are the base tables that every other table foreign-keys to.
 *
 * NOTE: We use pgm.sql() with the original CREATE TABLE IF NOT EXISTS statements
 * verbatim. This guarantees schema parity with the pre-refactor server.js and is
 * a valid node-pg-migrate usage pattern for "lift and shift" migrations. A future
 * task should refactor this into proper pgm.createTable() JS API calls — see
 * worklog for follow-up.
 */
module.exports = {
  up: (pgm) => {
    // From server.js line 1876
    pgm.sql(`CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, email TEXT, phone TEXT, subdomain TEXT UNIQUE, verified BOOLEAN DEFAULT false, approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, has_fundraising BOOLEAN DEFAULT false, wallet_balance INTEGER DEFAULT 0, description TEXT, address TEXT, logo_url TEXT, health_institution_type TEXT DEFAULT NULL, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1877
    pgm.sql(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, email TEXT UNIQUE NOT NULL, password TEXT, password_hash TEXT, role TEXT DEFAULT 'user', approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, dark_mode BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1878
    pgm.sql(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, admission_no TEXT, name TEXT NOT NULL, class TEXT, stream TEXT, guardian_name TEXT, guardian_phone TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1879
    pgm.sql(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount INTEGER NOT NULL, paid INTEGER DEFAULT 0, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1880
    pgm.sql(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER, date DATE NOT NULL, status TEXT, UNIQUE(student_id, date))`);

    // From server.js line 1881
    pgm.sql(`CREATE TABLE IF NOT EXISTS exams (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1882
    pgm.sql(`CREATE TABLE IF NOT EXISTS marks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score INTEGER, grade TEXT, UNIQUE(exam_id, student_id, subject))`);

    // From server.js line 1883
    pgm.sql(`CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT, joined_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1884
    pgm.sql(`CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, budget INTEGER DEFAULT 0, spent INTEGER DEFAULT 0, status TEXT DEFAULT 'active', description TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1885
    pgm.sql(`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, event_date DATE, budget INTEGER DEFAULT 0, description TEXT, venue TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1886
    pgm.sql(`CREATE TABLE IF NOT EXISTS org_finance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, amount INTEGER NOT NULL, type TEXT NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1887
    pgm.sql(`CREATE TABLE IF NOT EXISTS inventory (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, sku TEXT, quantity INTEGER DEFAULT 0, cost_price INTEGER DEFAULT 0, selling_price INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1888
    pgm.sql(`CREATE TABLE IF NOT EXISTS sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, customer_name TEXT, total INTEGER NOT NULL, paid INTEGER DEFAULT 0, status TEXT DEFAULT 'paid', created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1889
    pgm.sql(`CREATE TABLE IF NOT EXISTS sale_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE, inventory_id INTEGER REFERENCES inventory(id), quantity INTEGER, price INTEGER)`);

    // From server.js line 1890
    pgm.sql(`CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, invoice_no TEXT UNIQUE, customer_name TEXT, customer_contact TEXT, amount INTEGER NOT NULL, due_date DATE, status TEXT DEFAULT 'unpaid', created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1891
    pgm.sql(`CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category TEXT, amount INTEGER NOT NULL, description TEXT, expense_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1892
    pgm.sql(`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, action TEXT NOT NULL, details TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1893
    pgm.sql(`CREATE TABLE IF NOT EXISTS login_attempts (email TEXT PRIMARY KEY, attempts INTEGER DEFAULT 1, last_attempt TIMESTAMPTZ DEFAULT NOW())`);

    // From server.js line 1908
    pgm.sql(`CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, tenant_id INTEGER, amount INTEGER NOT NULL, source TEXT, description TEXT, details TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1909
    pgm.sql(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance INTEGER DEFAULT 0)`);

    // From server.js line 1911
    pgm.sql(`CREATE TABLE IF NOT EXISTS entertainment_videos (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, url TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1912
    pgm.sql(`CREATE TABLE IF NOT EXISTS entertainment_music (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, artist TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1913
    pgm.sql(`CREATE TABLE IF NOT EXISTS entertainment_games (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, player_name TEXT, score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1915
    pgm.sql(`CREATE TABLE IF NOT EXISTS meeting_minutes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, meeting_date DATE, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1916
    pgm.sql(`CREATE TABLE IF NOT EXISTS notice_board (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, priority TEXT DEFAULT 'normal', created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1917
    pgm.sql(`CREATE TABLE IF NOT EXISTS sermons (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, preacher TEXT, sermon_date DATE, scripture TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1918
    pgm.sql(`CREATE TABLE IF NOT EXISTS prayer_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT, request TEXT NOT NULL, is_private BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1919
    pgm.sql(`CREATE TABLE IF NOT EXISTS service_schedule (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service_name TEXT NOT NULL, day_of_week TEXT, start_time TEXT, end_time TEXT)`);

    // From server.js line 1920
    pgm.sql(`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1921
    pgm.sql(`CREATE TABLE IF NOT EXISTS budget_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category TEXT NOT NULL, planned INTEGER DEFAULT 0, actual INTEGER DEFAULT 0, month TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1922
    pgm.sql(`CREATE TABLE IF NOT EXISTS goals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, target INTEGER DEFAULT 0, current INTEGER DEFAULT 0, deadline DATE, created_at TIMESTAMP DEFAULT NOW())`);

    // From server.js line 1923
    pgm.sql(`CREATE TABLE IF NOT EXISTS personal_notes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_tenant_student ON attendance(tenant_id, student_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_fees_tenant_student ON fees(tenant_id, student_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_exam_student ON marks(exam_id, student_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_tenant ON marks(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_students_tenant_class ON students(tenant_id, class)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_email)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_church_attendance_tenant_member ON church_attendance(tenant_id, member_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_no ON invoices(invoice_no)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_students_tenant ON students(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_students_class ON students(class)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_fees_tenant ON fees(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_exam ON marks(exam_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_church_members_tenant ON church_members(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant ON analytics_events(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_school_events_tenant ON school_events(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_choir_members_tenant ON choir_members(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sermons_tenant ON sermons(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_prayer_requests_tenant ON prayer_requests(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_ticketed_events_tenant ON ticketed_events(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_pharmacy_inventory_tenant ON pharmacy_inventory(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_meal_attendance_tenant ON meal_attendance(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_invoices_tenant ON patient_invoices(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance(tenant_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_patient_portal_users_tenant_phone ON patient_portal_users(tenant_id, phone)`);
  },
  down: (pgm) => {
    // Drop in reverse dependency order
    const tables = [
      'personal_notes',
      'goals',
      'budget_items',
      'customers',
      'service_schedule',
      'prayer_requests',
      'sermons',
      'notice_board',
      'meeting_minutes',
      'entertainment_games',
      'entertainment_music',
      'entertainment_videos',
      'platform_wallet',
      'developer_revenue',
      'login_attempts',
      'audit_logs',
      'expenses',
      'invoices',
      'sale_items',
      'sales',
      'inventory',
      'org_finance',
      'events',
      'projects',
      'members',
      'marks',
      'exams',
      'attendance',
      'fees',
      'students',
      'users',
      'tenants',
    ];
    for (const t of tables) {
      pgm.sql(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
  },
};
