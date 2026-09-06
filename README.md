# Hidook Site Builder

Public name: **Hidook Site Builder**. Commercial product is the **browser builder** (account, editor, card/trial, publish, edit, renew). Telegram is acquisition / guided intake that creates or opens the **same** unpaid draft in that editor — not a second checkout or deploy state machine.

**Payment before first public publish** = Stripe **subscription** with a **7-day trial**, **card required**. Site is **live immediately after a valid card**. If the customer does not cancel, Stripe **auto-charges 99 EUR / 99 GBP / 99 USD** (country bucket) after day 7; **renewal 29** same currency / year via **subscription schedule**. Cancel during trial **unpublishes** the live site. Pricing authority: `bot/pricing.js`. Product contract: `PRODUCT.md`. Owner owns live Stripe Product/Prices, Customer Portal, and refunds.

Do not treat legacy DESSERD / desserdina Telegram-publish or `$29` / `BUILD_FEE_USD` packaging as the product.

## Surfaces

| Surface | Role |
|---|---|
| Browser builder (`builder/`, served at `/app/`) | Commercial happy path: design, copy, card/trial, publish |
| Telegram bot (`bot/`) | Draft intake only → same registry draft + open-in-builder link |
| Static renderer (`build.js` + `template.html` + `config.json`) | Zero-dep HTML generation used by publish pipelines |
| Sample site files (`config.json`, `index.html`, …) | Example customer brochure data — not operator product copy |

## Repo layout

| Path | Role |
|---|---|
| `PRODUCT.md` | Product contract (authority for agents) |
| `AGENTS.md` | Standing rules for workers |
| `ARCHITECTURE.md` | How the system is actually built — components, entry points, data layer |
| `builder/` | Browser builder UI (engine generated via `npm run build:app`) |
| `bot/` | HTTP server, Telegram intake, payments, deploy, registry |
| `bot/web.js` | **Production entry point** — what the `Dockerfile` actually starts (`CMD ["node", "web.js"]`); web-only, no Telegram |
| `bot/bot.js` | Alternate entry point: same HTTP server + Telegram long-polling, only when the host start command is overridden |
| `bot/pricing.js` | Single commercial pricing source (99 after trial / renewal 29) |
| `templates/` | Design-system templates (five — see `templates/README.md`) |
| `build.js` | Generates `index.html` from `template.html` + `config.json` |
| `config.json` | Sample customer site data (not Hidook operator branding) |
| `LAUNCH.md` | Team-oriented launch notes (local/test only unless owner gates) |

## Commercial path (customer)

1. Open the browser builder → pick a design → replace copy/images → preview.
2. Sign in (magic link when email is configured).
3. Start **subscription checkout** (card required, **7-day trial**).
4. Site goes **live immediately after a valid card**; first public publish is allowed on trial/card-on-file status.
5. After day 7, Stripe **auto-charges 99** unless cancelled; then edit + republish; renew at **29** / year via subscription schedule.
6. Cancel during trial → live site is **unpublished** (no charge).

Telegram never replaces steps 3–6. Ops detail: `bot/README.md`.

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
# 1. Build the browser builder engine once (fast, zero network calls;
#    builder/generated/ is gitignored and not shipped in git — /app/ loads an
#    empty template catalog without this step, with no visible error)
npm run build:app

# 2. Bot + builder API (see bot/README.md for full env)
cd bot && npm install
TELEGRAM_BOT_TOKEN=xxxxx \
  SERVER_SECRET=$(openssl rand -hex 32) \
  PUBLIC_URL=http://127.0.0.1:3000 \
  STRIPE_SECRET_KEY=sk_test_... \
  npm start
```

Re-run `npm run build:app` (from the repo root) after any change under `builder/*.js` or `templates/*` — the server serves the static bundle it produced, not the source files live.

Local/staging may use **test** Stripe and fake-or-isolated deploy (`HIDOOK_FAKE_DEPLOY=1`, refused when `NODE_ENV=production`). Fake deploy is not the client journey. Production Stripe, live DNS for hidook.agency, and owner launch gates are **owner-only** — see `PRODUCT.md` and `bot/DEPLOY.md`.

```bash
# Optional static preview of generated sample site
node .claude/serve.js   # http://localhost:4173
```

## Tests

```bash
npm test
# equivalent to: node --experimental-sqlite --test bot/test/*.test.js
```

Do not run `node bot/test/*.test.js` without `--test` — the shell expands the glob
to ~170 file arguments, but plain `node` only executes the first one and silently
ignores the rest as `process.argv` strings (no error). The `--test` flag is what
tells Node to run every matched file as a test suite. `--experimental-sqlite` is
required on Node < 22.5 (the CI/Dockerfile-pinned 22.20.0 has `node:sqlite`
unflagged, but a local dev machine on an older or newer Node patch may not) —
without it, every test that touches the registry or the native calendar fails
at import with `Error: The SQLite registry backend requires Node.js with
node:sqlite`.

Two tests are expected to fail on machines without a local Brave browser install
at a hardcoded macOS path (`test/advocate-eed3ca0-repair.test.js`,
`test/mobile-chrome-390-aabb.test.js`) — they are Playwright oracles wired to a
specific browser binary path, not portable across machines. That is a known gap,
not a regression.

Do not weaken assertions.

## Docs map

| Doc | Audience |
|---|---|
| `VISION.md` | **Source of truth** — takes priority over every other doc, including `PRODUCT.md`, when they disagree |
| `PRODUCT.md` | Compact product contract for workers (defers to `VISION.md` on conflict) |
| `ARCHITECTURE.md` | How the system is built — components, entry points, data layer, verified against code |
| `bot/README.md` | Bot/server operator surface |
| `bot/DEPLOY.md` | Deploy env and staging notes |
| `LAUNCH.md` | Commercial positioning for the team (not live production checklist) |
| `CLOUDFLARE-DEPLOY.md` | Provider-specific deploy notes |
| `BACKUP-RESTORE.md` | Backing up and restoring the SQLite registry / native-calendar databases and published sites |
| `CHANGELOG.md` | Shipped milestones and remediation waves, newest first, cited by commit |
| `LICENSE` | Repository license (proprietary default — see the file for scope and owner-confirmation status) |
