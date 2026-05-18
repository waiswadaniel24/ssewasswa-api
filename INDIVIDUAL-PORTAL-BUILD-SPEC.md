# Individual Portal — Full Build Specification for Z AI

## Project Context
- **Repo**: `ssewasswa/ssewasswa-api`
- **GitHub PAT**: Use the existing repo token already configured in the environment
- **Stack**: Node.js 18+ / Express / PostgreSQL (Neon) / Redis / WebSocket
- **CRITICAL**: Project uses **PostgreSQL**, NOT MySQL. Never use `pool.getConnection()`, `?` placeholders, `MEDIUMTEXT`, or MySQL-specific syntax.
- **Hosted on**: Render at https://ssewasswa.onrender.com — auto-deploys from GitHub `main` branch
- **Must `git pull origin main` before changes** (multiple Z AIs work on this repo)
- **Version**: v18.0.0
- **DO NOT touch**: Dev Portal or Org Portal — other Z AIs are working on those

## Current Individual Portal State (Already Built in server.js)
The following features exist as inline routes in `server.js` (lines ~6928-7218):

| # | Feature | Route Prefix | Status |
|---|---------|-------------|--------|
| 1 | Personal Dashboard | `/portal/individual` | Basic — 4 stats, 9 cards |
| 2 | Budget Chart API | `/individual/charts/budget` | Basic bar chart JSON |
| 3 | Budget Tracker | `/individual/budget` | CRUD with categories |
| 4 | Goals Tracker | `/individual/goals` | CRUD with progress |
| 5 | Personal Notes | `/individual/notes` | CRUD basic |
| 6 | Documents (placeholder) | `/individual/docs` | Placeholder only |
| 7 | Bill Reminders | `/bill-reminders` | CRUD basic |
| 8 | Documents Library | `/documents` | Upload/view/delete |
| 9 | Income Tracker | `/income` | CRUD basic |
| 10 | Billing/Subscription | `/billing` | Payment integration |
| 11 | Worker Management | `/dashboard/workers` | CRUD + worker login |

## What to Build — 35 New Features

Create a new file `individual-portal.js` with ALL 35 features below. The module pattern:

```javascript
module.exports = function(app, pool, renderPage, esc) {
  // ... all features here
};
```

Then add the require in `server.js` near line 34912 (Batch 8):
```javascript
try { const m = require('./individual-portal'); m(app, pool, renderPage, esc); console.log('[IndividualPortal] Individual portal extension loaded — 35 features'); } catch(e) { console.warn('[IndividualPortal] Error:', e.message); }
```

### Feature List with Route Details

#### GROUP 1: Personal Finance & Wealth Management (8 features)

| # | Feature | Routes | Description | New Tables |
|---|---------|--------|-------------|------------|
| 1 | **Investment Portfolio** | GET/POST `/individual/investments`, GET `/individual/investments/new`, GET `/individual/investments/:id`, POST `/individual/investments/:id/update`, GET `/individual/investments/:id/delete` | Track stocks, bonds, mutual funds, crypto with buy price, current value, returns %, portfolio allocation pie chart | `ind_investments` |
| 2 | **Savings Goals** | GET/POST `/individual/savings`, GET `/individual/savings/new`, POST `/individual/savings/save`, POST `/individual/savings/:id/deposit`, GET `/individual/savings/:id/delete` | Dedicated savings pots with targets, auto-progress bars, deposit history | `ind_savings_goals`, `ind_savings_deposits` |
| 3 | **Loan Tracker** | GET/POST `/individual/loans`, GET `/individual/loans/new`, POST `/individual/loans/save`, POST `/individual/loans/:id/payment`, GET `/individual/loans/:id/delete` | Track personal loans, EMIs, interest rates, outstanding balance, payment history | `ind_loans`, `ind_loan_payments` |
| 4 | **Expense Analytics** | GET `/individual/expenses`, GET `/individual/expenses/new`, POST `/individual/expenses/save`, GET `/individual/expenses/:id/delete`, GET `/individual/expenses/chart-data` | Categorized expense logging with daily/weekly/monthly views, trend charts, category breakdown donut | `ind_expenses` |
| 5 | **Net Worth Calculator** | GET `/individual/networth`, POST `/individual/networth/save` | Assets vs liabilities dashboard with net worth trend, auto-calculated from budgets/investments/loans | `ind_networth_snapshots` |
| 6 | **Recurring Transactions** | GET/POST `/individual/recurring`, GET `/individual/recurring/new`, POST `/individual/recurring/save`, GET `/individual/recurring/:id/toggle`, GET `/individual/recurring/:id/delete` | Auto-track monthly subscriptions, rent, utilities with next-due reminders | `ind_recurring_txns` |
| 7 | **Financial Reports** | GET `/individual/finance-report`, GET `/individual/finance-report/:period` | Monthly/quarterly/yearly P&L, cash flow summary, PDF export | Uses existing tables |
| 8 | **Currency Converter** | GET `/individual/currency`, POST `/individual/currency/convert` | UGX to USD/EUR/GBP/KES/TZS/RWF with live rates from API or static rates fallback | No table needed |

