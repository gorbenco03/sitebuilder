'use strict';
// Test-only: UTC noon is safely inside suite13's seven-day 00:00–23:59 windows.
// Set the calendar date in UTC, never carry a wall-clock time or local DST offset.
function futureUtcNoon(daysAhead, nowMs = Date.now()) {
    const slot = new Date(nowMs);
    slot.setUTCDate(slot.getUTCDate() + daysAhead);
    slot.setUTCHours(12, 0, 0, 0);
    return slot.toISOString();
}
module.exports = { futureUtcNoon };
