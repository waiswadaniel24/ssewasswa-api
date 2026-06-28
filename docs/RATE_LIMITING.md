# Rate Limiting Strategy

The platform has three layers of rate limiting, each defending against a
different class of abusive traffic. The layers are independent — bypassing
one (e.g., during local development with no Nginx) does not disable the
others.

```
   Internet  →  Cloudflare (Layer 1)  →  Nginx (Layer 2)  →  Express app (Layer 3)
                                                                     ↓
                                                              blockchain_certificates
                                                                  Postgres
```

## Layer 1: Cloudflare (edge)

- Applied at the CDN edge (Cloudflare is already in front of
  `ssewasswa.onrender.com`).
- Blocks the most abusive traffic before it reaches Render — DDoS mitigation,
  bot challenges, geo-blocking.
- Configured via the Cloudflare dashboard (not in this repo).
- Recommended rules:
  - Challenge page for >1,000 req/min per IP
  - Block for >10,000 req/min per IP
  - Challenge page for >100 req/min to `/public/verify/*` (mirrors Layer 2/3)

## Layer 2: Nginx (reverse proxy — for self-hosted deployments only)

- See `nginx/ssewasswa.conf` for the config.
- Per-endpoint zones, applied at the reverse-proxy layer so abusive requests
  are rejected before they reach the Node.js event loop:

  | Zone            | Path                  | Rate        | Burst | Purpose                                        |
  |-----------------|-----------------------|-------------|-------|------------------------------------------------|
  | `public_verify` | `/public/verify/*`    | 10 req/min  | 5     | Certificate verification — very strict         |
  | `public_api`    | `/api/public/*`       | 60 req/min  | 20    | General public API (verify JSON, events, news) |
  | `login`         | `/api/auth/login`     | 5 req/min   | 3     | Brute-force protection                         |
  | `api`           | `/api/*`              | 100 req/min | 50    | General API rate limit                         |

- Returns HTTP 429 with the standard `Retry-After` header when exceeded.
- On Render (current production), this layer is documentation only — Render
  handles TLS and routing, and there is no Nginx in front. Layer 3 still
  protects the app.

## Layer 3: Application (`express-rate-limit`)

- See `server.js` — search for `publicVerifyLimiter`, `publicBookingLimiter`,
  `globalLimiter`, and the inline limiters on `/login`, `/register`, `/api/`,
  `/dev/`, `/billing`, `/pay/`, `/momo/`, `/api/v1`, `/api/v2`, and
  `/forgot-password`.
- Same limits as Nginx (defense in depth) — the strict `publicVerifyLimiter`
  (10 req/min, 1-min window) mirrors the Nginx `public_verify` zone.
- Returns JSON error with `retry_after_seconds` field (e.g., for
  `/public/verify` and `/api/public/verify`):
  ```json
  {
    "error": "Too many verification requests from this IP. Please try again in a minute.",
    "retry_after_seconds": 60
  }
  ```
- The IP key is taken from `X-Forwarded-For` (set by Cloudflare / Nginx /
  Render's proxy) if present, else from `req.ip`. The first IP in the XFF
  list is the original client.

## Why three layers?

- **Cloudflare** blocks DDoS attacks that would otherwise overwhelm the
  server's network connection — even a single malicious request can never
  reach Render if Cloudflare challenges/blocks it.
- **Nginx** blocks abusive clients that pass through Cloudflare (e.g.,
  scrapers using rotating residential IPs that look like real browsers to
  Cloudflare's bot management). Rejecting at Nginx means the Node.js event
  loop is never touched, which preserves throughput for legitimate users.
- **App-level** blocking is the last line of defense and works even when
  Cloudflare/Nginx are bypassed — e.g., during local development, when
  Nginx is misconfigured, or when the app is run behind a different proxy
  (Render's built-in proxy, AWS ALB, etc.).

## Endpoint-specific limits (full table)

| Endpoint                       | Layer 1 (Cloudflare) | Layer 2 (Nginx)   | Layer 3 (express-rate-limit)               |
|--------------------------------|----------------------|-------------------|--------------------------------------------|
| `/public/verify/*` (HTML UI)   | ~100 req/min         | 10 req/min + 5    | `publicVerifyLimiter` — 10 req/min + 0     |
| `/api/public/verify/:certCode` | ~100 req/min         | 60 req/min + 20*  | `publicVerifyLimiter` — 10 req/min + 0     |
| `/api/public/*`                | ~100 req/min         | 60 req/min + 20   | general `/api/` limiter (server.js:869)    |
| `/api/auth/login`              | ~100 req/min         | 5 req/min + 3     | `/login` limiter (server.js:867)           |
| `/api/*` (general)             | ~100 req/min         | 100 req/min + 50  | general `/api/` limiter (server.js:869)    |
| `/clinic/book/*`               | ~100 req/min         | 100 req/min + 50  | `publicBookingLimiter` — 5 per 15 min      |
| `/forgot-password`             | ~100 req/min         | 100 req/min + 50  | inline — 3 per hour                        |

\* The Nginx `public_api` zone (60 req/min) applies to `/api/public/*` broadly.
The stricter `public_verify` zone is currently scoped to `/public/verify`
only (the HTML UI). The app-level `publicVerifyLimiter` (10 req/min) is
mounted at BOTH `/public/verify` AND `/api/public/verify` in server.js, so
the JSON endpoint gets the 10 req/min limit at the app layer regardless of
which Nginx zone matches at Layer 2.

## Customizing limits

To change the limits:

1. **Nginx (Layer 2):** edit `nginx/ssewasswa.conf` — the four
   `limit_req_zone` directives at the top of the file. Adjust the `rate=`
   parameter and the `burst=` parameter on each `limit_req` directive.
2. **App (Layer 3):** edit `server.js` — search for `publicVerifyLimiter`
   (line ~40910 as of Track C) and adjust `windowMs` and `max`.
3. **Reload Nginx:** `sudo systemctl reload nginx`
4. **Restart the Node.js app:** `pm2 restart ssewasswa` or
   `systemctl restart ssewasswa` (or, on Render, the deploy will pick up the
   change automatically on the next push).

## Webhooks — explicitly exempt

Stripe (`/api/payments/stripe/webhook`) and PayPal
(`/api/payments/paypal/webhook`) endpoints are EXEMPT from rate limiting at
all three layers:

- Cloudflare: webhooks come from Stripe/PayPal's egress IPs, which Cloudflare
  allowlists by default for verified merchants.
- Nginx: the config has explicit `location =` blocks for both webhook paths
  with NO `limit_req` directive.
- App: neither `publicVerifyLimiter` nor the general `/api/` limiter matches
  these paths because the Nginx-level exemption is sufficient and the payment
  providers retry on 429, which would cause duplicate processing (double
  charges, double subscription activations, etc.).

Additionally, the Stripe webhook block has `proxy_request_buffering off;` so
the app receives the raw request body — Stripe signature verification
requires the unmodified body, and Nginx's default buffering can re-chunk the
request in a way that breaks the signature check.

## Testing rate limits locally

To verify the app-level `publicVerifyLimiter` is working without a real
certificate in the DB:

```bash
# Fire 15 rapid requests to a non-existent cert code.
# Expect: first ~10 return 404 JSON, then 429 with the retry_after_seconds field.
for i in {1..15}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    https://ssewasswa.onrender.com/api/public/verify/BC-FAKE-CODE-$i
done
```

To verify the Nginx layer (self-hosted only), run the same loop against your
server's domain and check the response headers — the `Retry-After` header
should appear on the 429 responses.
