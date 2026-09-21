# FINDING — billing promo investigation (2026-09-21)

## Determination

**Root cause in code:** Stripe Checkout accepted customer promotion codes, but the post-checkout `99 → 29` Subscription Schedule rewrite did not copy Stripe's existing phase-0 Discount into the replacement phase. Stripe's explicit schedule update could therefore remove a code that Checkout had displayed as applied before the trial-end invoice was created.

The repair in `bot/payments.js` now reuses each existing Stripe Discount in phase 0 of the schedule update. The Checkout code path already sends `allow_promotion_codes=true`; the repair keeps the Stripe-applied discount in force for the first scheduled invoice. Coupon duration, eligible products/prices, currency restrictions, and redemption rules remain Stripe's authority.

## Chiril Gorbenco — records inspected

- Local registry search: no matching `users.first_name` or email record was present in `bot/registry.sqlite`.
- Local registry therefore has no associated site, order, Checkout Session, subscription, invoice, amount, or timestamp to attribute to this customer.
- Stripe CLI was installed, but its configured API credential had expired. Its read-only customer query returned: `The API key provided has expired.` No Stripe object was created, modified, refunded, or cancelled.

Accordingly, this repository cannot honestly establish the exact price, promotion code/coupon, amount charged, invoice time, whether the trial was skipped, or whether a duplicate subscription exists for this customer. The code defect above is proven by a causal regression test; the individual charge still needs the owner to inspect the live Stripe record.

## Fix and verification

- Added `bot/test/promo-discount-schedule.test.js`.
  - RED: failed because the generated phase-0 schedule update omitted `phases[0][discounts][0][discount]`.
  - GREEN: passes after the repair and asserts that the Checkout-applied Stripe Discount is retained.
- Passed focused billing checks:
  - `node --experimental-sqlite --test bot/test/promo-discount-schedule.test.js`
  - `node --experimental-sqlite --test bot/test/wave4-subscription-trial.test.js`
  - `node --experimental-sqlite --test bot/test/wave8-stripe-99-then-29.test.js`

## Owner how-to: inspect and, only if warranted, correct the charge

Do this in the same Stripe mode in which the client paid (usually **Live mode**, not Test mode). No credentials are needed in this document.

1. Open `https://dashboard.stripe.com/payments` and ensure the Live/Test mode selector matches the payment.
2. Search for **Chiril Gorbenco** using the Dashboard search field. Open the matching customer, then open **Payments** and the associated **Invoice**.
3. Record privately from the invoice: amount and currency paid, paid timestamp, invoice ID, subscription ID, the applied promotion/coupon, and the invoice period. In the subscription timeline, confirm whether the 7-day trial existed and whether more than one subscription is active for that customer.
4. Compare the invoice's discount and total against the Checkout Session/Subscription's applied promotion. If the promotion was missing or the paid total differs from the Stripe Checkout total the customer was shown, the charge is eligible for remediation under the product's policy.
5. To refund a confirmed erroneous payment: from that payment, choose **Refund** → select the full amount (or the approved adjustment amount) → confirm. Done looks like payment status **Refunded** (or **Partially refunded**) and a corresponding refund row under the payment. Do not create a new Checkout Session to compensate.
6. To stop a future charge while the adjustment is investigated: open the Subscription → **Cancel subscription** (or use the configured Customer Portal). Done looks like subscription status **Canceled** and no next invoice. This product's webhook unpublishes the site after cancellation, so confirm the customer understands that consequence before cancelling.
7. Save the private Stripe invoice/subscription IDs and the dashboard outcome with the support case; do not paste payment identifiers or card data into source control or this evidence file.

## Remaining QA gate

A QA browser task follows this backend repair: in Stripe **test mode**, apply a configured test promotion code, verify the final Stripe-hosted Checkout amount before payment, and save deterministically named screenshots in this same directory.
