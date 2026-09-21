# Environmental blocker — cannot open Stripe test Checkout

Recorded 2026-09-21 ~18:45 EEST. Read-only probes only. No secrets printed.

## Required by the QA card

Open the real browser Site Builder flow from the normal landing/product path. In Stripe TEST mode only, apply an already-configured test promotion code at Stripe-hosted Checkout. Verify the final amount before payment matches the discount shown. Do not pay. Do not create live objects. Do not use live mode. Do not request credentials.

## Probes

1. Evidence folder at start contained only `FINDING.md` (backend investigation). That file already recorded: Stripe CLI installed, configured API credential expired, `The API key provided has expired.`

2. Workspace Stripe env:
   - `/Users/Work/Desktop/sitebuilder/.env` — missing
   - `.env.local`, `bot/.env`, `bot/.env.local` — missing
   - process environment: no `STRIPE_*` / `PROMO*` names

3. `stripe` CLI 1.35.1 is installed. `stripe config --list` shows a `[default]` account (`display_name=Respakr`) with a test-mode API key present and a test-mode publishable key present. `stripe promotion_codes list --limit 10` still returns:
   `The API key provided has expired. Obtain a new key from the Dashboard or run \`stripe login\` and try again.`
   No promotion codes were listed. No coupons were created.

4. Listening TCP that looked like a local web app:
   - PID 47327 `127.0.0.1:3000` — Friendlyship `src/server.ts` worktree, not Site Builder
   - PID 93094 `*:8081` — Friendlyship `react-native start`
   - PID 97759 `127.0.0.1:8190` — python (not Site Builder)
   - nothing on 8787 (documented Site Builder `/app/` port)

5. No Site Builder `node --experimental-sqlite bot/web.js` (or `bot/server.js`) process was running.

6. Repo git state (context only): uncommitted billing repair exists (`bot/payments.js` modified, `bot/test/promo-discount-schedule.test.js` untracked). QA did not edit product code and did not treat tests-green as a pass.

## Why a local workaround was refused

- `HIDOOK_TEST_PAY=1` is offline `#test-checkout=` — not Stripe-hosted Checkout, so it cannot show a promo-code field or a Stripe total.
- Starting Site Builder without `STRIPE_SECRET_KEY` cannot create a Checkout Session.
- Hitting production would be live mode, which this card forbids.
- `stripe login` would request credentials, which this card forbids.
- Creating a test promotion code would create a Stripe object and would still need a working key.

## Unblock (operator, not this QA worker)

1. Refresh Stripe CLI test-mode login on this machine (`stripe login`, test mode).
2. Put a test-mode `STRIPE_SECRET_KEY=sk_test_…` in the local Site Builder runtime (not live).
3. Leave an already-configured **test** promotion code in that same Stripe account (do not paste the secret into chat).
4. Start Site Builder web on loopback with that test key (not `HIDOOK_TEST_PAY`).
5. Re-dispatch this QA card.

No browser screenshots were saved. Inventing Checkout pixels would violate the card.
