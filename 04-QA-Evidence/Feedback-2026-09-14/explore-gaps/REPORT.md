# Explore-gaps — 2026-09-14

Scope: the flows the 2026-09-13 feedback round explicitly did not reach —
native calendar owner dashboard, trial lifecycle, webhooks, sessions,
multi-site, data safety. `git log --since=2026-09-12 --oneline` was checked
first; nothing below duplicates an already-fixed item from that log or from
the "ALREADY FOUND" list in the task brief.

Method: three independent explorations ran in this worktree against locally
booted servers (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, no real
Stripe/network) and were then cross-checked and consolidated into this single
report — one covering the native calendar owner dashboard end-to-end
(`CAL-` ids), one covering trial lifecycle + webhooks (`TRW-` ids), and one
covering sessions, multi-site and data safety (`SESS-`/`MULTI-`/`DATA-`
ids). The two most severe findings (`TRW-04`, `TRW-05`) were additionally
confirmed by direct code reading of `bot/webpublish.js`. Every finding below
reproduced at least twice unless explicitly marked "unconfirmed".

## Summary table (sorted by severity)

| ID | Flow | Severity | One-line reason |
|---|---|---|---|
| TRW-04 | Trial/webhook recovery | **Blocker** | A site unpublished for payment failure never comes back online even after the card is fixed and Stripe confirms `active` — permanent revenue-losing outage, no in-app recovery |
| TRW-05 | Trial/webhook dunning | **Major** | The "card declined" warning banner never clears after a fully successful later charge — hides TRW-04 from the owner |
| CAL-01 | Calendar / portfolio | **Major** | A published portfolio site with native booking on has no link back to its own calendar from the dashboard — hardcoded to professionals only |
| CAL-02 | Calendar services | **Major** | Services have no price field at all, and there is no way to delete a service, ever — only rename/retime the ones auto-seeded at publish |
| CAL-03 | Calendar staff | **Major** | No way to delete a staff member — only deactivate |
| CAL-05 | Calendar hours | **Major** | The dashboard UI cannot express a recurring lunch break / split shift, even though the API and schema support it |
| CAL-EMAIL | Calendar emails | **Major** | The owner is never emailed about a new booking, cancellation, or reschedule — only an optional, default-off reminder exists |
| MULTI-03 | Multi-site / tabs | **Major** | Two different sites open in two tabs collide on one global localStorage draft key — a reload can silently switch which site a tab is editing |
| SESS-01 | Session expiry | **Major** | Publish after a dead session skips re-auth and shows a raw English "Sign-in required." error with no recovery path |
| CAL-04 | Calendar staff | Minor | A newly added staff member is publicly bookable immediately, with zero configured hours (looks fully booked, not "not set up yet") |
| CAL-07 | Calendar DST | Minor | The entire first occurrence of the DST fall-back hour (03:00 EEST, 2026-10-25) is silently never offered as a bookable slot |
| CAL-manage-link | Calendar emails | Minor | Manage/cancel links in booking emails resolve to a dead `http://127.0.0.1:0` unless `PUBLIC_URL` is set — already logged/mitigated in code, an ops config check is still worth doing |
| SESS-02 | Sessions / tabs | Minor | Same root cause as SESS-01, confirmed to also surface cross-tab (no new mechanism) |
| SESS-03 | Magic link cross-device | Minor | The desktop tab that sent the magic link is left frozen with no feedback when the link is opened on a phone instead |
| TRW-01 | Trial start | Minor | `paid`/`paidUntil` are set to a full year at trial start with no field distinguishing "trialing" from "actually charged" |
| TRW-09a | Trial cancel | Minor | `paid:true` and a ~12-month `paidUntil` persist on a site cancelled during trial despite zero charge (cosmetic) |
| TRW-reminder | Trial lifecycle | Minor | No pre-charge reminder exists before the day-7 first real charge (documented gap) |
| CAL-notice-ux | Calendar settings | Minor | Exceeding the 14-day min-notice ceiling fails silently with only a 6s auto-dismiss flash message |
| CAL-08 | Calendar staff UI | Unconfirmed | An 80-character service name renders unclipped in the staff "services offered" checklist |
| DATA-03 | Data safety | Unconfirmed | Removing a service/staff list item never checks for future bookings referencing it (code-reading only, not live-reproduced) |

## Findings

### TRW-04 — BLOCKER — a paid site never comes back online after the owner fixes their card

Flow: trial/subscription recovery after dunning exhaustion. Viewport: 1280
and 390 (dashboard renders identically broken at both).

Steps: publish a paid site. Simulate `invoice.payment_failed`, then
`customer.subscription.updated` status `past_due`, then status `unpaid` —
this genuinely unpublishes the site (`bot/webpublish.js#unpublishSite` sets
`status:'unpublished', url:null`; confirmed for real via the isolated-deploy
file being removed and the visitor URL 404ing). Then simulate the owner
fixing their card: `invoice.payment_succeeded` (billing_reason=
subscription_cycle), then `customer.subscription.updated` status `active`.
Reload the owner dashboard.

Expected: the site republishes automatically once Stripe confirms the
subscription is active again.

