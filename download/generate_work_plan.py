import os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, cm
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, HRFlowable
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ━━ Color Palette ━━
ACCENT = colors.HexColor('#1c7796')
TEXT_PRIMARY = colors.HexColor('#22201e')
TEXT_MUTED = colors.HexColor('#89857d')
BG_SURFACE = colors.HexColor('#e3e0db')
BG_PAGE = colors.HexColor('#f3f2f0')
TABLE_HEADER_COLOR = ACCENT
TABLE_HEADER_TEXT = colors.white
TABLE_ROW_EVEN = colors.white
TABLE_ROW_ODD = BG_SURFACE

RED = colors.HexColor('#c0392b')
GREEN = colors.HexColor('#27ae60')
AMBER = colors.HexColor('#e67e22')
BLUE = colors.HexColor('#2980b9')

# ━━ Fonts ━━
pdfmetrics.registerFont(TTFont('Tinos', '/usr/share/fonts/truetype/chinese/LiberationSerif-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Carlito', '/usr/share/fonts/truetype/english/Carlito-Regular.ttf'))
registerFontFamily('Tinos', normal='Tinos', bold='Tinos')
registerFontFamily('Carlito', normal='Carlito', bold='Carlito')

# ━━ Styles ━━
styles = getSampleStyleSheet()

title_style = ParagraphStyle('DocTitle', fontName='Tinos', fontSize=28, leading=36, alignment=TA_LEFT, textColor=TEXT_PRIMARY, spaceAfter=6)
subtitle_style = ParagraphStyle('DocSubtitle', fontName='Tinos', fontSize=14, leading=20, alignment=TA_LEFT, textColor=TEXT_MUTED, spaceAfter=12)
h1_style = ParagraphStyle('H1', fontName='Tinos', fontSize=20, leading=28, textColor=TEXT_PRIMARY, spaceBefore=18, spaceAfter=10)
h2_style = ParagraphStyle('H2', fontName='Tinos', fontSize=15, leading=22, textColor=ACCENT, spaceBefore=14, spaceAfter=8)
h3_style = ParagraphStyle('H3', fontName='Tinos', fontSize=12, leading=18, textColor=TEXT_PRIMARY, spaceBefore=10, spaceAfter=6)
body_style = ParagraphStyle('Body', fontName='Tinos', fontSize=10.5, leading=17, alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY, spaceAfter=6)
bullet_style = ParagraphStyle('Bullet', fontName='Tinos', fontSize=10.5, leading=17, alignment=TA_LEFT, textColor=TEXT_PRIMARY, leftIndent=20, bulletIndent=8, spaceAfter=4)
header_cell = ParagraphStyle('HeaderCell', fontName='Tinos', fontSize=10, leading=14, textColor=colors.white, alignment=TA_CENTER)
cell_style = ParagraphStyle('CellStyle', fontName='Tinos', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_CENTER)
cell_left = ParagraphStyle('CellLeft', fontName='Tinos', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
cell_left_small = ParagraphStyle('CellLeftSmall', fontName='Tinos', fontSize=9, leading=13, textColor=TEXT_PRIMARY, alignment=TA_LEFT)
caption_style = ParagraphStyle('Caption', fontName='Tinos', fontSize=9, leading=14, textColor=TEXT_MUTED, alignment=TA_CENTER, spaceBefore=3, spaceAfter=6)

page_w = A4[0]
left_m = 1.0 * inch
right_m = 1.0 * inch
avail_w = page_w - left_m - right_m

# ━━ TOC Template ━━
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))

def add_heading(text, style, level=0):
    import hashlib
    key = 'h_%s' % hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/>%s' % (key, text), style)
    p.bookmark_name = text
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def make_table(data, col_widths, caption_text=None):
    elements = []
    t = Table(data, colWidths=col_widths, hAlign='CENTER')
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ('TEXTCOLOR', (0, 0), (-1, 0), TABLE_HEADER_TEXT),
        ('GRID', (0, 0), (-1, -1), 0.5, TEXT_MUTED),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        bg = TABLE_ROW_ODD if i % 2 == 0 else TABLE_ROW_EVEN
        style_cmds.append(('BACKGROUND', (0, i), (-1, i), bg))
    t.setStyle(TableStyle(style_cmds))
    elements.append(t)
    if caption_text:
        elements.append(Spacer(1, 6))
        elements.append(Paragraph(caption_text, caption_style))
    return elements

# ━━ Build Document ━━
output_path = '/home/z/my-project/download/Comfort_Zone_Gap_Analysis_Work_Plan.pdf'
doc = TocDocTemplate(output_path, pagesize=A4, leftMargin=left_m, rightMargin=right_m, topMargin=0.8*inch, bottomMargin=0.8*inch)
story = []

# ── Cover Page ──
story.append(Spacer(1, 120))
story.append(Paragraph('<b>Comfort Zone Platform</b>', title_style))
story.append(Spacer(1, 8))
story.append(Paragraph('<b>Gap Analysis &amp; Strategic Work Plan</b>', ParagraphStyle('SubTitle', fontName='Tinos', fontSize=18, leading=26, textColor=ACCENT)))
story.append(Spacer(1, 24))
story.append(HRFlowable(width='40%', thickness=2, color=ACCENT, spaceAfter=18, spaceBefore=0, hAlign='LEFT'))
story.append(Paragraph('Comprehensive Assessment Across Four Critical Domains', subtitle_style))
story.append(Spacer(1, 30))
story.append(Paragraph('Prepared for: SSEWASSWA Platform Development', body_style))
story.append(Paragraph('Date: May 19, 2026', body_style))
story.append(Paragraph('Version: 1.0', body_style))
story.append(Spacer(1, 40))
story.append(Paragraph('<b>Current Overall Rating: 3.1 / 5.0</b>', ParagraphStyle('RatingHero', fontName='Tinos', fontSize=24, leading=32, textColor=RED)))
story.append(Paragraph('Target Rating After Full Implementation: 4.8 / 5.0', ParagraphStyle('Target', fontName='Tinos', fontSize=14, leading=20, textColor=GREEN)))

story.append(PageBreak())

# ── TOC ──
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle('TOC1', fontName='Tinos', fontSize=13, leftIndent=20, spaceBefore=6),
    ParagraphStyle('TOC2', fontName='Tinos', fontSize=11, leftIndent=40, spaceBefore=3),
]
story.append(Paragraph('<b>Table of Contents</b>', ParagraphStyle('TOCTitle', fontName='Tinos', fontSize=20, leading=28, textColor=TEXT_PRIMARY, spaceAfter=12)))
story.append(toc)
story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 1. EXECUTIVE SUMMARY
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>1. Executive Summary</b>', h1_style, 0))
story.append(Paragraph(
    'This document presents a comprehensive gap analysis of the Comfort Zone SaaS platform '
    'deployed at Render.com. The platform serves as "The Operating System for African Institutions," '
    'supporting 15 portal types including schools, hospitals, churches, hotels, restaurants, gyms, '
    'salons, real estate firms, e-commerce stores, blogs, portfolios, charities, fitness centers, '
    'spas, and general businesses. The codebase is a monolithic single-file Node.js/Express application '
    'with approximately 39,600 lines of code backed by PostgreSQL, Redis, and Cloudinary.', body_style))
