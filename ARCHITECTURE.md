# ARCHITECTURE.md — Hidook Site Builder

Authority: `VISION.md` is the synchronized source of truth for product scope and
commercial rules; this file documents the system **as built**, verified against
the code at commit `8a13c19` (2026-09-06). If a claim here cannot be checked
against the code, it says so instead of guessing. If this file and the code
ever disagree, the code is right — file a fix, don't trust the stale prose.

This is the one document that answers "how does the whole thing actually fit
together" for an engineer who has never seen the repo. `README.md` has the
docs map; `bot/README.md` and `bot/DEPLOY.md` have the operator-facing detail
this file only summarizes.

## 1. Shape of the system

One Node.js process (zero npm dependencies beyond `grammy` for Telegram) serves
everything:

```
                         ┌──────────────────────────────┐
  Browser  ── HTTPS ──▶  │        bot/server.js         │  ── Stripe webhooks
  (builder SPA,          │  zero-dep http.createServer   │  ── Cloudflare/Vercel API
   /app/*, /api/*)       │  routes: builder API, auth,   │
                         │  publish, calendar-native,    │
  Telegram ── polling ─▶ │  admin, health                │
  (bot.js only)          └───────────────┬───────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
           bot/registry.js       bot/webpublish.js      bot/calendar-native/
           (SQLite, DATA_DIR)    (build + deploy)        (SQLite, DATA_DIR)
                                          │
                                          ▼
                                     build.js
                              (template.html + config.json
                                    → index.html)
                                          │
                                          ▼
                              $DATA_DIR/published/<slug>/
                              or a real host (Cloudflare
                              Pages / Vercel / Netlify)
```

There is no separate frontend build server, no message queue, no external
database service — one process, one SQLite file for the registry, one
separate SQLite file for the native calendar, and a directory of built static
sites under `DATA_DIR`.

## 2. Entry points

Two files can start the process; **only one runs in production**:

| File | Runs | Used by |
|---|---|---|
| `bot/web.js` | HTTP server only (`bot/server.js`) — no Telegram | **Production default.** `Dockerfile` `CMD ["node", "web.js"]`. If `TELEGRAM_BOT_TOKEN` is set but the start command is not overridden, Telegram intake is silently disabled — the token is simply never read by this process. |
| `bot/bot.js` | Same HTTP server **plus** Telegram long-polling | Only when the Railway/host start command is explicitly overridden to `node bot.js` (see `bot/DEPLOY.md` §"Default container start command"). One replica only — one poller per bot token. |

Both files delegate the actual HTTP routing to `bot/server.js` and the Stripe
webhook dispatch to `bot/webpublish.js`; `bot/web.js` additionally wires
`invoice.payment_succeeded` / `invoice.paid` (automatic renewal) and
subscription lifecycle events directly, because it has no Telegram messenger
to hand `notifyAdmin` to.

`bot/flow.js` is the Telegram draft-intake state machine (AI or wizard
conversation → same registry draft the browser builder opens). It is **frozen
by owner decision** (see `AGENTS.md`) — Telegram is being phased out of the
product, not extended.

## 3. HTTP layer — `bot/server.js`

Zero-dependency `http.createServer`, hand-rolled routing (regex/string match on
`req.url`, no Express). The file's own top-of-file comment is the accurate,
current route table — grep it there rather than trusting a route list copied
into a second document, because that is exactly the kind of stale duplication
the 2026-09-06 audit flagged. As of this writing it documents, among others:

- `GET /health`, `GET /admin` (token-gated operator site list)
- `POST /webhooks/stripe`
- `GET /app/*` — static builder SPA files
- `GET /live/<slug>/*` — isolated local publish output (`$DATA_DIR/published/`)
- `/api/auth/*`, `/api/me`, `/api/sites*` — account + site management
- `/api/publish`, `/api/draft`, `/api/export-html`, `/api/export-zip`
- `/api/appointments` — legacy local appointment-*request* form (non-native)
- `/api/calendar-native/*` and `/calendar-native/*` — native calendar public
  API, visitor manage-link, and owner dashboard (see §7)

