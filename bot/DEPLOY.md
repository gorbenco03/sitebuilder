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
- `REVOLUT_SECRET_KEY` + `REVOLUT_ENV` (`sandbox` or `production`) — payments
- `BUILD_FEE_USD` (default 29), `DOMAIN_MARKUP_USD` (default 0)
- `ADMIN_CHAT_ID` — your Telegram numeric id, to get a DM on each new site/payment
  (get it by messaging @userinfobot)
- For real domain purchases: `REGISTRANT_FIRST_NAME`, `REGISTRANT_LAST_NAME`, `REGISTRANT_EMAIL`,
  `REGISTRANT_PHONE` (E.164, e.g. `+40.721234567`), `REGISTRANT_ADDRESS1`, `REGISTRANT_CITY`,
  `REGISTRANT_STATE`, `REGISTRANT_ZIP`, `REGISTRANT_COUNTRY` (ISO-2) — and a card on the Vercel account.

## 5. Deploy
Railway builds + starts automatically. Logs should show `🤖 Bot pornit ca @<username>`.
The bot is now live 24/7. Only one instance may poll a token at a time — keep replicas = 1.

## Notes
- To run locally instead: `cd bot && node --env-file=.env bot.js`.
- Build the image locally to test: `docker build -t desserd-bot . && docker run --rm --env-file bot/.env -e DATA_DIR=/data desserd-bot`.
- Health: the process exits non-zero only on fatal startup errors; Railway restarts it automatically.
