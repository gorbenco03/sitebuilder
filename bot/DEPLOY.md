# Deploy Hidook Site Builder (bot + browser builder) 24/7 on Railway

One process serves:

- **Browser builder** (commercial product): static UI under `/app/*`, account/API, **payment before public publish** via Stripe **subscription + 7-day card trial**
- **Telegram bot**: long-polling intake that opens the **same** unpaid draft in the builder (not a second checkout/deploy state machine)

Telegram long-polling needs no public URL for polling itself; the HTTP server still needs a public URL for webhooks, magic links, and the builder. Railway runs the `Dockerfile` at the repo root.

**Product:** Hidook Site Builder. **Pricing source:** `bot/pricing.js` — **99 EUR / 99 GBP / 99 USD** by country bucket after the trial (auto-charged on day 7 unless cancelled); **renewal 29** same currency / year via **subscription schedule**. **Card required**; site **live immediately after a valid card**. Cancel during trial **unpublishes**. No unpaid free live window. Owner owns live Stripe Product/Prices, Customer Portal, and refunds.

## 1. Push the repo to GitHub

Railway deploys from a Git repo. Ensure the repo (with `Dockerfile`) is on GitHub.

## 2. Create the Railway project

1. https://railway.app → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Railway auto-detects the `Dockerfile` and builds it (including `npm run build:app` / builder bake).

## 3. Add a persistent volume

1. Service → **Variables/Settings** → **Volumes** → mount at **`/data`**.
   (`DATA_DIR=/data` is set in the Dockerfile; sessions, registry, and built artifacts live there.)

## 4. Environment variables (Service → Variables)

### Required

- `TELEGRAM_BOT_TOKEN` — from @BotFather (if you run Telegram intake)
- `SERVER_SECRET` — random 32+ char secret for builder session cookies (`openssl rand -hex 32`). Without it, builder auth routes return 503.
- `PUBLIC_URL` — full public URL of this service (magic links + Stripe returns), e.g. `https://myapp.up.railway.app`

### Recommended / full functionality

- `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ optional `AI_MODEL=...`) — Telegram guided intake
- `RESEND_API_KEY` + optional `EMAIL_FROM` — magic-link email for builder sign-in
- **Deploy (trial/paid publish):**
  - `DEPLOY_PROVIDER=cloudflare` + `CLOUDFLARE_API_TOKEN` (Pages:Edit) + `CLOUDFLARE_ACCOUNT_ID`
    — client sites to Cloudflare Pages. Image includes `wrangler`.
  - and/or `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`) — Vercel deploy + domains path
- **Payments (Stripe subscription trial):** `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET` (Dashboard webhook → `https://<railway-public-domain>/webhooks/stripe`,
  event `checkout.session.completed`). Webhook is source of truth for trial start / card-on-file / paid;
  poller/sweeper may remain as fallback. Optional `STRIPE_PRICE_ID_*` / `STRIPE_PRICE_ID_RENEWAL_*`
  for Dashboard catalog Prices (first year 99 / renewal 29 schedule).
  Railway injects `PORT` — `bot/server.js` binds it and serves `GET /health`.
- Optional alternate payments: `REVOLUT_SECRET_KEY` + `REVOLUT_ENV` (`sandbox` or `production`)
- `ADMIN_CHAT_ID` — Telegram numeric id for ops DMs on notable events
- `CONTACT_URL` — URL/text after payment for custom-domain concierge (e.g. `https://t.me/hidook`)
- `BRAND_DOMAIN` — if set with Cloudflare deploy, best-effort `<slug>.<BRAND_DOMAIN>` attach
- Domain purchase extras (only if you enable registrar purchase): `REGISTRANT_*` fields + card on the provider account

### Pricing (do not use legacy fee defaults)

Commercial amounts are **not** `BUILD_FEE_EUR` default 49. Operators should leave fee overrides unset and rely on **`bot/pricing.js`**:

| | After 7-day card trial | Renewal (subscription schedule) |
|---|---|---|
| EU → EUR | **99** | **29** / year |
| UK → GBP | **99** | **29** / year |
| Rest → USD | **99** | **29** / year |

Do **not** set `TRIAL_DAYS` for a free live publish window. There is **no** “sites are published immediately for free” model. Drafts without a card stay non-public; **payment before first public publish** is the **7-day card-required subscription trial** (live immediately after a valid card). Cancel during trial unpublishes.

### Test-only (never production)

| Env var | Notes |
|---------|--------|
| `HIDOOK_FAKE_DEPLOY=1` | Stub deploys (`https://<slug>.test.local`). **Refused when `NODE_ENV=production`.** Not the client journey. |
| `ALLOW_FREE_PUBLISH=1` | Legacy dev skip. **Never set in production.** |

### Persistence

| Env var | Notes |
|---------|--------|
| `SITES_DIR` / `DATA_DIR` | Persistent volume paths. Railway: `DATA_DIR=/data`. |

## 5. Web builder

Static builder UI is served from `<repo>/builder/` at `GET /app/*` (image bake runs the builder build so `/app/` is not empty).

Stripe webhook dispatches by `metadata.platform`: `web` → builder subscription-trial publish path; Telegram metadata must not reintroduce a separate Telegram live-deploy commerce path as the happy path. Ensure Dashboard sends `checkout.session.completed` to `https://<domain>/webhooks/stripe`.

## 6. Deploy

Railway builds + starts automatically. Logs should show the bot starting as `@<username>` when the token is set, and the HTTP server on `PORT`. Keep replicas = 1 for Telegram long-polling (one poller per token).

## Notes

- Local: `cd bot && node --env-file=.env bot.js` (or your process manager).
- Build image locally: `docker build -t hidook-site-builder . && docker run --rm --env-file bot/.env -e DATA_DIR=/data -e SERVER_SECRET=... hidook-site-builder`.
- Health: non-zero exit only on fatal startup; platform restarts the process. `GET /health` on the bound port.
