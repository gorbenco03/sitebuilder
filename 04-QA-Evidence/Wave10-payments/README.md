# Wave10 — payments: real notifications, VAT runbook, adversarial re-walk

Scope: close the two remaining gaps from `04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/FINDINGS.md`
(C2's missing owner-facing channel, M3's undocumented VAT switch-on path)
without redoing what that re-audit already confirmed fixed (C1 guard on both
checkout doors, invoice history reachable, dashboard dunning display).

## Files in this directory

- `adversarial-walk.mjs` — real-HTTP adversarial walk: trial → live →
  renewal → C1 re-check → decline → 2 retries → exhaustion → return →
  cancel, driven through `bot/server.js`'s actual `/webhooks/stripe` route
  and the real, unmodified `bot/web.js#onStripeEvent` dispatcher.
  `HIDOOK_TEST_PAY`/`HIDOOK_ISOLATED_DEPLOY`, no real Stripe/Resend
  credentials. Re-run: `node --experimental-sqlite adversarial-walk.mjs`.
- `adversarial-walk-result.json` — the last run's result: 17/17 steps OK.
  Every "told-vs-charged" step compares what a customer would be told
  (dashboard dunning state / email copy) against what actually happened
  (site's real HTTP-served status, ledger's real invoice amount) and found
  no disagreement.
- `wave10-payments-notify-email.txt` — full run of
  `bot/test/wave10-payments-notify-email.test.js` (13 checks): decline,
  retry, last-chance, exactly-once on duplicate webhook delivery (both
  invoice.payment_failed and subscription.updated unpaid), never for
  cancel/delete, never for a mere past_due→active recovery, dev-mode
  fallback never throws, no-recipient case never throws, content-only pure
  function checks.
- `wave10-payments-notify-integration.txt` — full run of
  `bot/test/wave10-payments-notify-integration.test.js` (3 checks): the same
  guarantees, but driven through a REAL signed HTTP webhook request against
  `bot/server.js` using the real, unmodified `bot/web.js#onStripeEvent` —
  proof that zero changes to `bot/server.js`/`bot/web.js` were needed.
- `full-suite-run.txt` — `node --experimental-sqlite --test bot/test/*.test.js`:
  340 tests, 339 pass, 1 fail (`flow3-legal-export.test.js`, pre-existing,
  deliberately Brave-specific — matches the documented baseline exactly).
- `fullpass-63230d2.txt` — `node --experimental-sqlite bot/test/fullpass-63230d2.mjs`:
  `FULLPASS defects=0 steps=46`, unchanged from baseline.

## What changed to make this pass

- `bot/webpublish.js` — new Romanian owner-email notifications
  (`buildPaymentDeclinedEmailRo`, `buildSiteDownEmailRo`, `_notifyOwnerEmail`,
  `_sendOwnerEmail`, `_dashboardUrl`, `_ownerEmailForSite`), wired into
  `handleStripeInvoicePaymentFailed` and the `isUnpaidUpdate` branch of
  `handleStripeSubscriptionEvent`. Also fixed a latent exactly-once bug in
  `handleStripeSubscriptionEvent`: a duplicate webhook delivery of the same
  event id used to still re-run the Telegram `notifyAdmin` call (only logged
  "already_handled" and fell through) — now gated on `firstDelivery`, which
  also protects the new email from double-sending on the same class of
  redelivery.
- `OWNER-STRIPE-TRIAL.md` — VAT section rewritten as an ordered runbook (0.
  decide inclusive/exclusive first, 1-2. Dashboard Tax setup + registration
  status check, 3-4. test-mode checkout + concrete verification via the
  Checkout page's tax line AND the API's `automatic_tax.status`/
  `total_details.amount_tax`, 5. go-live) plus a Rollback section that did
  not exist before (unset the flag first, investigate second; nothing to
  undo in Stripe itself). Dunning section rewritten to describe the real
  email channel instead of the old "no channel exists" claim. Two stale
  `HANDOFF-payments.md` references removed (that file no longer exists in
  the repo — already-shipped fixes, not pending wiring).
- `HANDOFF-payments-notify.md` (repo root) — what's left that needs a file
  this agent does not own: primarily, no way today for an emailless
  (Telegram-origin) account to receive the new notifications.
- New tests: `bot/test/wave10-payments-notify-email.test.js`,
  `bot/test/wave10-payments-notify-integration.test.js`.

## Honest gaps not closed by this wave (see HANDOFF-payments-notify.md)

- A site whose account has no email on file (Telegram-origin, no web
  sign-in) still gets no notification of any kind if its card fails —
  logged, never throws, but genuinely nothing reaches a human. Needs a
  `builder/**`/`bot/server.js` change (collecting/storing a contact email)
  this agent does not own.
- H3 from the re-audit (currency defaults to USD for an English-locale EU
  visitor with no `CF-IPCountry`) is unrelated to this wave's scope
  (`bot/pricing.js`, not an owned file) and was not touched.
- Real Resend delivery, real Stripe Smart Retries timing/count, and real
  production `PUBLIC_URL` were not exercised — everything above ran under
  `HIDOOK_TEST_PAY`/no `RESEND_API_KEY`, as instructed.