#### GROUP 2: Personal Productivity & Time Management (7 features)

| # | Feature | Routes | Description | New Tables |
|---|---------|--------|-------------|------------|
| 9 | **Habit Tracker** | GET/POST `/individual/habits`, GET `/individual/habits/new`, POST `/individual/habits/save`, POST `/individual/habits/:id/checkin`, GET `/individual/habits/:id/delete`, GET `/individual/habits/:id/streak` | Daily habit check-in, streak counter, completion %, weekly heatmap | `ind_habits`, `ind_habit_checkins` |
| 10 | **Task Manager (Kanban)** | GET/POST `/individual/tasks`, GET `/individual/tasks/new`, POST `/individual/tasks/save`, POST `/individual/tasks/:id/move`, GET `/individual/tasks/:id/delete` | Todo/In-Progress/Done columns, priority levels, due dates, drag-drop style | `ind_tasks` |
| 11 | **Time Logger** | GET/POST `/individual/timelog`, GET `/individual/timelog/start`, POST `/individual/timelog/stop`, GET `/individual/timelog/:id/delete`, GET `/individual/timelog/summary` | Timer-based time tracking per project/activity, daily/weekly summaries | `ind_time_logs` |
| 12 | **Pomodoro Timer** | GET `/individual/pomodoro`, POST `/individual/pomodoro/session` | 25/5 min focus/break timer with session logging, daily focus stats | `ind_pomodoro_sessions` |
| 13 | **Calendar & Events** | GET/POST `/individual/calendar`, GET `/individual/calendar/new`, POST `/individual/calendar/save`, GET `/individual/calendar/:id/edit`, POST `/individual/calendar/:id/update`, GET `/individual/calendar/:id/delete` | Personal calendar with month/week views, event categories, reminders | `ind_calendar_events` |
| 14 | **Daily Journal** | GET/POST `/individual/journal`, GET `/individual/journal/new`, POST `/individual/journal/save`, GET `/individual/journal/:id`, GET `/individual/journal/:id/delete` | Daily journal entries with mood tracking, tags, search | `ind_journal_entries` |
| 15 | **Focus Mode (Distraction Blocker)** | GET `/individual/focus`, POST `/individual/focus/start`, POST `/individual/focus/end` | Session-based focus mode with blocked sites list, focus stats | `ind_focus_sessions` |

#### GROUP 3: Health & Wellness (6 features)

| # | Feature | Routes | Description | New Tables |
|---|---------|--------|-------------|------------|
| 16 | **Health Metrics** | GET/POST `/individual/health`, GET `/individual/health/new`, POST `/individual/health/save`, GET `/individual/health/:id/delete`, GET `/individual/health/chart-data` | Weight, BP, blood sugar, heart rate tracking with trend charts | `ind_health_metrics` |
| 17 | **Medication Tracker** | GET/POST `/individual/medications`, GET `/individual/medications/new`, POST `/individual/medications/save`, POST `/individual/medications/:id/taken`, GET `/individual/medications/:id/delete` | Medication schedule, dosage, taken/missed tracking | `ind_medications`, `ind_medication_log` |
| 18 | **Workout Logger** | GET/POST `/individual/workouts`, GET `/individual/workouts/new`, POST `/individual/workouts/save`, GET `/individual/workouts/:id/delete` | Exercise logging with sets/reps/duration, workout types, weekly stats | `ind_workouts` |
| 19 | **Water Intake Tracker** | GET `/individual/water`, POST `/individual/water/add`, GET `/individual/water/reset` | Daily water glasses tracking with goal, visual progress | `ind_water_intake` |
| 20 | **Sleep Tracker** | GET/POST `/individual/sleep`, GET `/individual/sleep/new`, POST `/individual/sleep/save`, GET `/individual/sleep/:id/delete` | Bedtime/wake time logging, sleep quality rating, weekly average | `ind_sleep_log` |
| 21 | **Mental Wellness Check** | GET/POST `/individual/wellness`, POST `/individual/wellness/checkin`, GET `/individual/wellness/history` | Mood logging, stress level, gratitude entries, wellness score | `ind_wellness_checkins` |

#### GROUP 4: Personal Knowledge & Learning (7 features)

