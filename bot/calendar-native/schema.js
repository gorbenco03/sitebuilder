'use strict';
/**
 * bot/calendar-native/schema.js — relational schema for native bookings.
 *
 * Tenant isolation key: (customer_id, site_id) on every table.
 * Race-safe slot lock: UNIQUE partial index on active bookings
 * (customer_id, site_id, service_id, start_utc) WHERE status IN
 * ('requested','confirmed') — optimistic-only check-then-write is forbidden
 * (VISION.md §8). Engine also uses BEGIN IMMEDIATE + overlap checks.
 */

const SCHEMA_VERSION = 1;

const BOOKING_STATUSES = Object.freeze([
    'requested',
    'confirmed',
    'cancelled',
    'reschedule_needed',
]);

const ACTIVE_BOOKING_STATUSES = Object.freeze(['requested', 'confirmed']);

const SCHEMA_SQL = `
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

module.exports = {
    SCHEMA_VERSION,
    SCHEMA_SQL,
    BOOKING_STATUSES,
    ACTIVE_BOOKING_STATUSES,
};
