# Owner how-to — Stripe subscription trial (7 days, card then live)

**Audience:** product owner only. Studio does **not** need production Stripe keys or live Product/Price IDs to ship the builder path.

**Product rule (VISION 2026-08-26):** stranger enters a valid card → **7-day trial starts** ($0 now) → site goes **live immediately** → Stripe **auto-charges 99** after the trial if not cancelled → **29/year** after the first paid year via a **Subscription Schedule** phase → **Cancel** in the builder opens **Stripe Customer Portal** → when the subscription is cancelled, the **public site is unpublished** (not live). Refunds stay **Stripe Dashboard / Customer Portal** (no custom refund API).

**Commercial amounts (Hidook Site Builder):** first period **99** (after the 7-day card trial), then **29**/year renewal in the same currency. Never a forever-99 yearly Price. Never a one-time Checkout line next to the trial (that would charge immediately).

---

## What the code does today

| Path | When | Behaviour |
|------|------|-----------|
| `HIDOOK_TEST_PAY=1` (non-production) | Local / E2E | Offline `cs_test_*` checkout + `#test-checkout=` return. **No network, no charge.** Returns the same **99-then-29** billing contract. Offline **Cancel** opens `#test-billing-portal=bps_test_*` and finishes cancel without network (site unpublished). |
| `STRIPE_SECRET_KEY=sk_test_…` without Price env | Stripe **test** mode | Checkout `mode=subscription`, `allow_promotion_codes=true`, `subscription_data.trial_period_days=7`, **single** inline recurring `price_data` at **99**/year. On `checkout.session.completed`, app attaches a **Subscription Schedule**: phase 0 = 99 through trial + first paid year; phase 1 = **29**/year thereafter. Builder **Cancel** → `billing_portal.sessions`. |
| `STRIPE_SECRET_KEY` + first-year `STRIPE_PRICE_ID_*` | Test or live | Same subscription + 7-day trial on your first-year Dashboard **Price**. Schedule phase 1 uses `STRIPE_PRICE_ID_RENEWAL_*` when set, else creates a **29**/year Price from `bot/pricing.js`. |
| + optional `STRIPE_PRICE_ID_RENEWAL_*` | Test or live | Schedule phase 1 uses your **29**/year Catalog Price id (preferred for live). |

Webhook success for first live publish:

- `checkout.session.completed` with `payment_status=paid` **or** `no_payment_required` (trial / card-on-file) → order paid + **immediate** public deploy + **subscription schedule attach** (99 then 29).
- `unpaid` / open → **no** publish.

Webhook cancel → site comes down:

- `customer.subscription.deleted` → **unpublish** (isolated: remove `$DATA_DIR/published/<slug>/`; registry status not live). Idempotent.
- `customer.subscription.updated` with `status=canceled` → same unpublish.
- Cancel during the 7-day trial does **not** charge (no invoice paid yet). Refunds for any later charge stay owner-side via **Dashboard / Customer Portal**.

Amounts stay in `bot/pricing.js` (`PRICE_CENTS=9900` first period, `RENEWAL_CENTS=2900` yearly after). Price env vars point at Stripe catalog IDs — they do **not** reprice the product in code. Session metadata alone does **not** change Stripe invoices; the schedule does.

---

## Local / test (no real money)

```bash
# Offline (default studio QA)
HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 NODE_ENV=development …

# Optional: real Stripe Test mode (test cards only — never sk_live_ here)
unset HIDOOK_TEST_PAY
export STRIPE_SECRET_KEY=sk_test_…
export STRIPE_WEBHOOK_SECRET=whsec_…   # test endpoint → /webhooks/stripe
# optional catalog in test mode (two Prices — first year 99, renewal 29):
# export STRIPE_PRICE_ID_EUR=price_test_…
# export STRIPE_PRICE_ID_RENEWAL_EUR=price_test_…
```

Use Stripe **test cards** only. Do not set live keys until you intentionally go live.

Listen for (in addition to checkout):

- `customer.subscription.deleted`
- `customer.subscription.updated` (app only acts when `status=canceled`)

---

## Last mile — when you are ready for production (owner)

Studio will not ask for these until you decide. Steps:

1. Stripe Dashboard (live) → **Product** “Hidook Site Builder” (or equivalent).
2. Create **two** recurring yearly **Prices** per currency you sell (EUR / GBP / USD):
   - **First year:** amount **99** (first period after the 7-day trial). Used on Checkout.
   - **Renewal:** amount **29** (every later year, same currency). Used on **Subscription Schedule** phase 1.
