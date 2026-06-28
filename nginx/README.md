# Nginx Configuration

This directory contains the Nginx reverse proxy configuration for self-hosted
deployments of ssewasswa-api.

## When to use this

- **Render deployment (current):** Not needed. Render handles TLS, routing,
  and rate limiting. This file is documentation only — kept in the repo so the
  three-layer rate-limiting strategy (Cloudflare → Nginx → app) is documented
  end-to-end and the same config is ready if the project ever migrates off
  Render.
- **Self-hosted (VPS, EC2, DigitalOcean Droplet):** Use this config. Place at
  `/etc/nginx/sites-available/ssewasswa` and symlink to `sites-enabled/`.
- **Docker deployment:** Use this config in an Nginx container that proxies
  to the Node.js app container. See the example `docker-compose.yml` snippet
  at the bottom of this file.

## Setup

### 1. Install Nginx and certbot

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Copy the config

```bash
sudo cp nginx/ssewasswa.conf /etc/nginx/sites-available/ssewasswa
sudo ln -s /etc/nginx/sites-available/ssewasswa /etc/nginx/sites-enabled/ssewasswa
# Remove the default site to avoid conflicts on port 80/443
sudo rm -f /etc/nginx/sites-enabled/default
```

### 3. Get TLS certificates

For a single domain (e.g., the marketing site):

```bash
sudo certbot --nginx -d ssewasswa.onrender.com -d www.ssewasswa.onrender.com
```

For wildcard (custom client domains — `*.ssewasswa.com`):

```bash
sudo certbot certonly --manual --preferred-challenges dns -d *.ssewasswa.com -d ssewasswa.com
```

Then uncomment and edit the `ssl_certificate` / `ssl_certificate_key` lines in
`ssewasswa.conf` to point at the issued certs.

For per-domain certs (one cert per client domain — simpler operationally,
auto-renewable via HTTP-01):

```bash
# Run this once a new client onboards with their custom domain.
# Requires their DNS A-record to already point at your server.
sudo certbot --nginx -d schoolname.com
```

### 4. Test and reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

certbot installs a systemd timer that auto-renews certs 30 days before
expiry — no cron job needed.

## Rate limiting

The config defines four rate-limit zones:

| Zone            | Path                   | Rate        | Burst | Purpose                                              |
|-----------------|------------------------|-------------|-------|------------------------------------------------------|
| `public_verify` | `/public/verify/*`     | 10 req/min  | 5     | Certificate verification — very strict to prevent scraping |
| `public_api`    | `/api/public/*`        | 60 req/min  | 20    | General public API (verify JSON, events, news, etc.) |
| `login`         | `/api/auth/login`      | 5 req/min   | 3     | Brute-force protection                               |
| `api`           | `/api/*`               | 100 req/min | 50    | General API rate limit                               |

The app ALSO has its own rate limiting via `express-rate-limit` (see `server.js`
— search for `publicVerifyLimiter`, `publicBookingLimiter`, and the global
`apiLimiter`). Nginx rate limiting is defense-in-depth — it protects the app
from even receiving the request when the IP is abusive, which keeps the Node.js
event loop free for legitimate traffic.

See `docs/RATE_LIMITING.md` for the full three-layer strategy.

## Custom domain routing

Nginx uses `server_name _;` (wildcard) to accept all domains. The app then
resolves the tenant from the `Host` header via the `resolveTenantDomain`
middleware in `branding-currency.js`. This means:

1. A client types `https://schoolname.com` in their browser.
2. DNS resolves `schoolname.com` to your server's IP.
3. Nginx accepts the request (wildcard SNI), terminates TLS, and proxies to
   the Node.js app, passing `Host: schoolname.com` through via
   `proxy_set_header Host $host;`.
4. The app reads the `Host: schoolname.com` header and looks up
   `tenants.custom_domain = 'schoolname.com'`.
5. If found, the request is scoped to that tenant for the duration of the
   request (currency, branding, tenant_id filter on every SQL query).

For wildcard TLS certs (one cert covering `*.ssewasswa.com`), use DNS-01
challenge with certbot. For per-domain certs (one cert per client domain),
use HTTP-01 challenge — certbot can auto-provision these on demand when a new
client onboards.

## WebSocket

The `/ws` location block enables WebSocket proxying for real-time
notifications. The `Upgrade` and `Connection` headers are required for the
WebSocket handshake, and the long `proxy_read_timeout` / `proxy_send_timeout`
(24h) prevents Nginx from closing idle WebSocket connections.

## Stripe and PayPal webhooks

Webhook endpoints are exempt from rate limiting because the payment providers
retry on 429, which would cause duplicate processing. The config also disables
`proxy_request_buffering` for the Stripe webhook so the app receives the raw
body — Stripe signature verification requires the unmodified body, and Nginx's
default buffering can re-chunk the request in a way that breaks the signature
check.

## Docker example

A minimal `docker-compose.yml` snippet for a self-hosted deployment:

```yaml
version: "3.9"
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/ssewasswa
      - SESSION_SECRET=...
      - NODE_ENV=production
    depends_on:
      - db
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=ssewasswa
    volumes:
      - pgdata:/var/lib/postgresql/data
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/ssewasswa.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/letsencrypt:ro
    depends_on:
      - app
volumes:
  pgdata:
```

Note: when running Nginx in a container, change `upstream ssewasswa_app` in
`ssewasswa.conf` from `127.0.0.1:3000` to `app:3000` (the Docker service name).
