# Hidook Site Builder — team launch notes

Commercial product: **Hidook Site Builder** — the **browser builder**. Customers open the builder, pick a design, edit copy/images, sign in, start a **Stripe subscription with a 7-day trial** (**card required**; **payment before first public publish** = card-on-file trial, not a one-shot prepay), then go **live immediately after a valid card** on the agency hosting path. Telegram is **draft-intake** into the **same** unpaid draft/editor — not the product that publishes a live site in minutes.

**Price:** after trial, **99 EUR / 99 GBP / 99 USD** by country bucket (auto-charged on day 7 unless cancelled); **renewal 29** same currency / year via **subscription schedule**. Authority: `bot/pricing.js` and `PRODUCT.md`. Do not sell legacy `$29` / `BUILD_FEE_USD` or `BUILD_FEE_EUR` 49 as the commercial price. Do not market old DESSERD / desserdina portfolio URLs as this product.

---

## 1. What you sell

| Offer | Price | Includes |
|---|---|---|
| **Brochure / lead-gen site** | **99** EUR or GBP or USD (bucket) after 7-day card trial | Builder + live site during trial + first-year managed hosting on agency subdomain after charge + self-service edits + basic SEO/contact + version history |
| **Renewal** | **29** / year (same currency, subscription schedule) | Continued hosting + edit/republish |
| **Custom domain** | At cost (+ optional concierge) | After card/trial; not required for the launch happy path |
| **Bespoke work** | Quote separately | Manual design/features outside the product SKU |

Do **not** promise permanent hosting from one payment. No public unpaid trial (card required; free `TRIAL_DAYS` live window is not the model).

## 2. Surfaces (one product)

| Surface | Role |
|---|---|
| Browser builder | Account, editor, card/trial, publish, edit, renew — commercial happy path |
| Telegram | Acquisition / guided intake → same draft + magic-link or open-in-builder URL |
| Static renderer | `build.js` pipeline behind trial/paid publish |

Happy path a stranger can complete (team verifies end-to-end; client does not QA slices):

1. Open builder → design → copy/images → preview
2. Sign in → **card on file (7-day trial)** → **live HTTPS immediately after valid card**
3. Return later → edit → republish; after day 7 auto-charge **99**; renew at **29** / year via schedule
4. Cancel during trial → site unpublished, no charge

## 3. In-scope for the team (local / staging)

- Local bot + builder API with **test** Stripe keys (`sk_test_…`) and webhook signing secrets for staging.
- Fake-or-isolated deploy (`HIDOOK_FAKE_DEPLOY=1`) for automated tests — **refused in production**; not the client journey.
- Running `node bot/test/*.test.js` and fixing regressions.
- Ops docs: `bot/README.md`, `bot/DEPLOY.md`.

See `bot/DEPLOY.md` for env tables. Commercial amounts always come from `bot/pricing.js`.

## 4. Owner-only launch gates (do not implement as this slice)

These stay with the owner. Do **not** treat the following as a team checklist to execute live from this document:

- Production Stripe (or other live payment) keys and live mode
- Live Stripe Product/Prices, Customer Portal, and refund policy
- Production Cloudflare / DNS for `hidook.agency` / `lp.hidook.agency` / `*.sites.hidook.agency`
- Production email sender and legal entity / VAT copy
- Live Railway (or other host) production cutover with real charges

When the owner runs those gates, follow their runbooks — not an ad-hoc “put live keys and ship” path from this file.

## 5. Go-to-market (positioning only)

- Lead with the **browser builder** and a live example on the agency domain — not a Telegram-only “site in minutes” pitch.
- Small local businesses without a site remain the ICP (cafés, salons, trades, events, portfolios).
- Message shape: professional brochure site, edit yourself after card/trial, **99** after 7 days then **29** / year hosting — open the builder link (Telegram optional as intake).
- Collect testimonials after real publishes; referral and short demo video of the **builder** card → live path.

## 6. Operating model

- Card/trial and first public publish live in the **builder** (payment before first public publish = subscription trial).
- Telegram notifies / steers users into the same draft; it does not own deploy after checkout.
- Admin/ops monitoring: see env and webhooks in `bot/README.md` / `bot/DEPLOY.md`.
- Bespoke requests: handle manually outside the product SKU (99 + 29/year subscription).
- Owner owns live Stripe Product/Prices, Customer Portal, and refunds.

## 7. Product backlog (when you have traction)

- Three design systems (product/menu, local service/lead-gen, portfolio/beauty/events) — current sample template look is not the approved commercial design.
- Neutral `socialFeed` slot: Instafidget included free for 12 months with Site Builder, then Instafidget Free with watermark (upgrade in Instafidget).
- Clearer admin/history tooling for operators.

---

**TL;DR:** Sell **Hidook Site Builder** (browser builder). Telegram = same-draft intake. **Stripe subscription**, **7-day card trial**, site **live immediately after valid card**; **auto-charge 99** EUR/GBP/USD after day 7; renewal **29** / year via subscription schedule (`bot/pricing.js`, `PRODUCT.md`). Cancel during trial unpublishes. Team works local/test Stripe and isolated deploy; **owner-only** for live keys, live DNS, Customer Portal, and production cutover.
