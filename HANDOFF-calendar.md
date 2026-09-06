# HANDOFF — calendar-native Wave 6 (reminders, .ics sync, booking-window policy)

Written by the agent that closed audit medium finding #26 (reminders, .ics
attachment, booking-window policy) on top of the native calendar engine.
Everything needed lives under `bot/calendar-native/` (which this agent owns
exclusively) — **except one thing**: a single new HTTP route in
`bot/server.js` to let the owner dashboard save the new settings. `bot/server.js`
is owned by another agent right now, so this is a description, not a diff.

## What does NOT need a server.js change

- **Reminder worker scheduling.** `bot/calendar-native/db.js`'s
  `openCalendarDb()` already self-schedules the reminder sweep the exact
  same way it already self-schedules the PII retention sweep: one
  synchronous best-effort sweep at open time, then an unref'd
  `setInterval` (`bot/calendar-native/reminders.js`,
  `startReminderScheduler`, every 5 minutes). Nothing in `server.js` needs
  to call or schedule anything — it already runs wherever the calendar DB
  is opened, including the real server process.
- **.ics attachment.** Rides the existing email outbox
  (`calendar_email_outbox.ics_content` / `ics_filename`, new nullable
  columns) and the existing local-memory transport. No new route, no new
  static file.
- **Reading the new settings.** `GET /api/calendar-native/owner/availability`
  already returns them — `owner-api.js`'s `getOwnerAvailability` was
  extended in place (new fields: `minNoticeMinutes`, `maxAdvanceDays`,
  `reminderHoursBefore`, `reminderVisitorEnabled`, `reminderOwnerEnabled`),
  no route change needed.

## What DOES need a server.js change

`owner-api.js` already exports a `putOwnerSettings(db, customerId, siteId, body)`
function (it existed before this wave, just never had a route). The owner
dashboard's new "Setări" tab (`bot/calendar-native/owner/owner-dashboard.js`)
calls `PUT /api/calendar-native/owner/settings` — that route does not exist
yet. Please add it following the exact pattern already used for
`PUT /api/calendar-native/owner/availability/weekly`.

**1. Add a handler**, next to `handleOwnerPutWeekly` (around `bot/server.js:1901`):

```js
async function handleOwnerPutSettings(req, res) {
    let body;
    try {
        body = await parseJson(req, 16 * 1024);
    } catch (e) {
        return sendJson(res, e.status || 400, { error: e.message || 'Invalid request.' });
    }
    const tenant = resolveOwnerTenantOrReject(req, res, body);
    if (!tenant) return;
    const ownerApi = getCalendarOwnerApi();
    const db = resolveCalendarNativeDb();
    if (tenant.demo) getCalendarNativeApi().ensureDemoTenant(db);
    const out = ownerApi.putOwnerSettings(db, tenant.customerId, tenant.siteId, body || {});
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}
```

**2. Add the route** in the dispatcher, next to the weekly-availability route
(around `bot/server.js:3200`):

```js
            if (req.method === 'PUT' && url === '/api/calendar-native/owner/availability/weekly') {
                return await handleOwnerPutWeekly(req, res);
            }
            if (req.method === 'PUT' && url === '/api/calendar-native/owner/settings') {
                return await handleOwnerPutSettings(req, res);
            }
```

That's the only wiring gap. `putOwnerSettings` validates every field itself
(RO error messages, 400 on out-of-range values) and calls
`engine.ensureSettings`, same as every other owner-settings write path.

## What this wave actually built (all inside `bot/calendar-native/`)

1. **Reminders** (`reminders.js`, new) — a periodic sweep (not enqueued at
   booking time) that finds confirmed, still-upcoming bookings past their
   `reminder_hours_before` threshold and enqueues into the *existing* email
   outbox (`email/outbox.js`) — same backoff/dead-letter/audit pipeline,
   zero second delivery path. Visitor reminders default ON (24h before,
   owner-configurable); the owner's own reminder is optional (default off).
   Three hazards proven in `bot/test/wave6-calendar-reminders.test.js`:
   cancelled booking → nothing sent; sweep run twice → sent once; sweep
   resuming after a simulated outage → never sends for an appointment whose
   start has already passed.
2. **`.ics` attachment** (`ics.js`, new) — hand-written RFC 5545 VCALENDAR
   (zero dependencies), correct CRLF + 75-octet folding, UID/DTSTAMP/
   DTSTART/DTEND (UTC)/SUMMARY/DESCRIPTION/LOCATION/ORGANIZER/ATTENDEE.
   `METHOD:REQUEST` on confirm and reschedule-confirm, `METHOD:CANCEL` with
   a bumped `SEQUENCE` on cancel. Built in `email/index.js`
   (`buildIcsForEvent`) and carried by the outbox to the transport
   (`email/outbox.js`, `email/provider.js`). Verified by parsing our own
   output back (`ics.parseIcs`) in `bot/test/wave6-calendar-ics.test.js`.
3. **Booking-window policy** — `min_notice_minutes` / `max_advance_days` on
   `calendar_settings` (same owner-configurable pattern as the existing
   `buffer_minutes` / `default_buffer_minutes`), enforced in
   `engine.generateSlots` (slot listing), `engine.createBooking` and
   `engine.applyReschedule` (booking time) — a crafted `start_utc` cannot
   bypass it. Defaults (0 minutes / no cap) preserve all pre-existing
   behavior; the policy only bites once an owner configures it. Proven in
   `bot/test/wave6-calendar-booking-window.test.js`.

Schema bumped to migration version 4 (`schema.js` `SCHEMA_SQL_V4`,
`db.js` `migrate()`) — additive `ALTER TABLE ADD COLUMN` only, applied
inside its own `BEGIN IMMEDIATE`. `bot/test/wave6-calendar-migration.test.js`
seeds a v1–v3 database with a live booking, migrates it, and asserts the
booking (and its PII, since retention isn't due) survives byte-identical
except for the new nullable/defaulted columns.

Evidence for all of the above is under `04-QA-Evidence/Wave6-calendar/`.
