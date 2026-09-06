# Re-audit 2026-09-06 — Payments & Deploy/Infra (adversarial, HTTP-surface)

Auditor: independent re-verification, same day as the round following the
2026-09-06 4/10 audit (`04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md`).
Scope: commercial/payments flow and deploy/infra, driven through the **real
HTTP surface** of an isolated server (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`,
temp `DATA_DIR`, no real keys) — not by reading functions in isolation. Rule
followed throughout: **report only what was reproduced**; label everything
else unconfirmed. No product code, tests, or docs were changed.

Evidence: `04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/scripts/*.js`
(driver scripts, kept as evidence) and
`04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/evidence/*.json` (raw
request/response/registry-state logs from each run). Scratch SQLite data
directories used for the backup/restore drill were deleted after verification
to keep evidence small (disk space is tight on this host — confirmed first-hand:
`/health/ready` on this machine reported 7.9% free disk during testing).

## Scores

### Payments: 5/10

Up from 3/10. The exact worst finding from the original audit — a paying
customer mislabeled and pushed into a second live subscription — is now
**blocked on the one endpoint the original bug used** (`POST
/api/sites/:id/checkout`, the dashboard "Reînnoiește hosting" button), and
that fix is real, tested, and reproduced independently here. Renewal via a
genuine Stripe `invoice.paid` cycle event extends entitlement by exactly one
year and is idempotent against duplicate webhook delivery, confirmed live.
VAT is honestly gated and documented rather than silently absent.

It stays out of "good" territory because the **same class of bug (a second,
orphaning subscription) is still reachable today, through the ordinary
edit-and-republish flow** (`POST /api/publish` with an existing `siteId`),
which never calls the guard that protects the dashboard button — see Critical
#1 below. That is not a smaller version of the original bug; it is the same
bug, on the more commonly used path (any customer who just edits their site
content hits it, not only someone who deliberately clicks "renew"). A second,
related gap: the failed-payment/dunning machinery is fully built and correct
in isolation, but nothing calls it — the dashboard shows "Activ" through a
real card decline and "Ciornă" (draft) after Stripe gives up and the site
goes dark, so the owner has no way to learn what happened from the product
itself.

### Deploy/infra: 6/10

Up from 3/10. CI now runs the real test suite with the correct flags, a
security job hard-fails on secrets/vulnerable deps, the Docker image excludes
the 140MB of QA evidence, and — most substantively — a documented backup was
taken, the database was destroyed, and the documented restore procedure
**actually worked**, verified against a live-again admin panel and site
record. Schema-migration rollback safety is proven with a real automated
test (additive-only migrations), not just asserted. The readiness endpoint is
real and told the truth in every scenario I could put it in while the process
stayed alive.

It is not higher because the canonical operator-facing runbook
(`BACKUP-RESTORE.md`) is **already stale the day it matters**: better,
tested backup/restore CLIs (`scripts/ops-backup.js`, `scripts/ops-restore.js`
— retention pruning, pre-restore safety snapshot, a `--yes` confirmation
gate) exist in the repo and are deliberately shipped inside the production
Docker image for this exact purpose, but the doc I was told to follow
literally as a new operator explicitly and incorrectly says no such tooling
exists, and its own former companion doc describing the real procedure
(`HANDOFF-ops.md`) was deleted under the repo's evidence-teardown policy and
never merged into anything durable. And the readiness endpoint's honesty has
a real boundary: if the registry database is already corrupted at container
start (not just corrupted mid-flight), the process crashes during `require()`
before it ever binds a port — `/health`/`/health/ready` cannot tell the truth
because there is no process alive to ask. Railway's restart policy turns that
into a visible crash loop rather than a silent lie, which is an acceptable
failure mode, but it means the readiness endpoint's guarantee is narrower
than "always tells the truth about the database."

## Could I open a second subscription? — Yes, via a different door than the one that was locked

**Direct answer to the audit's central question: yes.** The dashboard's own
"Reînnoiește hosting" button is correctly guarded and I could not get a
second subscription through it, including under a forced race (two
concurrent clicks). But the ordinary "edit your site, click Publică" flow on
a site whose local record looks stale/expired — the single most likely thing
a real customer does — walks straight past the guard, flips the site back to
an unpaid draft locally, and hands back a **new, real Checkout Session at the
full first-year price**, while the original Stripe subscription (confirmed
still `active` in this reproduction) is left completely untouched and
continues billing. See Critical #1.

## Restore: it worked

`BACKUP-RESTORE.md` §2a/§4a followed literally end-to-end: seeded a real
paid+live site, ran `sqlite3 "$DATA_DIR/registry.sqlite" ".backup ..."`
against the live WAL-mode database, verified the backup file independently
with a plain `sqlite3` `SELECT`, **destroyed** the live `registry.sqlite`
(overwrote with garbage bytes, deleted the `-wal`/`-shm` sidecars), restarted
against the corrupted file (confirmed the server fails hard — see Finding
Medium #1), then restored per the doc's §4a step 2 (`cp` the backup over the
live path, remove stale `-wal`/`-shm`), rebooted, and verified with `/health`
and `GET /admin` exactly as §4a step 4 instructs: the seeded site
(`backup-restore-site`, paid, live) was present, unchanged. Separately ran
the actual `scripts/ops-restore.js` CLI (undocumented in the runbook, see
High #2) end-to-end on a second corrupted copy: it correctly refused to run
without `--yes` (dry-run, exit 1), then on `--yes` took its own pre-restore
safety snapshot of the corrupted file (gracefully falling back to a raw copy
when the corrupted source failed an online-backup vacuum), restored, and
passed its own integrity check. Both paths recovered the data with zero loss
against the seeded site.

---

## Critical findings

### C1 — The double-subscription guard is bypassed by the ordinary edit-and-republish flow, not just the "Reînnoiește hosting" button

**Reproduced live**, `04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/evidence/run-commercial.json` steps `forced_stale_expired_while_active` through `ATTEMPT_C_concurrent_renewal_checkout`.

The fix that shipped (`webpublish.canStartRenewalCheckout`, wired into
`bot/server.js#handleSiteCheckout`, `bot/webpublish.js:355-385`) is real and
does its job: `POST /api/sites/:id/checkout` correctly returns `409
SUBSCRIPTION_STILL_ACTIVE` with a Romanian, actionable message when a site's
`stripeSubscriptionStatus` is `active`/`trialing`/`past_due`, even though its
local `paidUntil` looks expired. Confirmed live (Attempt A), and confirmed it
does not falsely block a *real* cancel-then-resubscribe (`come_back_after_real_cancel_should_be_allowed`, 200 OK).

But `bot/server.js#handlePublish` (the handler behind the ordinary in-editor
"Publică"/save action, `bot/server.js:3008-3165`) reaches the exact same
fork — "is this site currently entitled?" — through a **different, unguarded
function**: `hasActiveCommercialEntitlement(site)` (`bot/server.js:648-668`).
That function is a hard gate on `paidUntil` alone:

```js
if (site.paidUntil) {
    const paidUntilMs = Date.parse(site.paidUntil);
    if (!Number.isFinite(paidUntilMs) || paidUntilMs <= nowMs) return false;
}
```

It never looks at `stripeSubscriptionStatus`. When it returns `false` — which
happens whenever local `paidUntil` looks stale, the exact condition the
original audit's bug and this one's own `reconcileSiteFromStripe` docstring
both describe as a real, expected occurrence ("webhook lag... a first
checkout whose webhook hasn't arrived") — `handlePublish` falls through to
its "unpaid path" (`bot/server.js:3107-3159`), which:

1. Immediately sets the site's `paid: false, status: 'draft'` in the
   registry — **downgrading a genuinely paying customer's live site to an
   unpaid draft locally**, while their real Stripe subscription is untouched
   and still billing.
2. Creates a **new order** and a **new Checkout Session** at the full
   first-year price (`kind: 'publish'`, 99, not the 29 renewal price) —
   with **no call to `reconcileSiteFromStripe` or `canStartRenewalCheckout`
   anywhere in this code path**.

Reproduced exactly this: after forcing `paidUntil` into the past while
`stripeSubscriptionStatus` remained `active` (simulating the real webhook-lag
scenario, not an artificial state), I called `POST /api/publish` with the
existing `siteId` and an edited `config` — the same request the browser
sends when a customer edits text and clicks Publică. Result: `200 OK`, a
fresh `paymentUrl` for a brand-new Checkout Session, and the site's `paid`
flag flipped to `false`. Had this session been completed (as `test-pay/complete`
or a real Stripe payment would), `_storeStripeBillingIds` would overwrite the
site's `stripeSubscriptionId`/`stripeCustomerId` with the new subscription's
ids — **orphaning the original subscription exactly as the original audit
described**, with the sole difference being which button the customer
pressed to get there.

**Compounding effect confirmed**: once this happens, the guard on the
*renewal* endpoint is also disabled for the same site, because
`canStartRenewalCheckout`'s very first branch is `if (!site.paid) return {
allowed: true }` — and `site.paid` is now `false`. Firing two concurrent
`POST /api/sites/:id/checkout` calls at that point (Attempt C) both
succeeded (`200`, two more Checkout Sessions), because the guard now sees an
ordinary "first publish," not a conflicting renewal.

**Why this was missed**: the test suite that verifies the fix
(`bot/test/wave7-payments-no-double-subscription.test.js`) is a genuinely
thorough unit/E2E suite — I ran it, it passes, and its coverage of
`canStartRenewalCheckout`/`reconcileSiteFromStripe` and the `/checkout`
endpoint is real. But it, and every other test file in `bot/test/`, never
exercises `/api/publish` with an existing paid `siteId` against a
stale-but-actually-active site (confirmed by grep: zero hits for
`hasActiveCommercialEntitlement` combined with a publish-route test in the
double-subscription or payments-routes test files). CI (`node --test`)
would pass cleanly today with this defect present. This is the exact pattern
the audit's brief warned about — a well-tested guard with a real, untested
gap next to it — just discovered on the other side of the fix rather than in
the fix itself.

**Cost to the business**: a genuinely paying customer, on a webhook-lag
occurrence acknowledged as expected by this codebase's own comments, who
simply edits their site and saves — the single most common product action —
can be charged a second full 99 while their original subscription keeps
billing, with no error and no warning, and their previously-paid site
downgraded to "draft" in the registry in the process.

**Severity**: Critical. Direct financial harm to a real customer,
reproducible deterministically, on the single most common user action, via
the production entry point (`bot/web.js` → `bot/server.js#handlePublish`).

### C2 — Failed-payment/dunning information exists and is correct, but nothing in the product surfaces it — the dashboard actively lies during and after the failure

**Reproduced live**, `04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/evidence/run-dunning.json` (clean, uncontaminated site — separate from C1's repro).

`webpublish.getDunningState(site)` is well-designed and, called directly,
returns exactly the right thing at every stage:

- After a first card decline (`invoice.payment_failed` + `customer.subscription.updated status=past_due`):
  `{ severity: 'warning', code: 'PAYMENT_RETRY_IN_PROGRESS', messageRo: "Card refuzat la încercarea 1. Stripe reîncearcă automat cardul; site-ul rămâne live. Actualizează cardul din portalul de facturare ca să eviți oprirea site-ului." }` — correct, Romanian, actionable.
- After Stripe exhausts retries (`customer.subscription.updated status=unpaid`, which correctly triggers `unpublishSite`):
  `{ severity: 'critical', code: 'SITE_DOWN_PAYMENT_FAILED', messageRo: "Site-ul a fost oprit pentru că plata nu a putut fi finalizată după mai multe încercări. Adaugă un card nou din tabloul de bord ca să repornești site-ul." }` — again correct and actionable.

But `getDunningState` **is never called from `bot/server.js` or
`builder/app.js`** (grep-confirmed: zero call sites outside its own
definition and `bot/test/wave7-payments-dunning.test.js`). No API route
returns it; the client dashboard badge logic (`buildSiteCard()` in
`builder/app.js:4621-4670`) never reads `stripeSubscriptionStatus`,
`paymentFailedAt`, or `paymentFailedCount` at all. Consequences, reproduced
against the raw JSON `GET /api/sites` actually returns (which does carry
these fields — they are just never rendered):

- **During the first decline** (`stripeSubscriptionStatus: 'past_due'`,
  `paymentFailedCount: 1`, site still fully live): dashboard badge shows
  **"Activ"**. A customer whose card was just declined has zero indication
  anything is wrong.
- **After retries exhaust** (`stripeSubscriptionStatus: 'unpaid'`, site
  unpublished, `site.paid` still `true`, `paidUntil` still ~a year out):
  none of the six badge branches in `buildSiteCard()` match this state
  (`site.paid && hostingExpired` — false, `paidUntil` hasn't passed;
  `site.paid && status live/active` — false, status is `unpublished`;
  `status===live && !paid` — false; `status===expired` — false;
  `status===needs-retry` — false; `!site.paid` — false, `paid` is still
  `true`) — the badge falls through to the **default: "Ciornă" (Draft)**.
  A paying customer whose live site was just taken down for a failed
  payment sees their dashboard describe it as a draft that was never
  published, with no further explanation anywhere in the UI.

No email is sent at any stage either: `bot/email.js` implements exactly one
function, `sendMagicLink` — there is no payment-failure or dunning email at
all. `bot/web.js#onStripeEvent` explicitly passes no `notifyAdmin` for
subscription-lifecycle events, and its own comment documents why: "web-only
entry: no Telegram admin channel to notify through." The technical
mechanism (unpublish, `GET /live/<slug>/` → confirmed live 404 after
unpublish) works correctly — it is the entire communication layer to the
owner that is missing, on the production entry point.

**Severity**: Critical. This directly fails the audit's question ("does the
owner learn... does the dashboard tell the truth... what happens when
retries run out") on every count except the underlying data being correctly
recorded. A customer has no product-native way to learn their card failed,
their site is down, or why the dashboard now calls it a draft.

---

## High findings

### H1 — Invoice history is built, tested, and correct at the API level, but has zero UI

`GET /api/sites/:id/invoices` → `webpublish.getInvoiceHistory(site)` is real:
verified it returns the actual ledger record for a first-year charge with
correct `amountCents`/`currency`, and (separately, `run-renewal.json`) the
correct second `kind: 'renewal'` entry after a genuine cycle renewal — no
phantom third entry from the duplicate-webhook replays. But `builder/app.js`
never calls this endpoint (grep-confirmed: zero references to `/invoices`
anywhere in the builder). The only invoice-adjacent UI is the Stripe-hosted
Customer Portal button ("Anulează"/manage), which under `HIDOOK_TEST_PAY` is
an offline stub with no invoice list at all, and in real Stripe would show
Stripe's own portal — not this repo's ledger-backed history, which was
purpose-built (per its own comment) specifically because "an owner paying
yearly previously had no way to see or download past invoices." That gap is
unchanged from the customer's perspective; only the backend now has the data
to fix it.

### H2 — `BACKUP-RESTORE.md`, the doc a new operator is told to follow, is already wrong about what tooling exists

Confirmed: `scripts/ops-backup.js` and `scripts/ops-restore.js` exist, are
real (both run cleanly, see the "Restore: it worked" section above and their
own passing test `bot/test/wave6-ops-rollback.test.js`), are deliberately
kept in the production Docker image for exactly this purpose
(`.dockerignore`: `!scripts/ops-*.js`, with a comment explaining the owner
runs them via `railway run node scripts/ops-backup.js`), and are safer than
the manual procedure (retention pruning, a pre-restore safety snapshot taken
automatically, a `--yes` confirmation gate that defaults to a dry run).
`BACKUP-RESTORE.md` §2a states, verbatim, "This repo does not currently ship
a wrapper script for this," and §6 states "An automated backup script or cron
job — none exists in this repo yet." Both are false as of this repo's current
`HEAD`. The tools' own header comments point operators to `HANDOFF-ops.md`
for the full procedure; that file was deleted under the repo's own
evidence-teardown policy (`bb89ee6`, "delete worktrees and evidence after a
wave lands") and its content was never folded into `BACKUP-RESTORE.md` or any
surviving doc. A new operator following the one doc that exists today would
manually run raw `sqlite3 .backup`/`cp` commands (which do work — verified
above) while remaining unaware that a tested, safer, scheduled-job-ready tool
already ships in their own production image.

### H3 — Currency still defaults to USD for a real production visitor with no Cloudflare country header and an ambiguous/English browser locale

Confirmed via `bot/pricing.js#resolveCountryCode` under production-like
conditions (`HIDOOK_ISOLATED_DEPLOY` unset — the code path exercised is
identical to production's `else` branch): with no `CF-IPCountry` header and
no `Accept-Language` header at all, resolves to `US`/`usd`. With
`Accept-Language: en-US,en;q=0.9` (a very common real header for a Romanian
visitor using an English-language OS/browser, or a UK visitor), also
resolves to `US`/`usd` — by design, since a bare/`en`-tagged Accept-Language
is deliberately excluded from the EU-language fallback map (correctly, to
avoid guessing wrong — but the correct-and-safe choice here is still USD for
a real UK/Ireland/Malta visitor with an English UI). Only a non-English
EU-language Accept-Language (e.g. `ro-RO`) or an explicit `CF-IPCountry`
header correctly buckets to EUR/GBP. Per this repository's own ground truth,
production runs on Railway (not fronted by Cloudflare for the main app —
`DEPLOY_PROVIDER=cloudflare` in the recorded production config governs how
*published customer sites* deploy, not how the builder's own origin is
fronted), so `CF-IPCountry` is never present on production requests today.
This is a real, live improvement over the original finding (a non-English EU
visitor is now very likely correctly bucketed via Accept-Language, which did
not happen before), but the original defect's core claim — "any client real
primește USD" for a meaningful subset of real EU/UK visitors — still
reproduces for anyone whose browser sends an English or absent
Accept-Language, which is common. The code already logs a one-time
production warning for operators when this happens
(`pricing.country_source.cf_header_missing`); I did not verify that log
actually fires in a real Railway deployment (would need real production
env, out of scope here) — logging-only, unconfirmed in production.

---

## Medium findings

### M1 — `/health`/`/health/ready` cannot report anything if the registry database is already corrupted at process start

Reproduced: requiring `bot/web.js` (the production entry point) against an
already-corrupted `registry.sqlite` throws synchronously and the process
exits before `startServer()` ever binds a port — because `bot/registry-sqlite.js:29`
opens the database eagerly at module-load time (`const db = openRegistryDb();`),
and `bot/web.js` reaches that module through an eager top-level require chain
(`web.js` → `webpublish.js` → `registry.js`), not the lazy
`getRegistry()` pattern `bot/server.js`'s own request handlers use. In this
failure mode `/health` and `/health/ready` are simply unreachable — there is
no live process to answer either one truthfully or otherwise. Railway's
`restartPolicyType: ON_FAILURE` (max 10 retries) turns this into a visible
crash loop, which is a legitimate and arguably correct failure mode (fail
fast rather than serve a broken app), but it is a materially different
guarantee than "the readiness endpoint tells the truth about the database" —
it tells the truth only for corruption that happens **while the process is
already running**, which I separately confirmed works correctly and
honestly: corrupting `registry.sqlite` underneath a live, already-booted
server produces `/health` → still `200 {ok:true}` (by design — a
dependency-free liveness check, exactly as its own comment says, to avoid
restart-looping on a briefly slow database) and `/health/ready` → `503` with
`{"registryDb":{"ok":false,"error":"file is not a database"}}`, an accurate,
specific, truthful error.

### M2 — Would a broken commit be caught? Only for what already has a test

CI (`.github/workflows/ci.yml`) runs `node --test` correctly (fixing the
original audit's `bot/test/*.test.js`-without-`--test` documentation
mismatch — `package.json`'s own `test` script is also now correct) plus a
hard-failing secret scan and dependency audit. This is real and would catch
a regression in anything with an existing test. It would **not** have caught
C1 above: `bot/test/wave7-payments-no-double-subscription.test.js` is
thorough for the code paths it covers, but no test in the suite exercises
`/api/publish` against an existing paid site whose local `paidUntil` looks
stale while `stripeSubscriptionStatus` is still active — the exact gap that
produces a second subscription today. CI is real; its coverage of the
commercial-critical path has a specific, confirmed hole.

### M3 — VAT/automatic-tax: honestly gated, not a lie, but genuinely absent in production today

Confirmed via ground truth (`STRIPE_AUTOMATIC_TAX` not set in the live
Railway config) and via code: `automatic_tax`/`billing_address_collection`/
`tax_id_collection` only attach to a real Checkout Session when
`STRIPE_AUTOMATIC_TAX=1`, which is unset. `OWNER-STRIPE-TRIAL.md` §"VAT / EU
tax compliance" documents this accurately and thoroughly (why the flag
defaults off — turning it on against an unconfigured Stripe Tax account
would fail 100% of checkouts outright — plus a clear pre-flight checklist and
the open accountant questions). This is not a dashboard lie: the product
makes no VAT claim to the customer at all (zero UI references to VAT/TVA in
`builder/app.js`), so it is silent rather than dishonest. It remains a real
compliance gap for a product charging EU consumers, exactly as the original
audit flagged (medium #10), now with an honest paper trail instead of an
undocumented one.

---

## What held up under adversarial testing

- **The dashboard-button double-subscription guard itself** (`canStartRenewalCheckout` + `reconcileSiteFromStripe`, called from `POST /api/sites/:id/checkout`): correctly blocked a renewal attempt on a site with a forced-stale `paidUntil` but a genuinely `active` subscription status (409, Romanian, actionable message), including under concurrent load once the site was in the state the guard actually protects. Did **not** block a legitimate resubscribe after a real cancel.
- **Genuine annual renewal via `invoice.paid`/`invoice.payment_succeeded`**: extends `paidUntil` by exactly 12 months when the cycle is realistically timed (near the period end), and is fully idempotent — a duplicate delivery of the same event id, and a duplicate delivery of the same invoice id under a *different* event id, both correctly no-op. Verified against the actual ledger: exactly one `renewal` invoice entry was recorded, not two.
- **Failed-payment recording and the eventual unpublish**: `invoice.payment_failed` correctly records `paymentFailedAt`/`paymentFailedCount`; `past_due` correctly stays live (Stripe's own retry window); `unpaid` (retries exhausted) correctly and idempotently unpublishes — confirmed the live site actually 404s afterward. The data layer is right; only the communication layer (C2) is missing.
- **Backup and restore**: both the documented manual procedure and the undocumented purpose-built CLI tool round-tripped a real paid site with zero data loss, verified independently with plain `sqlite3` queries and the app's own `/admin` panel.
- **Schema-migration rollback safety**: a real, passing automated test proves every migration shipped so far is additive-only (no `DROP`/destructive `ALTER`), which is what makes "roll the app back, leave the database alone" actually safe — and the same test honestly proves the limit of that claim (an in-place data mutation like PII anonymization is not undone by a code rollback, only by restoring a pre-mutation backup).
- **CI**: runs the real test suite with the right flags and a hard-failing secret/dependency scan — a regression in anything with existing coverage would be caught before merge.
- **VAT documentation**: thorough, honest, and consistent with the actual unconfigured production state.

## What I did not get to (explicitly unconfirmed)

- **Real Stripe/Resend/Cloudflare behavior**: everything here ran under `HIDOOK_TEST_PAY`/isolated deploy, as instructed. Real Stripe retry timing/count, real card-decline copy, real email deliverability, and real Cloudflare edge caching/compression were not exercised.
- **The `pricing.country_source.cf_header_missing` production warning actually firing on Railway**: code-confirmed it would fire under the right conditions; did not confirm against a real production boot.
- **A live `docker build`**: not run (no Docker daemon in this environment); Dockerfile/`.dockerignore` were read and cross-checked against `.dockerignore` exclusions and the `ops-*.js` shipping decision, not built and booted as an image.
- **The `calendar-native.sqlite` backup/restore path**: `BACKUP-RESTORE.md`'s procedure was verified for `registry.sqlite` only; the calendar database follows the identical documented pattern but was not independently re-run here (out of this audit's payments/deploy-infra scope; the original audit's CAL-001 Docker/`node:sqlite` finding was not re-tested either).
- **Telegram-specific payment paths**: this repo's `bot/web.js` (the actual production entry point per the Dockerfile `CMD`) was the object of testing throughout; `bot/flow.js`'s Telegram-specific Stripe wiring was read but not driven end-to-end (Telegram is recorded elsewhere as frozen/out of product scope as of this date).
- **Scale/concurrency beyond the two-tab race tested**: the concurrent-checkout attempt (Attempt C) used two simultaneous requests; broader concurrent-load behavior of the SQLite registry under many simultaneous writers was not tested here (a separate wave's characterization suite covers general registry behavior, not this specific guard).
- **A second independent reviewer**: per this audit's own instructions, this is a single adversarial pass with reproduction evidence attached, not a second-agent-confirmed finding in the sense the original RAPORT.md's methodology section used that phrase.

