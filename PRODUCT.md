# Hidook Site Builder — product contract (local/staging build)

Authority: `VISION.md` is the synchronized source of truth. This file is a compact product contract for workers; if it conflicts with `VISION.md`, `VISION.md` wins.

## Product

Simple website builder sold worldwide. Public name: **Hidook Site Builder**.

- Builder: `https://builder.hidook.agency`
- Customer sites: `https://{slug}.sites.hidook.agency`
- Custom domains: concierge after launch; not required for the first happy path.

## Commercial model

- Stripe subscription with **7-day trial**.
- Card required at signup; no card means no live site.
- Site is live/public immediately after a valid card starts the trial.
- First charge happens automatically on day 7 if the customer does not cancel.
- Price: **99** in the customer currency bucket — EUR (EU), GBP (UK), USD (rest of world).
- Renewal: **29/year** in the same currency.
- No promise of permanent hosting from one payment.
- Owner creates production Stripe Product/Prices, Customer Portal, refund/cancellation policy. Local/staging uses test-mode/env-driven IDs only.

## Surfaces

- Commercial product = **browser builder**: account, editor, preview, card/trial, live publish, edit, republish, export.
- Telegram = acquisition / guided intake that opens the **same** draft. No second checkout or deploy state machine.

## Design and templates

Launch template scope:

1. Product/menu businesses
2. Local service / lead-gen
3. Portfolio / beauty / events
4. Professional services
5. Desserdirina remake — root rejected bakery/DESSERD sample promoted into a real approved template, not abandoned sample bytes.

All visible customer/site copy should be Romanian unless a deliberate i18n choice is made later. Every generated template must carry non-editable attribution: `Build by hidook.tech powered by hidook.agency`.

## Required product capabilities

- First template load works without refresh on realistic network.
- Details drawer opens automatically on first editor entry.
- Text, images, hero/section backgrounds and theme colors are actually editable and reflected in preview/live.
- WhatsApp badge is recognizable and supports a user-defined prefilled message.
- Preview is clear before card/trial.
- Privacy, Cookies and Terms machinery exists; final legal content is owner-gated.
- Export/self-deploy produces a complete static ZIP.
- Instafidget is separate paid add-on/slot only; disconnected feed is hidden.
- Professional calendar uses Hidook-hosted cal.diy only after owner approves hosting/DNS/spend.

## Launch gates — owner only

No push, production deploy, live DNS, real charges, production Stripe, production email sender, cal.diy hosting spend, or final legal/VAT text without explicit owner approval.

## Done before client delivery

A stranger can use the browser builder end-to-end on the real browser surface: choose template → edit → preview → card test → trial live immediately → edit/republish → cancel → export where allowed. QA and devil's advocate must open it themselves and save evidence. Client does not QA.
