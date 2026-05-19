---
Task ID: 1
Agent: Main Agent
Task: Organize the ENTIRE site dashboard menu and item display into a professional layout

Work Log:
- Analyzed all 7 portal dashboards in server.js (school, organization, church, business, health, individual, fallback)
- Found remote had newer design system (v20.2) with Inter font, glassmorphism nav, CSS variables
- Added `ds(icon, title, cardsHtml)` helper function for collapsible section generation
- Upgraded `.dash-section` CSS from simple text label to full collapsible component with:
  - Clickable header with hover effect
  - Module count badge
  - Collapsible grid body with smooth toggle
  - Responsive: single column on mobile, hidden count badge
- Organized ALL 8 portal dashboards into categorized collapsible sections:
  * School: 8 sections (Academics, Finance, People, Operations, Campus, Communication, Advanced, Admin) - 71 cards
  * Organization: 6 sections (Core, Finance, Communication, Events, Resources, Tools) - 41 cards
  * Church: 5 sections (Congregation, Worship, Finance, Events, Resources) - 26 cards
  * Business: 7 sections (Sales, Inventory, Finance, People, Tools, Industry Specific, Growth) - 27+36 conditional cards
  * Health: 5 sections (Clinical, Patient Mgmt, Diagnostics, Finance, Analytics) - 12 cards
  * Individual: 3 sections (Personal Finance, Productivity, Account) - 9 cards
  * Fallback: 5 sections (Core, Business, Growth, Analytics, People) - 8 cards
- Preserved all conditional/plan-gated cards exactly as-is
- Fixed Business portal unclosed grid bug
- Pushed to Render (commit 9a6b873)

Stage Summary:
- Total: ~200+ cards organized across 8 portal types, 39 collapsible sections
- Site-wide navigation already organized via existing dropdown menu system (v20.2)
- All portals now have professional categorized, collapsible dashboard sections
