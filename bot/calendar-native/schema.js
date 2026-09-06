'use strict';
/**
 * bot/calendar-native/schema.js — relational schema for native bookings.
 *
 * Tenant isolation key: (customer_id, site_id) on every table.
 * Race-safe slot lock: UNIQUE partial index on active bookings
 * (customer_id, site_id, service_id, start_utc) WHERE status IN
 * ('requested','confirmed') — optimistic-only check-then-write is forbidden
 * (VISION.md §8). Engine also uses BEGIN IMMEDIATE + overlap checks.
 *
 * v2: transactional booking email outbox + delivery audit (VISION §8 step d).
 * Secrets (API keys, SMTP passwords) are NEVER stored in these tables.
 */

const SCHEMA_VERSION = 2;

const BOOKING_STATUSES = Object.freeze([
    'requested',
    'confirmed',
    'cancelled',
    'reschedule_needed',
]);

const ACTIVE_BOOKING_STATUSES = Object.freeze(['requested', 'confirmed']);

/** Delivery lifecycle for calendar transactional email (VISION §8). */
const EMAIL_DELIVERY_STATUSES = Object.freeze([
    'queued',
    'sent',
    'failed',
    'suppressed',
    'dead_letter',
]);

/**
 * Template keys map 1:1 to booking lifecycle honesty.
 * Never use booking_confirmed copy for requested/conflicted rows.
 */
const EMAIL_TEMPLATE_KEYS = Object.freeze([
    'booking_requested',
    'booking_confirmed',
    'booking_cancelled',
    'booking_reschedule_needed',
    'booking_reschedule_confirmed',
    'booking_reminder',
    'booking_reminder_owner',
]);

const SCHEMA_SQL_V1 = `
CREATE TABLE IF NOT EXISTS calendar_settings (
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    default_buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (default_buffer_minutes >= 0),
    min_cancel_hours INTEGER NOT NULL DEFAULT 24 CHECK (min_cancel_hours >= 0 AND min_cancel_hours <= 168),
    slot_interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_interval_minutes > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (customer_id, site_id)
);

CREATE TABLE IF NOT EXISTS calendar_services (
    id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
    buffer_minutes INTEGER CHECK (buffer_minutes IS NULL OR buffer_minutes >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (customer_id, site_id, id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_services_tenant
    ON calendar_services (customer_id, site_id);

-- weekday: 1=Monday .. 7=Sunday (ISO)
CREATE TABLE IF NOT EXISTS calendar_weekly_availability (
    id TEXT NOT NULL PRIMARY KEY,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
    start_minute INTEGER NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
    end_minute INTEGER NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
    CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS idx_calendar_weekly_tenant
    ON calendar_weekly_availability (customer_id, site_id, weekday);

-- date_local = YYYY-MM-DD in owner timezone
-- kind: blackout (full day closed) | special_hours (start/end required)
CREATE TABLE IF NOT EXISTS calendar_date_overrides (
    id TEXT NOT NULL PRIMARY KEY,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    date_local TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('blackout', 'special_hours')),
    start_minute INTEGER CHECK (start_minute IS NULL OR (start_minute >= 0 AND start_minute < 1440)),
    end_minute INTEGER CHECK (end_minute IS NULL OR (end_minute > 0 AND end_minute <= 1440)),
    note TEXT,
    CHECK (
        (kind = 'blackout' AND start_minute IS NULL AND end_minute IS NULL)
        OR (kind = 'special_hours' AND start_minute IS NOT NULL AND end_minute IS NOT NULL AND end_minute > start_minute)
    ),
    UNIQUE (customer_id, site_id, date_local, kind, start_minute, end_minute)
);
CREATE INDEX IF NOT EXISTS idx_calendar_overrides_tenant_date
    ON calendar_date_overrides (customer_id, site_id, date_local);

CREATE TABLE IF NOT EXISTS calendar_bookings (
    id TEXT NOT NULL PRIMARY KEY,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    start_utc TEXT NOT NULL,
    end_utc TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'confirmed', 'cancelled', 'reschedule_needed')),
    visitor_name TEXT NOT NULL,
    visitor_email TEXT NOT NULL,
    visitor_phone TEXT,
    note TEXT,
    manage_token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cancelled_at TEXT,
    CHECK (end_utc > start_utc)
);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_tenant_start
    ON calendar_bookings (customer_id, site_id, start_utc);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_tenant_status
    ON calendar_bookings (customer_id, site_id, status);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_token
    ON calendar_bookings (manage_token_hash);

-- Race-safe slot lock (VISION §8): active rows cannot share the same slot key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_bookings_active_slot
    ON calendar_bookings (customer_id, site_id, service_id, start_utc)
    WHERE status IN ('requested', 'confirmed');
`;

/**
 * v2 email outbox — delivery status auditable; no API keys / SMTP passwords.
 * body_text holds the rendered visitor email for the local/test harness only
 * (short transactional copy). Production providers must not log secrets here.
 */
