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
- Other `customer.subscription.updated` lifecycle states are persisted on the site. Export remains available only for `active` / `trialing`; `past_due`, `unpaid`, `incomplete`, `incomplete_expired` and `paused` block HTML/ZIP even when historical `paid=true` and `paidUntil` is still in the future.
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
- `customer.subscription.updated` (app persists lifecycle status for publish/export entitlement and unpublishes when `status=canceled`)

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
   Subscription updates persist the Stripe lifecycle status used by publish/export entitlement; cancel/delete webhooks **unpublish** the public site.
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

In the **Hidook Site Builder** editor topbar, **Download HTML** fetches `GET /api/export-html` (session cookie) and saves a complete `.html` file of the **current draft** from the registry — same `build.js` renderer as a live site, but no new Stripe charge, deploy, or unpublish. Export uses the live-publish entitlement allowlist: Stripe `active`, Stripe `trialing`, or an unexpired legacy paid entitlement. `paid=true` alone is historical and insufficient: unpaid, `past_due`, canceled, and expired-`paidUntil` drafts receive a Romanian activation upsell and no file; missing draft also returns an error toast. Never print secrets.

## Download ZIP / self-deploy (Flow 3)

**Descarcă ZIP** fetches `GET /api/export-zip` (session cookie) and saves a `.zip` of the current draft: `index.html`, CSS/JS, images, Privacy/Terms/Cookies pages, cookie banner assets, and the Hidook attribution badge. Unzip and serve with any static host — **no** Hidook runtime and **no** required requests to Hidook domains. It uses the same explicit entitlement allowlist as Download HTML and live publish: `active`, `trialing`, or unexpired legacy paid. Unpaid, `past_due`, canceled, and expired-`paidUntil` drafts receive a Romanian activation upsell and no file. Export is not a live publish and does not create a new charge.

---

## Instafidget (partner)

Instagram feed is provided by Instafidget, a partner product (not Hidook Site Builder). Included free for 12 months with a Site Builder site, then Instafidget Free (watermark). Public Instagram on the live site only appears when the partner embed is connected; otherwise the section is omitted. Hidook does not bill Instafidget and does not operate Instagram. Never print partner secrets.

---

## VAT / EU tax compliance (Wave7)

