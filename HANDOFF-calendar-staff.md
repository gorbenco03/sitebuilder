# HANDOFF — calendar staff/resources (audit #25) → bot/server.js

Written by the calendar-native agent for whoever owns `bot/server.js` /
`bot/web.js`. I do **not** own those files (my ownership is everything under
`bot/calendar-native/` plus new test files under `bot/test/wave7-calendar-*`),
so every server-side route below is a description + exact code, not a diff I
applied. All business logic already exists and is tested in
`bot/calendar-native/owner-api.js` (see `bot/test/wave7-calendar-resources-owner-api.test.js`)
— these are thin HTTP wrappers only, following the *exact* precedent of
`handleOwnerPutSettings` / `PUT /api/calendar-native/owner/settings`, already
mounted the same way.

## What changed conceptually

A tenant can now have more than one bookable "resource" (a stylist, a room, a
bay) instead of exactly one shared calendar. Every pre-existing tenant is
migrated (schema v5, `bot/calendar-native/db.js`) into exactly one implicit
resource — **no existing route's request/response shape needs to change for
that tenant to keep working**. The new routes below are strictly additive.

## 1. Two existing handlers need one line added each

### `handleOwnerListBookings` (bot/server.js, currently line ~1817)

Add a `resourceId` passthrough so the owner dashboard's new "team" filter
(and the `'__unassigned__'` pseudo-filter for still-unresolved "any
available" requests) works:

```javascript
async function handleOwnerListBookings(req, res, query) {
    const src = {
        customerId: query.get('customerId') || query.get('customer_id'),
        siteId: query.get('siteId') || query.get('site_id'),
    };
    const tenant = resolveOwnerTenantOrReject(req, res, src);
    if (!tenant) return;
    const ownerApi = getCalendarOwnerApi();
    const db = resolveCalendarNativeDb();
    if (tenant.demo) getCalendarNativeApi().ensureDemoTenant(db);
    const out = ownerApi.listOwnerBookings(db, tenant.customerId, tenant.siteId, {
        status: query.get('status') || undefined,
        fromUtc: query.get('fromUtc') || undefined,
        toUtc: query.get('toUtc') || undefined,
        fromDateLocal: query.get('fromDateLocal') || query.get('from') || undefined,
        toDateLocal: query.get('toDateLocal') || query.get('to') || undefined,
        q: query.get('q') || undefined,
        resourceId: query.get('resourceId') || undefined, // <-- ADD THIS LINE
    });
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}
```

### `handleOwnerGetAvailability` (bot/server.js, currently line ~1890)

Add a `resourceId` passthrough so the "Disponibilitate" tab's per-resource
weekly-hours selector works:

```javascript
async function handleOwnerGetAvailability(req, res, query) {
    const src = {
        customerId: query.get('customerId') || query.get('customer_id'),
        siteId: query.get('siteId') || query.get('site_id'),
    };
    const tenant = resolveOwnerTenantOrReject(req, res, src);
    if (!tenant) return;
    const ownerApi = getCalendarOwnerApi();
    const db = resolveCalendarNativeDb();
    if (tenant.demo) getCalendarNativeApi().ensureDemoTenant(db);
    const out = ownerApi.getOwnerAvailability(db, tenant.customerId, tenant.siteId, {
        resourceId: query.get('resourceId') || undefined, // <-- ADD THIS LINE (and wrap prior bare call in {})
    });
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}
```

`handleOwnerPutWeekly` and `handleOwnerAddOverride` need **no changes** —
they already forward the whole parsed `body` to `ownerApi.putOwnerWeekly` /
`ownerApi.addOwnerOverride`, and those two functions already read an optional
`body.resourceId` / `body.resource_id` themselves (falling back to the
tenant's implicit resource when absent, so a client that never sends it
behaves exactly as before this wave).

Optional, not required by the current owner-dashboard UI (it doesn't scope
reschedule-slot search by resource yet): `handleOwnerListSlots` (line
~2000) could also forward `resourceId: query.get('resourceId') || undefined`
into its `ownerApi.listOwnerSlots(...)` call for a future resource-scoped
reschedule search. Skippable for now.

## 2. New routes to mount

### `handleCalendarNativeSlots` (bot/server.js, currently line ~1545) needs one line added

`GET /api/calendar-native/slots` already exists; `publicApi.listPublicSlots`
already accepts an optional `resourceId`, but the handler currently doesn't
forward it:

```javascript
async function handleCalendarNativeSlots(req, res, query) {
    applyPublicCalendarCors(req, res);
    try {
        const api = getCalendarNativeApi();
        const { customerId, siteId } = api.parseTenant({
            customerId: query.get('customerId') || query.get('customer_id'),
            siteId: query.get('siteId') || query.get('site_id'),
        });
        const db = resolveCalendarNativeDb();
        maybeSeedDemoTenant(db, customerId, siteId);
        const out = api.listPublicSlots(db, customerId, siteId, {
            serviceId: query.get('serviceId') || query.get('service_id'),
            fromDateLocal: query.get('from') || query.get('fromDate'),
            toDateLocal: query.get('to') || query.get('toDate'),
            resourceId: query.get('resourceId') || query.get('resource_id') || undefined, // <-- ADD THIS LINE
        });
        if (out.error) return sendJson(res, out.status || 400, out);
        return sendJson(res, 200, out);
    } catch (e) {
        const status = e.status || 400;
        return sendJson(res, status, { error: e.message || 'Invalid request.', code: e.code || 'ERROR' });
    }
}
```

`handleCalendarNativeBookings` (line ~1568) needs **no change** — it already
calls `api.createPublicBooking(db, customerId, siteId, body || {})`,
forwarding the whole parsed body, and `createPublicBooking` already reads an
optional `body.resourceId`/`body.resource_id` itself (defaulting to "any
available" when absent).

### New public route: `GET /api/calendar-native/resources`

For the widget's "pick a person or any available" step. Mount exactly like
`GET /api/calendar-native/services` (bot/server.js line ~3206) — add right
next to it:

```javascript
if (req.method === 'GET' && url === '/api/calendar-native/resources') {
    return await handleCalendarNativeResources(req, res, query);
}
```

Also add `'/api/calendar-native/resources'` to the OPTIONS-preflight URL list
at line ~3194 (same array as `services`/`slots`/`bookings`), and handler
function (place right after `handleCalendarNativeServices`, line ~1543),
copied verbatim from that function's exact shape:

```javascript
async function handleCalendarNativeResources(req, res, query) {
    applyPublicCalendarCors(req, res);
    try {
        const api = getCalendarNativeApi();
        const { customerId, siteId } = api.parseTenant({
            customerId: query.get('customerId') || query.get('customer_id'),
            siteId: query.get('siteId') || query.get('site_id'),
        });
        const db = resolveCalendarNativeDb();
        maybeSeedDemoTenant(db, customerId, siteId);
        const out = api.listPublicResources(db, customerId, siteId, {
            serviceId: query.get('serviceId') || query.get('service_id') || undefined,
        });
        if (out.error) return sendJson(res, out.status || 400, out);
        return sendJson(res, 200, out);
    } catch (e) {
        const status = e.status || 400;
        return sendJson(res, status, { error: e.message || 'Invalid request.', code: e.code || 'ERROR' });
    }
}
```

(`getCalendarNativeApi()` is `function getCalendarNativeApi() { return
require('./calendar-native/public-api.js'); }` — line ~1507 — and
`public-api.js` already exports the new `listPublicResources` alongside
`listPublicServices`/`listPublicSlots`, so `api.listPublicResources(...)`
above works with no other wiring.)

### Owner resource CRUD + reassignment

Insert these in the same flat `if (method && url)` dispatch cascade, right
after the existing `mSvc` block (bot/server.js, currently ~line 3271-3275,
inside the `{ ... }` scoped block that handles `:id`-parameterized owner
routes) and before the static-asset routes at ~line 3277:

```javascript
if (req.method === 'GET' && url === '/api/calendar-native/owner/resources') {
    return await handleOwnerListResources(req, res, query);
}
if (req.method === 'POST' && url === '/api/calendar-native/owner/resources') {
    return await handleOwnerCreateResource(req, res);
}
{
    const mRes = /^\/api\/calendar-native\/owner\/resources\/([^/]+)$/.exec(url);
    if (req.method === 'PUT' && mRes) {
        return await handleOwnerPutResource(req, res, decodeURIComponent(mRes[1]));
    }
    const mReassign = /^\/api\/calendar-native\/owner\/bookings\/([^/]+)\/reassign$/.exec(url);
    if (req.method === 'POST' && mReassign) {
        return await handleOwnerReassignBooking(req, res, decodeURIComponent(mReassign[1]));
    }
}
```

Handler functions (place near the other `handleOwner*` functions, e.g. right
after `handleOwnerPutService`):

```javascript
async function handleOwnerListResources(req, res, query) {
    const src = {
        customerId: query.get('customerId') || query.get('customer_id'),
        siteId: query.get('siteId') || query.get('site_id'),
    };
    const tenant = resolveOwnerTenantOrReject(req, res, src);
    if (!tenant) return;
    const ownerApi = getCalendarOwnerApi();
    const db = resolveCalendarNativeDb();
    if (tenant.demo) getCalendarNativeApi().ensureDemoTenant(db);
    const out = ownerApi.listOwnerResources(db, tenant.customerId, tenant.siteId);
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}

async function handleOwnerCreateResource(req, res) {
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
    // No id in body => putOwnerResource creates a new resource (mirrors
    // putOwnerService's create-vs-update-by-presence-of-id shape).
    const out = ownerApi.putOwnerResource(db, tenant.customerId, tenant.siteId, null, body || {});
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}

async function handleOwnerPutResource(req, res, resourceId) {
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
    const out = ownerApi.putOwnerResource(db, tenant.customerId, tenant.siteId, resourceId, body || {});
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}

async function handleOwnerReassignBooking(req, res, bookingId) {
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
    const out = ownerApi.reassignOwnerBooking(db, tenant.customerId, tenant.siteId, bookingId, body || {});
    if (out.error) return sendJson(res, out.status || 400, out);
    return sendJson(res, 200, out);
}
```

Every one of these follows the exact `parseJson → resolveOwnerTenantOrReject
→ getCalendarOwnerApi → resolveCalendarNativeDb → ensureDemoTenant(if demo)
→ business call → error/success sendJson` skeleton already used by
`handleOwnerPutSettings`.

## 3. What already works with zero server.js changes

- `POST /api/calendar-native/bookings` — confirmed above, forwards the whole
  body already.
- `GET /api/calendar-native/manage`, `POST /api/calendar-native/manage/cancel`,
  `GET /api/calendar-native/manage/slots`, `POST /api/calendar-native/manage/reschedule`
  — all already resource-aware server-side (manage-api.js resolves the
  booking's own resource; the visitor never supplies one). No server.js
  change needed.

## 4. Doc comment

The route-list doc comment near the top of bot/server.js (the one starting
`GET  /api/calendar-native/services → public active services...`) should
gain two lines once the above is wired:

```
 *   GET  /api/calendar-native/resources → public bookable resources for one tenant (Wave 7, audit #25)
 *   GET/POST/PUT /api/calendar-native/owner/resources[/:id] → owner resource (staff/room) CRUD
 *   POST /api/calendar-native/owner/bookings/:id/reassign → owner moves a booking onto a different resource, same time
```

## Verification

Everything above is a thin wrapper around already-tested business logic:

- `bot/test/wave7-calendar-resources-owner-api.test.js` exercises
  `listOwnerResources`, `putOwnerResource` (create/rename/deactivate/service
  assignment), `getOwnerAvailability` with/without `resourceId`,
  `putOwnerWeekly`/`addOwnerOverride` with `resourceId`, `listOwnerBookings`
  with `resourceId` (including `'__unassigned__'`), `reassignOwnerBooking`,
  and tenant isolation for every one of them.
- `bot/test/wave7-calendar-resources-concurrency.test.js` proves the
  underlying `engine.createBooking` "any available" resolution is race-safe
  under genuine concurrent load (the mechanism `POST
  /api/calendar-native/bookings` calls into).
- `bot/test/wave7-calendar-resources-migration.test.js` proves no existing
  tenant needs any of the above to keep working.

Once mounted, the fastest manual smoke test is the demo tenant
(`demo_customer_elena` / `demo_site_cabinet`), which now seeds a SECOND
resource ("Dr. Ioana Marin") automatically — see
`bot/calendar-native/public-api.js`'s `ensureDemoTenant` — so
`/calendar-native/owner/preview.html` and `/calendar-native/widget/preview.html`
both have two real resources to show in a screenshot with zero setup.
