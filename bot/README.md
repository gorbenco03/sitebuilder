# Hidook Site Builder — bot & server ops

Commercial product is the **browser builder** (`/app/` on the same process). Telegram is acquisition / guided intake that creates or opens the **same** unpaid draft in that editor. Customers complete **payment before first public publish** in the builder as a **Stripe subscription with a 7-day trial** (**card required**) — site is **live immediately after a valid card**. There is no unpaid free live window and no second Telegram checkout/deploy happy path.

Public name: **Hidook Site Builder**. Pricing authority: `bot/pricing.js` — after trial, **99 EUR / 99 GBP / 99 USD** by country bucket (auto-charged on day 7 unless cancelled); **renewal 29** in the same currency / year via **subscription schedule**. Cancel during trial **unpublishes** the live site. Do not hardcode legacy `BUILD_FEE_EUR=49` as the commercial price. Owner owns live Stripe Product/Prices, Customer Portal, and refunds.

## Surfaces

| Surface | Role |
|---|---|
| Browser builder (`GET /app/*`, API under `/api/*`) | Account, editor, card/trial, publish, edit, renew — commercial happy path |
| Telegram bot | Draft intake only: conversation / wizard → same registry draft + magic-link or open-in-builder URL |
| HTTP server (`bot/server.js`) | Health, webhooks, builder static + API on `PORT` |

## Telegram intake (not the publisher)

1. `/start` — Welcome; AI chat (when configured) or wizard gathers business copy and photos.
2. When enough content exists, finish registers an **unpaid draft** in the shared site registry (status `draft`).
3. Bot returns a link into the **same browser editor** so the customer can refine, sign in, start **card/trial**, then publish.
4. Telegram must **not** run Stripe checkout → domain buy → live deploy as the operator happy path. Card/trial and first public publish live in the builder.

### Wizard fallback (`/wizard` or `AI_PROVIDER=none`)

Step-by-step: business name, slogan, about, products/services, optional socials/address, logo, gallery (`/gata` to finish). Outcome is still a **draft** opened in the builder — not a free live site.

### Commands

| Command | Effect |
|---|---|
| `/start` | Start AI intake (or wizard if `AI_PROVIDER=none`) |
| `/wizard` | Force step-by-step wizard |
| `/gata` | Finish gallery in wizard mode |
| `/anuleaza` | Reset current session |

## Browser builder (commercial path)

1. Open builder → pick design → replace copy/images → preview.
2. Sign in (magic link when email is configured).
3. Start **Stripe subscription checkout** — **7-day trial**, **card required** (`pricing.js` amounts).
4. Site goes **live immediately after a valid card**; first **public** production publish is allowed on trial/card-on-file status.
5. After day 7, Stripe **auto-charges 99** unless cancelled; edit + republish; renew at **29** / year via subscription schedule.
6. Cancel during trial → live site **unpublished** (no charge).

Local/staging may use test Stripe and `HIDOOK_FAKE_DEPLOY=1` (refused when `NODE_ENV=production`). Fake deploy is not the client journey.

## Start locally

```bash
cd bot
npm install      # once

# Telegram intake only (no AI):
TELEGRAM_BOT_TOKEN=xxxxx npm start

# With AI:
TELEGRAM_BOT_TOKEN=xxxxx AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npm start

# Full local stack (builder API + Telegram + test payments — see DEPLOY.md):
TELEGRAM_BOT_TOKEN=xxxxx \
  SERVER_SECRET=$(openssl rand -hex 32) \
  PUBLIC_URL=http://127.0.0.1:3000 \
  AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... \
  STRIPE_SECRET_KEY=sk_test_... \
  npm start
```

Commercial amounts come from `bot/pricing.js`. Do not set `BUILD_FEE_EUR=49` to “match docs”; that is obsolete.

## Environment variables

### Required for Telegram process

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather (`/newbot`) |

### Required for browser builder API

| Variable | Description |
|---|---|
| `SERVER_SECRET` | Random 32+ char secret for HMAC session cookies. Without it, `/api/auth/*` and `/api/me` return 503. |
| `PUBLIC_URL` | Public base URL (magic links, Stripe return URLs), e.g. `https://lp.hidook.agency` |

### AI (optional — without it, Telegram uses wizard)

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `anthropic` or `openai` (default: `none`) |
| `ANTHROPIC_API_KEY` | When `AI_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | When `AI_PROVIDER=openai` |
| `AI_MODEL` | Optional model override |

### Payments (builder subscription trial)

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret (`sk_live_...` / `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for `POST /webhooks/stripe` |
| `PAYMENT_PROVIDER` | e.g. `stripe` |
| `STRIPE_PRICE_ID_*` / `STRIPE_PRICE_ID_RENEWAL_*` | Optional Dashboard Price ids (first year 99 / renewal 29) |
| `BOT_USERNAME` | Optional; legacy Telegram success/cancel URL helper |

**Price:** use `bot/pricing.js` (99 EUR / 99 GBP / 99 USD after trial; renewal 29 / year via subscription schedule). Do not document or rely on `BUILD_FEE_EUR` default 49 as the product price.

### Deploy providers (trial/paid publish)

| Variable | Description |
|---|---|
| `DEPLOY_PROVIDER` | e.g. `cloudflare` or Vercel path via `VERCEL_TOKEN` |
| `VERCEL_TOKEN` / `VERCEL_TEAM_ID` | Vercel deploy + domains |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Pages |
| `NETLIFY_TOKEN` | Legacy Netlify fallback |
| `HIDOOK_FAKE_DEPLOY` | Test only (`1` stubs deploys). **Refused in production.** |

### Email (magic link)

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | When set, magic-link mail via Resend; else link logged / returned as `devLink` |
| `EMAIL_FROM` | Sender when Resend is set |

## Technical notes

- **Drafts without a card** stay non-public. **Payment before first production publish** is enforced in the builder/API as card-on-file **subscription trial** — not via a free live `TRIAL_DAYS` window.
- **Stripe webhooks** on `POST /webhooks/stripe` are the source of truth for trial start / paid; pollers may exist as fallback.
- **Cancel during trial** unpublishes the live site in product; owner-owned Customer Portal/Dashboard handles refunds after charge.
- **Sessions** may be in-memory or under `DATA_DIR`; use a persistent volume in production.
- **Schema** — configs use `categories` (not a flat `gallery`). See repo root docs for template details.

## File map

```
bot/
  bot.js             — Telegram Bot wiring
  flow.js            — Telegram intake / draft finish
  server.js          — HTTP: health, webhooks, builder API
  pricing.js         — Single commercial pricing source (99 / renewal 29)
  ai.js              — AI adapter (Hidook identity)
  payments.js        — Checkout helpers (subscription + schedule)
  webpublish.js      — Builder trial/pay + publish path
  deploy-*.js        — Deploy adapters
  email.js           — Magic-link mail (Hidook brand)
```

For Railway / Docker operator setup, see `DEPLOY.md`.