## 4. Render engine — `build.js`

The zero-dependency static-site generator at the repo root. Given a directory
containing `template.html` + `config.json`, `build(dir)` produces
`index.html`. Token syntax (see `templates/README.md` for the full contract):

- `{{a.b.c}}` — HTML-escaped value at that dot-path in `config.json`
- `{{& a.b}}` — raw/unescaped value, only for the small allowlist of trusted
  fields (`hero.background`, `contact.address`, `seo.jsonLd`)
- `<!-- @each path -->...<!-- @end -->` — repeats a block per array item
- `<!-- @if path -->...<!-- @endif -->` — conditional block, also usable
  inside a tag for conditional attributes

`build.js` is used by three callers: `node build.js` directly (sample/dev),
`bot/webpublish.js` (the real publish path — see §5), and ad hoc test/QA
scripts under `scripts/`.

## 5. Templates and the builder SPA

**Five design systems** ship under `templates/`: `product-menu`,
`local-service`, `portfolio`, `professionals`, `desserdirina`. Each folder has
`template.html`, `styles.css`, `script.js`, `collage.js` (gallery/lightbox),
`schema.json` (wizard field contract) and `presets.json` (two demo configs).
`templates/registry.json` lists all five; `templates/README.md` has the full
per-file contract. Verified: `templates/registry.json` → `templates.length ===
5` (also pinned by `bot/test/audit-docs-round2.test.js`).

The browser builder (`builder/`) is a hand-rolled SPA (`builder/app.js` +
`builder/index.html` + `builder/edit-overlay.js`), **not** shipped from source
in git — `builder/generated/` is gitignored. `scripts/build-builder.js`
(`npm run build:app`) reads `templates/*` and emits:

- `builder/generated/engine.js` — `window.HidookEngine` (`renderHtml`,
  `renderPreview`, `escapeHtml`) used by the live in-browser preview
- `builder/generated/templates-data.js` — light catalog registry only (no
  heavy schema/presets/base64 images), so the template grid boots fast
- `builder/generated/templates/<id>.js` — the heavy per-template payload,
  fetched on demand at Start/Preview
- `builder/generated/template-assets/<id>/images/*` — real cacheable image
  files, not base64-in-JS

Both the `Dockerfile` and `.github/workflows/ci.yml` run this build step
before the server can serve `/app/` with a working catalog. Without it,
`/app/` still returns 200 (SPA shell), but the template catalog is silently
empty — a documented first-boot trap, not a crash.

## 6. Data layer — the registry

`bot/registry.js` is a **thin backend switcher**, not the implementation:

```js
module.exports = process.env.REGISTRY_BACKEND === 'json'
    ? require('./registry-json')      // legacy fallback
    : require('./registry-sqlite');   // default
```

- **`bot/registry-sqlite.js`** (default) — the real storage engine, backed by
  `bot/registry-db.js` (opens `DATA_DIR/registry.sqlite`, `node:sqlite`, WAL
  journal mode, `PRAGMA foreign_keys = ON`) and `bot/registry-schema.js`
  (versioned `CREATE TABLE` DDL: `users`, `tokens`, `sites`, `versions`,
  `orders`, `stripe_events`, `registry_meta`, `registry_schema_migrations`).
  Each mutation now costs roughly the size of the row it touches, not the
  size of the whole database — the audit's BE-05/DI-02 finding (one JSON file
  read+rewritten whole on every mutation) is what this replaced.
- **`bot/registry-json.js`** — the original one-file-JSON implementation.
  Kept as an **emergency exit**: `REGISTRY_BACKEND=json` switches back to it
  with an environment variable, not a redeploy of different code.
- **`bot/registry-migrate.js`** — a one-time, idempotent, non-destructive
  migration that runs automatically on first SQLite open if `DATA_DIR/.registry.json`
  exists: copies every record into SQLite, verifies row counts **and** a
  deep-equality spot-check, and only then writes a `registry_meta` marker.
  If verification fails, nothing commits and the process throws loudly at
  startup — the original `.registry.json` is never modified or deleted by
  this module.
