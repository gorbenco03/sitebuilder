# Hidook Site Builder — go-live & configuration guide

Everything you need to configure before you can sell the product to real customers.

Scope: the **web application** (browser builder + its backend). The Telegram bot is
optional and is not required for any step here.

Related docs: [`PRODUCT.md`](PRODUCT.md) (product contract), [`LAUNCH.md`](LAUNCH.md)
(positioning), [`bot/DEPLOY.md`](bot/DEPLOY.md) (Railway specifics).

---

## 0. What the customer journey actually is

1. Customer opens the builder → picks one of four designs → edits copy and photos.
2. Signs in with a **magic link** sent by email (no password).
3. Starts a **Stripe subscription** with a **7-day trial** (**card required**).
4. Their site goes **live immediately after a valid card** (trial period; no charge yet).
5. If they do not cancel, Stripe **auto-charges 99** (EUR / GBP / USD by country bucket) after day 7.
6. They come back, edit, republish. **Renewal is 29/year** in the same currency via a
   **subscription schedule**. Cancel during trial **unpublishes** the live site (no charge).

Every one of those steps depends on a key you must configure. If any is missing,
the journey breaks at that step — usually **silently**. Section 3 lists exactly how.

**Payment before first public publish** means card-on-file subscription trial in the
builder — not a one-time charge before go-live, and not an unpaid free live window.

---

## 1. Accounts to open before you start

| Service | What for | Cost |
|---|---|---|
| **Stripe** | Subscription checkout (7-day trial), first-year **99** charge, **29**/year renewal schedule, Customer Portal | % per transaction |
| **Resend** | Magic-link sign-in emails + receipts | Free tier available |
| **Cloudflare** | Hosting the customer sites you publish | Pages free tier is generous |
| A host (**Railway**, Fly, Render, a VPS…) | Running this app itself, 24/7 | ~$5–20/mo |
| A domain registrar | Your brand domain | ~$10–15/yr |

You need a **legal entity + VAT setup** before charging real money. That is a business
prerequisite, not a technical one, but it blocks going live just as hard.

---

## 2. The environment variables

### 2.1 Required — the app is broken without these

| Variable | Value | Why |
|---|---|---|
| `SERVER_SECRET` | `openssl rand -hex 32` | Signs session cookies and magic-link tokens. **Without it, every auth route returns 503** — nobody can sign in. |
| `PUBLIC_URL` | `https://builder.yourdomain.com` | Used to build magic links and Stripe return URLs. Must be the real public URL, no trailing slash. |
| `DATA_DIR` | `/data` (a **persistent volume**) | Accounts, the site registry, drafts and published artifacts live here. On ephemeral disk you lose every customer site on redeploy. |
| `PORT` | injected by your host | The HTTP server binds it and serves `GET /health`. |

### 2.2 Required to actually make money

