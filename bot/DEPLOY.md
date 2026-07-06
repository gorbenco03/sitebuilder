# Deploy DESSERD bot 24/7 on Railway

The bot uses Telegram **long-polling**, so it needs no public URL — just a process
that stays running. Railway runs the `Dockerfile` at the repo root.

## 1. Push the repo to GitHub
Railway deploys from a Git repo. Make sure the repo (with `Dockerfile`) is on GitHub.

## 2. Create the Railway project
1. https://railway.app → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Railway auto-detects the `Dockerfile` and builds it.

## 3. Add a persistent volume (so sessions survive redeploys)
1. In the service → **Variables/Settings** → **Volumes** → add a volume mounted at **`/data`**.
   (`DATA_DIR=/data` is already set in the Dockerfile; `.sessions.json` + `.sites-map.json` live there.)

## 4. Set environment variables (Service → Variables)
Required:
- `TELEGRAM_BOT_TOKEN` — from @BotFather

Recommended / for full functionality:
- `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` (+ optional `AI_MODEL=claude-haiku-4-5-20251001`)
- `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`) — site deploy + domains
- `DEPLOY_PROVIDER=cloudflare` + `CLOUDFLARE_API_TOKEN` (Pages:Edit) + `CLOUDFLARE_ACCOUNT_ID`
  — deploy client sites to Cloudflare Pages (`https://<slug>.pages.dev`) instead of Vercel.
  The image ships the `wrangler` CLI, which the deploy adapter shells out to.
- **Payments (Stripe, UK Ltd):** `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET` (from the Stripe Dashboard webhook endpoint pointing at
  `https://<railway-public-domain>/webhooks/stripe`, event `checkout.session.completed`).
  The webhook is the source of truth for "paid"; the poller/sweeper remain as fallback.
  Railway injects `PORT` — the in-process HTTP server (`bot/server.js`) binds it and also
  serves `GET /health`.
- `REVOLUT_SECRET_KEY` + `REVOLUT_ENV` (`sandbox` or `production`) — alternative payments (polling only)
- `BUILD_FEE_EUR` (default 49), `DOMAIN_MARKUP_USD` (default 0)
- `ADMIN_CHAT_ID` — your Telegram numeric id, to get a DM on each new site/payment
  (get it by messaging @userinfobot)
- For real domain purchases: `REGISTRANT_FIRST_NAME`, `REGISTRANT_LAST_NAME`, `REGISTRANT_EMAIL`,
  `REGISTRANT_PHONE` (E.164, e.g. `+40.721234567`), `REGISTRANT_ADDRESS1`, `REGISTRANT_CITY`,
  `REGISTRANT_STATE`, `REGISTRANT_ZIP`, `REGISTRANT_COUNTRY` (ISO-2) — and a card on the Vercel account.

## 5. Web Builder (API + site editor)

The same process also serves the web-based site builder on the same PORT:

| Env var | Required | Description |
|---------|----------|-------------|
| `SERVER_SECRET` | **yes** | Random 32-char secret for HMAC session cookies. Without it, all `/api/auth/*` and `/api/me` routes respond 503. Generate with: `openssl rand -hex 32` |
| `PUBLIC_URL` | yes for magic links | Full public URL of the service, e.g. `https://myapp.up.railway.app`. Used to build the `/auth/verify?token=…` link in magic-link emails. |
| `RESEND_API_KEY` | no | When set, magic-link emails are sent via [Resend](https://resend.com). Without it, the link is logged to stdout (`devLink` is also returned in the API response for dev mode). |
| `EMAIL_FROM` | no | Sender address for magic-link emails (default: `onboarding@resend.dev`). Only used when `RESEND_API_KEY` is set. |
| `BUILD_FEE_EUR` | no | One-time site build fee in EUR cents (default `49`). Same env as the Telegram bot. |
| `ALLOW_FREE_PUBLISH` | dev only | Set to `1` to skip payment and publish immediately. **Never set in production.** |
| `SITES_DIR` / `DATA_DIR` | no | Persistent volume for built sites and registry data. Railway mounts `/data`; `DATA_DIR=/data` is set in the Dockerfile. |

Static files for the builder UI are served from `<repo>/builder/` at `GET /app/*`.
The parallel agent builds the full UI; a minimal `builder/index.html` is shipped as a placeholder.

Stripe webhook for web payments: the existing `POST /webhooks/stripe` endpoint now dispatches
events by `metadata.platform`: `web` → `webpublish.handleStripePaid`; `telegram` (default) → `flow.handleStripeWebhookEvent`.
Make sure the Stripe webhook in the dashboard sends `checkout.session.completed` to `https://<domain>/webhooks/stripe`.

## 6. Deploy
Railway builds + starts automatically. Logs should show `🤖 Bot pornit ca @<username>`.
The bot is now live 24/7. Only one instance may poll a token at a time — keep replicas = 1.

## Notes
- To run locally instead: `cd bot && node --env-file=.env bot.js`.
- Build the image locally to test: `docker build -t desserd-bot . && docker run --rm --env-file bot/.env -e DATA_DIR=/data desserd-bot`.
- Health: the process exits non-zero only on fatal startup errors; Railway restarts it automatically.
