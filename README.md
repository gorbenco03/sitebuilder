# Hidook Site Builder

Public name: **Hidook Site Builder**. Commercial product is the **browser builder** (account, editor, pay, publish, edit, renew). Telegram is acquisition / guided intake that creates or opens the **same** unpaid draft in that editor — not a second checkout or deploy state machine.

**Pay before first public publish.** Price **99 EUR / 99 GBP / 99 USD** by country bucket; **renewal 29** in the same currency / year. Pricing authority: `bot/pricing.js`. Product contract: `PRODUCT.md`.

Do not treat legacy DESSERD / desserdina Telegram-publish or `$29` / `BUILD_FEE_USD` packaging as the product.

## Surfaces

| Surface | Role |
|---|---|
| Browser builder (`builder/`, served at `/app/`) | Commercial happy path: design, copy, pay, publish |
| Telegram bot (`bot/`) | Draft intake only → same registry draft + open-in-builder link |
| Static renderer (`build.js` + `template.html` + `config.json`) | Zero-dep HTML generation used by publish pipelines |
| Sample site files (`config.json`, `index.html`, …) | Example customer brochure data — not operator product copy |

## Repo layout

| Path | Role |
|---|---|
| `PRODUCT.md` | Product contract (authority for agents) |
| `AGENTS.md` | Standing rules for workers |
| `builder/` | Browser builder UI (engine generated via `npm run build:app`) |
| `bot/` | HTTP server, Telegram intake, payments, deploy, registry |
| `bot/pricing.js` | Single commercial pricing source (99 / renewal 29) |
| `templates/` | Design-system templates |
| `build.js` | Generates `index.html` from `template.html` + `config.json` |
| `config.json` | Sample customer site data (not Hidook operator branding) |
| `LAUNCH.md` | Team-oriented launch notes (local/test only unless owner gates) |

## Commercial path (customer)

1. Open the browser builder → pick a design → replace copy/images → preview.
2. Sign in (magic link when email is configured).
3. **Pay** 100 in the resolved currency bucket.
4. First **public** production publish only after paid status; then edit + republish; renew at 29 / year.

Telegram never replaces steps 3–4. Ops detail: `bot/README.md`.

## Static site render (sample / pipeline)

```bash
node build.js
```

Writes `index.html` from `template.html` + `config.json`. Zero npm dependencies for the renderer. The sample bakery-style `config.json` / `index.html` in the repo root are **customer-site examples**, not the Hidook product name.

### Template syntax (short)

- `{{business.name}}` — value at that path in `config.json`.
- Repeatable blocks:

  ```html
  <!-- @each services -->
    <li>{{icon}} {{label}}</li>
  <!-- @end -->
  ```

- Nested loops (`categories` → `photos`) resolve inner paths on the inner element.

## Local development

```bash
# Bot + builder API (see bot/README.md for full env)
cd bot && npm install
TELEGRAM_BOT_TOKEN=xxxxx \
  SERVER_SECRET=$(openssl rand -hex 32) \
  PUBLIC_URL=http://127.0.0.1:3000 \
  STRIPE_SECRET_KEY=sk_test_... \
  npm start
```

Local/staging may use **test** Stripe and fake-or-isolated deploy (`HIDOOK_FAKE_DEPLOY=1`, refused when `NODE_ENV=production`). Fake deploy is not the client journey. Production Stripe, live DNS for hidook.agency, and owner launch gates are **owner-only** — see `PRODUCT.md` and `bot/DEPLOY.md`.

```bash
# Optional static preview of generated sample site
node .claude/serve.js   # http://localhost:4173
```

## Tests

```bash
node bot/test/*.test.js
```

No `npm test` script; run the Node tests directly. Do not weaken assertions.

## Docs map

| Doc | Audience |
|---|---|
| `PRODUCT.md` | Product truth |
| `bot/README.md` | Bot/server operator surface |
| `bot/DEPLOY.md` | Deploy env and staging notes |
| `LAUNCH.md` | Commercial positioning for the team (not live production checklist) |
| `CLOUDFLARE-DEPLOY.md` | Provider-specific deploy notes |
