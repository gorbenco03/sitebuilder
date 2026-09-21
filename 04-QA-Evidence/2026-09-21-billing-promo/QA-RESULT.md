# QA result — Stripe test-mode promo total before payment

QA: FAIL

Not a product-pixel fail. The Stripe test-mode Checkout path could not be opened. No screenshots of Checkout exist because none were taken.

Checked at 2026-09-21 18:45 EEST (local Mac). Read `FINDING.md` first. Did not submit payment, did not create Stripe objects, did not use live mode, did not request credentials, did not start `HIDOOK_TEST_PAY` (that is not Stripe-hosted Checkout).

## Defects / blockers

1. Stripe CLI test-mode API key is expired.
   Evidence: `stripe promotion_codes list --limit 10` returned `The API key provided has expired. Obtain a new key from the Dashboard or run \`stripe login\` and try again.`
   Screenshot: none (CLI, not a product screen). See `ENVIRONMENT-BLOCKER.md`.

2. No Site Builder Stripe test-mode configuration in this workspace.
   Evidence: no `.env` / `bot/.env` / process `STRIPE_*` keys. Local recipe without `HIDOOK_TEST_PAY` cannot create a real Checkout Session.

3. No already-configured test promotion code is readable.
   Evidence: promotion-code list failed on expired auth. Repo does not document a test code. Task forbids creating Stripe objects.

4. No real Site Builder product process is listening.
   Evidence: 127.0.0.1:3000 is Friendlyship backend; :8081 is React Native metro for Friendlyship; nothing on :8787 (`/app/` local recipe). Opening those ports would not be Site Builder Checkout.

## What was not done

- Did not open landing → builder → Stripe Checkout.
- Did not apply a promo code.
- Did not compare a discounted total to the amount shown.
- Did not fabricate browser proof.

Unblock requires: working Stripe **test** mode credentials already on this machine, a Site Builder process using `sk_test_` (not `HIDOOK_TEST_PAY`, not live), and an already-configured test promotion code. Then re-run this QA card.
