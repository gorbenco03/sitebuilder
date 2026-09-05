QA: FAIL

Independent stranger walk of calendar-native on integrated main `bb30226` (ahead 25, not pushed). Isolated loopback `http://127.0.0.1:18791` (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, `DATA_DIR=/tmp/hidook-cal-qa-bb30226`). Did not cut over, did not touch `bot/site-legal.js` or `bot/test/fullpass-63230d2.mjs`.

Named-screenshot oracle: `04-QA-Evidence/CalendarNative-QA-bb30226/walk-calendar-native-qa.mjs` (filename = action just performed). Machine log: `walk-log.json`.

## Baseline (before walk)

- `node --test bot/test/calendar-native-*.test.js` → 5/5 pass
- `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`

Tests-green is not a pass. Opened pixels fail the stranger bar.

## Comparable (copy/layout bar)

Opened Calendly marketing homepage (`23-opened-comparable-calendly-homepage.png`) plus public write-up of Booksy/Setmore/Timpo-class booking products (websitefirma.ro, 2026). Real products: one job (pick service → date → time → confirm), locale-correct clocks, no workshop banners, a working “manage this booking” page after email. Hidook’s widget chrome (service chips + day strip + slot grid) is in the right family; the factory preview copy, English leftovers, AM/PM, US `mm/dd/yyyy`, starred tel link, and 404 manage URL are not.

## Checklist

1. Public widget — flow works (service, weekend empty, weekday slots, instant `confirmed` when free, blackout zeros that day). Copy/controls fail: D1–D4.
2. Owner dashboard desktop + 390 — preview-session login, list, cancel (slot-free toast), reschedule, weekly save, blackout add. `documentElement.scrollWidth=390` on bookings/availability/services. Critical actions reachable. Copy/locale fail: D7–D9, D11.
3. Email harness — local-memory outbox `status=sent`, Romanian status-honest templates, unguessable manage token, no API keys in body/logs. Manage URL 404 and factory site id: D5–D6.
4. Outage (widget pointed at `http://127.0.0.1:9`) — Romanian “temporar indisponibile”, no fake success, WhatsApp + phone + email shown. Leftover loading chrome + starred tel: D10, D3.
5. Tenant isolation — owner cookie on tenant B → 403 `Acces interzis.`; anon owner list/cancel → 401; public GET `/api/calendar-native/bookings` → 404; public services for B do not leak Elena’s catalogue. No isolation hole found.

## Defects

### D1 — Public surface is a factory preview, not a product page
Visible: title `Programare nativă — previzualizare`; banner “Previzualizare programări online Hidook (cale nouă — formularul local de cerere rămâne neschimbat). Demo izolat pe acest cabinet…”
A stranger does not get a finished booking page.
Screenshots: `screenshots/01-opened-public-widget-desktop-loaded.png`, `screenshots/09-opened-public-widget-390-loaded.png`

### D2 — English leftover “slot” on the public widget
“nu vei vedea niciodată „confirmat” pe un slot deja rezervat.”
Screenshots: `screenshots/01-opened-public-widget-desktop-loaded.png`, `screenshots/09-opened-public-widget-390-loaded.png`

### D3 — Phone control is a lie
Visible text `0722 111 222`, href `tel:+407****1222`. Tapping Call cannot reach the cabinet. WhatsApp uses a real `wa.me/40722111222`.
Screenshots: `screenshots/01-opened-public-widget-desktop-loaded.png`, `screenshots/09-opened-public-widget-390-loaded.png`

### D4 — Confirmed state leaves a lying CTA and the whole form
After a real `confirmed` booking, the form + day strip stay up and the button still reads `Se trimite…` under the success card. Dead/lying control.
Screenshot: `screenshots/06-submitted-booking-result-state.png`

### D5 — Manage-link token from email 404s
Outbox body has `http://127.0.0.1:18791/calendar-native/manage?token=…` (32+ char, one booking). Opening it: `Pagină negăsită — Hidook Site Builder`. VISION §8 visitor cancel/reschedule via email token is not a product.
Screenshot: `screenshots/21-opened-manage-link-from-email.png`

### D6 — Email names the factory site id, not the cabinet
Body: “Programarea ta la demo_site_cabinet pentru „Consultație inițială”…”. Brand on the widget is Cabinet Dr. Elena Pop. `demo_site_cabinet` is workshop.
Evidence: `walk-log.json` → `notes.outbox.rows[].body_text`

### D7 — Owner availability is English/factory at 390
Visible together: `Timezone: Europe/Bucharest · stocare canonică UTC. Blackout-urile pe dată…`; heading `Blackout / ore speciale`; `Zi liberă (blackout)`; `+ Adaugă override`; time inputs `09:00 AM`–`05:00 PM`; date placeholder `mm/dd/yyyy`.
Screenshots: `screenshots/16-opened-owner-availability-390.png`, `screenshots/18-added-blackout-date-override-390.png`

### D8 — Owner services tab: buffer / slot jargon
“Durata și buffer-ul se folosesc la generarea sloturilor libere…” and labels `Buffer (min)`.
Screenshot: `screenshots/19-opened-owner-services-390.png`

### D9 — Owner toasts say “Slotul”
Cancel: “Programare anulată. Slotul este liber.”
Reschedule: “Programare mutată. Slotul vechi e liber.”
(Actions themselves worked.)
Screenshots: `screenshots/12-clicked-cancel-booking-390.png`, `screenshots/15-saved-reschedule-390.png`

### D10 — Outage panel does not hide loading chrome
Dead-port widget shows `Se încarcă programul…` and the step rail together with “Programările online sunt temporar indisponibile” + WhatsApp/phone/email. CSS only forces `[hidden]` on `.hnb`, `.hnb__panel`, `.hnb__result` — not steps/layout. No fake success.
Screenshot: `screenshots/22-pointed-widget-api-at-dead-port-9.png`

### D11 — Owner booking filters use US date placeholders
`mm/dd/yyyy` on De la / Până la at 390. Romanian product.
Screenshot: `screenshots/11-opened-owner-dashboard-390-bookings.png`

## What did work (not a pass)

- Weekend (Sâ 5) → “Nu sunt intervale libere în această zi.” Weekday Lu 7 → 30 real slots. Unhappy submit → “Completează numele, emailul și un interval orar.” Instant confirm when free (`data-hnb-success=confirmed`). Blackout 2026-09-08 → 0 slots.
- Owner 390 `scrollWidth=390`; Anulează / Reprogramează / Salvează programul / Adaugă override all functioned.
- Outbox: 8 rows `sent`, templates match status (`booking_confirmed` / `booking_cancelled` / `booking_reschedule_confirmed`), `manage_link_present`, zero secret-shaped strings.
- Isolation: 403/401 as required; public write-mostly surface does not list bookings.

## Not in this packet

No cutover proposal. Shipped local appointment-request form on Professional sites was left untouched (VISION: public sites still use that form until step (e)).

## Files

- `04-QA-Evidence/CalendarNative-QA-bb30226/REPORT.md`
- `04-QA-Evidence/CalendarNative-QA-bb30226/walk-calendar-native-qa.mjs`
- `04-QA-Evidence/CalendarNative-QA-bb30226/walk-log.json`
- `04-QA-Evidence/CalendarNative-QA-bb30226/screenshots/*.png` (23 named shots)