story.append(Spacer(1, 6))
story.append(Paragraph(
    'The analysis was conducted across four critical domains: System Administration, Tenant Portal, '
    'Identity Security and Access Control, and Operational Extensibility. Each domain was evaluated '
    'against industry-standard SaaS benchmarks to identify existing capabilities, partial implementations, '
    'and critical gaps. The assessment reveals that while the platform has a remarkably broad feature set '
    'for a single-developer project, significant improvements are needed to reach production-grade reliability, '
    'security compliance, and operational maturity.', body_style))
story.append(Spacer(1, 6))
story.append(Paragraph(
    'The current overall platform rating stands at <b>3.1 out of 5.0</b>, which reflects a strong foundation '
    'with numerous working features but critical gaps in security enforcement, billing automation, and '
    'operational resilience. With the implementation of the work plan outlined in this document, the platform '
    'can achieve a target rating of <b>4.8 out of 5.0</b>, placing it among mature, enterprise-ready SaaS platforms.', body_style))

# ── Rating Overview Table ──
story.append(Spacer(1, 12))
rating_data = [
    [Paragraph('<b>Domain</b>', header_cell), Paragraph('<b>Current</b>', header_cell),
     Paragraph('<b>After Phase 1</b>', header_cell), Paragraph('<b>After Phase 2</b>', header_cell),
     Paragraph('<b>Target</b>', header_cell)],
    [Paragraph('System Administration', cell_left), Paragraph('3.0 / 5.0', cell_style),
     Paragraph('3.8 / 5.0', cell_style), Paragraph('4.5 / 5.0', cell_style), Paragraph('4.8 / 5.0', cell_style)],
    [Paragraph('Tenant Portal', cell_left), Paragraph('3.2 / 5.0', cell_style),
     Paragraph('4.0 / 5.0', cell_style), Paragraph('4.6 / 5.0', cell_style), Paragraph('4.8 / 5.0', cell_style)],
    [Paragraph('Identity Security &amp; Access', cell_left), Paragraph('2.8 / 5.0', cell_style),
     Paragraph('3.8 / 5.0', cell_style), Paragraph('4.5 / 5.0', cell_style), Paragraph('4.9 / 5.0', cell_style)],
    [Paragraph('Operational &amp; Extensibility', cell_left), Paragraph('3.3 / 5.0', cell_style),
     Paragraph('4.2 / 5.0', cell_style), Paragraph('4.7 / 5.0', cell_style), Paragraph('4.8 / 5.0', cell_style)],
    [Paragraph('<b>OVERALL</b>', ParagraphStyle('BoldCell', fontName='Tinos', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_LEFT)),
     Paragraph('<b>3.1 / 5.0</b>', ParagraphStyle('BoldCellC', fontName='Tinos', fontSize=9.5, leading=14, textColor=RED, alignment=TA_CENTER)),
     Paragraph('<b>3.9 / 5.0</b>', ParagraphStyle('BoldCellC2', fontName='Tinos', fontSize=9.5, leading=14, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('<b>4.6 / 5.0</b>', ParagraphStyle('BoldCellC3', fontName='Tinos', fontSize=9.5, leading=14, textColor=BLUE, alignment=TA_CENTER)),
     Paragraph('<b>4.8 / 5.0</b>', ParagraphStyle('BoldCellC4', fontName='Tinos', fontSize=9.5, leading=14, textColor=GREEN, alignment=TA_CENTER))],
]
cw = [avail_w*0.32, avail_w*0.17, avail_w*0.17, avail_w*0.17, avail_w*0.17]
story.extend(make_table(rating_data, cw, 'Table 1: Overall Platform Rating Summary by Domain'))

# ── Critical Findings ──
story.append(Spacer(1, 12))
story.append(Paragraph('<b>Critical Findings Requiring Immediate Attention:</b>', h3_style))
critical_items = [
    '<b>CSRF enforcement is DISABLED</b> (server.js line 341) - Form submissions are completely unprotected against cross-site request forgery attacks. This is the single most urgent security fix required.',
    '<b>Audit log helper does not record tenant_id</b> (line 619) - While the database column exists, the audit() function never populates it, creating a compliance risk where tenant actions cannot be traced.',
    '<b>Subscription expiry is never enforced</b> - A cron job placeholder exists at line 39602 with only a console.log statement. Expired subscriptions are never automatically downgraded or cancelled.',
    '<b>Minimum password length is 4 characters</b> (line 3540) - This critically weak password policy fails every industry security standard and makes brute-force attacks trivially easy.',
    '<b>PostgreSQL Row-Level Security is absent</b> - All data isolation is performed at the application layer only, meaning a single SQL injection vulnerability could expose all tenant data.',
    '<b>Inconsistent bcrypt cost factor</b> - Password hashing uses 12 rounds during registration but only 10 rounds in password reset and staff creation contexts.',
]
for item in critical_items:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 2. DOMAIN 1: SYSTEM ADMINISTRATION
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>2. Domain 1: System Administration</b>', h1_style, 0))
story.append(Paragraph(
    'System administration encompasses the platform operator\'s ability to manage tenants, handle billing, '
    'monitor system health, and configure global settings. This domain is critical because it directly impacts '
    'revenue collection, operational visibility, and the ability to scale the platform across hundreds or '
    'thousands of tenants. The current rating for this domain is <b>3.0 out of 5.0</b>.', body_style))

# 2.1 Tenant Provisioning
story.append(add_heading('<b>2.1 Tenant Provisioning</b>', h2_style, 1))
story.append(Paragraph(
    'The platform provides a functional self-service signup flow through the POST /register endpoint. When a new '
    'tenant registers, the system atomically creates a tenant record, assigns a unique subdomain, creates the first '
    'user account with the appropriate role based on portal type, inserts a free-tier subscription, and sends a '
    'welcome email. A setup wizard guides new tenants through 3 initial configuration steps. This is a solid foundation '
    'for automated provisioning.', body_style))

story.append(Paragraph('<b>What Exists:</b>', h3_style))
prov_exists = [
    'Self-service tenant registration with automatic subdomain generation (line 3536-3597)',
    'Auto user creation with role assignment matching tenant type (school, church, organization, etc.)',
    'Free plan subscription auto-created on signup; paid plans set to pending_payment status',
    'Welcome email with HTML template sent via sendEmail() and queueEmail()',
    '3-step setup wizard (setup_complete, setup_steps columns, /setup routes)',
    'Multi-portal switching via GET /go-portal/:type (line 3855-3879)',
]
for item in prov_exists:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
prov_gaps = [
    '<b>No admin approval queue:</b> The tenants.approved column exists but registration sets approved=true immediately. There is no workflow for the platform administrator to review and approve or reject new tenant signups before they gain access.',
    '<b>No email verification:</b> The tenants.verified column exists in the database schema, but no email verification flow is triggered during registration. Users can sign up with any email address without confirmation.',
    '<b>No tenant provisioning API:</b> Platform administrators have no dedicated API to create tenants programmatically. The only way to create a tenant is through the public /register endpoint or the developer panel.',
]
for item in prov_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 2.2 Billing & Subscription
story.append(add_heading('<b>2.2 Billing &amp; Subscription</b>', h2_style, 1))
story.append(Paragraph(
    'The billing system supports four subscription tiers (Free, Basic at UGX 50,000, Pro at UGX 150,000, '
    'and Enterprise at custom pricing) with 5 payment providers: Flutterwave, PesaPal, MTN MoMo, Airtel Money, '
    'and DPO. Feature gating is implemented through the getTenantPlanInfo() function and feature_flags table. '
    'However, the billing system has critical gaps that prevent it from being a reliable revenue engine.', body_style))

story.append(Paragraph('<b>What Exists:</b>', h3_style))
bill_exists = [
    '4 subscription tiers with record limits: Free (50), Basic (500), Pro (50,000), Enterprise (unlimited)',
    'Multiple payment provider integrations (Flutterwave, PesaPal, MTN MoMo, Airtel Money, DPO)',
    'Plan limit enforcement via requirePlanLimit() middleware and checkPlanLimit() function',
    'Feature gating by plan via getTenantPlanInfo(), hasFeature(), featureCard() functions',
    'Feature access overrides table for admin-granted exceptions regardless of plan',
    'Billing UI with plan comparison cards and upgrade buttons (line 10405-10468)',
    'subscriptions and payments database tables for tracking all billing activity',
]
for item in bill_exists:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(Paragraph('<b>Major Gaps (Revenue-Impact):</b>', h3_style))
bill_gaps = [
    '<b>No automated subscription renewal:</b> The cron job at line 39602 contains only a console.log placeholder. Subscriptions never auto-renew, meaning every user on a paid plan will silently revert to Free tier once their subscription expires.',
    '<b>No subscription cancellation flow:</b> There is no route or UI for tenants to cancel their subscriptions. This creates both a UX problem and a potential legal compliance issue in some jurisdictions.',
    '<b>No automated expiry enforcement:</b> Expired subscriptions are never downgraded. The status check exists but no scheduled process enforces it.',
    '<b>No invoice generation:</b> No automated invoice or receipt PDF is generated for recurring billing cycles, making it difficult for tenants to track payments and for the platform to maintain financial records.',
    '<b>No payment retry logic:</b> Failed payment charges are never retried automatically, leading to silent revenue loss when payment methods expire or fail temporarily.',
]
for item in bill_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 2.3 Health Monitoring
story.append(add_heading('<b>2.3 Platform Health &amp; Monitoring</b>', h2_style, 1))
story.append(Paragraph(
    'The platform has solid health monitoring fundamentals with a GET /ping endpoint for load balancer checks, '
    'a comprehensive GET /health endpoint that reports database latency, Redis status, WebSocket connections, '
    'memory usage, and process uptime, plus a public-facing status page backed by the platform_status table. '
    'Sentry integration provides error tracking with structured JSON logging. This coverage earns a respectable '
    'rating, but the system lacks proactive alerting and log aggregation capabilities.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
health_gaps = [
    '<b>No external uptime monitoring:</b> The /health endpoint reports internal metrics but no external service is configured to alert the team when the platform goes down. Integration with services like UptimeRobot or PagerDuty is needed.',
    '<b>No log aggregation:</b> Structured JSON logs are written to console only. There is no centralized log management system (ELK Stack, Loki, or cloud-native alternatives) for searching, filtering, and analyzing logs across time.',
    '<b>Sentry tracesSampleRate is only 10%:</b> Only 10% of transactions are traced by Sentry (line 114-128), meaning 90% of performance issues go undetected.',
    '<b>No custom alerting thresholds:</b> The system cannot alert on high database latency, memory usage spikes, or other performance degradation patterns.',
]
for item in health_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 2.4 Global Configuration
story.append(add_heading('<b>2.4 Global Configuration</b>', h2_style, 1))
story.append(Paragraph(
    'Global configuration is well-handled through a platform_settings table acting as a key-value store, '
    'an admin settings UI at /dev/settings, a settings cache that refreshes every 60 seconds, and a feature '
    'flags system with per-tenant toggling. This is one of the stronger areas of the platform, achieving '
    'approximately 80% coverage of configuration management requirements.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
config_gaps = [
    '<b>60-second cache delay:</b> Settings changes take up to 60 seconds to propagate due to the polling-based cache refresh. Real-time invalidation via Redis pub/sub would provide instant updates.',
    '<b>No settings audit trail:</b> There is no record of who changed what setting and when. For a multi-admin platform, this creates accountability gaps.',
    '<b>No feature flag rollout percentages:</b> Feature flags are binary (on/off) only. Percentage-based rollouts for gradual feature deployment are not supported.',
]
for item in config_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 3. DOMAIN 2: TENANT PORTAL
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>3. Domain 2: Tenant Portal</b>', h1_style, 0))
story.append(Paragraph(
    'The Tenant Portal domain evaluates the experience that individual tenants have when using the platform, '
    'including branding customization, dashboard quality, and workflow flexibility. A strong tenant portal '
    'reduces churn and increases the perceived value of the subscription. The current rating for this domain '
    'is <b>3.2 out of 5.0</b>.', body_style))

# 3.1 White Labeling
story.append(add_heading('<b>3.1 White Labeling</b>', h2_style, 1))
story.append(Paragraph(
    'The platform has invested significantly in white labeling capabilities, with dedicated database columns '
    'for logo URL, favicon, custom CSS, custom JavaScript, primary/secondary/accent colors, font family, '
    'custom domain, app name override, support contact overrides, privacy/terms URLs, and an onboarding '
    'message. A branding settings page exists at /settings/branding with Cloudinary-based logo uploads. '
    'The white_label feature flag is gated to the Enterprise plan.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
wl_gaps = [
    '<b>Custom domain routing not implemented:</b> While the custom_domain column exists, there is no DNS validation, no middleware to resolve custom domains to tenant subdomains, and no SSL certificate provisioning. The feature is effectively a placeholder.',
    '<b>Custom CSS may not be injected:</b> The custom_css column is saved but there is no evidence the value is injected into the page &lt;head&gt; in the renderPage() function. The white labeling CSS customization may not actually work.',
    '<b>No email whitelabeling:</b> Tenants cannot send emails from their own domain (custom FROM address). All transactional emails appear to come from the platform\'s default sender, breaking the white-label experience.',
    '<b>No custom email templates:</b> All tenants share the same email templates for welcome emails, payment receipts, and notifications. Enterprise tenants expect customizable email branding.',
]
for item in wl_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 3.2 Tenant Dashboard
story.append(add_heading('<b>3.2 Tenant Dashboard</b>', h2_style, 1))
story.append(Paragraph(
    'Each portal type has a purpose-built dashboard with relevant KPIs, inline SVG charts, and Redis-cached '
    'statistics with a 2-minute TTL. School dashboards show student counts, fee balances, exam results, and '
    'attendance donut charts. Church dashboards track tithes, donations, and membership. Business dashboards '
    'display sales, expenses, POS metrics, and inventory levels. Feature-gated cards with upgrade prompts '
    'help drive conversions from free to paid plans.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
dash_gaps = [
    '<b>No customizable dashboard layout:</b> All tenants see the same fixed dashboard layout for their portal type. There is no drag-and-drop widget system to let tenants prioritize the metrics most important to their business.',
    '<b>No dashboard export:</b> Tenants cannot export their dashboard view as a PDF or image for sharing with stakeholders, board members, or management.',
    '<b>Charts are server-side SVG only:</b> Charts are rendered as inline SVGs on the server, making them non-interactive. Tenants cannot hover for details, zoom into time ranges, or click to drill down into specific data points.',
    '<b>No real-time dashboard updates:</b> While WebSocket notifications exist, the dashboard itself does not update in real-time. Tenants must refresh the page to see new data.',
]
for item in dash_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 3.3 Custom Workflows
story.append(add_heading('<b>3.3 Custom Workflows &amp; Automations</b>', h2_style, 1))
story.append(Paragraph(
    'The platform includes a basic automation engine (evaluateAutomations) that supports trigger-condition-action '
    'rules with CRUD operations at /automations. Supported triggers include payment events, login events, and '
    'fee reminders. Actions include send_sms, send_email, in-app notifications, and webhook calls. Custom fields '
    'and a report builder add flexibility. However, the automation system is limited in expressiveness and lacks '
    'visual design tools.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
wf_gaps = [
    '<b>Conditions are extremely basic:</b> Only single-field comparisons with simple operators (&gt;, &lt;, =) are supported. There is no AND/OR logic, no regex matching, and no multi-condition rules. Real-world automations almost always require compound conditions.',
    '<b>No visual workflow builder:</b> Tenants must create automations through a form-based interface. A drag-and-drop visual builder would dramatically improve usability and adoption.',
    '<b>No approval workflows:</b> Multi-step approval chains (e.g., leave request, purchase order) are not supported. This is a common requirement for organizations and schools.',
    '<b>Scheduled reports not executed:</b> The scheduled_reports table exists but no cron scheduler was found to actually run these reports on schedule.',
    '<b>No webhook-triggered automations:</b> Automations can only be triggered by internal events, not by incoming webhooks from external systems.',
]
for item in wf_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 4. DOMAIN 3: IDENTITY SECURITY & ACCESS CONTROL
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>4. Domain 3: Identity Security &amp; Access Control</b>', h1_style, 0))
story.append(Paragraph(
    'This is the most critical domain from a risk perspective and currently the lowest-rated at <b>2.8 out of 5.0</b>. '
    'While the platform has implemented many security features including bcrypt password hashing, rate limiting, '
    'input validation, SQL injection prevention via table allowlists, and 2FA/TOTP support, several critical '
    'vulnerabilities exist that must be addressed before the platform can be considered production-secure.', body_style))

# 4.1 Data Isolation
story.append(add_heading('<b>4.1 Tenant Data Isolation</b>', h2_style, 1))
story.append(Paragraph(
    'Every business table in the database includes a tenant_id column with a foreign key reference to the tenants '
    'table using ON DELETE CASCADE. All queries use parameterized WHERE tenant_id=$1 clauses scoped to the '
    'session user\'s tenant. A dedicated requireTenantAccess() middleware prevents cross-tenant access, and API '
    'key authentication resolves tenant_id for API requests. The VALID_TABLES allowlist of 200+ tables prevents '
    'SQL injection through table name manipulation.', body_style))

story.append(Paragraph('<b>Critical Security Gaps:</b>', h3_style))
iso_gaps = [
    '<b>No PostgreSQL Row-Level Security (RLS):</b> All data isolation is at the application layer. If a bug bypasses the requireTenantAccess() middleware or a SQL injection slips through, all tenant data is exposed. PostgreSQL RLS policies would provide defense-in-depth by enforcing isolation at the database engine level.',
    '<b>Audit log tenant_id not populated:</b> The audit() helper function at line 619 inserts into audit_logs but does NOT include tenant_id in the INSERT query. This means audit logs cannot be filtered by tenant, creating a serious compliance issue.',
    '<b>Some tables added tenant_id as an afterthought:</b> Lines 1352-1362 show ALTER TABLE statements adding tenant_id to existing tables, meaning older deployments may contain un-scoped data.',
    '<b>No per-tenant encryption:</b> All tenant data is stored with a single encryption scheme. There is no per-tenant key management for data encryption at rest.',
]
for item in iso_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 4.2 RBAC
story.append(add_heading('<b>4.2 Multi-Tenancy RBAC</b>', h2_style, 1))
story.append(Paragraph(
    'The platform implements a role-based access control system with built-in roles (super_admin, and role names '
    'matching portal types like school, church, head_teacher, teacher, full_worker, read_worker), plus a '
    'checkPermission() middleware that evaluates fine-grained JSON permissions stored in the role_permissions table. '
    'Role CRUD operations, team management with invite flows, and plan-based feature gating round out the system.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
rbac_gaps = [
    '<b>No permission inheritance/hierarchy:</b> Permissions are flat individual keys. There is no concept of permission hierarchies (e.g., can_manage_users implies can_view_users). Every permission must be explicitly granted.',
    '<b>No resource-level permissions:</b> Permissions are global within a tenant. A teacher cannot be granted access to "only Class 3A students" rather than all students. This limits the system\'s usefulness for larger organizations.',
    '<b>Permission assignment UI missing:</b> While the role_permissions table stores JSON permission blobs, there is no admin UI for selectively assigning specific permissions to a role. Roles can only be quick-created from preset names.',
    '<b>No role assignment audit trail:</b> When a user\'s role is changed, no audit log entry records who made the change, when, and from what role to what role.',
]
for item in rbac_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 4.3 Federated Authentication
story.append(add_heading('<b>4.3 Federated Authentication</b>', h2_style, 1))
story.append(Paragraph(
    'Google OAuth2 is implemented with proper consent screen flow and token exchange, while Microsoft OAuth and '
    'SAML SSO exist as route stubs only. The oauth_clients table provides infrastructure for tenant-specific '
    'OAuth configurations. TOTP-based 2FA with backup codes is fully implemented. The platform supports local '
    'email/password authentication as the primary method.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
fed_gaps = [
    '<b>SAML SSO is placeholder only:</b> The GET /auth/saml endpoint returns a static HTML page saying "Contact support." The feature flag saml_sso is set to false by default. No actual SAML implementation exists.',
    '<b>Microsoft OAuth not implemented:</b> Only a redirect route stub exists at line 13716 with no actual token exchange or user provisioning logic.',
    '<b>No admin OAuth configuration UI:</b> Google OAuth relies on environment variables. There is no admin UI for tenants to configure their own OAuth providers.',
    '<b>No OIDC support:</b> OpenID Connect, the modern standard for federated identity, is not supported. This limits integration with modern identity providers like Auth0, Okta, and Azure AD.',
    '<b>CSRF enforcement disabled:</b> This is the most critical gap. CSRF token generation exists (line 258) but enforcement is completely disabled (line 341-351) because Render.com uses multiple instances with memory-based sessions. Form submissions are completely unprotected.',
]
for item in fed_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 4.4 Audit Logging
story.append(add_heading('<b>4.4 Audit Logging</b>', h2_style, 1))
story.append(Paragraph(
    'The audit logging system is comprehensive in scope, tracking login attempts (successful and failed), '
    'user registration, password resets, CRUD operations on all major entities (students, staff, fees, payments), '
    'clock-in/out events, CSV imports, and API key creation. The audit_logs table has indexes on user_email and '
    'created_at for query performance. Both a viewer page and an export endpoint exist.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
audit_gaps = [
    '<b>Missing tenant_id in audit helper (CRITICAL):</b> As mentioned in Section 4.1, the audit() function does not include tenant_id in the INSERT. This is the single most impactful audit gap because it makes tenant-level compliance reporting impossible.',
    '<b>No IP address tracking in most audit entries:</b> IP addresses are only captured for login_failed events (line 3320). Other critical actions like data deletion, permission changes, and payment processing are not linked to the source IP.',
    '<b>No session ID tracking:</b> Audit logs do not record the session ID, making it impossible to correlate a sequence of actions to a single user session for forensic analysis.',
    '<b>No audit log retention policy:</b> Audit logs grow indefinitely with no automatic purge. Over time, this will consume significant database storage and slow down queries.',
    '<b>No real-time audit alerting:</b> Suspicious patterns (e.g., mass data export, repeated failed logins from different IPs, privilege escalation) do not trigger real-time alerts.',
]
for item in audit_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 5. DOMAIN 4: OPERATIONAL & EXTENSIBILITY
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>5. Domain 4: Operational &amp; Extensibility</b>', h1_style, 0))
story.append(Paragraph(
    'Operational excellence determines how well the platform scales under load, integrates with external systems, '
    'and maintains data integrity over time. This domain currently rates <b>3.3 out of 5.0</b>, buoyed by a strong '
    'API and webhook system but held back by limited scalability architecture and backup gaps.', body_style))

# 5.1 Scalability
story.append(add_heading('<b>5.1 Scalability &amp; Elasticity</b>', h2_style, 1))
story.append(Paragraph(
    'The platform uses Redis caching via ioredis with cacheGet/cacheSet/cacheInvalidate helper functions, '
    'PostgreSQL connection pooling with max: 5 connections (reduced from 10 for Render free tier), gzip '
    'compression, request timeouts (10s socket, 30s request), PG-backed session store for multi-instance '
    'compatibility, and WebSocket servers for real-time notifications.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
scale_gaps = [
    '<b>Redis caching is underutilized:</b> Only dashboard statistics use Redis caching (2-minute TTL). Most database queries hit PostgreSQL directly on every request. Common read-heavy queries (settings, feature flags, tenant config) should be cached.',
    '<b>Connection pool is too small:</b> max: 5 connections is extremely conservative and will become a bottleneck as tenant count grows. No dynamic scaling based on load is implemented.',
    '<b>No horizontal scaling architecture:</b> The application is fundamentally single-process. While PG session store supports multiple instances, there is no distributed lock mechanism, no sticky session routing, and no load-aware request distribution.',
    '<b>No CDN for static assets:</b> All static assets (logos, uploaded files, the PWA service worker) are served directly by the application server. A CDN would dramatically reduce server load and improve global latency.',
    '<b>No read replica support:</b> A single database connection string is used for all operations. Read-heavy workloads cannot be offloaded to read replicas.',
]
for item in scale_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 5.2 API & Webhooks
story.append(add_heading('<b>5.2 API &amp; Webhooks</b>', h2_style, 1))
story.append(Paragraph(
    'The API system is one of the strongest areas, with 15+ REST API v1 endpoints, Bearer token API key authentication '
    'with hashed keys and scope control, full API documentation at /api-docs, an OpenAPI specification at /api/v1/openapi.json, '
    'a GraphQL endpoint at /api/v2/graphql, webhook CRUD with HMAC-signed delivery, webhook retry every 30 minutes, '
    'and webhook logging. This earns an 80% coverage rating.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
api_gaps = [
    '<b>No per-API-key rate limiting:</b> Only global rate limits exist. A single API key can consume the entire rate limit quota, affecting other tenants. Per-key rate limiting is essential for fair usage.',
    '<b>GraphQL implementation is basic:</b> The GraphQL endpoint at line 13682 is not a full schema-based resolver. It provides limited query flexibility compared to the REST API.',
    '<b>No OAuth2 client credentials flow:</b> API authentication uses static Bearer tokens only. The OAuth2 client credentials flow (standard for machine-to-machine authentication) is not supported.',
    '<b>Webhook retry is disabled by default:</b> The feature flag webhook_retry is set to false. Failed webhook deliveries are never retried unless manually enabled.',
    '<b>No webhook delivery dashboard:</b> There is no UI to monitor webhook delivery success rates, view failed deliveries, or manually retry individual webhooks.',
]
for item in api_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

# 5.3 Automated Backups
story.append(add_heading('<b>5.3 Automated Backups</b>', h2_style, 1))
story.append(Paragraph(
    'The backup system supports manual JSON and CSV export, manual JSON import/restore, and an auto daily backup '
    'job (runAutoBackup) that processes 5 tenants per run and uploads to Cloudinary. A backup_log table tracks '
    'status, URL, and size. However, the auto backup feature is disabled by default and has significant limitations.', body_style))

story.append(Paragraph('<b>Gaps Identified:</b>', h3_style))
backup_gaps = [
    '<b>Auto backup disabled by default:</b> The auto_backup feature flag is set to false. It only activates if CLOUDINARY_URL is configured and the feature flag is manually enabled.',
    '<b>No true database dump:</b> Backups use SELECT queries to export data, not pg_dump. This means database schema changes, indexes, constraints, and sequences are not captured in the backup.',
    '<b>No incremental backups:</b> Every backup is a full export, consuming bandwidth and storage unnecessarily as data grows.',
    '<b>No backup verification:</b> There is no automated test-restore process to verify backup integrity. A backup that cannot be restored is effectively useless.',
    '<b>No backup encryption:</b> Backup files are stored on Cloudinary without encryption. Sensitive tenant data including personal information and financial records are exposed if the Cloudinary account is compromised.',
    '<b>No backup alerts:</b> Backup success or failure notifications are not sent to administrators. A silently failing backup could go unnoticed for days.',
]
for item in backup_gaps:
    story.append(Paragraph(item, bullet_style, bulletText='\u2022'))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 6. STRATEGIC WORK PLAN
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>6. Strategic Work Plan &amp; Implementation Roadmap</b>', h1_style, 0))
story.append(Paragraph(
    'The work plan is organized into three phases, prioritized by business impact and security urgency. '
    'Phase 1 addresses critical security vulnerabilities and revenue-blocking billing gaps. Phase 2 builds '
    'on the foundation to add missing features and improve operational maturity. Phase 3 focuses on advanced '
    'capabilities that differentiate the platform from competitors.', body_style))

# Phase 1
story.append(add_heading('<b>6.1 Phase 1: Critical Fixes &amp; Revenue Enablement (Weeks 1-3)</b>', h2_style, 1))
story.append(Paragraph(
    'Phase 1 targets the highest-priority items that directly impact security posture and revenue collection. '
    'These are not optional improvements; they are fundamental requirements for operating a production SaaS platform '
    'that handles real money and personal data.', body_style))

phase1_data = [
    [Paragraph('<b>ID</b>', header_cell), Paragraph('<b>Task</b>', header_cell),
     Paragraph('<b>Domain</b>', header_cell), Paragraph('<b>Priority</b>', header_cell),
     Paragraph('<b>Effort</b>', header_cell)],
    [Paragraph('1.1', cell_style), Paragraph('Re-enable CSRF enforcement with Redis-backed token storage', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('CRITICAL', ParagraphStyle('RedC', fontName='Tinos', fontSize=9, leading=13, textColor=RED, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('1.2', cell_style), Paragraph('Increase minimum password length from 4 to 8 characters', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('CRITICAL', ParagraphStyle('RedC2', fontName='Tinos', fontSize=9, leading=13, textColor=RED, alignment=TA_CENTER)), Paragraph('1 hour', cell_style)],
    [Paragraph('1.3', cell_style), Paragraph('Standardize bcrypt cost to 12 rounds in all contexts', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('1 hour', cell_style)],
    [Paragraph('1.4', cell_style), Paragraph('Fix audit() helper to include tenant_id in all INSERT queries', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('CRITICAL', ParagraphStyle('RedC3', fontName='Tinos', fontSize=9, leading=13, textColor=RED, alignment=TA_CENTER)), Paragraph('3 hours', cell_style)],
    [Paragraph('1.5', cell_style), Paragraph('Implement subscription expiry cron job with auto-downgrade', cell_left_small),
     Paragraph('Billing', cell_style), Paragraph('CRITICAL', ParagraphStyle('RedC4', fontName='Tinos', fontSize=9, leading=13, textColor=RED, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('1.6', cell_style), Paragraph('Add IP address and session ID to all audit log entries', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC2', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('4 hours', cell_style)],
    [Paragraph('1.7', cell_style), Paragraph('Enable auto_backup feature flag and add admin notification', cell_left_small),
     Paragraph('Ops', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC3', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
    [Paragraph('1.8', cell_style), Paragraph('Add subscription cancellation UI and API route', cell_left_small),
     Paragraph('Billing', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC4', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
    [Paragraph('1.9', cell_style), Paragraph('Implement PostgreSQL RLS policies on all tenant-scoped tables', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('CRITICAL', ParagraphStyle('RedC5', fontName='Tinos', fontSize=9, leading=13, textColor=RED, alignment=TA_CENTER)), Paragraph('3 days', cell_style)],
    [Paragraph('1.10', cell_style), Paragraph('Implement email verification flow for new registrations', cell_left_small),
     Paragraph('Admin', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC5', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
]
cw1 = [avail_w*0.06, avail_w*0.48, avail_w*0.13, avail_w*0.14, avail_w*0.12]
story.extend(make_table(phase1_data, cw1, 'Table 2: Phase 1 Tasks - Critical Fixes & Revenue Enablement'))

story.append(Paragraph(
    '<b>Phase 1 Expected Outcome:</b> After completing Phase 1, the platform will have a fundamentally secure '
    'authentication layer, working subscription billing with automatic renewal and expiry enforcement, compliant '
    'audit logging with tenant scoping, and active automated backups. The overall rating should improve from '
    '3.1 to approximately <b>3.9 out of 5.0</b>.', body_style))

# Phase 2
story.append(add_heading('<b>6.2 Phase 2: Feature Completion &amp; Operational Maturity (Weeks 4-8)</b>', h2_style, 1))
story.append(Paragraph(
    'Phase 2 focuses on completing partially-implemented features and adding operational maturity. These tasks '
    'will transform the platform from a functional prototype into a reliable, feature-complete SaaS product.', body_style))

phase2_data = [
    [Paragraph('<b>ID</b>', header_cell), Paragraph('<b>Task</b>', header_cell),
     Paragraph('<b>Domain</b>', header_cell), Paragraph('<b>Priority</b>', header_cell),
     Paragraph('<b>Effort</b>', header_cell)],
    [Paragraph('2.1', cell_style), Paragraph('Implement automated subscription renewal with payment retry (3 attempts)', cell_left_small),
     Paragraph('Billing', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC6', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('3 days', cell_style)],
    [Paragraph('2.2', cell_style), Paragraph('Build invoice/receipt PDF generation for subscription payments', cell_left_small),
     Paragraph('Billing', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC7', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('2.3', cell_style), Paragraph('Implement admin approval queue for new tenant signups', cell_left_small),
     Paragraph('Admin', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('2.4', cell_style), Paragraph('Inject custom_css into renderPage() head and verify white labeling works', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC8', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
    [Paragraph('2.5', cell_style), Paragraph('Implement custom domain DNS validation and routing middleware', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC2', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('5 days', cell_style)],
    [Paragraph('2.6', cell_style), Paragraph('Expand Redis caching to settings, feature flags, and common queries', cell_left_small),
     Paragraph('Scalability', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC9', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('2.7', cell_style), Paragraph('Implement per-API-key rate limiting', cell_left_small),
     Paragraph('API', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC3', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
    [Paragraph('2.8', cell_style), Paragraph('Enable webhook retry by default and build delivery dashboard UI', cell_left_small),
     Paragraph('API', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC4', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('2.9', cell_style), Paragraph('Implement admin UI for assigning permissions to roles', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC5', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('3 days', cell_style)],
    [Paragraph('2.10', cell_style), Paragraph('Implement compound conditions (AND/OR) in automation engine', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC6', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('2.11', cell_style), Paragraph('Set up external uptime monitoring (UptimeRobot) and alerting', cell_left_small),
     Paragraph('Admin', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC10', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
    [Paragraph('2.12', cell_style), Paragraph('Increase Sentry tracesSampleRate from 10% to 50%', cell_left_small),
     Paragraph('Admin', cell_style), Paragraph('LOW', ParagraphStyle('GreenC', fontName='Tinos', fontSize=9, leading=13, textColor=GREEN, alignment=TA_CENTER)), Paragraph('15 min', cell_style)],
]
story.extend(make_table(phase2_data, cw1, 'Table 3: Phase 2 Tasks - Feature Completion & Operational Maturity'))

story.append(Paragraph(
    '<b>Phase 2 Expected Outcome:</b> After Phase 2, the platform will have a fully automated billing lifecycle, '
    'working white labeling with custom domains, expanded caching for better performance, complete RBAC management '
    'UI, enhanced automation engine, and proactive monitoring. The rating should reach approximately '
    '<b>4.6 out of 5.0</b>.', body_style))

# Phase 3
story.append(add_heading('<b>6.3 Phase 3: Advanced Capabilities &amp; Differentiation (Weeks 9-14)</b>', h2_style, 1))
story.append(Paragraph(
    'Phase 3 introduces advanced capabilities that position the platform competitively against established SaaS '
    'products and open doors to enterprise customers. These are longer-term investments that compound in value '
    'over time.', body_style))

phase3_data = [
    [Paragraph('<b>ID</b>', header_cell), Paragraph('<b>Task</b>', header_cell),
     Paragraph('<b>Domain</b>', header_cell), Paragraph('<b>Priority</b>', header_cell),
     Paragraph('<b>Effort</b>', header_cell)],
    [Paragraph('3.1', cell_style), Paragraph('Implement full SAML SSO with admin configuration UI', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC7', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('5 days', cell_style)],
    [Paragraph('3.2', cell_style), Paragraph('Add OIDC support for modern identity providers (Auth0, Okta)', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC8', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('4 days', cell_style)],
    [Paragraph('3.3', cell_style), Paragraph('Build visual drag-and-drop automation workflow builder', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC11', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('7 days', cell_style)],
    [Paragraph('3.4', cell_style), Paragraph('Implement customizable dashboard with widget system', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC12', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('5 days', cell_style)],
    [Paragraph('3.5', cell_style), Paragraph('Replace inline SVG charts with interactive client-side charts (Chart.js)', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC9', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('5 days', cell_style)],
    [Paragraph('3.6', cell_style), Paragraph('Implement approval workflow engine (multi-step, configurable)', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC10', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('7 days', cell_style)],
    [Paragraph('3.7', cell_style), Paragraph('Add email whitelabeling (custom FROM per tenant via SendGrid/Mailgun)', cell_left_small),
     Paragraph('Portal', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC11', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('3 days', cell_style)],
    [Paragraph('3.8', cell_style), Paragraph('Implement pg_dump-based backup with encryption and rotation policy', cell_left_small),
     Paragraph('Ops', cell_style), Paragraph('HIGH', ParagraphStyle('AmberC13', fontName='Tinos', fontSize=9, leading=13, textColor=AMBER, alignment=TA_CENTER)), Paragraph('3 days', cell_style)],
    [Paragraph('3.9', cell_style), Paragraph('Add CDN integration for static assets (CloudFront/Cloudflare)', cell_left_small),
     Paragraph('Scalability', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC12', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('3.10', cell_style), Paragraph('Implement read replica support for database scaling', cell_left_small),
     Paragraph('Scalability', cell_style), Paragraph('LOW', ParagraphStyle('GreenC2', fontName='Tinos', fontSize=9, leading=13, textColor=GREEN, alignment=TA_CENTER)), Paragraph('3 days', cell_style)],
    [Paragraph('3.11', cell_style), Paragraph('Build audit log retention policy and immutability verification', cell_left_small),
     Paragraph('Security', cell_style), Paragraph('MEDIUM', ParagraphStyle('BlueC13', fontName='Tinos', fontSize=9, leading=13, textColor=BLUE, alignment=TA_CENTER)), Paragraph('2 days', cell_style)],
    [Paragraph('3.12', cell_style), Paragraph('Implement settings change audit trail (who changed what, when)', cell_left_small),
     Paragraph('Admin', cell_style), Paragraph('LOW', ParagraphStyle('GreenC3', fontName='Tinos', fontSize=9, leading=13, textColor=GREEN, alignment=TA_CENTER)), Paragraph('1 day', cell_style)],
]
story.extend(make_table(phase3_data, cw1, 'Table 4: Phase 3 Tasks - Advanced Capabilities & Differentiation'))

story.append(Paragraph(
    '<b>Phase 3 Expected Outcome:</b> After Phase 3, the platform will have enterprise-grade authentication options, '
    'a visual automation builder, interactive dashboards, approval workflows, proper encrypted backups, CDN-accelerated '
    'static assets, and full audit compliance. The rating should reach the target of <b>4.8 out of 5.0</b>.', body_style))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 7. DETAILED GAP-TO-FIX MAPPING
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>7. Detailed Gap-to-Fix Mapping</b>', h1_style, 0))
story.append(Paragraph(
    'The following table provides a comprehensive mapping of every identified gap to its corresponding fix task, '
    'current status, and expected resolution. This serves as a quick-reference checklist for tracking implementation '
    'progress across all 34 tasks.', body_style))

gap_data = [
    [Paragraph('<b>Gap</b>', header_cell), Paragraph('<b>Domain</b>', header_cell),
     Paragraph('<b>Current</b>', header_cell), Paragraph('<b>Fix Task</b>', header_cell),
     Paragraph('<b>Phase</b>', header_cell)],
    [Paragraph('CSRF enforcement disabled', cell_left_small), Paragraph('Security', cell_style),
     Paragraph('DISABLED', ParagraphStyle('RedSm', fontName='Tinos', fontSize=8.5, leading=12, textColor=RED, alignment=TA_CENTER)),
     Paragraph('1.1', cell_style), Paragraph('1', cell_style)],
    [Paragraph('Password min length = 4', cell_left_small), Paragraph('Security', cell_style),
     Paragraph('CRITICAL', ParagraphStyle('RedSm2', fontName='Tinos', fontSize=8.5, leading=12, textColor=RED, alignment=TA_CENTER)),
     Paragraph('1.2', cell_style), Paragraph('1', cell_style)],
    [Paragraph('Audit missing tenant_id', cell_left_small), Paragraph('Security', cell_style),
     Paragraph('CRITICAL', ParagraphStyle('RedSm3', fontName='Tinos', fontSize=8.5, leading=12, textColor=RED, alignment=TA_CENTER)),
     Paragraph('1.4', cell_style), Paragraph('1', cell_style)],
    [Paragraph('Subscription expiry not enforced', cell_left_small), Paragraph('Billing', cell_style),
     Paragraph('CRITICAL', ParagraphStyle('RedSm4', fontName='Tinos', fontSize=8.5, leading=12, textColor=RED, alignment=TA_CENTER)),
     Paragraph('1.5', cell_style), Paragraph('1', cell_style)],
    [Paragraph('No PostgreSQL RLS', cell_left_small), Paragraph('Security', cell_style),
     Paragraph('CRITICAL', ParagraphStyle('RedSm5', fontName='Tinos', fontSize=8.5, leading=12, textColor=RED, alignment=TA_CENTER)),
     Paragraph('1.9', cell_style), Paragraph('1', cell_style)],
    [Paragraph('bcrypt cost inconsistent', cell_left_small), Paragraph('Security', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('1.3', cell_style), Paragraph('1', cell_style)],
    [Paragraph('No email verification', cell_left_small), Paragraph('Admin', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm2', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('1.10', cell_style), Paragraph('1', cell_style)],
    [Paragraph('Auto backup disabled', cell_left_small), Paragraph('Ops', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm3', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('1.7', cell_style), Paragraph('1', cell_style)],
    [Paragraph('No subscription cancellation', cell_left_small), Paragraph('Billing', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm4', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('1.8', cell_style), Paragraph('1', cell_style)],
    [Paragraph('No automated renewal', cell_left_small), Paragraph('Billing', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm5', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('2.1', cell_style), Paragraph('2', cell_style)],
    [Paragraph('No invoice generation', cell_left_small), Paragraph('Billing', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm6', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('2.2', cell_style), Paragraph('2', cell_style)],
    [Paragraph('Custom CSS not injected', cell_left_small), Paragraph('Portal', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm7', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('2.4', cell_style), Paragraph('2', cell_style)],
    [Paragraph('Custom domain not routed', cell_left_small), Paragraph('Portal', cell_style),
     Paragraph('MEDIUM', ParagraphStyle('BlueSm', fontName='Tinos', fontSize=8.5, leading=12, textColor=BLUE, alignment=TA_CENTER)),
     Paragraph('2.5', cell_style), Paragraph('2', cell_style)],
    [Paragraph('Redis caching underused', cell_left_small), Paragraph('Scalability', cell_style),
     Paragraph('MEDIUM', ParagraphStyle('BlueSm2', fontName='Tinos', fontSize=8.5, leading=12, textColor=BLUE, alignment=TA_CENTER)),
     Paragraph('2.6', cell_style), Paragraph('2', cell_style)],
    [Paragraph('SAML SSO placeholder only', cell_left_small), Paragraph('Security', cell_style),
     Paragraph('MEDIUM', ParagraphStyle('BlueSm3', fontName='Tinos', fontSize=8.5, leading=12, textColor=BLUE, alignment=TA_CENTER)),
     Paragraph('3.1', cell_style), Paragraph('3', cell_style)],
    [Paragraph('No visual workflow builder', cell_left_small), Paragraph('Portal', cell_style),
     Paragraph('MEDIUM', ParagraphStyle('BlueSm4', fontName='Tinos', fontSize=8.5, leading=12, textColor=BLUE, alignment=TA_CENTER)),
     Paragraph('3.3', cell_style), Paragraph('3', cell_style)],
    [Paragraph('No pg_dump backups', cell_left_small), Paragraph('Ops', cell_style),
     Paragraph('HIGH', ParagraphStyle('AmberSm8', fontName='Tinos', fontSize=8.5, leading=12, textColor=AMBER, alignment=TA_CENTER)),
     Paragraph('3.8', cell_style), Paragraph('3', cell_style)],
    [Paragraph('No CDN integration', cell_left_small), Paragraph('Scalability', cell_style),
     Paragraph('MEDIUM', ParagraphStyle('BlueSm5', fontName='Tinos', fontSize=8.5, leading=12, textColor=BLUE, alignment=TA_CENTER)),
     Paragraph('3.9', cell_style), Paragraph('3', cell_style)],
]
cw_gap = [avail_w*0.34, avail_w*0.14, avail_w*0.15, avail_w*0.12, avail_w*0.10]
story.extend(make_table(gap_data, cw_gap, 'Table 5: Complete Gap-to-Fix Mapping'))

story.append(PageBreak())

# ═══════════════════════════════════════════════════════════
# 8. RATING METHODOLOGY
# ═══════════════════════════════════════════════════════════
story.append(add_heading('<b>8. Rating Methodology</b>', h1_style, 0))
story.append(Paragraph(
    'The platform rating is calculated using a weighted scoring methodology across all 14 sub-domains. Each '
    'sub-domain is rated on a 5-point scale based on feature completeness, implementation quality, and security '
    'posture. The weights reflect the relative business impact of each area.', body_style))

method_data = [
    [Paragraph('<b>Sub-Domain</b>', header_cell), Paragraph('<b>Weight</b>', header_cell),
     Paragraph('<b>Current Score</b>', header_cell), Paragraph('<b>Max Possible</b>', header_cell),
     Paragraph('<b>Weighted Score</b>', header_cell)],
    [Paragraph('Tenant Provisioning', cell_left), Paragraph('8%', cell_style),
     Paragraph('4.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.32', cell_style)],
    [Paragraph('Billing &amp; Subscription', cell_left), Paragraph('15%', cell_style),
     Paragraph('2.5', cell_style), Paragraph('5.0', cell_style), Paragraph('0.38', cell_style)],
    [Paragraph('Health Monitoring', cell_left), Paragraph('8%', cell_style),
     Paragraph('3.5', cell_style), Paragraph('5.0', cell_style), Paragraph('0.28', cell_style)],
    [Paragraph('Global Configuration', cell_left), Paragraph('5%', cell_style),
     Paragraph('4.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.20', cell_style)],
    [Paragraph('White Labeling', cell_left), Paragraph('7%', cell_style),
     Paragraph('3.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.21', cell_style)],
    [Paragraph('Tenant Dashboard', cell_left), Paragraph('7%', cell_style),
     Paragraph('3.5', cell_style), Paragraph('5.0', cell_style), Paragraph('0.25', cell_style)],
    [Paragraph('Custom Workflows', cell_left), Paragraph('5%', cell_style),
     Paragraph('2.5', cell_style), Paragraph('5.0', cell_style), Paragraph('0.13', cell_style)],
    [Paragraph('Data Isolation', cell_left), Paragraph('12%', cell_style),
     Paragraph('3.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.36', cell_style)],
    [Paragraph('RBAC', cell_left), Paragraph('8%', cell_style),
     Paragraph('3.5', cell_style), Paragraph('5.0', cell_style), Paragraph('0.28', cell_style)],
    [Paragraph('Federated Auth', cell_left), Paragraph('7%', cell_style),
     Paragraph('2.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.14', cell_style)],
    [Paragraph('Audit Logging', cell_left), Paragraph('5%', cell_style),
     Paragraph('3.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.15', cell_style)],
    [Paragraph('Scalability', cell_left), Paragraph('5%', cell_style),
     Paragraph('2.5', cell_style), Paragraph('5.0', cell_style), Paragraph('0.13', cell_style)],
    [Paragraph('API &amp; Webhooks', cell_left), Paragraph('5%', cell_style),
     Paragraph('4.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.20', cell_style)],
    [Paragraph('Automated Backups', cell_left), Paragraph('3%', cell_style),
     Paragraph('2.0', cell_style), Paragraph('5.0', cell_style), Paragraph('0.06', cell_style)],
    [Paragraph('<b>TOTAL</b>', ParagraphStyle('BoldLeft', fontName='Tinos', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_LEFT)),
     Paragraph('<b>100%</b>', ParagraphStyle('BoldCenter', fontName='Tinos', fontSize=9.5, leading=14, textColor=TEXT_PRIMARY, alignment=TA_CENTER)),
     Paragraph('', cell_style), Paragraph('', cell_style),
     Paragraph('<b>3.09</b>', ParagraphStyle('BoldCenter2', fontName='Tinos', fontSize=9.5, leading=14, textColor=RED, alignment=TA_CENTER))],
]
cw_m = [avail_w*0.30, avail_w*0.12, avail_w*0.16, avail_w*0.16, avail_w*0.16]
story.extend(make_table(method_data, cw_m, 'Table 6: Detailed Rating Methodology and Weighted Scores'))

story.append(Spacer(1, 18))

# ── Rating Scale Reference ──
story.append(Paragraph('<b>Rating Scale Reference:</b>', h3_style))
scale_data = [
    [Paragraph('<b>Rating</b>', header_cell), Paragraph('<b>Description</b>', header_cell), Paragraph('<b>Industry Equivalent</b>', header_cell)],
    [Paragraph('5.0', cell_style), Paragraph('Production-grade, enterprise-ready', cell_left), Paragraph('Salesforce, Shopify Plus', cell_left)],
    [Paragraph('4.0 - 4.9', cell_style), Paragraph('Mature SaaS with minor gaps', cell_left), Paragraph('Freshworks, Zoho One', cell_left)],
    [Paragraph('3.0 - 3.9', cell_style), Paragraph('Functional but needs hardening', cell_left), Paragraph('Early-stage SaaS startups', cell_left)],
    [Paragraph('2.0 - 2.9', cell_style), Paragraph('Prototype with security concerns', cell_left), Paragraph('MVP / internal tools', cell_left)],
    [Paragraph('1.0 - 1.9', cell_style), Paragraph('Development stage, not production-ready', cell_left), Paragraph('Proof of concept', cell_left)],
]
cw_s = [avail_w*0.15, avail_w*0.42, avail_w*0.33]
story.extend(make_table(scale_data, cw_s, 'Table 7: Rating Scale Reference'))

story.append(Spacer(1, 18))
story.append(Paragraph(
    'The Comfort Zone platform currently sits at <b>3.1 out of 5.0</b>, which places it in the "Functional but '
    'needs hardening" category. This is typical for a single-developer SaaS project that has prioritized feature '
    'breadth over operational depth. The good news is that the foundation is strong, and the work plan outlined '
    'in Section 6 provides a clear, actionable path to reaching the "Mature SaaS" tier at 4.8 out of 5.0 '
    'within approximately 14 weeks of focused development.', body_style))

story.append(Spacer(1, 12))
story.append(Paragraph(
    'The most critical insight from this analysis is that <b>Billing &amp; Subscription carries the highest weight '
    '(15%) but has the second-lowest score (2.5/5.0)</b>. This means fixing the subscription lifecycle (auto-renewal, '
    'expiry enforcement, cancellation, invoicing) will have the single largest impact on the overall rating AND '
    'directly enable revenue collection. These should be the absolute first priority after the critical security '
    'fixes in Phase 1.', body_style))

# ── Build ──
doc.multiBuild(story)
print(f'PDF generated: {output_path}')
