# Hidook Site Builder — product contract (local/staging build)

Authority: `VISION.md` is the synchronized source of truth. This file is a compact product contract for workers; if it conflicts with `VISION.md`, `VISION.md` wins.

## Product

Simple website builder sold worldwide. Public name: **Hidook Site Builder**.

- Builder: `https://lp.hidook.agency`
- Customer sites: `https://{slug}.sites.hidook.agency`
- Custom domains: self-serve. The owner enters their domain, the product shows the exact DNS records to create at their registrar, polls propagation honestly (not visible yet / visible but wrong / verified), provisions TLS, and moves canonical, og:url, robots.txt and sitemap.xml onto the new domain. Disconnecting leaves the site reachable on its Hidook subdomain. Apex domains are pointed at www with a registrar-side forward, because the alternative needs account-specific fallback IPs.

## Commercial model

- Stripe subscription with **14-day trial**.
- Card required at signup; no card means no live site.
- Site is live/public immediately after a valid card starts the trial.
- First charge happens automatically on day 14 if the customer does not cancel.
- Price: **99** in the customer currency bucket — EUR (EU), GBP (UK), USD (rest of world).
- Renewal: **29/year** in the same currency.
- No promise of permanent hosting from one payment.
- Owner creates production Stripe Product/Prices, Customer Portal, refund/cancellation policy. Local/staging uses test-mode/env-driven IDs only.

## Surfaces

- Commercial product = **browser builder**: account, editor, preview, card/trial, live publish, edit, republish, export.
- Telegram = **frozen, out of product scope** (owner decision, 2026-09-06). The channel is being retired: the code still runs and still opens the same draft with no second checkout or deploy state machine, but no Telegram file is touched any more and its audit findings are deferred rather than fixed. It is not scored as part of the product.

## Design and templates

Launch template scope:

1. Product/menu businesses
2. Local service / lead-gen
3. Portfolio / beauty / events
4. Professional services
5. Desserdirina remake — root rejected bakery/DESSERD sample promoted into a real approved template, not abandoned sample bytes.

All visible customer/site copy should be Romanian unless a deliberate i18n choice is made later. Every generated template must carry non-editable attribution: `Build by hidook.tech powered by hidook.agency`.

`portfolio` and `professionals` (audit27 S-2B, 2026-09-27) ship an optional "Recenzii" testimonials section, and `professionals` also an optional "Echipa" section — both list-editable in the builder, hidden when empty. This is a small fixed per-template library, not the generic section add/remove/reorder still tracked as backlog in `VISION.md` §4.6. Both templates also gained a general "Scrie-ne" contact form (`portfolio` had no contact form before; `professionals`' existing appointment-request form is unrelated and untouched); it POSTs to `/api/site-messages`, which does not exist yet — until that endpoint and the publish-time attribute fill land, the form always shows its honest tel:/wa.me fallback instead of delivering the message.

## Required product capabilities

- First template load works without refresh on realistic network.
- Details drawer opens automatically for every newly selected design; a manual close survives reload for the current design but does not suppress the next design selection.
- A first-time visitor starting a template sees a short, skippable 2-step onboarding wizard first (business type → optional name/phone/WhatsApp/town), then the editor opens on the recommended template already filled via the existing `applyQuickstart()`; it never shows again after completion or skip (`localStorage`), and does not change Details-drawer auto-open or the quickstart bar for any later design selection (`PLAN-UX-2026-09-27` §5.1) — except that for the one design the wizard was actually completed (not skipped) on, Details does not auto-open and a small dismissible hint offers it instead.
- Identity stamping never invents contact data (VERIFICARE-2026-10-04 H-01): changing the business name blanks the template's demo Instagram/Facebook links, handle and e-mail instead of deriving `instagram.com/<name>` / `contact@<name>.ro`; the publish checklist lists demo social links, e-mail and address while they remain. The wizard/quickstart phone is validated (Romanian local or `+`/`00` international; inline Romanian error) and normalized for `wa.me`; the town also updates the hero label, address town part, the address Google Maps link and the "Unde ne găsești" address.
- Text, images, hero/section backgrounds and theme colors are actually editable and reflected in preview/live.
- WhatsApp badge is recognizable and supports a user-defined prefilled message. Opening the control shows a horizontally and vertically centered QR in finished customer chrome; the deep-link / QR mechanism is unchanged.
- Social preview artwork is derived automatically from the current hero/business photography; customers are never asked for an `og:image` URL.
- Preview is clear before card/trial.
- Privacy, Cookies and Terms machinery exists; final legal content is owner-gated.
- Export/self-deploy uses the live-publish entitlement allowlist: Stripe `active`, `trialing`, or an unexpired legacy paid entitlement. Unpaid, `past_due`, canceled, and expired-`paidUntil` drafts receive a clear Romanian upsell and no file.
- Instafidget is included free for 12 months with Site Builder, then Instafidget Free with watermark; the editor opens in a new tab in the same browser, and disconnected feed is hidden.
- Professional sites can opt in to a native Hidook booking calendar (`appointment.nativeBooking`, per-site flag, built in `bot/calendar-native/`): isolated availability/services/bookings, a public booking widget, an owner dashboard, and email confirmations (local/test harness only, no production sender). Default remains unchanged for sites that do not opt in: the local appointment-request form. (The optional Cal.com link customers used to paste in Detalii was removed from the product on 2026-09-12, owner decision — see `VISION.md` §8/Flow 4; an older site saved with that value keeps it as an unused, harmless leftover in its config.) Opt-out restores the local form without deleting existing native bookings. Cutover to native booking on the existing live fleet is not automatic — see `VISION.md` §8.
- GDPR self-service (owner decision 2026-09-27, R-27): the signed-in account's menu — reachable from `#dashboard`/`#templates` and from inside the editor — has "Descarcă datele mele" (JSON export of the account's own profile, sites/version history, orders/invoices, native-calendar services/bookings) and "Șterge contul" (typed-email-confirmation modal, then: cancels any active Stripe subscription, unpublishes and removes every owned site's live files, erases native-calendar tenant data, deletes sessions/login tokens/versions/sites, deletes the user row, signs out). Both routes require a valid session, are rate-limited, and check request origin. See `VISION.md` §5.
- Site contact-form messages (S-2C, PLAN-UX §5.2 supporting piece): a published site's optional generic contact form (added per-template separately) posts to a public, honeypot- and rate-limited API; each owner's dashboard site card shows a "Mesaje" entry with an unread count, opening a modal to read, mark-as-read and delete — the owner is also emailed in Romanian. Messages are included in the GDPR export and erased with their site (or the whole account). A static ZIP/HTML export never carries a live API base, so its form falls back to WhatsApp/mailto instead of depending on Hidook.

## Launch gates — owner only

No push, production deploy, live DNS, real charges, production Stripe, production email sender, or final legal/VAT text without explicit owner approval.

## Done before client delivery

A stranger can use the browser builder end-to-end on the real browser surface: choose template → edit → preview → card test → trial live immediately → edit/republish → export HTML/ZIP → cancel. Export uses the same explicit active/trialing or unexpired-paid entitlement as live publish; unpaid, `past_due`, canceled, and expired sites cannot download files. QA and devil's advocate must open it themselves and save evidence. Client does not QA.