Actual: the registry stays `status:"unpublished", url:null` forever.
`stripeSubscriptionStatus` correctly flips to `"active"`, but nothing ever
calls `publishSite()` again. Root cause, read directly in `bot/webpublish.js`:
`unpublishSite()` (~line 148) always sets `status:'unpublished'`, never
`'expired'`. The only reactivation branch that exists, in
`handleStripeInvoicePaid()` (~line 522), is gated on
`if (fresh && fresh.status === 'expired')` — it only fires for the unrelated
"hosting lapsed, late renewal payment arrives" case, never for a
payment-failure unpublish. `handleStripeSubscriptionEvent()`'s non-terminal
branch (the one that runs for `status: active`) only patches
`stripeSubscriptionId`/`stripeSubscriptionStatus`/`subscriptionStatus`/
`stripeCustomerId` — it never republishes either. No code path anywhere
brings the site back.

The dashboard card compounds this: it shows a red "Anulat" (Cancelled)
badge — as if the owner had cancelled themselves — while the stale warning
banner still claims "site-ul rămâne live" (the site stays live). The only
button offered is "Actualizează cardul", which does nothing since the card
is already fixed. `canStartRenewalCheckout` would also refuse a manual
renewal checkout, since Stripe now reports the subscription as `active`. The
owner has no in-app path back to live.

Severity: Blocker — a paying, current customer's site is dark indefinitely
with no recovery UI and a dashboard that actively misdescribes the state.

Likely responsible: `bot/webpublish.js#handleStripeInvoicePaid` and
`#handleStripeSubscriptionEvent` (missing a republish-on-recovery branch for
`status:'unpublished'`); `builder/app.js` site-card badge/label logic
(mislabels this state "Anulat", keeps the stale "rămâne live" text).

Evidence: `trial-webhooks/trw-ui-05-stuck-after-recovery-1280.png`,
`trw-ui-05-stuck-after-recovery-390.png`, `trw-ui-card-texts.json`,
`trw-backend-sim-results.json` (id `TRW-04`), `trw-backend-sim-results-run2-confirm.json`.
Independently confirmed by direct code reading of `bot/webpublish.js`
lines ~148-178 and ~465-544.

Reproduced: twice via live simulation (backend + full Playwright/real-webhook
run) plus a third independent confirmation via source reading. Confirmed.

### TRW-05 — MAJOR — the dunning warning banner never clears after a later successful charge

Flow: dunning recovery / dashboard state display.

