# <img src="https://img.icons8.com/fluency/48/graduation-cap.png" width="28" alt="Comfort"> Comfort Zone — All-in-One Management Platform

> **🌐 LIVE WEBSITE: [https://ssewasswa.github.io/ssewasswa-api/](https://ssewasswa.github.io/ssewasswa-api/)** | 🚀 **LAUNCH APP: [https://ssewasswa.onrender.com](https://ssewasswa.onrender.com)**

[![Website](https://img.shields.io/badge/WEBSITE-ssewasswa.github.io-blue?style=for-the-badge&logo=github)](https://ssewasswa.github.io/ssewasswa-api/)
[![Live App](https://img.shields.io/badge/LIVE_APP-ssewasswa.onrender.com-brightgreen?style=for-the-badge&logo=rend)](https://ssewasswa.onrender.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)

**Comfort Zone** is the all-in-one cloud management platform by **Ssewasswa** for **15 organization types**: schools, churches, clinics/hospitals, businesses, hotels, restaurants, retail shops, salons, pharmacies, gyms, hardware stores, supermarkets, transport, electronics, and individuals. Built with Node.js, PostgreSQL, Redis, and WebSocket — serving organizations across Uganda, Kenya, Tanzania, and East Africa.

---

## ✨ Key Features

### 🎓 School Management
- Student enrollment, promotion & graduation
- Fee tracking with MTN MoMo / Airtel Money payments
- Online exams & quizzes with auto-grading
- Attendance tracking (QR code, biometric, manual)
- Report cards (.docx & .pdf generation)
- Timetable scheduling & subject management
- Parent portal with real-time notifications
- Library management (cataloging, lending, fines)

### ⛪ Church Management
- Member directory & attendance tracking
- Tithe & offering tracking with statements
- Sermon management & service scheduling
- Prayer requests & choir/worship team management
- Cell groups & fundraising campaigns
- Peer-to-peer fundraising

### 💰 Business / POS
- Point of sale with barcode scanning
- Multi-branch inventory management
- Customer management & loyalty tracking
- Purchase orders & supplier management
- Quotations, invoices & delivery tracking
- Tax reports (VAT / URA compliance)
- Profit & loss analytics

### 🏥 Clinic & Pharmacy
- Patient queue & triage management
- Consultations, prescriptions & lab requests
- Pharmacy dispensing & drug interaction checks
- Pharmacy inventory management

### 🤖 AI Assistant
- Natural language queries across all data
- Predictive analytics (dropout risk, fee defaults)
- Smart notifications & automated insights

### 📱 Communication
- Bulk SMS via Africa's Talking
- WhatsApp receipt & invoice sharing
- Email campaigns & templates
- Push notifications (Web Push API)
- Real-time WebSocket updates

### 💳 Payments (Uganda-Focused)
- **MTN Mobile Money** (Collection API)
- **Airtel Money** (Merchant API)
- **DPO / Direct Pay Online** (Card payments)
- **Flutterwave** (Nigeria, Ghana, Kenya)
- QR code payments with auto-reconciliation
- Fee installment plans (2-12 months)

### 📞 USSD Portal
- Feature phone access via *XXX# dial codes
- Check fees, attendance & results from any phone
- Bilingual support (English & Luganda)
- Africa's Talking integration

### 🔐 Security & Infrastructure
- Multi-tenant data isolation
- CSRF protection, rate limiting, Helmet CSP
- 2FA authentication (OTP)
- SQL injection prevention (table allowlist)
- Sentry error monitoring
- Redis caching layer
- Automated database backups (pg_dump → Cloudinary)

---

## 🏗️ Architecture

```
ssewasswa-api/
├── server.js                    # Main Express server (28,000+ lines)
├── api-routes.js                # REST API v1 (JWT auth)
├── public-portal.js             # Landing page & registration
├── business-specializations.js  # 10 industry modules
├── launch-routes.js             # Public site routes
├── security-ops.js              # 2FA, audit, backups
├── branding-currency.js         # White-label & multi-currency
├── parent-analytics.js          # Parent portal & analytics
├── marketplace-pwa.js           # Plugin marketplace & PWA
├── messaging-chat.js            # Internal messaging (14 routes)
├── file-manager.js              # File & document manager (16 routes)
├── reports-center.js            # Reports & exports (11 routes)
├── payment-gateway.js           # Payment integration (MoMo/Airtel/DPO)
├── search-audit.js              # Global search & audit logs (6 routes)
├── task-manager.js              # Kanban boards & projects (17 routes)
├── workflow-automation.js       # Approval chains & automation
├── survey-builder.js            # Survey & form builder
├── calendar-scheduler.js        # Calendar & scheduling
├── backup-restore.js            # Backup & data export
├── notification-center.js       # Notification inbox & preferences
├── template-library.js          # Document/email templates
├── data-import.js               # CSV import/export wizard
├── advanced-settings.js         # System configuration
├── invoicing-billing.js         # Invoicing & recurring billing
├── attendance-tracker.js        # QR & manual attendance
├── helpdesk.js                  # Ticket system
├── online-exams.js              # Exams, quizzes & grading
├── event-manager.js             # Event management & RSVP
├── inventory-pro.js             # Advanced inventory
├── visitor-log.js               # Visitor management
├── library.js                   # Library management
├── payroll.js                   # Payroll management
├── alumni-network.js            # Alumni network
├── hostel-manager.js            # Hostel & accommodation
├── transport.js                 # Transport routes & tracking
├── canteen.js                   # Canteen & meal management
├── sports.js                    # Sports league management
├── certificates.js              # Certificate generator (13 routes)
├── feedback.js                  # Feedback & rating system
├── asset-tracker.js             # Asset tracking & depreciation
├── crm.js                       # CRM & contact management
├── blog-cms.js                  # Blog CMS
├── sms-blast.js                 # Bulk SMS & communication
├── ai-assistant.js              # AI-powered assistant
├── student-id-cards.js          # Student ID card generator (12 routes)
├── qr-payments.js               # QR code payment system (10 routes)
├── fee-installments.js          # Fee installment plans (12 routes)
├── whatsapp-receipts.js         # WhatsApp receipt sharing (8 routes)
├── ussd-portal.js               # USSD feature phone access (10 routes)
├── migrate.js                   # Database migrations
├── worker.js                    # Background worker
└── render.yaml                  # Render deployment config
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ / Bun |
| Framework | Express.js |
| Database | PostgreSQL 15+ (Neon) |
| Caching | Redis (ioredis) |
| Real-time | WebSocket (ws) |
| File Storage | Cloudinary |
| Auth | bcrypt, otplib (2FA), JWT |
| Payments | MTN MoMo, Airtel Money, DPO, Flutterwave |
| SMS | Africa's Talking |
| Email | Nodemailer (Gmail) |
| Monitoring | Sentry |
| Deployment | Render |

---

## 📊 Platform Stats

- **49** External modules
- **211+** Feature areas
- **494** Database tables
- **1,450+** API routes
- **28,000+** Lines of core server code
- **Multi-currency**: UGX, KES, TZS, RWF, USD
- **Multi-tenant**: Full data isolation per organization

---

## 🏢 Business Specializations

The platform includes 10 pre-built industry modules:

1. 🏨 **Hotels** — Reservations, housekeeping, room management
2. 🍽️ **Restaurants** — Menu, orders, tables, kitchen display
3. 🏪 **Retail / Supermarket** — POS, barcode scanning, daily sales
4. 💇 **Salons** — Appointments, services, staff scheduling
5. 💊 **Pharmacies** — Dispensing, drug inventory, interactions
6. 🏋️ **Gyms** — Memberships, check-ins, class schedules
7. 🔧 **Hardware Stores** — Products, quotations, repairs
8. 🛒 **Supermarkets** — Products, daily sales, stock take
9. 🚐 **Transport** — Routes, vehicles, passenger tracking
10. 📱 **Electronics** — Products, repairs, warranties

---

## 🌍 Localization

- English (default)
- Luganda
- Swahili
- Multi-currency support (UGX, KES, TZS, RWF, USD)
- Dark mode support

---

## 📦 Getting Started

### Prerequisites
- Node.js 18+ or Bun
- PostgreSQL 15+
- Redis (optional, for caching)

### Installation

```bash
git clone https://github.com/ssewasswa/ssewasswa-api.git
cd ssewasswa-api
npm install
```

### Environment Variables

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
SESSION_SECRET=your-secret-key
GMAIL_USER=your@gmail.com
GMAIL_PASS=your-app-password
CLOUDINARY_URL=cloudinary://key:secret@cloudname
AT_API_KEY=africastalking-key
AT_USERNAME=africastalking-username
BASE_URL=https://your-domain.com
```

### Run

```bash
# Development
npm run dev

# Production
node server.js

# With Bun
bun run server.js
```

---

## 🤝 Contributing

This is a proprietary project. For feature requests or bug reports, please open an issue.

---

## 📄 License

Proprietary — All rights reserved. See [LICENSE](LICENSE) for details.

---

## 📍 Location

Built with ❤️ in **Kampala, Uganda** 🇺🇬

<p align="center">
  <strong>Comfort Zone</strong> — Manage Everything. One Platform.
</p>