- **`bot/registry-shared.js`** — logic shared by both backends (slug
  building, `addMonthsIso`, Stripe event id validation, the `SITE_EXTRA_FIELDS`
  allowlist for `updateSite`).

`bot/registry.js`'s 21 exported functions have the same signatures and return
shapes on both backends — every consumer (`bot/server.js`, `bot/webpublish.js`,
`bot/flow.js`, `bot/calendar-native/email/index.js`, …) works unmodified
either way. See `BACKUP-RESTORE.md` for how to back up and restore this store.

## 7. Publish pipeline

`bot/webpublish.js` is the web-platform publish pipeline:

- `publishSite` — builds (via `build.js`) and deploys after payment (or a
  paid republish)
- `handleStripePaid` — first public publish after checkout, or republish of
  an expired site; stores `stripeCustomerId`/`stripeSubscriptionId`
- `handleStripeSubscriptionEvent` — persists subscription lifecycle status;
  `canceled`/`unpaid`/`incomplete_expired` trigger `unpublishSite` (`unpaid`
  is Stripe's terminal dunning state and can persist indefinitely without a
  `.deleted` event, so it is a trigger on its own — not just cancel/delete)
- `handleStripeInvoicePaid` — extends `paidUntil` on a real recurring charge
  (`invoice.payment_succeeded` / `invoice.paid`), idempotently, without
  re-extending an already-unexpired first year
- `unpublishSite` — removes `$DATA_DIR/published/<slug>/`; registry marked
  not-live

Deploy adapters, tried in this order (`bot/flow.js` → `deployBuiltSite`):
Cloudflare Pages (`bot/deploy-cloudflare.js`, shells out to the `wrangler`
CLI — the raw HTTP Direct Upload flow needs BLAKE3 hashing `node:crypto`
lacks) → Vercel (`bot/deploy-vercel.js`) → Netlify (legacy fallback). Test/dev
paths never touch a real host: `HIDOOK_FAKE_DEPLOY=1` stubs a
`https://<slug>.test.local` URL; `HIDOOK_ISOLATED_DEPLOY=1` copies the built
site into `$DATA_DIR/published/<slug>/`, served by `GET /live/<slug>/*` on
the same process. Both are refused when `NODE_ENV=production`.

Export (`GET /api/export-html`, `GET /api/export-zip`) reuses the same
`build.js` renderer and the same live-publish entitlement allowlist (Stripe
`active`/`trialing`, or an unexpired legacy paid entitlement) — it is not a
new code path with its own rules.

## 8. Payments — Stripe

- **`bot/pricing.js`** — the single source of commercial amounts: 9900 cents
  (99) first period, 2900 cents (29) yearly renewal, currency bucketed EUR
  (EU) / GBP (UK) / USD (elsewhere). Country resolution order: Cloudflare
  `CF-IPCountry` header → explicit `country`/`region` param → coarse
  `Accept-Language` guess → isolated-local-boot RO/EUR default → USD default.
- **`bot/payments.js`** — Stripe Checkout and Subscription Schedules via
  direct REST calls (no `stripe` npm package). `mode=subscription` with a
  7-day trial; on `checkout.session.completed` the app attaches a schedule so
  year 1 stays at 99 and year 2+ renews at 29 in the same currency.
  `createBillingPortalSession` backs the in-app Cancel button.
- Webhook dispatch (`POST /webhooks/stripe`) is verified in `bot/server.js`
  and handed to `onStripeEvent`, implemented per entry point (`bot/web.js` /
  `bot/bot.js`) — see §2.

Full operator detail: `OWNER-STRIPE-TRIAL.md`, `GO-LIVE.md` §4.

## 9. Native calendar — `bot/calendar-native/`

A self-contained module, **opt-in per site** via the `appointment.nativeBooking`
config flag (`da`/`nu`, reversible, non-destructive — see `VISION.md` §8 for
the product decision this implements). Default behavior for a site that does
not opt in is unchanged: the legacy local appointment-*request* form
(`POST /api/appointments`, handled directly in `bot/server.js`, status
always `requested`), plus an optional Cal.com link the owner can paste in
Detalii (`templates/professionals/schema.json`) — that link is a plain,
customer-supplied external URL, not a Hidook-built calendar integration.

