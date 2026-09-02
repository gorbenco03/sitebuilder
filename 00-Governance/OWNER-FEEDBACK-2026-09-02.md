# Owner feedback round — 2026-09-02 23:5x

Owner reviewed the live "Produsul" state and gave 8 items. Authority: VISION.md + this file. Rewrite task bodies fresh from current repo state, not copy-pasted from history.

## 1. Remove customer-facing "Imagine pentru partajare socială" (og:image) field

`templates/*/schema.json` exposes `seo.ogImage` as an editable URL field with strict "must start with http(s)://" validation in the customer-facing Details/editor panel. Owner does not want the customer to see or fill this field — it reads as a developer/CMS leftover, not a site-builder feature.

Fix: remove the field from the customer-visible schema-driven editor UI for all systems (`professionals`, `local-service`, `portfolio`, `product-menu`, `desserdirina`, and root/product-menu variants). Keep `og:image`/`twitter:image` meta tags functional on published sites (SEO must not regress) — auto-derive from an existing hero/business photo already in the site data instead of asking the customer to paste a URL. No dead `<meta>` tags, no broken social preview.

## 2. Gate HTML/ZIP export behind payment

`GET /api/export-html` and `GET /api/export-zip` currently work for any signed-in draft, paid or not (VISION Flow 3 explicitly said "no new commercial lock" — that decision is now REVERSED by the owner). Change: exporting HTML or the self-deploy ZIP must require the site to be on a paid/trial-active subscription (same paid state that unlocks live publish), not just signed-in.

Unpaid draft → export attempt returns a clear Romanian error/upsell, no file. Paid/trialing → export works exactly as today. Update `OWNER-STRIPE-TRIAL.md` / relevant docs to reflect the new gate. Add/update oracle tests proving unpaid export is blocked and paid export still works.

## 3. Details drawer must auto-open every time a design/template is selected, not once ever

Current behavior (`hb-details-drawer-pref` in `builder/app.js`) treats "auto-open" as a first-ever-visit / persisted-preference thing — once a customer closes it, it stays closed forever across template switches. Owner wants: every time the customer selects/opens a NEW design (switches template), Details auto-opens again for that new context, regardless of a prior dismissal on a different design. Keep the interaction otherwise: customer can still close it manually per-session.

## 4. WhatsApp button experience polish

When the customer clicks the WhatsApp control (badge/button that shows the WA text/opens WhatsApp Web with a QR), two fixes:
- The QR code must be horizontally/vertically centered in its container (currently off-center or unpolished layout).
- The surrounding text/panel needs a visual polish pass — currently reads as a bare/plain box, not a finished product surface. Keep the underlying WhatsApp deep-link/QR mechanism unchanged; this is presentation only.

## 5. The whole app must read as a real "website builder" product

General direction note, not a single bug: owner wants the overall builder chrome (not just seed content) to visually and behaviorally feel like a professional site-builder SaaS (Wix/Squarespace-tier polish), not a bakery-sample fork with builder chrome bolted on. Use this as a standing design-quality bar for every UI task in this round — when touching any builder screen, raise its polish to that bar, don't just patch the reported bug.

## 6. Empty tab when adding a new service (Salon / local-service "Servicii")

Reported concretely on the Salon (local-service) system: adding a new service via the editor creates a new tab/card, but it renders with no text — an empty bordered box. Root-cause and fix: new service entries must get sane default label/placeholder text (Romanian) so the tab is never visually empty, and the tab must render its actual entered text once the customer types it (this may be the same underlying defect class across other repeatable-item UIs — check portfolio/product-menu "add item" flows too for the same empty-tab defect, fix the shared root cause once, not one system at a time).

## 7. Real end-to-end test per template — with binding proof, not swappable screenshots

Owner wants ONE real E2E pass per template system (professionals, local-service, portfolio, product-menu, desserdirina): pick the template → edit real content (text/photos/colors) → preview → publish (test pay) → verify the live site → document every step with ITS OWN screenshot, not a generic/reused screenshot standing in for a different step.

**The trust problem to solve:** a QA/critic can currently claim "button X was clicked, see screenshot" while the attached screenshot is actually of something else, and that gets accepted. Owner wants this structurally impossible, not just policed by a stricter prompt (prompts alone don't scale and waste tokens re-litigating it every round).

**Build this as a tool/oracle (operating principle 1 — fix it once, outside the loop), not a recurring human-readable checklist:**
- A Playwright/Node script (one per template, or one parameterized script driven by a per-template fixture) that runs the real click → screenshot → next-click sequence itself, and names/writes each screenshot file deterministically tied to the exact action it just performed (e.g. `07-clicked-publish-button.png` is written by the exact code path that clicked publish, not chosen after the fact by an agent).
- The script's own log (JSON) records: step name, selector/action taken, screenshot filename it wrote, timestamp, and a simple content check where feasible (e.g. assert the screenshot's DOM state or a visible text string matches what that step should show) — so a reviewer (or future agent) can mechanically verify screenshot N truly corresponds to claimed step N, without re-trusting prose.
- This script becomes a reusable Flow 2 oracle: `bot/test/flow2-template-e2e-<system>.mjs` (or similar), run once per template, output under `04-QA-Evidence/Flow2/e2e-real/<system>/`.
- Keep token cost down: the script does the browser driving deterministically (no LLM in the loop for the click sequence itself); an agent only reviews the resulting log + a sampled subset of screenshots to sign off, instead of re-deriving the whole walkthrough from scratch every time.

## 8. VISION.md / PRODUCT.md / project status docs must stay current — make this a standing rule, not a one-off

Owner is unsure these docs are being kept in sync with reality. Add an explicit, permanent process rule (in `AGENTS.md` and this round's task bodies) that: whenever a task changes product behavior, pricing, scope, or commercial rules covered by `VISION.md`/`PRODUCT.md`, the SAME task must update the relevant doc section before being marked done — no separate "update docs later" task, no drift. Critic/reviewer must check for this on every task touching product behavior; a task that changes behavior without updating the doc is not ACCEPT-able.

## Execution notes

- One task = one worktree/branch, per repo rules.
- Work items 1–6 are independent vertical slices — dispatch in parallel where the studio's concurrency allows, to move faster (see dispatch --max increase).
- Item 7 is infrastructure (build the oracle) that then produces the 5 template E2E proofs — do it once, reuse per template.
- Item 8 is a process rule, wire it into AGENTS.md immediately (see patch alongside this file) so every subsequent task inherits it automatically.
- Full-pass QA/advocate still required before any new "Produsul" claim once 1–7 land.