3. Copy each Price id (`price_…`) into host env:
   - First-year: `STRIPE_PRICE_ID_EUR` / `STRIPE_PRICE_ID_GBP` / `STRIPE_PRICE_ID_USD`
     - optional fallback: `STRIPE_PRICE_ID`
   - Renewal (29/year): `STRIPE_PRICE_ID_RENEWAL_EUR` / `STRIPE_PRICE_ID_RENEWAL_GBP` / `STRIPE_PRICE_ID_RENEWAL_USD`
     - optional fallback: `STRIPE_PRICE_ID_RENEWAL`
4. Set `STRIPE_SECRET_KEY=sk_live_…` and `STRIPE_WEBHOOK_SECRET=whsec_…` for endpoint
   `https://<public-host>/webhooks/stripe`.
   Events: **`checkout.session.completed`**, **`customer.subscription.deleted`**, **`customer.subscription.updated`**.
   The paid handler creates/updates a **subscription schedule** on the new subscription.
   Cancel webhooks **unpublish** the public site.
5. Enable **Customer Portal** for cancel/refund self-serve (Dashboard → Settings → Billing → Customer portal).
   Builder **Cancel** calls `POST /api/sites/:id/billing-portal` → Stripe `billing_portal.sessions`.
6. Confirm `NODE_ENV=production` and that `HIDOOK_TEST_PAY`, `HIDOOK_FAKE_DEPLOY`, `HIDOOK_ISOLATED_DEPLOY`, `ALLOW_FREE_PUBLISH` are **unset**.

Until steps 1–4 are done, leave Price env **unset** and use test keys or `HIDOOK_TEST_PAY` only (inline path already does **99 then 29** from `bot/pricing.js` via Checkout + schedule).

If you set a first-year Price env without a renewal Price env, the app still attaches a schedule phase at renewal **29** (creates a Price from `pricing.js`) so billing is never an undocumented forever-99 catalog.

---

## Cancel behaviour (product default)

| Action | Result |
|--------|--------|
| Customer cancels in **Customer Portal** (trial or later) | Stripe ends the subscription → webhook → **site unpublished** (not publicly served). |
| Cancel during 7-day trial | **No charge.** Site comes down. |
| Refund after a charge | Owner issues refund in **Stripe Dashboard** or Portal. No in-app refund API. |

---

## Ops /admin (operator site list)

Set a long random `HIDOOK_ADMIN_TOKEN` in the **host environment only** (never commit a real value). Open `https://<public-host>/admin` with header `Authorization: Bearer <token>`, or for a browser tab `https://<public-host>/admin?token=<token>`. Done looks like: title **Sites**, product name **Hidook Site Builder**, every registry row with slug, **Live** or **Unpublished**, public URL when live, and billing (trial / paid / canceled) when already on the site record. Missing or wrong token returns a plain **404** (surface is not advertised). Read-only — no unpublish or refund buttons; refunds stay Stripe Dashboard / Customer Portal.

---

## Download HTML (current draft)

In the **Hidook Site Builder** editor topbar, **Download HTML** fetches `GET /api/export-html` (session cookie) and saves a complete `.html` file of the **current draft** from the registry — same `build.js` renderer as a live site, but **no** Stripe charge, deploy, or unpublish. Sign-in required; missing draft returns an error toast. Never print secrets.

## Download ZIP / self-deploy (Flow 3)

**Descarcă ZIP** fetches `GET /api/export-zip` (session cookie) and saves a `.zip` of the current draft: `index.html`, CSS/JS, images, Privacy/Terms/Cookies pages, cookie banner assets, and the Hidook attribution badge. Unzip and serve with any static host — **no** Hidook runtime and **no** required requests to Hidook domains. Same auth rules as Download HTML (sign-in, draft required). Not a live publish and not a charge.

---

## Instafidget (partner)

Instagram feed is provided by Instafidget, a partner product (not Hidook Site Builder). Included free for 12 months with a Site Builder site, then Instafidget Free (watermark). Public Instagram on the live site only appears when the partner embed is connected; otherwise the section is omitted. Hidook does not bill Instafidget and does not operate Instagram. Never print partner secrets.

---

## Out of this how-to

- Fifth design system, Telegram checkout.
- Real charges without your explicit go-live of live keys.
- Legal counsel text beyond the product placeholders already shipped.