| # | Feature | Routes | Description | New Tables |
|---|---------|--------|-------------|------------|
| 22 | **Book Library** | GET/POST `/individual/books`, GET `/individual/books/new`, POST `/individual/books/save`, POST `/individual/books/:id/status`, GET `/individual/books/:id/delete` | Book collection with reading status (Want/Reading/Done), ratings, author, genre | `ind_books` |
| 23 | **Skill Tracker** | GET/POST `/individual/skills`, GET `/individual/skills/new`, POST `/individual/skills/save`, POST `/individual/skills/:id/progress`, GET `/individual/skills/:id/delete` | Skills with proficiency levels (Beginner/Intermediate/Advanced/Expert), progress % | `ind_skills` |
| 24 | **Course Tracker** | GET/POST `/individual/courses`, GET `/individual/courses/new`, POST `/individual/courses/save`, POST `/individual/courses/:id/progress`, GET `/individual/courses/:id/delete` | Online/offline courses with completion %, certificates, deadlines | `ind_courses` |
| 25 | **Bookmark Manager** | GET/POST `/individual/bookmarks`, GET `/individual/bookmarks/new`, POST `/individual/bookmarks/save`, GET `/individual/bookmarks/:id/delete` | Save links with categories, tags, search, favicon | `ind_bookmarks` |
| 26 | **Flashcards** | GET/POST `/individual/flashcards`, GET `/individual/flashcards/deck/:id`, GET `/individual/flashcards/new`, POST `/individual/flashcards/save`, POST `/individual/flashcards/:id/study`, GET `/individual/flashcards/:id/delete` | Create decks, add cards, study mode with flip animation, spaced repetition score | `ind_flashcard_decks`, `ind_flashcards` |
| 27 | **Contact Book** | GET/POST `/individual/contacts`, GET `/individual/contacts/new`, POST `/individual/contacts/save`, GET `/individual/contacts/:id/edit`, POST `/individual/contacts/:id/update`, GET `/individual/contacts/:id/delete` | Personal address book with name, phone, email, company, notes, category | `ind_contacts` |
| 28 | **Personal Wiki** | GET/POST `/individual/wiki`, GET `/individual/wiki/new`, POST `/individual/wiki/save`, GET `/individual/wiki/:id`, GET `/individual/wiki/:id/edit`, POST `/individual/wiki/:id/update`, GET `/individual/wiki/:id/delete` | Nested wiki pages with rich text, internal links, categories | `ind_wiki_pages` |

#### GROUP 5: Lifestyle & Social (7 features)

| # | Feature | Routes | Description | New Tables |
|---|---------|--------|-------------|------------|
| 29 | **Travel Planner** | GET/POST `/individual/travel`, GET `/individual/travel/new`, POST `/individual/travel/save`, GET `/individual/travel/:id`, POST `/individual/travel/:id/add-item`, GET `/individual/travel/:id/delete` | Trip planning with itinerary items, packing list, budget per trip | `ind_trips`, `ind_trip_items` |
| 30 | **Recipe Book** | GET/POST `/individual/recipes`, GET `/individual/recipes/new`, POST `/individual/recipes/save`, GET `/individual/recipes/:id`, GET `/individual/recipes/:id/delete` | Personal recipe collection with ingredients, steps, cook time, servings | `ind_recipes` |
| 31 | **Event Wishlist** | GET/POST `/individual/wishlist`, GET `/individual/wishlist/new`, POST `/individual/wishlist/save`, POST `/individual/wishlist/:id/purchase`, GET `/individual/wishlist/:id/delete` | Wish list with items, priority, estimated cost, purchased toggle | `ind_wishlist_items` |
| 32 | **Subscription Manager** | GET/POST `/individual/subscriptions`, GET `/individual/subscriptions/new`, POST `/individual/subscriptions/save`, POST `/individual/subscriptions/:id/toggle`, GET `/individual/subscriptions/:id/delete` | Track all paid subscriptions (Netflix, Spotify, etc.) with billing cycle, cost, next billing date | `ind_subscriptions` |
| 33 | **Gift Tracker** | GET/POST `/individual/gifts`, GET `/individual/gifts/new`, POST `/individual/gifts/save`, GET `/individual/gifts/:id/delete` | Track gifts given/received with occasion, recipient, cost | `ind_gifts` |
| 34 | **Bucket List** | GET/POST `/individual/bucketlist`, GET `/individual/bucketlist/new`, POST `/individual/bucketlist/save`, POST `/individual/bucketlist/:id/complete`, GET `/individual/bucketlist/:id/delete` | Life goals checklist with categories (Travel, Career, Personal, Adventure) | `ind_bucket_list` |
| 35 | **Personal QR Code Generator** | GET `/individual/qrcode`, POST `/individual/qrcode/generate` | Generate QR codes for vCard, WiFi, URL, text — display as SVG/PNG | No table needed |

