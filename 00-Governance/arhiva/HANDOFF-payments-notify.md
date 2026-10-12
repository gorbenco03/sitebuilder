# HANDOFF — payments notify (Wave10)

**Owner of this file's content:** the payments agent (owns `bot/payments.js`,
`bot/webpublish.js`, `bot/ledger.js`, `OWNER-STRIPE-TRIAL.md`). Everything
described here needed a file that agent does not own
(`bot/server.js`, `builder/**`, `bot/calendar-native/**`, `templates/**`) —
if you own one of those files, this is your punch list.

## What shipped without touching any file outside this agent's ownership

The real owner-facing email notifications for the failing-payment sequence
(decline → retry → site down) live entirely inside `bot/webpublish.js`
(`_notifyOwnerEmail` / `buildPaymentDeclinedEmailRo` / `buildSiteDownEmailRo`,
called from `handleStripeInvoicePaymentFailed` and the `isUnpaidUpdate`
branch of `handleStripeSubscriptionEvent`). They fire regardless of what
caller passes for `notifyAdmin` — including `undefined`, which is exactly
what `bot/web.js` (the Dockerfile CMD, the real production entry point)
always passes. Proven end-to-end with **zero edits to `bot/web.js` or
`bot/server.js`** in
`bot/test/wave10-payments-notify-integration.test.js`, which drives a real
signed HTTP `POST /webhooks/stripe` through `bot/server.js#startServer`
using the actual, unmodified `bot/web.js#onStripeEvent` dispatcher. **No
action needed from you for this to work in production** — it already does,
as of this wave, and needs no `bot/server.js`/`builder/**` wiring step.

## What is left — and does need a change outside this agent's files

### 1. No way for an owner to add/see their notification email (builder/**, bot/server.js)

The new emails go to `registry.getUser(site.userId).email` — the same
address used for magic-link sign-in. This works for every site created
through the web builder (sign-in is by email there). It does **not** work
for a site whose account has no email on file — e.g. a Telegram-origin site
with no web account. That case is not silently broken (the ledger records
`reason: 'no_recipient'`, nothing throws — see
`bot/test/wave10-payments-notify-email.test.js`'s "no user email on file"
case), but the owner in that state genuinely gets nothing when their card
fails.

**Suggested fix (not this agent's files to make):** a settings field in
`builder/app.js` (or a one-time prompt after first publish) letting an
owner add/confirm a contact email, persisted via a `bot/server.js` route
onto the user record (`registry.getOrCreateUserByEmail` /
an `updateUser`-shaped call — check `registry-sqlite.js`/`registry-json.js`
for what exists today; there is currently no generic "update this user's
email" function, only creation). Until that exists, a Telegram-origin
owner's only signal remains the dashboard badge (`site.dunning`, already
wired) — which requires them to log in, the exact problem this wave was
asked to close.

### 2. Dashboard could optionally surface "we emailed you" (builder/app.js, nice-to-have)

Not required — the dashboard badge (`buildSiteCard()` reading `site.dunning`)
already tells the truth and does not need this to be correct. But if you
want to close the loop visually, `webpublish.getDunningState(site)` could be
extended to also read the latest `owner_notified` ledger row for that site
and surface e.g. "Ți-am trimis un email pe {address} pe {dată}" under the
existing dunning banner. This is presentation only; the underlying data
(ledger `event: 'owner_notified', channel: 'email', ...`) already exists and
is stable — see `bot/webpublish.js#_notifyOwnerEmail`'s ledger shape.

### 3. RESEND_API_KEY / EMAIL_FROM are shared with the magic-link sender (ops, no code change)

The new emails reuse the same `RESEND_API_KEY` / `EMAIL_FROM` env vars as
`bot/email.js#sendMagicLink` (deliberately — one Resend account, one sender
identity). No action needed if these are already set in production (the
context that spawned this wave says they are); just noting the coupling so
a future rotation of `RESEND_API_KEY` is understood to affect both magic
links and payment-failure notices, not just one.

## What was explicitly re-verified and found still correct (no action needed)

- The double-subscription guard (`canStartRenewalCheckout` +
  `reconcileSiteFromStripe`) is still wired into **both**
  `POST /api/sites/:id/checkout` and the ordinary `POST /api/publish`
  republish path in `bot/server.js` (source-confirmed at the specific lines
  the 2026-09-06 re-audit flagged, `bot/server.js:3166-3201`) — see
  `04-QA-Evidence/Wave10-payments/adversarial-walk-result.json`, step "C1
  re-check".
- The dashboard dunning badge (`site.dunning` attached in
  `bot/server.js#getSitesForOwner`-shaped handlers, rendered in
  `builder/app.js#buildSiteCard`) matches reality at every stage of the
  decline → retry → site-down sequence — also re-confirmed in the same
  adversarial walk.
- Invoice history (`GET /api/sites/:id/invoices`) is reachable; no change
  needed.

## Files touched by this wave

`bot/webpublish.js`, `bot/ledger.js` (no change — reused as-is), tests under
`bot/test/wave10-payments-*`, `OWNER-STRIPE-TRIAL.md`. `bot/payments.js` was
read but not changed by this specific fix (the VAT runbook rewrite in
`OWNER-STRIPE-TRIAL.md` documents `bot/payments.js` behavior that already
existed). No changes to `bot/server.js`, `builder/**`,
`bot/calendar-native/**`, `templates/**`, or any frozen file
(`bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`).
