# Hidook Site Builder — product contract (local build)

Authority: owner decisions 2026-08-20. This file is the source of truth for agents. Do not ask the client to QA slices.

## Product

Simple website builder sold worldwide. Public name: **Hidook Site Builder**.

- Builder: `https://builder.hidook.agency`
- Customer sites: `https://{slug}.sites.hidook.agency`
- Custom domains: concierge after payment; not required for launch happy path.

## Commercial

- One simple brochure/lead-gen site.
- Price **99 in the customer’s currency bucket:** EUR (EU), GBP (UK), USD (rest of world).
- Includes builder + first public publish + 12 months managed hosting on the agency subdomain + self-service edits + basic SEO/contact + version history.
- Renewal: 29 in the same currency / year. Domain extra at cost.
- Do **not** promise permanent hosting from one payment.
- Payment **before** first public production publish. No public unpaid trial.

## Surfaces

- Commercial product = **browser builder** (account, editor, pay, publish, edit, renew).
- Telegram = acquisition / guided intake that opens the **same** draft. No second checkout or deploy state machine.

## Design

Client rejected current generated-site look. Team owns design. Three systems (not five skins):

1. Product / menu businesses
2. Local service / lead-gen
3. Portfolio / beauty / events

Do not ping the client for palettes or template slices.

## Instafidget

Out of scope for this team. Keep a provider-neutral `socialFeed` slot + static gallery fallback. No Instafidget API, UI, or billing.

## Launch gates (owner only — do not implement production)

Stripe production, Cloudflare/DNS for hidook.agency, production email sender, legal entity / VAT copy.

Local/staging with test Stripe and fake-or-isolated deploy is in scope.

## Done (before the client sees it)

A stranger can: open builder → pick a design → replace copy/images → preview → sign in → pay 99 → live HTTPS site → come back, edit, republish. Team tests this end-to-end. Client does not.