## Database Migration Pattern

ALL table creation must use PostgreSQL syntax in an async IIFE at the top of the module:

```javascript
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ind_investments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id INTEGER,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50), -- stock, bond, mutual_fund, crypto, real_estate, other
      buy_price NUMERIC(15,2),
      current_value NUMERIC(15,2),
      quantity NUMERIC(15,4),
      purchase_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    // ... repeat for all tables
    console.log('[IndividualPortal] Migrations applied successfully');
  } catch(e) { console.error('[IndividualPortal] Migration error:', e.message); }
})();
```

## CSS Styling Pattern

Use consistent CSS with `ip-` prefix:

```css
.ip-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.ip-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.ip-nav a:hover{background:#e2e8f0}
.ip-nav a.active{background:#ec4899;color:#fff}
.ip-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.ip-btn-primary{background:#ec4899;color:#fff}
.ip-btn-success{background:#059669;color:#fff}
.ip-btn-danger{background:#fee2e2;color:#dc2626}
.ip-btn-secondary{background:#f1f5f9;color:#475569}
.ip-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
.ip-table{width:100%;border-collapse:collapse;font-size:13px}
.ip-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase}
.ip-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
```

## Navigation Pattern

```javascript
const ipNav = (active) => `<div class="ip-nav">
  <a href="/portal/individual" class="${active==='dash'?'active':''}">📊 Dashboard</a>
  <a href="/individual/budget" class="${active==='budget'?'active':''}">💰 Budget</a>
  <a href="/individual/goals" class="${active==='goals'?'active':''}">🎯 Goals</a>
  <a href="/individual/investments" class="${active==='invest'?'active':''}">📈 Investments</a>
  <a href="/individual/habits" class="${active==='habits'?'active':''}">🔄 Habits</a>
  <a href="/individual/tasks" class="${active==='tasks'?'active':''}">✅ Tasks</a>
  <a href="/individual/health" class="${active==='health'?'active':''}">❤️ Health</a>
  <a href="/individual/journal" class="${active==='journal'?'active':''}">📔 Journal</a>
  <a href="/individual/books" class="${active==='books'?'active':''}">📚 Books</a>
  <a href="/individual/contacts" class="${active==='contacts'?'active':''}">👤 Contacts</a>
  <a href="/individual/wishlist" class="${active==='wishlist'?'active':''}">🎁 Wishlist</a>
</div>`;
```

## Updated Dashboard

The `/portal/individual` dashboard (currently in server.js lines 6932-6972) should be ENHANCED with links to ALL 35 features organized in sections:

- **Finance**: Budget, Goals, Investments, Savings, Loans, Expenses, Net Worth, Recurring, Reports, Currency
- **Productivity**: Habits, Tasks, Time Log, Pomodoro, Calendar, Journal, Focus
- **Health**: Health Metrics, Medications, Workouts, Water, Sleep, Wellness
- **Knowledge**: Books, Skills, Courses, Bookmarks, Flashcards, Contacts, Wiki
- **Lifestyle**: Travel, Recipes, Wishlist, Subscriptions, Gifts, Bucket List, QR Code

## Key Rules
1. **PostgreSQL ONLY** — no MySQL syntax ever
2. Use `$1, $2, $3` parameterized queries, never `?` placeholders
3. All tables must have `tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
4. All routes must use `requireAuth` middleware
5. Use `renderPage(title, html, user, req)` for page rendering
6. Use `esc()` for HTML escaping user content
7. Module export: `module.exports = function(app, pool, renderPage, esc) { ... }`
8. File should be self-contained — all routes, tables, CSS, navigation in ONE file
9. Every table creation wrapped in `CREATE TABLE IF NOT EXISTS`
10. Chart data endpoints return JSON for Chart.js consumption
11. Mobile-responsive CSS with `@media(max-width:768px)` breakpoints
12. Consistent pink/magenta theme (`#ec4899`) for Individual Portal identity
13. File name: `individual-portal.js`
14. Target: 2,500+ lines of production code

## Deployment
1. `git pull origin main` (always pull first — other Z AIs are working)
2. Create `individual-portal.js`
3. Add require in `server.js` Batch 8 area (~line 34910):
   ```javascript
   try { const m = require('./individual-portal'); m(app, pool, renderPage, esc); console.log('[IndividualPortal] Individual portal extension loaded — 35 features'); } catch(e) { console.warn('[IndividualPortal] Error:', e.message); }
   ```
4. `git add . && git commit -m "Add Individual Portal — 35 features" && git push origin main`
5. Render auto-deploys from main
