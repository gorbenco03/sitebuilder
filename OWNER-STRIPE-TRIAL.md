# Owner how-to — Stripe subscription trial (7 days, card then live)

**Audience:** product owner only. Studio does **not** need production Stripe keys or live Product/Price IDs to ship the builder path.

**Product rule (VISION 2026-08-26):** stranger enters a valid card → **7-day trial starts** → site goes **live immediately** → Stripe **auto-charges** after the trial if not cancelled → cancel/refund via **Stripe Customer Portal / Dashboard** (not a custom in-app teardown in this slice).

---

## What the code does today

| Path | When | Behaviour |
|------|------|-----------|
| `HIDOOK_TEST_PAY=1` (non-production) | Local / E2E | Offline `cs_test_*` checkout + `#test-checkout=` return. **No network, no charge.** |
| `STRIPE_SECRET_KEY=sk_test_…` without Price env | Stripe **test** mode | Checkout `mode=subscription`, `subscription_data.trial_period_days=7`, inline `price_data` from `bot/pricing.js` amounts. |
| `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID_*` | Test or live | Same subscription + 7-day trial, but line item uses your Dashboard **Price** id. |

Webhook success for first live publish:

- `checkout.session.completed` with `payment_status=paid` **or** `no_payment_required` (trial / card-on-file) → order paid + **immediate** public deploy.
- `unpaid` / open → **no** publish.

Amounts stay in `bot/pricing.js` (`PRICE_CENTS=9900`). Price env vars point at Stripe catalog IDs — they do **not** reprice the product in code.

---

## Local / test (no real money)

```bash
# Offline (default studio QA)
HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 NODE_ENV=development …

# Optional: real Stripe Test mode (test cards only — never sk_live_ here)
unset HIDOOK_TEST_PAY
export STRIPE_SECRET_KEY=sk_test_…
export STRIPE_WEBHOOK_SECRET=whsec_…   # test endpoint → /webhooks/stripe
# optional catalog in test mode:
# export STRIPE_PRICE_ID_EUR=price_test_…
```

Use Stripe **test cards** only. Do not set live keys until you intentionally go live.

---

## Last mile — when you are ready for production (owner)

Studio will not ask for these until you decide. Steps:

1. Stripe Dashboard (live) → **Product** “Hidook Site Builder” (or equivalent).
2. Create **recurring Prices** (yearly) for EUR / GBP / USD matching commercial amounts (99 first-publish / 29 renewal).
3. Copy each Price id (`price_…`) into host env:
   - `STRIPE_PRICE_ID_EUR`
   - `STRIPE_PRICE_ID_GBP`
   - `STRIPE_PRICE_ID_USD`
   - optional fallback: `STRIPE_PRICE_ID`
4. Set `STRIPE_SECRET_KEY=sk_live_…` and `STRIPE_WEBHOOK_SECRET=whsec_…` for endpoint
   `https://<public-host>/webhooks/stripe`.
   Event: **`checkout.session.completed`** (keep listening; trial completions send `payment_status=no_payment_required`).
5. Enable **Customer Portal** for cancel/refund self-serve (Dashboard → Settings → Billing → Customer portal).
6. Confirm `NODE_ENV=production` and that `HIDOOK_TEST_PAY`, `HIDOOK_FAKE_DEPLOY`, `HIDOOK_ISOLATED_DEPLOY`, `ALLOW_FREE_PUBLISH` are **unset**.

Until steps 1–4 are done, leave Price env **unset** and use test keys or `HIDOOK_TEST_PAY` only.

---

## Out of this how-to

- Cancel-day-7 site teardown policy (separate product decision).
- Admin dashboard, legal pages, Telegram checkout (price display already 99).
- Real charges without your explicit go-live of live keys.