| Variable | Value | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | `stripe` | |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` while testing. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | From the webhook endpoint you create in §4. The webhook is the **source of truth** for card-on-file / trial start / paid. |
| `STRIPE_PRICE_ID_EUR` / `_GBP` / `_USD` (optional) | `price_…` | Dashboard first-year recurring Prices. Omit to use inline `price_data` from `bot/pricing.js`. See [`OWNER-STRIPE-TRIAL.md`](OWNER-STRIPE-TRIAL.md). |
| `STRIPE_PRICE_ID` (optional) | `price_…` | Fallback first-year Price id when currency-specific env is unset. |
| `STRIPE_PRICE_ID_RENEWAL_*` (optional) | `price_…` | Renewal Prices (**29**/year) used when attaching the subscription schedule. |

Commercial **amounts** are **not** free-form env prices. Cents come from
[`bot/pricing.js`](bot/pricing.js): **99** first-year charge after trial, **29**/year
renewal, bucketed EUR (EU) / GBP (UK) / USD (rest). Leave any legacy `BUILD_FEE_*`
override unset. Checkout is a **subscription with a 7-day trial** (card required;
site live during trial).

### 2.3 Required for customers to be able to sign in

| Variable | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | **See the warning in §3.1 — this one fails silently.** |
| `EMAIL_FROM` | `Hidook <hello@yourdomain.com>` | Must be a domain you verified in Resend. |

### 2.4 Required for published sites to get a URL

Pick **one** provider. Cloudflare Pages is the documented path.

| Variable | Value |
|---|---|
| `DEPLOY_PROVIDER` | `cloudflare` |
| `CLOUDFLARE_API_TOKEN` | token with **Pages: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | from the Cloudflare dashboard |
| `BRAND_DOMAIN` | `sites.yourdomain.com` — publishes attach `<slug>.<BRAND_DOMAIN>` |

Alternatives, in the order the code falls back through
([`bot/flow.js` → `deployBuiltSite`](bot/flow.js)): Cloudflare → `VERCEL_TOKEN`
(+ optional `VERCEL_TEAM_ID`) → `NETLIFY_TOKEN`.

### 2.5 Optional

| Variable | Purpose |
|---|---|
| `CONTACT_URL` | Shown after payment for custom-domain concierge |
| `LEGAL_URL` | Terms & privacy link |
| `MAX_IMAGE_BYTES`, `MAX_GALLERY_PHOTOS` | Upload limits |
| `RL_BUILD_PER_CHAT_HOUR`, `RL_BUILD_GLOBAL_DAY` | Rate limits |
| `TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, `ADMIN_CHAT_ID` | Telegram intake — leave unset to run web-only |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL` | Only used by the Telegram intake flow |

### 2.6 Must NEVER be set in production

| Variable | What it does |
|---|---|
| `HIDOOK_FAKE_DEPLOY=1` | Stubs deploys to `https://<slug>.test.local`. Refused when `NODE_ENV=production`. |
| `HIDOOK_ISOLATED_DEPLOY=1` | Publishes to a local folder instead of the internet. Refused when `NODE_ENV=production`. |
| `HIDOOK_TEST_PAY=1` | Marks orders paid **without charging**. Ignored when `NODE_ENV=production`. |
| `ALLOW_FREE_PUBLISH=1` | Legacy dev skip of payment before first public publish. **No production guard — set it and you give the product away.** |

**Always set `NODE_ENV=production`.** Three of those four guards depend on it.
`ALLOW_FREE_PUBLISH` does not — just never set it.

---

## 3. Failure modes that are silent

These are the ones that will cost you customers, because nothing errors visibly.

### 3.1 No email key → nobody can sign in, and you won't notice

[`bot/email.js`](bot/email.js) falls back to *logging* the magic link server-side when
`RESEND_API_KEY` is missing:

```js
const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
    log('email.magic_link.dev', { email, devLink: url });
    return { sent: false, devLink: url };
}
```

There is **no production guard**. The customer sees "check your inbox", the email never
arrives, and they leave. Verify by signing up with a real address on the live site.

Also: `EMAIL_FROM` defaults to `onboarding@resend.dev`, a shared Resend sandbox sender
that only delivers to your own verified address. Set a verified domain sender.

### 3.2 No deploy provider → publish succeeds but produces no URL

If none of Cloudflare / Vercel / Netlify is configured, `deployBuiltSite` returns
`{ url: null, provider: null }`. The customer has a card on file and has no site.

### 3.3 Non-persistent `DATA_DIR` → every customer site disappears on redeploy

Mount a real volume. This is the single most destructive misconfiguration here.

### 3.4 Webhook not configured → trial/card never flips live; charges may not settle cleanly

The webhook is what records card-on-file / trial start and later paid status. Without it,
checkout can succeed in Stripe while the product never goes live.

---

## 4. Stripe setup, step by step

1. Stripe Dashboard → **Developers → API keys** → copy the secret key.
   Use `sk_test_…` first; switch to `sk_live_…` only after §6 passes end to end.
2. **Developers → Webhooks → Add endpoint**
   - URL: `https://<your-public-url>/webhooks/stripe`
   - Event: **`checkout.session.completed`**
   - Trial starts complete with `payment_status=no_payment_required` (card on file);
     the app treats that the same as `paid` for first public publish during trial.
3. Copy the endpoint's **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
4. Set `PAYMENT_PROVIDER=stripe`.
5. **Subscription trial (default in code):** Checkout uses `mode=subscription` and a
   **7-day** trial. Optional catalog Price ids (create Product/Price in Dashboard when
   you are ready — not required for test/local inline `price_data`):
   - First year: `STRIPE_PRICE_ID_EUR` / `STRIPE_PRICE_ID_GBP` / `STRIPE_PRICE_ID_USD`
     or fallback `STRIPE_PRICE_ID`
   - Renewal (**29**/year): `STRIPE_PRICE_ID_RENEWAL_*` / `STRIPE_PRICE_ID_RENEWAL`
   - After trial, code attaches a **subscription schedule** so year 1 stays **99** then
     renews at **29**/year in the same currency.
