# Task r3: Email-Based User Invitations with Accept/Reject Flow

## Summary
Built a complete email-based user invitation system for the ssewasswa-api platform.

## Changes Made

### 1. fix-schema-gaps.js
- Added `user_invitations` table with columns: id, tenant_id, email, role, token, invited_by, expires_at, accepted_at, declined_at, created_at
- Added 2 indexes: `idx_invitations_token` on token, `idx_invitations_tenant` on tenant_id
- Added `user_invitations` to VALID_TABLES entries

### 2. server.js — Database
- Added `user_invitations` to VALID_TABLES set

### 3. server.js — CSRF Exemptions
- Added `/invite/accept` and `/invite/decline` to CSRF_EXEMPT_PATHS (unauthenticated users can't have CSRF cookies)

### 4. server.js — Invitation Routes (6 new routes)
- **POST /team/invite-email** — Admin sends invitation email with accept/decline buttons, 7-day token expiry, duplicate checks
- **GET /invite/accept?token=xxx** — Registration form showing org name, role, pre-filled email; validates token state
- **POST /invite/accept** — Creates user account, marks invitation accepted, auto-logs in, redirects to dashboard
- **GET /invite/decline?token=xxx** — Decline confirmation page with org details
- **POST /invite/decline** — Marks invitation declined, shows confirmation
- **GET /team/invite/cancel/:id** — Admin cancels pending invitation

### 5. server.js — Team Page Updates
- Added "Invite by Email" card with email + role selector form
- Added "Pending Invitations" table with cancel action
- Added success toast messages via ?msg= query parameter
- Renamed existing "Add Team Member" to "Add Team Member (Manual)"

## Security
- Token: `crypto.randomBytes(32).toString('hex')` (64 hex chars, 256 bits)
- All HTML output uses `esc()` for XSS prevention
- Admin-only routes: `requireAuth + requireNotBanned + requireRole('admin')`
- Unauthenticated routes: accept/decline (user has no account yet)
- Duplicate user check before creating account
- Duplicate pending invitation check before sending
- Token expiry validation on every access
- Audit logging for all invitation actions
