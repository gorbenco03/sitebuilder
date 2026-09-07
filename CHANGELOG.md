# CHANGELOG.md — Hidook Site Builder

This project does not cut versioned releases (`package.json` stays at
`1.0.0` — it is a continuously-deployed product, not a library). Entries below
are grouped by shipped milestone/remediation wave instead of by semver, newest
first, each citing the integration merge commit on `main` so a claim here can
be checked with `git show <sha> --stat` rather than taken on faith. Commit
messages carry the full detail; this file is the map, not a copy of every
diff. Dates come from the commits themselves.

Not exhaustive — the full history is `git log main`. This file covers
user-visible or architecturally significant changes, the way the audit
expected a changelog to.

## 2026-09-07 — Dashboard card layout + shell cache-busting

`aeb088e` (`fix: the dashboard card starved its own name column, and deploys
never reached the browser`).

Two defects that together hid a shipped feature. `.site-card-info` was
`flex: 1` against `.site-card-actions` at `flex-shrink: 0`, so a card with the
full action set left the name/URL column 101px at 1440 and 41px at 700 — and
`.site-card-name` is `overflow: visible`, so the project name painted across
the button row. Separately, the CDN rewrites the origin's
`max-age=0, must-revalidate` on `/app/*.js` to `max-age=14400`, so for four
hours after a deploy an owner's browser served the previous build from disk.
Both shells (`/app/` and `/calendar-native/owner/`) now stamp every same-origin
`.js`/`.css` reference — attributes and inline-script string literals — with
that file's size+mtime, and fold those signatures into the shell ETag.
Published customer sites are not stamped.

New oracles: `wave13-site-card-layout` (measures rendered boxes and the name's
actual ink in Chromium, not CSS declarations) and `wave13-shell-cache-busting`.

## 2026-09-06 — Storage: SQLite registry (round 3)

`04e65f0` (merge), `317b631` (`feat(registry): SQLite-backed storage behind
the existing interface`), `8f5c788` (`perf: faster template start, image
sizing and build minification`), `8a13c19` (`perf: finish the interrupted
performance wave, real minifier gate, runnable npm test`).

- Replaced the single-JSON-file registry (`.registry.json`, read and
  rewritten whole on every mutation) with `bot/registry-sqlite.js`: separate
  indexed tables, `node:sqlite`, WAL mode. One-time non-destructive migration
  (`bot/registry-migrate.js`) from any existing `.registry.json`, verified by
  row-count and deep-equality spot checks before it commits.
  `REGISTRY_BACKEND=json` remains an emergency exit back to the old backend.
  See `ARCHITECTURE.md` §6.
- `bot/test/registry-characterization.test.js` added first as a safety net
  (158 assertions pinning the old behavior, including 4 latent bugs later
  fixed explicitly rather than accidentally).
- Real minifier for the builder bundle's CSS (`scripts/build-builder.js`);
  faster first template load; image sizing pass.
- `package.json` `"test"` script corrected to
  `node --experimental-sqlite --test bot/test/*.test.js` (the SQLite backend
  needs the flag on Node < 22.5).

## 2026-09-06 — Audit remediation, round 2 (8 domains)

`baed144`, `a5bf2ab`, `1cb9b22`, `75b511d`, `d57564f` (merges), plus
`101b984`, `e859973`, `da95490`, `42e6189`, `88a8c01`, `42ec318`.

- Server: calendar-native CORS locked down + real rate limiting, honest
  `/admin` labels for `past_due`/`unpaid`, PII-safe logs (email masked:
  prefix + domain + correlation hash), `ETag`/revalidation on
  `GET /api/templates`, a duplicated function removed.
- Docs: test command fixed in 3 places + the `npm test` script (see round 3
  above for the later `--experimental-sqlite` follow-up); `VISION.md` added
  to the docs map in `README.md` and the operator docs;
  `PRODUCT.md` rewritten to describe the native calendar instead of only
  Cal.com; `OWNER-CALENDAR-CAL-DIY.md` marked `SUPERSEDAT`.
