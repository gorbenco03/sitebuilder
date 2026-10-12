# Handoff — Wave 8, make the native booking calendar reachable

No changes to `bot/calendar-native/engine.js`, `owner-api.js`, or
`public-api.js` were needed for this wave — that contract is proven and this
file exists per the wave's rule ("if you need a change there, describe it
here instead of touching it"). The answer for those three files is "none
required." Below is what was actually broken, how it was fixed entirely
within `builder/**`, `bot/server.js`, and `bot/calendar-native/owner/**`, and
one server-side behavior worth knowing about even though nothing needed to
change for it.

## What was actually broken (recap)

1. **No way to turn it on.** `appointment.nativeBooking` existed in
   `templates/professionals/schema.json` as a `type:"text"` field, but
   `builder/app.js`'s generic drawer-field loop (`isDrawerField`) only
   auto-renders `phone`/`url`/`color`/`background` types plus a short
   partial-key allowlist — a bare `type:"text"` field is never surfaced. It
   is also never interpolated as visible `{{appointment.nativeBooking}}` text
   anywhere in `template.html` (it only gates an `@if`), so there was no
   inline-editable spot for it either. Nothing in `builder/` ever wrote this
   key — confirmed by grep before this wave (zero hits for `nativeBooking` or
   `appointment.` in `builder/app.js`).
2. **No way to reach the dashboard.** `bot/calendar-native/owner/preview.html`
   unconditionally called `POST /api/calendar-native/owner/preview-session`
   on load, which mints a session signed as `DEMO.customerId` and sets that
   as the `hb_session` cookie — silently replacing whatever real session a
   signed-in owner already had. `builder/app.js` never linked to
   `/calendar-native/owner/` at all.

## The fix

- **`builder/app.js`** — `buildNativeBookingPanel()` (called from
  `buildDrawer()`, right after the existing page-sections panel). It only
  renders when the *current template's schema* actually declares an
  `appointment.nativeBooking` field (checked live against
  `currentTemplate.data.schema` via `getAllSchemaFields`), so `local-service`
  (no `appointment` section at all) and any other non-`professionals`
  template get no panel. The toggle writes
  `draft.config.appointment.nativeBooking` to `'da'`/`''` and calls
  `saveDraft()` — the same choke point every other field uses, so undo/redo
  and the paid-site publish payload cover it for free. A small
  `isNativeBookingOn()` helper mirrors `cutover.js#isNativeBookingEnabled`'s
  truthy/falsy string rules (`bot/test/wave8-calendar-reachable-flag-
  consistency.test.js` locks the two in agreement value-for-value — if a
  future edit to either function drifts from the other, that test catches
  it). Once active on a **published, paid** site, the panel also shows a
  direct "Deschide programările" link (dashboard entry point right where the
  owner just turned the feature on).
- **`builder/app.js` — `buildSiteCard()`** — the primary, durable entry
  point: on the "Proiectele mele" dashboard, a paid + live/active
  `professionals` site card lazily fetches its last-published config
  (`GET /api/sites/:id`, an endpoint that already existed) and, only if
  `appointment.nativeBooking` is truthy there, appends a "Programări" link to
  `/calendar-native/owner/?customerId=<real userId>&siteId=<real site
  id>&brand=<project name>`.
- **`bot/calendar-native/owner/preview.html`** — added a branch at the very
  top of its boot script: if the URL carries `?customerId=&siteId=`, it skips
  the demo `preview-session` call entirely, sets `data-customer-id`/
  `data-site-id` (and optionally `data-brand`) straight from the query
  string, and mounts `owner-dashboard.js` directly against whatever
  `hb_session` cookie the browser already has from a normal login. With no
  query string (the exact request shape screenshot tooling and any bare
  `/calendar-native/owner/` visit uses), behavior is byte-for-byte unchanged
  — regression-locked by
  `bot/test/wave8-calendar-reachable-demo-preserved.test.js`.
- **No `bot/server.js` route changes were needed.** `serveCalendarNativeOwner`
  already serves `preview.html` for any `/calendar-native/owner/...` request
  and already preserves the query string end-to-end (the request handler
  splits `url` from the query once, near the top of the request loop, and
  `serveCalendarNativeOwner` only ever sees the pathname — the query stays on
  `req.url` the way the browser sent it, so `window.location.search` inside
  the served HTML sees it correctly). `resolveOwnerTenantOrReject` already
  authorizes correctly (`customerId === session userId`, plus a registry
  ownership check) — a forged/wrong `customerId`/`siteId` in the URL just
  gets a normal 401/403 from every dashboard API call, same as before.

## One thing that already worked and needed no touching

The publish-time cutover (`bot/webpublish.js` → `bot/calendar-native/
cutover.js`, both outside this wave's file ownership and untouched) already
injects real `nativeCustomerId`/`nativeSiteId` (`site.userId`/`site.id`) and
seeds services + weekly availability from the professionals config whenever
`configHasNativeBooking()` is true at publish time. Once the builder could
actually *write* the flag, that machinery just worked — confirmed end-to-end
by `bot/test/wave8-calendar-reachable-e2e.test.js` (toggle → publish → an
anonymous visitor books on the live site → the owner sees that exact booking
in their own, non-demo dashboard).

## If native booking extends to another template

Same three steps as the sections feature's handoff pattern:

1. Give that template's `template.html` an `@if appointment.nativeBooking`
   gate around a native-widget mount point (see `templates/professionals/
   template.html` lines ~219–243) and a legacy fallback for the off case.
2. Add an `appointment.nativeBooking` field to that template's
   `schema.json` (`type: "text"`, same shape as `templates/professionals/
   schema.json`).
3. Nothing else — `buildNativeBookingPanel()` and the dashboard-link check in
   `buildSiteCard()` are already schema-gated generically; they will start
   showing up for that template automatically. (The `buildSiteCard()` check
   is currently hardcoded to `site.templateId === 'professionals'` as a cheap
   short-circuit before the per-card `GET /api/sites/:id` fetch — widen that
   `===` to an array/set of native-booking-capable template ids at that
   point.)

## Other paid capabilities this wave noticed have no reachable UI

Out of scope for this wave's files/definition-of-done, reported per the
task's step 4 ("ask the same question of the rest of the product"):

- **Self-serve custom domains** (audit finding #47 — "self-serve, replacing
  manual concierge"). `bot/domains.js` + four routes wired in `bot/server.js`
  (`GET/POST/... /api/sites/:id/domain*` — get record, start connection,
  poll DNS/Cloudflare status, check TLS, disconnect) are fully implemented
  and tested (`bot/test/wave7-domains-*.test.js`), but `builder/app.js` has
  **zero** references to any of them. A customer whose plan includes a custom
  domain has no button, no form, no field anywhere in the builder to start
  that connection — the entire capability is API-reachable only.
- **Invoice / billing history** (`handleSiteInvoices` in `bot/server.js`,
  reading `webpublish.getInvoiceHistory(site)` from the durable payments
  ledger — tested in `bot/test/wave7-payments-invoices.test.js`). No button
  or panel anywhere in `builder/app.js` calls
  `GET /api/sites/:id/invoices`; an owner cannot see their own billing
  history from the product at all.

Both are in files this wave owns (`bot/server.js`, `builder/app.js`) and
could in principle be fixed the same way this wave fixed the calendar, but
each is its own substantial feature (a multi-step DNS/TLS connection wizard;
a billing history panel) — well beyond this wave's scoped deliverable of
"make the calendar reachable." Flagging rather than attempting both in the
same pass so neither gets a rushed, under-tested UI.