**Why this exists:** Hidook sells to Romanian and EU small businesses.
Charging without handling VAT correctly is a compliance problem, not a
polish item (audit medium #10). The code is ready; turning it on for real
money needs a few Dashboard steps and, for two of them, your accountant —
this repo cannot decide those for you, and guessing would be worse than
leaving them written down here.

### What the code does today

- `STRIPE_AUTOMATIC_TAX` env var, **unset/`0` by default**. When set to `1`,
  Checkout Sessions add:
  - `automatic_tax: {enabled: true}` — Stripe calculates VAT per customer
    location.
  - `billing_address_collection: 'required'` — needed both for the tax
    calculation and because a VAT-compliant invoice must show the
    customer's address.
  - `tax_id_collection: {enabled: true}` — an EU business customer can enter
    their VAT id at checkout; Stripe validates it and, once automatic_tax is
    on, applies the intra-EU B2B **reverse charge** (0% charged to the
    customer, they self-assess) automatically.
- Every inline Price (`price_data`) — the Checkout line item and the
  renewal-phase Price created by `attachFirstThenRenewalSchedule` — sets
  `tax_behavior: 'exclusive'` **unconditionally**, flag or no flag. This
  means the 99/29 figures in `bot/pricing.js` are treated as **net of VAT**:
  if you later turn `STRIPE_AUTOMATIC_TAX=1` on, an EU consumer sees VAT
  added on top of 99/29, not carved out of it.

**Why the flag defaults off:** `automatic_tax: {enabled:true}` makes
Checkout Session creation **fail outright** on any Stripe account that has
not configured Stripe Tax (Dashboard → Tax → origin address +
registrations). Turning it on unconditionally the day this ships would take
down 100% of checkout on an unconfigured account — a strictly worse outcome
than today's VAT gap. Flip the env var only after the Dashboard steps below.

### Before you set `STRIPE_AUTOMATIC_TAX=1`

1. **Stripe Dashboard → Tax** → enable Stripe Tax, set your business's
   origin address, and add a tax registration for Romania (and any other
   country you are obligated to collect VAT in).
2. Test in Stripe **test mode** first (`sk_test_…` + `STRIPE_AUTOMATIC_TAX=1`)
   and run a checkout with a test card from an EU billing address to confirm
   Stripe actually computes and shows a tax line before doing this in live
   mode.
3. Only then set `STRIPE_AUTOMATIC_TAX=1` alongside `sk_live_…` in production.

### Questions for your accountant (this repo does not guess these)

- **Inclusive vs. exclusive pricing.** The code currently treats 99/29 as
  VAT-exclusive (VAT added on top, varying by the customer's EU country's
  rate). Should the *displayed* headline price instead be VAT-inclusive
  (same 99€ regardless of buyer country, margin absorbs the VAT
  difference)? This is a pricing/positioning call, not a technical one —
  changing it is a one-line `tax_behavior` flip in `bot/payments.js` once
  you decide.
- **OSS (One-Stop-Shop) registration.** Selling a digital service (site
  hosting) to EU consumers (B2C) across borders above the EU-wide
  €10,000/year threshold requires either registering for VAT in each
  buyer's country or using the OSS scheme to file once. Below that
  threshold, domestic Romanian VAT rules alone may suffice for now — has
  that threshold check been done, and is OSS registration in progress if
  needed?
- **Romanian invoicing requirements beyond VAT.** Sequential invoice
  numbering, mandatory company fields (CUI, registration number) on every
  invoice — Stripe's own invoices carry your Business Settings details, but
  confirm with your accountant that Stripe-generated invoices satisfy
  Romanian ANAF requirements for your entity type, or whether e-Factura
  (Romania's mandatory e-invoicing system) obligations apply to a SaaS
  subscription sold this way.
- **B2B reverse charge validation.** `tax_id_collection` lets a business
  customer type *any* string as a VAT id at checkout — Stripe validates it
  against the EU VIES registry before applying the reverse charge, but
  confirm you're comfortable with Stripe's validation being the sole gate
  (no manual review) before relying on it for real invoices.

Until these are answered, leave `STRIPE_AUTOMATIC_TAX` unset. The product
still functions exactly as before — this is additive, not a behavior change
for existing checkout.

---

## Dunning: the sequence a customer (and the owner) can act on

**Audit:** "a failed invoice currently records a ledger entry and one
Romanian notification." Wave7 built out the rest of the sequence:

| Day | Stripe state | What the code does | What the owner sees |
|-----|--------------|---------------------|----------------------|
| 0 | Charge declines | `invoice.payment_failed` → `webpublish.handleStripeInvoicePaymentFailed`: records `paymentFailedAt`/`paymentFailedCount` on the site, appends a ledger `payment_failed` entry (with Stripe's own `next_payment_attempt`), best-effort notifies. | Site stays live. Notification names the attempt number and either the next scheduled retry date or, if none, says plainly retries are exhausted. |
| Stripe subscription flips to `past_due` around the same time | `customer.subscription.updated status=past_due` → status persisted, **not** unpublished (past_due is recoverable — Stripe keeps retrying on its own schedule). | Dashboard: `webpublish.getDunningState(site)` returns a `warning`-severity state — see §2 of `HANDOFF-payments.md` for the exact dashboard wiring (this agent doesn't own `builder/**`). |
| Retries 2, 3, 4… (Stripe's own Smart Retries schedule — not configured by this codebase) | Each failed attempt repeats the row above with an incrementing `attemptCount`. | Same warning, updated attempt count. |
| All retries exhausted | Stripe flips the subscription to `unpaid` (or `incomplete_expired` for a first invoice that never got paid) → `handleStripeSubscriptionEvent` unpublishes the site **and now notifies the owner** ("Site oprit: …") — this used to be completely silent. | `getDunningState` returns a `critical`-severity state: the site is down, add a new card to bring it back. |

**Stripe Dashboard settings this code does not control:** Smart Retries
schedule (how many attempts, how spaced) and "Email customers about failed
invoices" live in **Stripe Dashboard → Settings → Subscriptions and
emails**. This codebase has no customer email channel of its own — on the
web platform there is currently no owner-facing notification channel at all
(`bot/web.js` passes `notifyAdmin: undefined` throughout; see
`HANDOFF-payments.md` §2). Until a real channel exists, enable those Stripe
Dashboard settings so the *customer* gets Stripe's own dunning emails, and
treat the dashboard card as the *owner's* notice.

---

## Invoice history ("Facturi")

**Audit:** "an owner paying yearly has no way to see or download past
invoices." `webpublish.getInvoiceHistory(site)` now returns every charge
(first-year and renewal, `HIDOOK_TEST_PAY` and real Stripe alike) from a
durable ledger record this branch appends on every successful payment —
provable without real Stripe credentials. Real-Stripe renewals also carry
Stripe's own `hostedInvoiceUrl`/`invoicePdf` links. See `HANDOFF-payments.md`
§4 for the `GET /api/sites/:id/invoices` route and the "Facturi" button this
agent could not add directly (does not own `bot/server.js`/`builder/**`).

---

## No second subscription for a site that already has one

**Audit's worst payments finding:** "a paying customer labelled 'Expirat'
and pushed into opening a second subscription that billed alongside the
first." Re-verified end to end in
`bot/test/wave7-payments-no-double-subscription.test.js` (active
subscription → renewal paid → dashboard label stays correct → the guard
refuses a second Checkout). Two new functions, both need one wiring step in
`bot/server.js` — see `HANDOFF-payments.md` §1:

- `webpublish.reconcileSiteFromStripe(site)` — heals a stale local
  `paidUntil` from Stripe's own subscription status before anything else
  decides the site looks expired.
- `webpublish.canStartRenewalCheckout(site)` — refuses to open a Checkout
  Session while Stripe still reports the site's subscription as
  active/trialing/past_due.

---

## Out of this how-to

- Telegram checkout (all five design systems, including Desserdirina, already ship —
  see `templates/registry.json`; this is a Stripe/billing how-to, not a design-scope doc).
- Real charges without your explicit go-live of live keys.
- Legal counsel text beyond the product placeholders already shipped.
