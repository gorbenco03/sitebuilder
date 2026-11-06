'use strict';
// Causal fixture regression: real calendar engine, unchanged business windows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openCalendarDb } = require('../calendar-native/db');
const engine = require('../calendar-native/engine');
const { futureUtcNoon } = require('./helpers/nov06-calendar-fixture');

test('suite13 old rolling clock reproduces end-of-day rejection; UTC-noon fixture confirms across boundaries', () => {
    const clocks = [
        '2030-03-30T00:00:00.000Z', '2030-03-30T12:00:00.000Z',
        '2030-03-30T23:29:00.000Z', '2030-03-30T23:30:00.000Z',
        '2030-03-30T23:35:00.000Z', '2030-03-30T23:59:59.999Z',
        '2030-03-31T23:59:59.999Z', // European spring transition Sunday
        '2030-10-26T23:59:59.999Z', '2030-10-27T00:00:00.000Z', // autumn/weekend
        '2030-12-31T23:59:59.999Z', // UTC year rollover
    ];
    for (const clock of clocks) for (const days of [2, 4, 5]) {
        const db = openCalendarDb({ dbPath: ':memory:', skipRetentionSweep: true, skipReminderSweep: true });
        try {
            const c = 'fixture', s = 'clock';
            engine.ensureSettings(db, c, s, { timezone: 'UTC', slot_interval_minutes: 30, min_cancel_hours: 0 });
            engine.setWeeklyAvailability(db, c, s, [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start_minute: 0, end_minute: 1439 })));
            const service = engine.upsertService(db, c, s, { name: 'Boundary control', duration_minutes: 30, buffer_minutes: 5 });
            const nowMs = Date.parse(clock);
            const oldStart = new Date(nowMs + days * 86400000).toISOString();
            const input = { serviceId: service.id, nowMs, visitorName: 'Fixture', visitorEmail: 'fixture@example.com' };
            const oldMinute = new Date(oldStart).getUTCHours() * 60 + new Date(oldStart).getUTCMinutes();
            if (oldMinute + 30 > 1439) {
                assert.throws(() => engine.createBooking(db, c, s, { ...input, startUtc: oldStart }), { code: 'SLOT_OUTSIDE_AVAILABILITY' }, 'RED original fixture ' + clock);
                assert.equal(engine.countFutureBookingsForService(db, c, s, service.id, nowMs), 0, 'rejected setup must not write a booking');
            } else {
                const old = engine.createBooking(db, c, s, { ...input, startUtc: oldStart });
                assert.equal(old.status, 'confirmed', 'old setup is valid away from the boundary');
                engine.cancelBookingAsOwner(db, c, s, old.booking.id);
            }
            const startUtc = futureUtcNoon(days, nowMs);
            assert.match(startUtc, /T12:00:00\.000Z$/);
            assert.equal(startUtc.slice(0, 10), oldStart.slice(0, 10), 'preserve intended future UTC calendar date');
            assert.ok(Date.parse(startUtc) > nowMs);
            const fixed = engine.createBooking(db, c, s, { ...input, startUtc });
            assert.equal(fixed.status, 'confirmed', 'GREEN stable fixture ' + clock);
            assert.equal(engine.countFutureBookingsForService(db, c, s, service.id, nowMs), 1);
            assert.throws(() => engine.deleteService(db, c, s, service.id, { nowMs }), { code: 'FUTURE_BOOKINGS' });
            assert.equal(engine.getBooking(db, c, s, fixed.booking.id).status, 'confirmed');
        } finally {
            db.close();
        }
    }
});