Steps: `invoice.payment_failed` sets `paymentFailedAt`/`paymentFailedCount`;
later a normal renewal `invoice.payment_succeeded` actually processes
(paidUntil extends by 12 months, confirmed with a near-expiry `paidUntil` so
the `RENEWAL_DUE_WINDOW_MS` guard doesn't ignore it as a duplicate).

Expected: `getDunningState()` returns `null` once the site is current again.

Actual: `paymentFailedAt`/`paymentFailedCount` are never cleared by any
handler — `getDunningState()`'s `hasFailureOnRecord` check
(`!!site.paymentFailedAt`) stays true forever after any single past decline,
even years later, so the "Card refuzat la încercarea N..." banner never goes
away. This is the same defect that makes TRW-04 invisible to the owner.

Severity: Major — persistent, misleading dashboard state; not itself
destructive but actively hides TRW-04.

Likely responsible: `bot/webpublish.js#handleStripeInvoicePaid` /
`#getDunningState` — no clearing of `paymentFailedAt`/`paymentFailedCount` on
a subsequent successful charge.

Evidence: `trial-webhooks/trw-backend-sim-results.json` (id `TRW-05`,
`"bug":"CONFIRMED..."`), reproduced identically in
`trw-backend-sim-results-run2-confirm.json`.

Reproduced: twice. Confirmed.

### CAL-01 — MAJOR — a published portfolio site with booking on has no link back to its own calendar

Flow: publish a portfolio site, drawer -> "Programari native Hidook" ->
Activeaza -> publish+pay -> open `/app/#dashboard`. Viewport: 1280 (card
markup is shared with 390). Reproduced twice, two independent server runs.

Expected: portfolio genuinely supports native booking end-to-end —
`templates/portfolio/schema.json` declares `appointment.nativeBooking`,
`templates/portfolio/template.html` mounts the same `data-hidook-cal-native`
widget as professionals, and publish-time cutover seeded 3 services for the
portfolio site exactly like it did for professionals (`calendar.cutover.seeded
services:3` logged for both). A portfolio owner should reach their bookings
the same way a professionals owner does.

Actual: the sites-dashboard card shows 0 booking-related buttons for the
portfolio site, vs 1 ("Programari") for an identical professionals setup.
Root cause: `builder/app.js` (~line 7671) gates the whole card link on
`site.templateId === 'professionals'`, with a comment claiming "Only
professionals sites can opt into native booking (schema check)" — stale; the
portfolio schema addition outran it. (Separately, in this exploration's own
direct run, the *editor drawer's* activation panel does correctly appear for
portfolio — the gap is specifically the post-publish dashboard link back to
the calendar, not the ability to turn booking on in the first place.)

Severity: Major — a paying portfolio owner who turns booking on has no
discoverable path back to their calendar from "Proiectele mele".

Likely responsible: `builder/app.js` site-card render (~line 7671,
`site.templateId === 'professionals'` check).

Evidence: `calendar-owner/item1-01-portfolio-drawer.png`,
`item1-02-portfolio-dashboard-card.png`, `item1-03-professionals-published.png`,
`item1-04-professionals-dashboard-card.png`, `item1-site-ids.txt`; corroborated
by `calendar-owner-direct/07-portfolio-drawer.png` (activation panel itself
working).

Reproduced: twice. Confirmed.

### CAL-02 — MAJOR — no price field on services, and no way to ever delete one

Flow: native calendar -> Servicii tab. Reproduced via live UI, schema, and
API, twice.

Findings: services have no price/cost concept anywhere in the system —
`bot/calendar-native/schema.js`'s `calendar_services` table columns are
id/name/duration_minutes/buffer_minutes/active/sort_order, no price column.
The task's "0 price" edge case is untestable because there is nothing to set
to 0. Separately, this exploration's own direct run confirmed there is also
no owner-facing way to *create* a new service — `PUT
/api/calendar-native/owner/services/:id` only updates an id that cutover
already seeded (404 `Serviciul nu a fost gasit.` otherwise), and there is no
`POST` route for services at all in `bot/server.js`, unlike staff/resources
which do have one. And there is no delete/deactivate control in the UI
either (`owner-api.js` has no delete function; the Servicii tab has no
"Sterge" button) — a service, once seeded by cutover, can be renamed/retimed
but never removed. 0-duration and an 80-char name ARE correctly validated
(400 rejection, and server-side `.slice(0,80)` clamp respectively) — that
part works.

Severity: Major — "add/edit/remove services" is explicit in-scope, and two
of those three verbs (add, remove) do not exist at all; edit works.

Likely responsible: `bot/calendar-native/owner-api.js` (no
create/delete-service function), `bot/server.js` (no `POST`/`DELETE` route
under `/api/calendar-native/owner/services`), `bot/calendar-native/owner/
owner-dashboard.js` (Servicii tab has no add UI),
`bot/calendar-native/schema.js` (`calendar_services` has no price column).

Evidence: `calendar-owner/item2-01-services-tab.png`,
`item2-02-services-edge-0duration-longname.png`,
`item2-03-services-valid-edge-save.png`, `explore-main-findings.json`;
corroborated by `calendar-owner-direct/context.json` and `cal01e.log`
(SVC_LIST/SVC_UPDATE showing only the 3 seeded ids are ever addressable).

Reproduced: twice (live UI + direct API check, both runs consistent).
Confirmed.

### CAL-03 — MAJOR — no way to delete a staff member, only deactivate

Confirmed via UI (0 "Sterge" buttons in the Personal tab) and via code
(`owner-api.js` has `putOwnerResource` for create/update, no delete
function). Deactivating IS safe with respect to existing bookings — see
"Verified working" below — but permanent removal is simply not offered.

Severity: Major (missing capability spanning the same "remove" gap as
CAL-02, for staff instead of services).

Likely responsible: `bot/calendar-native/owner-api.js` (no delete-resource
function), `bot/calendar-native/owner/owner-dashboard.js` (Personal tab has
no delete control).

Evidence: `calendar-owner/item3-*.png`, `part4-item3-results.json`.

Reproduced: twice. Confirmed.

### CAL-05 — MAJOR — the dashboard UI cannot express a recurring lunch break

Flow: native calendar -> Disponibilitate tab, weekly hours.

Steps/finding: the DOM has exactly one start-input and one end-input per
weekday row, and `saveWeekly()` reads exactly one open/start/end triplet per
`li[data-weekday]`, replacing ALL windows for that weekday/resource on every
save — so a split shift (e.g. 9-12 + 13-17) cannot be expressed recurringly
through the dashboard UI; only a one-off "ore speciale" override per single
date exists, which would need to be re-added for every future occurrence.
Note this exploration's own direct run *did* successfully save a two-window
Monday (9-13 + 14-17) — but only by calling the owner API
(`PUT /api/calendar-native/owner/availability/weekly`) directly with two
windows in the payload; the engine and schema accept it fine (no UNIQUE
constraint blocks a second row per weekday). The gap is specifically that
the dashboard UI a real owner would actually use has no "add another window"
control, so in practice an owner cannot configure this despite the backend
fully supporting it.

Severity: Major — explicitly in scope ("breaks"), and the capability is
real at the API/engine level but completely unreachable through the UI.

Likely responsible: `bot/calendar-native/owner/owner-dashboard.js`
`paintAvail()`/`saveWeekly()` (UI layer only).

Evidence: `calendar-owner/item4-01-weekly-hours-single-window.png`;
corroborated (backend capability) by `calendar-owner-direct/cal01e.log`
(WEEKLY response showing two accepted Monday windows via direct API call).

Reproduced: twice (UI gap) / backend capability confirmed separately.
Confirmed.

### CAL-EMAIL — MAJOR — the owner is never emailed about booking events

Flow: native calendar emails, all lifecycle steps.

Findings: `EMAIL_TEMPLATE_KEYS` in `bot/calendar-native/schema.js` lists
`booking_requested, booking_confirmed, booking_cancelled,
booking_reschedule_needed, booking_reschedule_confirmed, booking_reminder,
booking_reminder_owner` — the only owner-addressed template is
`booking_reminder_owner`, an optional pre-appointment reminder that defaults
OFF (`reminder_owner_enabled` defaults to 0). Confirmed live: 3 bookings + 1
cancel + 1 reschedule produced exactly 6 outbox rows, all 6 addressed to
visitors, zero to the owner. An owner who doesn't proactively reopen the
dashboard has no real-time signal that anything happened — no "you have a
new booking" email at all.

Severity: Major — this is one of the explicit scope questions ("the emails
queued in the outbox for owner and visitor at each step") and the answer for
the owner side is: none, ever, by default.

Likely responsible: `bot/calendar-native/email/templates-ro.js` /
`schema.js` (template set), `bot/calendar-native/engine.js` (booking-event
email emission only ever targets the visitor).

Evidence: `calendar-owner/item6-outbox-emails.txt` / `.json` (full raw
bodies, all `to=` visitor addresses); corroborated by
`calendar-owner-direct/outbox-after-create.json`,
`outbox-after-reschedule.json`, `outbox-after-cancel.json` (same pattern:
every row addressed to the visitor).

Reproduced: twice (both explorations independently saw zero owner-addressed
event emails). Confirmed.

### MULTI-03 — MAJOR — two different sites in two tabs collide on one global draft key

Flow: multiple sites per account, two tabs. Viewport 1280. Reproduced twice,
consistent both times.

Steps: Tab A publishes site A (professionals) then starts/publishes a
second, different site B (product-menu) in the same tab. Tab B is opened
from the dashboard's "Editeaza" onto site A and edits it (autosaves). Tab A
— which still holds site B in memory — is then reloaded.

Expected: Tab A's reload should resume site B (or at least warn/ask), not
silently become site A.

Actual: Tab A resumes as site A after reload — `#editor-template-name` flips
from B's template to A's, `currentSiteId` becomes site A's id, and
`draft.config.business.name` shows Tab B's edit. Root cause:
`DRAFT_KEY = 'hb.draft.v1'` (`builder/app.js` line 12) is a single global
localStorage key with no site scoping; `resumeLocalDraft()` (~6903-6938) and
the `#edit` route (~8413-8425) blindly trust whatever is in that one slot
whenever in-memory `draft.templateId` is empty (true on every hard reload).
The existing multi-tab conflict banner (`isSameDraftRecord()`,
`initTabConflictWatcher()`, ~1738-1783) deliberately does not fire here
because the two records have different `siteId`s (correct for avoiding false
alarms on the same-draft case) — but that means the cross-site case gets
zero warning of any kind.

Consequence: if the owner doesn't notice the template/content swap and keeps
editing "thinking" they're on site B, the next save would post to
`/api/draft` with `siteId=<site A>`, silently overwriting site A's real
content. Server-side records were not corrupted in this repro (the leak is
purely which site the tab now believes it's editing), but the next save from
a confused tab would corrupt whichever site is now wrongly bound.

Severity: Major — data-integrity risk between an owner's own sites, though
the swapped template content is at least a visible tell to an attentive
user, so it is silent-to-the-system but not literally invisible on screen.

Likely responsible: `builder/app.js` `DRAFT_KEY` (line 12),
`resumeLocalDraft()` (6903-6938), `handleRoute()` `#edit` branch
(8413-8425), `isSameDraftRecord()`/`initTabConflictWatcher()` (1738-1783).

Evidence: `sessions-multisite/multi03-attempt{1,2}-log.txt`,
`multi03-attempt{1,2}-tabA-after-reload.png`,
`multi03-attempt{1,2}-tabB-editing-siteA.png`.

Reproduced: twice. Confirmed.

### SESS-01 — MAJOR — Publish after a dead session leaks an English error with no recovery path

Flow: session expiry mid-edit. Viewport 1280. Reproduced twice, consistent.

Steps: sign in, start editing a draft (autosave-eligible), revoke the
session server-side (simulating "log out everywhere"/expiry from elsewhere)
while the tab is untouched.

Actual: autosave fails with `save-status` state=error, but the VISIBLE pill
text is always the generic "Nu s-a salvat" — the accurate message ("Sesiunea
a expirat — reconecteaza-te ca sa salvezi in cont. Proiectul ramane aici, pe
acest calculator.") only exists in the `title` tooltip attribute
(`renderSaveIndicator()`, builder/app.js ~1833-1850), so a user has to hover
to learn anything. Clicking Publica afterward does not re-check the session:
`doActualPublish()` (~6487) only gates on the stale in-memory `currentUser`,
which is still truthy, so it skips re-auth and calls the server directly.
The server's `requireAuth()` (bot/server.js 1061-1073) returns
`{error:'Sign-in required.'}` — English, in a product that otherwise
enforces Romanian-only copy. This shows verbatim as the toast, and no auth
form is offered — the user is stuck with no visible next step short of
reloading the page. Draft content itself IS preserved correctly in
localStorage through all of this, including a full page reload — no data
loss.

Severity: Major — no data loss, but a real UX dead-end plus a
language-consistency break in a product that specifically audits for this
(see already-fixed "English magic-link email" item).

Likely responsible: `builder/app.js` `runServerAutosave()` (~1950-1984),
`renderSaveIndicator()` (~1833-1850), `doActualPublish()`/`execPublish()`
(~6487-6554); `bot/server.js` `requireAuth()` (1061-1073).

Evidence: `sessions-multisite/sess01-attempt{1,2}-01-after-revoke-autosave.png`,
`sess01-attempt{1,2}-02-publish-after-revoke.png` (toast shows
"Sign-in required."), `sess01-attempt{1,2}-03-after-reload.png`,
`sess01-attempt{1,2}-log.txt`.

Reproduced: twice. Confirmed. (Supersedes an earlier, more tentative read of
the same raw log as "unconfirmed" — the toast text is present and precisely
sourced in both runs.)

### SESS-02 — MINOR — same root cause, confirmed cross-tab too

Flow: two tabs, same context/account, same draft. Tab 1 signs out via the
account menu; Tab 2 keeps editing. Reproduced twice.

Findings: the cookie jar is shared, so Tab 1's logout genuinely kills Tab
2's session too (correct — verified `isSessionValid(sid)==false` and an
empty Cookie header on Tab 2's next request). Tab 2 gets zero indication
anything happened until its own next save attempt, which produces the exact
same generic-pill/tooltip-only pattern as SESS-01. Tab 2's draft still
survives. `GET /api/me` correctly returns `200 {user:null}` here (a
deliberate, documented no-cookie special case in bot/server.js 1574-1591 to
avoid noisy 401 console logs) — not a bug.

Severity: Minor/polish on top of SESS-01 — no new mechanism, just confirms
the same gap surfaces cross-tab too.

Evidence: `sessions-multisite/sess02-attempt1-log.txt`,
`sess02-attempt1-tab1-after-logout.png`,
`sess02-attempt1-tab2-after-edit-post-logout.png`.

Reproduced: twice. Confirmed.

### CAL-04 — MINOR — a newly added staff member is publicly bookable with zero configured hours

Repro (confirmed live): added "Dr. Bogdan Explorat" via the dashboard ->
immediately visible as a chip in the public "Cu cine" picker -> selecting
him on any date shows the generic "Nu sunt intervale libere in aceasta zi"
(indistinguishable from "fully booked") until the owner separately visits
Disponibilitate, switches the "Program pentru" selector to him, and sets
hours. The dashboard does warn the owner ("Persoana/resursa adaugata.
Seteaza-i acum programul..."), but nothing on the public side hints why a
newly-listed person has no slots, and nothing blocks them from being
selectable before they're schedulable.

Severity: Minor — no data corruption, but a confusing visitor-facing dead
end for every new staff member until hours are set.

Likely responsible: `owner-dashboard.js` `addResource()` /
`renderResourcePicker()` in the public booking widget.

Evidence: `calendar-owner/item3-03-two-resources.png`,
`item3-04-public-resource-picker.png`.

Reproduced: twice. Confirmed.

### CAL-07 — MINOR — the first occurrence of the DST fall-back hour is silently unbookable

Flow: calendar time math + slot generation, Europe/Bucharest DST end
(2026-10-25). On the clocks-back day, local wall-clock "03:00-03:59"
physically happens twice (once EEST/UTC+3, once EET/UTC+2). `generateSlots`
produces exactly one slot per local label for the whole day, and
`zonedWallTimeToUtcMs`'s fixed-point iteration always converges on the LATER
(EET) occurrence for an ambiguous label. Confirmed two independent ways:
this exploration's own direct DST-fold script found
`zonedWallTimeToUtcMs(2026,10,25,3,30,'Europe/Bucharest')` returns
`01:30:00.000Z` (the post-fold/EET interpretation, not the pre-fold/EEST one
some libraries would pick); the calendar-owner exploration additionally
confirmed the practical, visible effect: the day's slot list jumps straight
from `2026-10-24T23:00:00.000Z` to `2026-10-25T01:00:00.000Z` — the entire
first real occurrence of "3 o'clock" (EEST) is never offered as a bookable
slot at all, with no indication to owner or visitor. The unambiguous
post-fold hour (04:30 local) computed correctly on both sides.

Severity: Minor — affects one hour, one day per year; no data corruption,
just an invisible, undocumented one-hour gap in stated availability that
day, and no documented policy establishing this as intended.

Likely responsible: `bot/calendar-native/time.js#zonedWallTimeToUtcMs` +
`bot/calendar-native/engine.js#generateSlots` (label-based generation).

Evidence: `calendar-owner-direct/dst-check.json`, `dst-outbox.json`;
`calendar-owner/item8-dst-oct25-slots.json`, `item8-dst-booking-email.txt`,
`item8-dst-results.json`.

Reproduced: twice, by two independent scripts, same underlying behavior both
times. Confirmed.

### CAL-manage-link — MINOR — booking emails' manage/cancel link resolves to a dead address unless `PUBLIC_URL` is set

Steps: publish a site with native booking on in an environment with no
`PUBLIC_URL`/`CALENDAR_PUBLIC_BASE_URL`/`PUBLIC_BASE_URL` set (this repo's
own Dockerfile/railway.json/CI/GO-LIVE.md do not set any of them — confirmed
by reading `bot/calendar-native/cutover.js`'s own doc comment, which names
this exact gap). Create/confirm/reschedule/cancel a booking and read the
resulting visitor email.

Actual: the manage link is `http://127.0.0.1:0/calendar-native/manage?token=...`
— literally unreachable. The code (`bot/calendar-native/email/index.js#manageBaseUrl`)
already documents this exact defect as a past incident and has a mitigation:
it falls back through `PUBLIC_URL` before giving up, and logs
`calendar.manage_url.unconfigured` at error level when it does fall through
— both observed firing correctly. The code-level fix is real; the residual
risk is entirely operational: if the actual deployed environment doesn't
have `PUBLIC_URL` set as a real env var outside the repo, every visitor's
cancel/reschedule link is silently dead again, with only a server log to
notice it.

Severity: Minor (already mitigated in code with logging) but worth a human
checking the real production environment variables, since nothing in the
repo enforces or CI-checks that `PUBLIC_URL` is set.

Evidence: `calendar-owner-direct/outbox-summary.txt` (literal dead link),
`cal01e.log` (`calendar.manage_url.unconfigured` /
`calendar.native_api_base.unconfigured` log lines). Independently
re-confirmed by the calendar-owner exploration's own run (noted there as "a
pre-existing, already self-diagnosed limitation... not a new finding, just
confirmed still reproducible when PUBLIC_URL is absent").

Reproduced: every run (deterministic given the required env). Confirmed.

### SESS-03 — MINOR — desktop tab is left stuck with no feedback when the magic link is used on a phone instead

Flow: magic link opened on a different device than the one that requested
it. Reproduced twice, consistent.

Steps: desktop context requests a magic link and captures the dev link; a
separate phone context opens that same link.

Actual: phone logs in correctly, lands on `#dashboard`, `/api/me` shows the
right user. Desktop has no polling and is never notified — stays on "check
your email" indefinitely (`wireAuthForm()`, builder/app.js ~6581-6654, only
advances on a click of its own `#dev-link`). The token is correctly
single-use (`consumeLoginToken`, bot/registry-sqlite.js 105-114, marks
`used=1`) — when desktop later clicks its own now-consumed link, it fails
cleanly with a Romanian toast "Linkul de autentificare a expirat. Incearca
din nou." and redirects to `#templates`. A third, fully independent
anonymous context re-visiting the same link gets the same clean expiry,
confirmed via raw HTTP too. Net effect: if an owner starts a publish on
desktop and opens the mailed link on their phone instead, the desktop flow
is permanently dead (must request a brand-new link), with no messaging
anywhere telling them this will happen. Desktop's own draft is
untouched/safe.

Severity: Minor — no security issue (single-use enforcement is correctly
strict, confirmed not reusable from anywhere), but a real UX dead-end.

Likely responsible: `builder/app.js` `wireAuthForm()` (~6581-6654),
`#login-expired` route handler (~8459-8461); `bot/registry-sqlite.js`
`consumeLoginToken()` (105-114).

Evidence: `sessions-multisite/sess03-attempt{1,2}-01-phone-after-link.png`,
`sess03-attempt{1,2}-02-desktop-still-stuck.png`,
`sess03-attempt{1,2}-03-desktop-after-reusing-token.png`,
`sess03-attempt{1,2}-log.txt`.

Reproduced: twice, identical both times. Confirmed.

### TRW-01 — MINOR — trial start is indistinguishable from a real payment in the registry

Steps: `checkout.session.completed` with `payment_status:'no_payment_required'`
(the real Stripe shape for a $0 trial-start). Actual: `handleStripePaid`
treats it identically to `payment_status:'paid'` — `paid:true` and
`paidUntil = now + 12 months` are set immediately with no distinguishing
field. This matches `OWNER-STRIPE-TRIAL.md`'s documented model and is not an
exploitable leak (`canceledAt` still correctly gates entitlement on
cancellation — see TRW-09a), but means nothing in the registry can answer
"is this site actually paid, or just trialing" without cross-referencing
`stripeSubscriptionStatus`.

Severity: Minor/polish — works today, but a landmine for future logic built
on the `paid` field alone.

Evidence: `trial-webhooks/trw-backend-sim-results.json` (`TRW-01`,
`TRW-01b`). Reproduced twice, deterministic.

### TRW-09a — MINOR — `paid:true` persists on a trial-cancelled, never-charged site

Steps: `customer.subscription.deleted` while `stripeSubscriptionStatus:'trialing'`,
zero invoices ever paid. Actual: `paid` stays `true`, `paidUntil` stays ~12
months out, even though nothing was ever charged. `status` correctly flips
to `unpublished`/`url:null`, and `canceledAt` is set —
`hasActiveCommercialEntitlement()` explicitly checks `!site.canceledAt`, so
the site is genuinely, correctly blocked from serving/exporting. Data-hygiene
oddity, not a functional or security bug.

Severity: Minor/cosmetic. Evidence: `trial-webhooks/trw-backend-sim-results.json`
(`TRW-09a`). Reproduced twice.

### TRW-reminder — MINOR — no pre-charge trial reminder exists

Grepped `OWNER-STRIPE-TRIAL.md` and `HANDOFF-payments-notify.md` (the only
docs describing the notification sequence). The dunning table has exactly
two rows: "day 0 - charge declines" and "all retries exhausted." Nothing
tells the owner in advance that their card will be charged 99 EUR on day 7
while things are going fine — only a reactive decline notice if/when the
charge fails. Documented gap, not a fabricated feature request.

Severity: Minor (no data loss/outage risk, but a real "surprise charge"
support-ticket generator). Evidence: direct read of `OWNER-STRIPE-TRIAL.md`
and `HANDOFF-payments-notify.md`.

### CAL-notice-ux — MINOR — exceeding the min-notice ceiling fails silently

While isolating the min-notice and max-advance settings independently, an
attempt to save a min-notice value exceeding the server's own 20160-minute
(14-day) cap silently failed to persist, with only a small auto-dismissing
(6s) flash message and no inline field-level error — easy to miss, and the
field itself carries no hint about the ceiling.

Severity: Minor/polish. Evidence: `calendar-owner/part3-item5-refined.json`.
Reproduced: twice (min-notice/max-advance enforcement itself verified
working correctly once configured within range — see "Verified working").

### CAL-08 — UNCONFIRMED — long service name not truncated in the staff "services offered" checklist

Single-run evidence, not independently reproduced: a service renamed to an
80-character string of repeated characters (testing the `maxLen:80`
boundary) renders unclipped as a checkbox label on the Personal/resurse
(staff) tab, producing a full-width wall of text that pushes the layout.
Plausible given the field's `maxLen` is 80 and nothing in
`owner-dashboard.js`'s resource-tab rendering visibly truncates service
names — but this was not re-run a second time, so it is reported unconfirmed
per the reproduce-twice rule, and it is not mentioned in the calendar-owner
exploration's own final summary (may have been superseded or simply not
re-flagged there).

Evidence: `calendar-owner/item3-01-resources-tab-before.png`.

### DATA-03 — UNCONFIRMED — removing a service/staff item never checks for future bookings

`onListRemove()` (builder/app.js 3228-3247) unconditionally `splice()`s the
array and calls `saveDraft()`/`fullRerender()` — no lookup against
`calendar_bookings`, no confirmation, no ID-based linkage check at all.
Grepped `bot/webpublish.js` and `bot/server.js` for any orphan/future-booking
guard on config save or publish — none found. This is a code-reading finding
only; the full native-booking UI setup needed to click through and confirm
end-to-end was not completed (time-boxed), so it is flagged for follow-up
rather than reported as confirmed.

Severity if true: minor/major — silent orphaning of a confirmed future
booking's referenced service/staff (the booking record itself isn't
deleted, but would point at a service no longer in the published config).

## Verified working correctly

**Native calendar owner dashboard:**
- Editing an existing service's name/duration/buffer — works, persists,
  reflected live. 0-minute duration correctly rejected (400). 80-char name
  clamped both client- and server-side.
- Creating a staff/resource — works. Deactivating a staff member who has a
  FUTURE CONFIRMED booking does NOT orphan it: the booking stays fully
  visible on the owner dashboard with full Reprogrameaza/Reatribuie/Anuleaza
  controls, and the public resource picker correctly drops the deactivated
  person. Confirmed live end-to-end.
- Weekly hours (single window per day), blackout override, and special-hours
  override all save correctly and are respected by the PUBLIC widget: a
  blackout date shows 0 slots; a special-hours override restricts that day
  to only its sub-window's slots.
- Minimum-notice and maximum-advance-days are enforced in the PUBLIC SLOT
  GENERATOR itself (not just at booking-submit time) — the correct place for
  it. Verified with independent settings: notice-only and advance-only cases
  both behaved correctly.
- "Oricine disponibil" (anyone available) auto-assigns and auto-confirms
  correctly when 2+ resources exist. With exactly ONE resource (the solo
  cabinet case the task specifically asked about), the resource picker is
  hidden entirely and a booking auto-confirms immediately — there is no
  separate "pending" state for a solo cabinet at all.
- Confirm/cancel/reschedule all work from the dashboard UI. Visitor emails
  are consistently Romanian, correctly show Europe/Bucharest local time with
  an "(ora cabinetului)" clarifier, correct status label per action, ICS
  attached with correct UTC DTSTART/DTEND, and the cancellation email
  correctly omits the manage link.
- DST offset correctness (outside the one ambiguous hour in CAL-07): Oct 23
  09:00 local -> 06:00Z (+3, EEST) vs Oct 26 09:00 local -> 07:00Z (+2, EET)
  — flips correctly across the transition; a booking for Oct 25 09:00 local
  (post-fallback) stores the correct UTC and the confirmation email/ICS both
  agree with it.
- The native-booking activation panel DOES appear on the portfolio template
  in the editor (not only professionals — see CAL-01 for the separate,
  real gap: the post-publish dashboard link back to the calendar).
- Owner dashboard UI renders cleanly and is genuinely responsive at 390px.
- Cutover correctly seeds services from the professionals template's
  `appointment.types` config at publish time (3/3, names/durations matched).

**Trial/webhook lifecycle:**
- Duplicate `checkout.session.completed` — correctly deduped, no double
  grant, no duplicate invoice-ledger row, confirmed both via direct handler
  call and real HTTP `/webhooks/stripe` (both ACK 200 immediately; the
  second delivery is a hard no-op).
- Duplicate `invoice.payment_failed` and duplicate
  `customer.subscription.updated(unpaid)` — correctly no-op / notify exactly
  once despite the underlying unpublish re-running idempotently.
- Out-of-order webhooks (subscription/invoice events before
  `checkout.session.completed` for a site that doesn't exist yet) — never
  throw, log a warning, no-op; the legitimately-late checkout still
  establishes the site as paid afterward.
- Webhooks for an unknown or since-deleted site — handled gracefully
  everywhere tested (logged, `null` returned, no throw).
- Malformed/garbage event payloads never crash `onStripeEvent`; confirmed at
  the HTTP layer too (malformed JSON body -> clean 400, `/health` stays 200
  immediately after every case).
- `past_due` correctly keeps a site LIVE with a "warning" dunning state.
  Terminal `unpaid` correctly unpublishes — verified as a real effect
  (isolated-deploy directory actually removed, live URL genuinely 404s).
- `RENEWAL_DUE_WINDOW_MS` guard works as documented — no double-grant of a
  second year on top of the 12 months already set at trial-start checkout.

**Sessions / multi-site / data safety:**
- Session revocation mid-edit: the in-progress draft SURVIVES in
  localStorage across a dead session, a failed publish attempt, and a full
  page reload — no silent data loss.
- Sign-out in one tab genuinely revokes the session server-side (not just
  cookie-cleared), confirmed via direct registry read; the other tab's draft
  also survives.
- Magic-link tokens are single-use and expire cleanly everywhere tested (own
  device reuse, a different device, a third anonymous context) — no
  replay/security gap found.
- Second unpaid site is never publicly reachable: creating a second unpaid
  site returns 200 with `paid:false, url:null`; `/live/<slug>/` for it is a
  confirmed 404. The owner can still GET/edit the unpaid site (200) —
  editing/previewing is intentionally allowed, only publishing is blocked.
- Same-tab site switching (dashboard "Editeaza" from one site to another)
  correctly reloads fresh config from the server each time, with no
  stale-field leakage (distinct from the two-TAB case in MULTI-03).
- Delete-site confirmation already names exactly what's lost in Romanian
  ("se sterge site-ul publicat, ciornele, domeniul propriu conectat si
  datele de programari") and requires typing the exact project name.
- Starting a new template over an unsaved draft never silently discards it:
  it best-effort backs the old draft up to the account, always stashes it in
  `REPLACED_DRAFT_KEY`, shows a toast naming what happened, and it's
  recoverable via the recovery banner or "Proiectele mele".

## Not reached / partially reached

Scope items 5 (multiple sites) and 6 (data safety) were covered, but not
exhaustively:
- Multi-site: the two-different-sites-in-two-tabs collision (MULTI-03) and
  the second-unpaid-site reachability question were both directly tested.
  Not tested: switching sites rapidly within one tab under load, or a
  three-plus-site account.
- Data safety: site-deletion warning copy and the new-template-over-
  unsaved-draft flow were both directly verified as safe/working. DATA-03
  (orphaned future bookings on service/staff removal) is code-reading only,
  not live-reproduced — flagged unconfirmed, follow-up recommended.
- Not attempted at all: undo/redo history loss on browser crash/tab-close
  (only reload was tested, via the draft-survival checks above, which held
  up); a genuinely three-way multi-tab/multi-site combination.

## Evidence index

All paths relative to `04-QA-Evidence/Feedback-2026-09-14/explore-gaps/`.
PNGs are gitignored repo-wide (`04-QA-Evidence/**/*.png`) — this index is
the committed record of what each one shows; the files remain on disk in
this worktree.

**calendar-owner/** (primary calendar-owner-dashboard exploration):
- `item1-*.png`, `item1-site-ids.txt` — portfolio vs professionals dashboard
  link comparison (CAL-01).
- `dashboard-01/02-bookings-*.png` — owner dashboard at 1280px/390px.
- `item2-*.png` — services edge cases (CAL-02).
- `item3-*.png`, `part4-item3-results.json` — staff/resources incl.
  deactivate-with-booking (CAL-03/04).
- `item4-*.png` — weekly hours, blackout, special hours (CAL-05).
- `item5-*.png`, `part3-item5-refined.json` — min-notice/advance-limit
  isolation (CAL-notice-ux).
- `item6-*.png`, `item6-outbox-emails.txt`/`.json` — confirm/cancel/
  reschedule + raw emails (CAL-EMAIL).
- `item7-*.png` — solo-resource behavior.
- `item8-dst-*.json`/`.txt` — DST engine-level verification (CAL-07).
- `explore-main-findings.json`, `part2-item4-5-results.json`,
  `part3-item6-7-results.json` — structured raw results per run.

**calendar-owner-direct/** (corroborating direct exploration):
- `01..07*.png` — editor/drawer/dashboard screenshots (professionals +
  portfolio), 1280 and 390px.
- `context.json`, `site-detail-professionals.json` — run identifiers.
- `outbox-after-create/reschedule/cancel.json`, `outbox-summary.txt` — raw
  + human-readable booking emails.
- `dst-check.json`, `dst-outbox.json` — independent DST-fold confirmation.
- `findings-part1.json` — structured findings/working list.

**trial-webhooks/**:
- `trw-backend-sim-results.json` / `-run2-confirm.json` — TRW-01 through
  TRW-10, full before/after registry state, two runs.
- `trw-http-webhook-results.json` / `-run2-confirm.json` — TRW-11a-d,
  TRW-12, real HTTP `/webhooks/stripe` behavior, two runs.
- `trw-ui-01..04-*.png` — dashboard at fresh-paid / trialing / past_due
  warning / unpaid critical states, both viewports.
- `trw-ui-04b-visitor-after-unpublish.png` — visitor 404 after unpublish.
- `trw-ui-05-stuck-after-recovery-*.png` — TRW-04/TRW-05 visualized.
- `trw-ui-card-texts.json` — raw extracted card text for every state above.

**sessions-multisite/**:
- `sess01-attempt{1,2}-*` — session revocation mid-edit (SESS-01).
- `sess02-attempt1-*` — cross-tab logout (SESS-02).
- `sess03-attempt{1,2}-*` — magic link on phone vs desktop (SESS-03).
- `multi03-attempt{1,2}-*` — two sites in two tabs, draft-key collision
  (MULTI-03).