6. Activate your Stripe account (business details, bank account, tax) before live keys.
7. Enable **Customer portal** for cancel/refund self-serve. **Owner** owns live Stripe
   Product/Prices, Customer Portal configuration, and refunds (see
   [`OWNER-STRIPE-TRIAL.md`](OWNER-STRIPE-TRIAL.md)).

The webhook dispatches on `metadata.platform`; `web` is the browser-builder paid path.

Commercial **amounts** still come only from [`bot/pricing.js`](bot/pricing.js). Price env
vars select Stripe catalog IDs; they do not override cents in code.

---

## 5. DNS

Assuming your brand domain is `yourdomain.com`:

| Record | Points to | Purpose |
|---|---|---|
| `builder.yourdomain.com` | your app host | Where customers use the builder |
| `*.sites.yourdomain.com` | Cloudflare Pages | Where published customer sites live |

Then set `PUBLIC_URL=https://builder.yourdomain.com` and
`BRAND_DOMAIN=sites.yourdomain.com`.

Verify both resolve over HTTPS with a valid certificate before taking cards.

---

## 6. Pre-launch verification — do this end to end, yourself

Run it as a stranger would, in a private window, on the **real** deployment, with
**test** Stripe keys first. Do not skip steps: each one covers a different silent
failure above.

- [ ] `GET /health` returns OK
- [ ] Builder loads at `PUBLIC_URL/app/`
- [ ] All four designs open in the editor (Restaurant, Trades, Salon, Professional services)
- [ ] Editing text on the page updates the preview
- [ ] **Replacing a photo works** and the new photo appears
- [ ] Sign-in email actually **arrives in a real inbox** (not just the server log)
- [ ] Checkout completes with a Stripe test card (`4242 4242 4242 4242`) — subscription trial
- [ ] The order flips to trial/card-on-file — check the Stripe webhook delivery log for a 2xx
- [ ] The site is **live at a public HTTPS URL** immediately after the valid card
- [ ] Editing and republishing updates the live site
- [ ] Cancel during trial unpublishes the live site (no charge)
- [ ] Restart/redeploy the app, then confirm the customer's site and account still exist
- [ ] Switch to `sk_live_…`, then do one **real** card run and refund yourself via Dashboard/Portal

---

## 7. Known gaps to decide on before selling

- **Renewal is automated via Stripe subscription schedule.** `bot/pricing.js` defines
  **29**/year; after the trial the first-year **99** phase rolls into the renewal Price.
  Owner still configures live Product/Prices and watches failed-payment dunning in Stripe.
- **Custom domains are concierge**, not self-service. Fine for launch, but it is manual
  work per customer — price it in.
- **Cancel during trial unpublishes** in product. Refunds and post-charge cancellations
  are owner-owned via **Stripe Customer Portal** / Dashboard — write your refund policy
  before the first sale; do not invent VAT/legal text in this repo.
- **The Telegram bot is unconverted.** It still speaks Romanian and is not part of the
  web product. Leave it disabled (`TELEGRAM_BOT_TOKEN` unset) until you decide its role.
- **Legal pages.** Terms, privacy and a VAT-correct invoice are your obligation, not the
  app's. `LEGAL_URL` only renders a link.

---

## 8. Minimal production environment

```bash
NODE_ENV=production
PORT=<injected by host>
PUBLIC_URL=https://builder.yourdomain.com
DATA_DIR=/data                      # persistent volume
SERVER_SECRET=<openssl rand -hex 32>

PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

RESEND_API_KEY=re_...
EMAIL_FROM=Hidook <hello@yourdomain.com>

DEPLOY_PROVIDER=cloudflare
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
BRAND_DOMAIN=sites.yourdomain.com

CONTACT_URL=https://yourdomain.com/contact
LEGAL_URL=https://yourdomain.com/terms
```

Nothing from §2.6 appears in that list. That is deliberate — keep it that way.