const SCHEMA_SQL_V2 = `
CREATE TABLE IF NOT EXISTS calendar_email_outbox (
    id TEXT NOT NULL PRIMARY KEY,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    booking_id TEXT NOT NULL,
    template_key TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    booking_status_snapshot TEXT NOT NULL,
    manage_link_present INTEGER NOT NULL DEFAULT 0 CHECK (manage_link_present IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'suppressed', 'dead_letter')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
    next_attempt_at TEXT,
    last_error TEXT,
    provider_name TEXT NOT NULL,
    provider_message_id TEXT,
    idempotency_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT,
    UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_calendar_email_outbox_tenant
    ON calendar_email_outbox (customer_id, site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_email_outbox_booking
    ON calendar_email_outbox (booking_id);
CREATE INDEX IF NOT EXISTS idx_calendar_email_outbox_status_next
    ON calendar_email_outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS calendar_email_audit (
    id TEXT NOT NULL PRIMARY KEY,
    outbox_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    booking_id TEXT NOT NULL,
    event TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_email_audit_outbox
    ON calendar_email_audit (outbox_id, created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_email_audit_tenant
    ON calendar_email_audit (customer_id, site_id, created_at);
`;

/**
 * v3 — PII retention / GDPR erasure (VISION §8 "Date personale — minimizare
 * și retenție"): marks a booking as anonymized without deleting the row, so
 * aggregated history (counts, service load) survives while visitor_name /
 * visitor_email / visitor_phone / note are scrubbed. NULL = never anonymized.
 */
const SCHEMA_SQL_V3 = `
ALTER TABLE calendar_bookings ADD COLUMN anonymized_at TEXT;
`;

/**
 * v4 — Wave 6 (audit finding #26): reminders, .ics sync, booking-window policy.
 *
 * calendar_settings gains the same "owner-configurable, tenant-defaulted"
 * columns already established by default_buffer_minutes / min_cancel_hours:
 *   - min_notice_minutes / max_advance_days: booking-window policy. Defaults
 *     (0 / NULL = no cap) intentionally preserve pre-v4 behavior for every
 *     existing row and every test fixture that never patches these fields —
 *     the policy is opt-in per tenant, enforced server-side once configured.
 *   - reminder_hours_before / reminder_visitor_enabled / reminder_owner_enabled:
 *     reminder policy. Visitor reminders default ON (24h before) because the
 *     reminder *sweep* (reminders.js) only ever acts when explicitly run —
 *     it never fires inline on booking mutations — so this default cannot
 *     change the row/email counts any existing oracle asserts immediately
 *     after create/cancel/reschedule.
 *
 * calendar_bookings gains:
 *   - visitor_reminder_sent_at / owner_reminder_sent_at: idempotency ledger
 *     for the reminder sweep (NULL = not yet sent; reset to NULL by
 *     applyReschedule() whenever the slot moves, so a reschedule earns a
 *     fresh reminder for the new time).
 *   - ics_sequence: RFC 5545 SEQUENCE counter for the .ics attached to
 *     lifecycle email (confirm / reschedule-confirm / cancel). Starts at 0;
 *     bumped by one every time email/index.js emits a calendar object for
 *     that booking, independent of which lifecycle event triggered it.
 *
 * calendar_email_outbox gains ics_content / ics_filename (nullable — only
 * populated for confirm/reschedule-confirm/cancel rows) so the .ics rides
 * the EXISTING outbox/backoff/audit pipeline instead of a second path.
 */
const SCHEMA_SQL_V4 = `
ALTER TABLE calendar_settings ADD COLUMN min_notice_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (min_notice_minutes >= 0 AND min_notice_minutes <= 20160);
ALTER TABLE calendar_settings ADD COLUMN max_advance_days INTEGER
    CHECK (max_advance_days IS NULL OR (max_advance_days > 0 AND max_advance_days <= 730));
ALTER TABLE calendar_settings ADD COLUMN reminder_hours_before INTEGER NOT NULL DEFAULT 24
    CHECK (reminder_hours_before >= 0 AND reminder_hours_before <= 336);
ALTER TABLE calendar_settings ADD COLUMN reminder_visitor_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (reminder_visitor_enabled IN (0, 1));
ALTER TABLE calendar_settings ADD COLUMN reminder_owner_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (reminder_owner_enabled IN (0, 1));

ALTER TABLE calendar_bookings ADD COLUMN visitor_reminder_sent_at TEXT;
ALTER TABLE calendar_bookings ADD COLUMN owner_reminder_sent_at TEXT;
ALTER TABLE calendar_bookings ADD COLUMN ics_sequence INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_status_start
    ON calendar_bookings (status, start_utc);

ALTER TABLE calendar_email_outbox ADD COLUMN ics_content TEXT;
ALTER TABLE calendar_email_outbox ADD COLUMN ics_filename TEXT;
`;

