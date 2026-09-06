# HANDOFF — Wave 8 owner-facing UI (domains, invoices, dunning)

Everything below is a note for whoever next touches `bot/server.js`,
`bot/domains.js` or `bot/webpublish.js` — files this wave was not allowed to
edit. Nothing here blocked shipping; all three are worked around in
`builder/**` as noted.

## 1. `GET /api/sites/:id/domain` returns the raw record, not the
   human-readable DNS-instructions shape

`bot/domains.js#startDomainConnection` is the only function that returns the
`{domain, targetHost, isApex, status, records, note, instructiuni, message}`
shape (built by the internal `_dnsInstructionsFor`). `getDomainForSite` —
what `GET /api/sites/:id/domain` calls — returns the bare stored record
(`domain, targetHost, pagesHost, verificationToken, isApex, status, …`).

That matters because the builder needs the DNS records table (tip/nume/
valoare/TTL, plus the apex-forwarding note) every time the owner reopens the
"Domeniu" panel — not just once, right after they first connect. Re-POSTing
`/domain` to fetch that shape again is NOT safe: `startDomainConnection`
unconditionally resets `status` back to `'awaiting_dns'`, even for an
already-`active` connection — calling it again to "resume" would silently
regress a working domain back to "waiting for DNS".

**Workaround shipped in `builder/app.js`:** the one instructions response a
`POST /domain` call ever returns is cached verbatim in `localStorage`
(`hb.domainDns.<siteId>`), keyed by the connected domain. If that cache is
missing (different browser/session, cleared storage), `buildDnsRecordsFromRecord()`
rebuilds the exact same two records + apex note client-side from the raw
record fields alone — a literal copy of `bot/domains.js#_dnsInstructionsFor`'s
logic. Both paths are proven by
`bot/test/wave8-owner-ui-domain-reachable-e2e.test.js`.

**Suggested real fix, next time `bot/domains.js`/`bot/server.js` are open:**
have `getDomainForSite` (or a small wrapper `GET /domain` calls) return the
same `_dnsInstructionsFor(record)` shape whenever a record exists and is not
`disconnected`, instead of the bare record. That removes the localStorage
cache and the client-side duplication entirely.

## 2. No `HANDOFF-payments.md` ever existed

`bot/webpublish.js#getDunningState`'s doc comment and
`bot/test/wave7-payments-dunning.test.js`'s docblock both point at
`HANDOFF-payments.md` for "exactly where builder/app.js should render this."
That file was never created — the pointer was dangling. This wave's sweep
found the gap it described (see below) and closed it; this file
(`HANDOFF-owner-ui.md`) is now the record of that decision, since the
original filename was never actually used anywhere else in the repo.

## 3. Reachability sweep — what else is paid for and (was) unreachable

Beyond the two named features, one more real instance of the same defect was
found and fixed (all within `builder/**`, no server files touched):

- **Dunning state** (`bot/webpublish.js#getDunningState`,
  `paymentFailedAt`/`paymentFailedCount`/`stripeSubscriptionStatus` on the
  site record, all already returned verbatim by `GET /api/sites`): a
  declined renewal charge notified a Telegram ADMIN and, once Stripe's
  retries were exhausted, silently unpublished the site — the OWNER'S OWN
  dashboard showed nothing. Fixed with `computeDunningBanner()` (a hand-kept
  mirror of `getDunningState`, same duplication rationale as the domain
  panel — the builder is a static browser bundle with no `require()` access
  to `bot/`) rendering a warning/critical banner + an "Actualizează cardul"
  button on the site card. Proven by
  `bot/test/wave8-owner-ui-dunning-banner-reachable-e2e.test.js`.

Everything else checked and found ALREADY reachable from the builder (no
action taken):

- `POST /api/sites/:id/checkout`, `/billing-portal` — the "Adaugă un
  card"/"Reînnoiește hosting"/"Anulează" buttons on the dashboard card.
- `/api/sites/:id/versions`, `/rollback` — "Istoric" button + modal.
- `/api/sites/:id/social-feed/{grant,editor-session,disconnect}` — the
  "Adaugă Instagram" topbar button + modal.
- `/api/calendar-native/owner/*` — the "Programări" dashboard-card link
  (Wave 8's own earlier fix, same session as the calendar work this wave's
  instructions reference).
- `/api/draft`, `/api/export-html`, `/api/export-zip`, `/api/publish`,
  `/api/slug-check`, `/api/templates`, `/api/auth/*`, `/api/me` — all wired
  into the editor/publish/auth flow already.

No other "server-complete, nothing to click" gap was found in the routes
`bot/server.js` mounts.

## Files touched this wave

`builder/app.js`, `builder/app.css`, `builder/index.html`,
`bot/test/wave8-owner-ui-domain-reachable-e2e.test.js`,
`bot/test/wave8-owner-ui-invoices-reachable-e2e.test.js`,
`bot/test/wave8-owner-ui-dunning-banner-reachable-e2e.test.js`. No edits to
`bot/server.js`, `bot/domains.js`, `bot/webpublish.js`, or any frozen file.