- Infra: production image made runnable at all — `node:sqlite` does not
  exist on Node 20, so the `Dockerfile` base moved to `node:22.20.0-alpine`
  (verified empirically, see the file's own header comment);
  `railway.json` `healthcheckPath`; first GitHub Actions CI workflow.
- Calendar: visitor reschedule via the manage-link token (previously cancel
  was the only visitor action); PII retention job (24-month window per
  `VISION.md` §8).
- Fixed a genuine cross-round regression at integration: two parallel
  rounds had each rewritten `GET /api/templates` and the `unpaid`
  unpublish path differently; reconciled in `42ec318` rather than shipping
  whichever merged last.

## 2026-09-06 — Audit remediation, round 1 (8 parallel branches)

`c12d3bd` .. `00edfbc` (8 merge commits), plus the underlying fix commits
(`ba245cd`, `bf44400`, `51f6025`, `90fd1be`, `7cb02c4`, `eda6265`, `8817a37`,
`655d842`, `745bec2`).

- Gallery lightbox CSS fixed on `product-menu` and `portfolio` (was
  completely unstyled — clicking a photo broke the page layout instead of
  opening a viewer).
- Root cause of the "+ Adaugă" empty-card / corrupted-DOM bug on
  `product-menu` and `professionals`: `findListItemContainer()` picked the
  first ancestor containing the item's fields, which for a single-field item
  was the inner wrapper, not the card — fixed by walking up to the last
  ancestor exclusive to that item.
- `product-menu`: transparent hero CTA fixed (specificity collision);
  mobile navigation added to the 3 of 5 templates that lacked it.
- `professionals`: appointment form on self-hosted exports now attempts a
  real submission from any `http(s)` origin instead of only `/live/<slug>/`,
  and shows an honest Romanian failure state with phone/WhatsApp instead of
  a false success.
- Modal focus trap added across all 6 builder modals; rename cascade now
  parses and re-serializes `seo.jsonLd` instead of doing a raw text
  replacement on the serialized string (was silently corrupting JSON-LD on
  any name containing a quote or backslash); `team.title` added to the
  rename cascade fields.
- WhatsApp QR: replaced the hand-rolled encoder (which produced QR codes
  that failed to decode on all 5 templates) with a correct one, plus an
  oracle that actually decodes the generated QR rather than only checking it
  visually rendered something.
- Two cross-round regressions caught only at integration and fixed there,
  not blamed on either branch: `wave11-html-export` broke because the
  `unpaid` unpublish path stopped syncing the legacy `subscriptionStatus`
  field; the QR oracle broke because a new WhatsApp button in the form's
  error panel became the first `a[href*="wa.me"]` in the DOM (selector now
  requires the first *visible* WhatsApp control).

## 2026-09-05/06 — Audit-05, PC-01, SEC-01, QR-01 (point fixes ahead of the wave)

`c5f818f`, `e488096`, `1f0effd`, `1f04860`.

- GDPR delete (`/sterge` in Telegram) now calls `webpublish.unpublishSite()`
  for every owned site before clearing the registry record — previously the
  bot confirmed deletion while the paid site stayed live on disk.
- Stripe `invoice.paid`/`invoice.payment_succeeded` now extends `paidUntil`
  idempotently on real automatic renewal (previously a renewed customer
  could show as "Expired" and be pushed into opening a second, orphaning
  subscription).
- `POST /api/auth/email` no longer returns the magic-link token in the
  response body when `RESEND_API_KEY` is unset in production (previously a
  full account-takeover primitive — anyone could request any account's login
  link in clear text).
- WhatsApp QR encoder fix, landed once as `QR-01` ahead of being folded into
  round 1 above.

## 2026-09-05 — Native Hidook calendar, steps (a)–(e)

`884ce76` (step (e) cutover), `9a7afb4` (step (c) part 1, public widget),
plus the owner-dashboard, email-harness and tenant-isolation work merged in
the same window. Full product decision record: `VISION.md` §8.

- Owner-locked decision (2026-09-04): the Professional calendar is a
  **native Hidook module**, not cal.diy, not Cal.com Platform, not a
  third-party embed. Supersedes the two earlier same-topic decisions
  recorded in `OWNER-CALENDAR-CAL-DIY.md` (now marked superseded).
- Shipped as `bot/calendar-native/`: isolated per-tenant data model and
  booking engine with DB-level slot locking (proven live against 20
  simultaneous requests for the same slot: 1 confirmed, 19 correctly
  demoted, 0 double-bookings); public booking widget; owner dashboard with
  availability editor; local/test email harness with retry + delivery audit
  (no production sender); staged opt-in cutover via the
  `appointment.nativeBooking` config flag — reversible, seeded at publish,
  the legacy local-request form remains the default for sites that do not
  opt in. See `ARCHITECTURE.md` §9.
- Two independent-review REJECT → repair cycles landed before acceptance:
  a "lying CTA" (stale "Se trimite…" state after submit) fixed with a
  `[hidden]` force-hide CSS rule, and an initial QA pass that had exercised
  the preview widget instead of a real opted-in `/live/<slug>/` site,
  redone against the real product.

## 2026-09-05 — Documentation correction: PS-01 infirmed

`8ef0d0a` (`docs: record the round-2 audit remediation wave and the PS-01
correction`).

- The audit's PS-01 finding ("editor has no document model, inline-edit is
  regex text-matching over rendered HTML") was investigated and found
  **false**: the function it named, `injectDataHb()`, is dead code called
  from nowhere. The live path (`renderPreview(..., {editMode:true})` in
  `build.js`) emits edit markers at render time, from the token, with the
  exact path. Verified empirically against a real browser session: 99
  editable nodes on `professionals`, including sub-3-character and
  pure-numeric values the regex path would have skipped, and every
  occurrence of duplicated text (the regex path would have wrapped only the
  first). Full record: `04-QA-Evidence/Audit-2026-09-06-2225ca7/CORECTII.md`.
- Consequence: the editor was **not** rebuilt. Missing undo/redo and
  removable/reorderable sections were confirmed as real gaps (real, but
  additive work on the existing document model, not a rewrite of it).

## 2026-09-06 — End-to-end audit

17 parallel review lenses covering all 5 templates, builder chrome, backend
security, payments, deploy/infra, docs, performance, calendar, Telegram,
accessibility, and product strategy. Scored 4/10 overall; 152 findings, only
3 independently double-checked (adversarial second-pass verification was
stopped by the owner on cost grounds). Full report:
`04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md`. Every wave in this file
from 2026-09-06 downward is remediation against that report.

## Earlier milestones (pre-audit)

- **Native calendar decision groundwork, data model + booking engine + tenant
  isolation oracle** (`c4406d5` lineage) — the architecture later confirmed
  by the audit as "the most mature code in the whole product."
- **Instafidget partnership integration** (`7f9d685`, `merge(S111)`) —
  Instagram feed via the Instafidget partner product, free 12 months with
  Site Builder, then Instafidget Free with a watermark; editor opens in a
  new tab, disconnected feed hidden.
- **Flow 1 — first-load + theming** (`6fa18d4`) — bundle split so the
  template catalog boots without shipping the full per-template payload
  up front; theme colors actually consumed by template CSS.
- **Five design systems shipped**: `product-menu`, `local-service`,
  `portfolio`, `professionals`, and the `desserdirina` remake of the
  original root bakery sample (`5aa3bfe`, `merge(S58)`, and the template
  registry work around `9286500`). `templates/registry.json` has listed
  exactly five templates since this point.
- **Commercial model**: Stripe subscription checkout with a 7-day card
  trial, site live immediately after a valid card, 99 first period /
  29/year renewal via a Subscription Schedule (`bot/pricing.js`,
  `bot/payments.js`) — the model documented in `PRODUCT.md` and
  `OWNER-STRIPE-TRIAL.md` today.