Storage is a **second, separate SQLite database**: `bot/calendar-native/db.js`
opens `DATA_DIR/calendar-native.sqlite` (same `node:sqlite` + WAL pattern as
the registry, tables defined in `bot/calendar-native/schema.js`:
`calendar_settings`, `calendar_services`, `calendar_weekly_availability`,
`calendar_date_overrides`, `calendar_bookings`, `calendar_email_outbox`,
`calendar_email_audit`). Tenant key = Site Builder customer id + site id.

| File | Role |
|---|---|
| `engine.js` | Booking engine — availability resolution, slot locking (DB-level, not optimistic-only), create/cancel/confirm/reschedule |
| `public-api.js` | Public, tenant-scoped, write-mostly API: list active services, aggregated free slots, create booking |
| `owner-api.js` | Authenticated owner dashboard API: list/search bookings, weekly + blackout availability editor, cancel/confirm/reschedule |
| `manage-api.js` | Visitor manage-link API: cancel or reschedule via a single-booking, unguessable token (never a login) |
| `email/` | Provider boundary + `outbox.js` (queued/sent/failed/suppressed/dead_letter with retry backoff) + `policy.js` + `templates-ro.js` (Romanian, honest-on-state) + `secrets.js` (scrub before persisting/logging). Local/test transport only — no production sender wired in this repo. |
| `cutover.js` | `preparePublishCutover` — seeds services/weekly availability and injects tenant ids into a site's config at publish time, only when the opt-in flag is set |
| `retention.js` | PII retention job (VISION §8: active + 24 months after cancellation, then delete/anonymize) |
| `widget/`, `owner/`, `manage/` | Static public booking widget, owner dashboard UI, and visitor manage-link UI (HTML/CSS/JS, no build step) |

`bot/calendar-boundary.js` is a **separate, vestigial stub** unrelated to this
module — it forces `calDiyEnabled: false` unconditionally and predates the
native-calendar decision. See `OWNER-CALENDAR-CAL-DIY.md` for why it still
exists and why it is not part of the live architecture.

## 10. Deploy / infra

- **`Dockerfile`** — pinned to `node:22.20.0-alpine` specifically because the
  native calendar and the SQLite registry both require the built-in
  `node:sqlite` module, which does not exist at all on Node 20 and is only
  available unflagged starting at this exact patch (Node 22.11 and 23.1 both
  still need `--experimental-sqlite`). `NODE_OPTIONS=--experimental-sqlite`
  is set anyway as a defensive belt-and-suspenders. `CMD ["node", "web.js"]`
  — see §2. `.dockerignore` excludes `04-QA-Evidence/`, `00-Governance/`,
  `04-Deliverables/`, `.worktrees/`, and other non-runtime paths from the
  build context.
- **`railway.json`** — `healthcheckPath: "/health"`, `numReplicas: 1`
  (required for the Telegram long-polling path when enabled), restart on
  failure.
- **`.github/workflows/ci.yml`** — runs the full `node --test` suite (minus
  two machine-specific Brave-only oracles) on every push/PR to `main`,
  against the same pinned Node patch as the Dockerfile.
- **`DATA_DIR`** — the one persistent volume the whole product depends on.
  Contents and backup guidance: `BACKUP-RESTORE.md`.

## 10a. Image variants — a build artifact, not a build step

Gallery and Instagram photos ship as committed WebP width-variants
(`templates/<id>/images/*-{480,960}w.webp`) plus a `variants.json` manifest.
`build.js#injectResponsiveImages()` reads that manifest and upgrades the
matching `<img>` into a `<picture>` with `srcset`/`sizes` and intrinsic
`width`/`height`.

**The generator is not part of any build.** `scripts/generate-image-variants.js`
is run by hand, and it needs macOS `sips` plus Homebrew's `cwebp` — neither
exists on the CI runner or in the Docker image, and neither is an npm
dependency. Nothing in `npm run build:app`, the publish path or CI invokes it,
so a Linux machine can build, test and deploy the product normally; it just
cannot regenerate the variants.