/**
 * v5 — Wave 7 (audit finding #25): more than one person or room per tenant.
 *
 * A "resource" is a named bookable unit — a stylist, a room, a bay. Every
 * pre-v5 tenant is backfilled (JS step in db.js, see backfillResourcesV5)
 * into exactly one implicit resource ("Personal implicit") so existing
 * public URLs and bookings keep working with no owner action.
 *
 * calendar_service_resources: which services a resource may perform. Zero
 * rows for a given service_id means "offered by every active resource of
 * this tenant" (permissive default — see engine.listResourcesForService),
 * so a brand-new service or a never-touched single-resource tenant needs no
 * extra setup. Once a service has at least one row, only listed resources
 * are eligible. Migration gives every pre-existing service an explicit row
 * pointing at the implicit default resource only, so adding a second
 * resource later never silently fans old services out to it.
 *
 * calendar_weekly_availability had no UNIQUE constraint, so resource_id is
 * a plain ADD COLUMN (backfilled by JS, not SQL, since the target id is
 * generated per tenant).
 *
 * calendar_date_overrides has an inline UNIQUE that must now include
 * resource_id (two resources can each have their own blackout on the same
 * date) — SQLite cannot ALTER a table constraint, so the table is rebuilt.
 *
 * calendar_bookings: resource_id nullable — NULL means an unresolved "any
 * available" request that never found a free resource (still
 * requested/reschedule_needed until an owner reassigns it, see
 * owner-api.js reassignOwnerBooking). The old service-scoped active-slot
 * lock is replaced by a resource-scoped lock: physical exclusivity is about
 * the resource (a person/room can only do one thing at a time), not the
 * service label — two different services can no longer silently double-book
 * the same resource at the same instant, which the old service-scoped index
 * allowed. NULLs are distinct in SQLite's unique index, so several
 * unresolved "any available" rows can share a start_utc without a false
 * collision (they don't occupy a real resource yet).
 */
const SCHEMA_SQL_V5 = `
CREATE TABLE IF NOT EXISTS calendar_resources (
    id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (customer_id, site_id, id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_resources_tenant
    ON calendar_resources (customer_id, site_id);

CREATE TABLE IF NOT EXISTS calendar_service_resources (
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (customer_id, site_id, service_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_calendar_svc_res_service
    ON calendar_service_resources (customer_id, site_id, service_id);
CREATE INDEX IF NOT EXISTS idx_calendar_svc_res_resource
    ON calendar_service_resources (customer_id, site_id, resource_id);

ALTER TABLE calendar_weekly_availability ADD COLUMN resource_id TEXT;
CREATE INDEX IF NOT EXISTS idx_calendar_weekly_resource
    ON calendar_weekly_availability (customer_id, site_id, resource_id, weekday);

ALTER TABLE calendar_date_overrides RENAME TO calendar_date_overrides_v4;
CREATE TABLE calendar_date_overrides (
    id TEXT NOT NULL PRIMARY KEY,
    customer_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    resource_id TEXT,
    date_local TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('blackout', 'special_hours')),
    start_minute INTEGER CHECK (start_minute IS NULL OR (start_minute >= 0 AND start_minute < 1440)),
    end_minute INTEGER CHECK (end_minute IS NULL OR (end_minute > 0 AND end_minute <= 1440)),
    note TEXT,
    CHECK (
        (kind = 'blackout' AND start_minute IS NULL AND end_minute IS NULL)
        OR (kind = 'special_hours' AND start_minute IS NOT NULL AND end_minute IS NOT NULL AND end_minute > start_minute)
    ),
    UNIQUE (customer_id, site_id, resource_id, date_local, kind, start_minute, end_minute)
);
INSERT INTO calendar_date_overrides
    (id, customer_id, site_id, resource_id, date_local, kind, start_minute, end_minute, note)
SELECT id, customer_id, site_id, NULL, date_local, kind, start_minute, end_minute, note
    FROM calendar_date_overrides_v4;
DROP TABLE calendar_date_overrides_v4;
CREATE INDEX IF NOT EXISTS idx_calendar_overrides_tenant_date
    ON calendar_date_overrides (customer_id, site_id, date_local);
CREATE INDEX IF NOT EXISTS idx_calendar_overrides_resource_date
    ON calendar_date_overrides (customer_id, site_id, resource_id, date_local);

ALTER TABLE calendar_bookings ADD COLUMN resource_id TEXT;
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_resource
    ON calendar_bookings (customer_id, site_id, resource_id, start_utc);

DROP INDEX IF EXISTS uq_calendar_bookings_active_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_bookings_active_slot
    ON calendar_bookings (customer_id, site_id, resource_id, start_utc)
    WHERE status IN ('requested', 'confirmed');
`;

/** Full schema for brand-new databases. */
const SCHEMA_SQL =
    SCHEMA_SQL_V1 + '\n' + SCHEMA_SQL_V2 + '\n' + SCHEMA_SQL_V3 + '\n' + SCHEMA_SQL_V4 + '\n' + SCHEMA_SQL_V5;

module.exports = {
    SCHEMA_VERSION,
    SCHEMA_SQL,
    SCHEMA_SQL_V1,
    SCHEMA_SQL_V2,
    SCHEMA_SQL_V3,
    SCHEMA_SQL_V4,
    SCHEMA_SQL_V5,
    BOOKING_STATUSES,
    ACTIVE_BOOKING_STATUSES,
    EMAIL_DELIVERY_STATUSES,
    EMAIL_TEMPLATE_KEYS,
};
