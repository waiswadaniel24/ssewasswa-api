# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ssewasswa-api, please report it responsibly:

1. **DO NOT open a public GitHub issue.**
2. Email: `security@comfortzone.co.ug` (placeholder — replace with the owner's actual security email before publicizing).
3. Include a clear description of the vulnerability, steps to reproduce, and potential impact.
4. You will receive an acknowledgment within 48 hours and a fix timeline within 7 days.

## Supported Versions

| Version | Supported            |
|---------|----------------------|
| 9.0.x   | ✓ Active development |
| < 9.0   | ✗ Not supported      |

## Security Measures in Place

- HTTPS-only (Render enforces TLS)
- Helmet CSP headers
- bcrypt password hashing (12 rounds)
- TOTP-based 2FA via otplib
- Rate limiting on auth endpoints
- CSRF protection on session cookies
- Multi-tenant data isolation
- Audit logging (90-day retention)
- GitHub Secret Scanning enabled (push protection on for public repos)
- Dependabot alerts and weekly security PRs (see `.github/dependabot.yml`)
- CodeQL automated SAST scanning (see `.github/workflows/codeql.yml`)

## Known Limitations

- The database user `ssewasswa_comfort_zone_user` currently has `CREATEDB` and
  `CREATEROLE` privileges — this should be tightened to only the privileges the
  app needs (CREATE TABLE, INSERT, UPDATE, DELETE, SELECT on the public schema).
- Session secrets are currently regenerated on every deploy (audit finding —
  being fixed).
- The `security@comfortzone.co.ug` reporting email above is a placeholder until
  the repo owner confirms the real address.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will publish a
security advisory on GitHub and credit the reporter (unless they prefer to
remain anonymous).
