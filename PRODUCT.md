# Hidook Site Builder — product contract (local/staging build)

Authority: `VISION.md` is the synchronized source of truth. This file is a compact product contract for workers; if it conflicts with `VISION.md`, `VISION.md` wins.

## Product

Simple website builder sold worldwide. Public name: **Hidook Site Builder**.

- Builder: `https://lp.hidook.agency`
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
- Details drawer opens automatically for every newly selected design; a manual close survives reload for the current design but does not suppress the next design selection.
- Text, images, hero/section backgrounds and theme colors are actually editable and reflected in preview/live.
- WhatsApp badge is recognizable and supports a user-defined prefilled message. Opening the control shows a horizontally and vertically centered QR in finished customer chrome; the deep-link / QR mechanism is unchanged.
- Social preview artwork is derived automatically from the current hero/business photography; customers are never asked for an `og:image` URL.
- Preview is clear before card/trial.
- Privacy, Cookies and Terms machinery exists; final legal content is owner-gated.
- Export/self-deploy uses the live-publish entitlement allowlist: Stripe `active`, `trialing`, or an unexpired legacy paid entitlement. Unpaid, `past_due`, canceled, and expired-`paidUntil` drafts receive a clear Romanian upsell and no file.
- Instafidget is included free for 12 months with Site Builder, then Instafidget Free with watermark; the editor opens in a new tab in the same browser, and disconnected feed is hidden.
- Professional customers create their own free Cal.com account and paste the booking link in Detalii; when absent, the existing local appointment-request form remains available.

## Launch gates — owner only

No push, production deploy, live DNS, real charges, production Stripe, production email sender, or final legal/VAT text without explicit owner approval.

## Done before client delivery

A stranger can use the browser builder end-to-end on the real browser surface: choose template → edit → preview → card test → trial live immediately → edit/republish → export HTML/ZIP → cancel. Export uses the same explicit active/trialing or unexpired-paid entitlement as live publish; unpaid, `past_due`, canceled, and expired sites cannot download files. QA and devil's advocate must open it themselves and save evidence. Client does not QA.
