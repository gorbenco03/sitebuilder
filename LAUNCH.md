# Hidook Site Builder — team launch notes

Commercial product: **Hidook Site Builder** — the **browser builder**. Customers open the builder, pick a design, edit copy/images, sign in, **pay before first public publish**, then go live on the agency hosting path. Telegram is **draft-intake** into the **same** unpaid draft/editor — not the product that publishes a live site in minutes.

**Price:** **100 EUR / 100 GBP / 100 USD** by country bucket; **renewal 29** same currency / year. Authority: `bot/pricing.js` and `PRODUCT.md`. Do not sell legacy `$29` / `BUILD_FEE_USD` or `BUILD_FEE_EUR` 49 as the commercial price. Do not market old DESSERD / desserdina portfolio URLs as this product.

---

## 1. What you sell

| Offer | Price | Includes |
|---|---|---|
| **Brochure / lead-gen site** | **100** EUR or GBP or USD (bucket) | Builder + first public publish + 12 months managed hosting on agency subdomain + self-service edits + basic SEO/contact + version history |
| **Renewal** | **29** / year (same currency) | Continued hosting + edit/republish |
| **Custom domain** | At cost (+ optional concierge) | After payment; not required for the launch happy path |
| **Bespoke work** | Quote separately | Manual design/features outside the product SKU |

Do **not** promise permanent hosting from one payment. No public unpaid trial.

## 2. Surfaces (one product)

| Surface | Role |
|---|---|
| Browser builder | Account, editor, pay, publish, edit, renew — commercial happy path |
| Telegram | Acquisition / guided intake → same draft + magic-link or open-in-builder URL |
| Static renderer | `build.js` pipeline behind paid publish |

Happy path a stranger can complete (team verifies end-to-end; client does not QA slices):

1. Open builder → design → copy/images → preview  
2. Sign in → **pay 100** → live HTTPS on agency subdomain  
3. Return later → edit → republish; renew at 29 / year  

## 3. In-scope for the team (local / staging)

- Local bot + builder API with **test** Stripe keys (`sk_test_…`) and webhook signing secrets for staging.
- Fake-or-isolated deploy (`HIDOOK_FAKE_DEPLOY=1`) for automated tests — **refused in production**; not the client journey.
- Running `node bot/test/*.test.js` and fixing regressions.
- Ops docs: `bot/README.md`, `bot/DEPLOY.md`.

See `bot/DEPLOY.md` for env tables. Commercial amounts always come from `bot/pricing.js`.

## 4. Owner-only launch gates (do not implement as this slice)

These stay with the owner. Do **not** treat the following as a team checklist to execute live from this document:

- Production Stripe (or other live payment) keys and live mode  
- Production Cloudflare / DNS for `hidook.agency` / `builder.hidook.agency` / `*.sites.hidook.agency`  
- Production email sender and legal entity / VAT copy  
- Live Railway (or other host) production cutover with real charges  

When the owner runs those gates, follow their runbooks — not an ad-hoc “put live keys and ship” path from this file.

## 5. Go-to-market (positioning only)

- Lead with the **browser builder** and a paid live example on the agency domain — not a Telegram-only “site in minutes” pitch.
- Small local businesses without a site remain the ICP (cafés, salons, trades, events, portfolios).
- Message shape: professional brochure site, edit yourself after pay, 100 once then 29 / year hosting — open the builder link (Telegram optional as intake).
- Collect testimonials after real paid publishes; referral and short demo video of the **builder** pay → publish path.

## 6. Operating model

- Payments and first public publish live in the **builder** after pay-before-publish.
- Telegram notifies / steers users into the same draft; it does not own deploy after pay.
- Admin/ops monitoring: see env and webhooks in `bot/README.md` / `bot/DEPLOY.md`.
- Bespoke requests: handle manually outside the 100 SKU.

## 7. Product backlog (when you have traction)

- Three design systems (product/menu, local service/lead-gen, portfolio/beauty/events) — current sample template look is not the approved commercial design.
- Neutral `socialFeed` slot only (Instafidget is another team).
- Clearer admin/history tooling for operators.

---

**TL;DR:** Sell **Hidook Site Builder** (browser builder). Telegram = same-draft intake. **Pay before public publish** at **100** EUR/GBP/USD; renewal **29** / year (`bot/pricing.js`, `PRODUCT.md`). Team works local/test Stripe and isolated deploy; **owner-only** for live keys, live DNS, and production cutover.