Practical consequence: **adding or replacing a shipped template photo requires
a Mac.** If that becomes a constraint worth removing, the honest options are a
pure-JS encoder (a real dependency, against this repo's zero-dependency rule)
or generating variants in CI on a runner that has `cwebp` available.

Owner-uploaded photos arrive as base64 data URIs in the config and never pass
through this generator. They get intrinsic `width`/`height` (decoded from the
data URI) so they do not cause layout shift, but no WebP and no `srcset`.

## 10b. Production, as actually configured (verified 2026-09-06)

Read from the live Railway service rather than inferred from this repo, because
documentation here has drifted from production before.

| Fact | Value |
|---|---|
| Workspace / project | `My Projects` / `grateful-fascination` |
| Service | `lp-builder1-hidook-agency` |
| Build | **Dockerfile**, per `railway.json` (`builder: DOCKERFILE`) — not Nixpacks |
| Entry point | `bot/web.js`; boot log says "web-only mode (no Telegram)" |
| `PUBLIC_URL` | `https://lp.hidook.agency` |
| `DATA_DIR` | `/data`, matching `RAILWAY_VOLUME_MOUNT_PATH` — the SQLite stores are on the persistent volume |
| `DEPLOY_PROVIDER` | `cloudflare` |
| Healthcheck | `/health`, per `railway.json` |

Set in production: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the six
`STRIPE_PRICE_ID_*` (first-year and renewal, EUR/GBP/USD), `RESEND_API_KEY`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BRAND_DOMAIN`,
`SERVER_SECRET`, `SITEBUILDER_PARTNER_SECRET`, `EMAIL_FROM`.

**Not set in production**, and worth knowing:

- `CALENDAR_PUBLIC_BASE_URL` / `PUBLIC_BASE_URL` — the calendar's manage links
  used to read only these two and fell back to `http://127.0.0.1:0`, so every
  cancel/reschedule link mailed to a visitor was dead. `PUBLIC_URL` is now the
  fallback, which production does set.

  The native booking widget's own origin (`appointment.nativeApiBase`, resolved
  in `bot/calendar-native/cutover.js`) had the identical bug and was not covered
  by that fix: it resolved to `''`, so a site exported to Cloudflare Pages asked
  its own static host for the widget bundle and the booking API. Pages answers
  those with the site's `index.html` at 200 `text/html`, so the widget never
  booted and nothing errored — the visitor saw a booking section with no way to
  book. `PUBLIC_URL` is now in that chain too, and switching the calendar on
  with no origin configured logs `calendar.native_api_base.unconfigured` at
  error level instead of publishing quietly.
- `STRIPE_AUTOMATIC_TAX` — VAT collection is therefore off, which is the
  deliberate default until Stripe Tax is configured in the Dashboard.
- `NODE_OPTIONS` — not needed as a service variable; the Dockerfile sets
  `--experimental-sqlite` itself.

## 11. Testing

`bot/test/*.test.js`, run via `node --experimental-sqlite --test bot/test/*.test.js`
(`npm test`). Mix of `node:test`-based unit/integration tests spinning up the
real `bot/server.js` on an ephemeral port with an isolated `DATA_DIR`, and a
handful of Playwright-driven browser oracles that open the real product in a
real browser and assert on pixels/DOM (see `bot/test/*browser*`,
`*-390.test.js`, `advocate-*`). `AGENTS.md` and `README.md` document known,
pre-existing, environment-dependent failures (Brave-path oracles, missing
`playwright` package) that are not regressions to chase.

## 12. What this file does not cover

- The Telegram intake conversation design (`bot/ai.js`, `bot/flow.js`,
  `bot/template-steps.js`) — frozen by owner decision; see `bot/README.md`.
- Exact Stripe Dashboard setup steps — `GO-LIVE.md` §4, `OWNER-STRIPE-TRIAL.md`.
- Product scope and commercial rules — `VISION.md` (this file describes how
  the system is built, not what it is supposed to do).
