'use strict';
/**
 * bot/calendar-native — native Hidook Professional booking core (VISION.md §8).
 *
 * Step (a)+(b): relational model + booking engine. No public UI wiring yet.
 * Legacy POST /api/appointments local-request path stays untouched.
 */

const { openCalendarDb, SCHEMA_VERSION } = require('./db');
const schema = require('./schema');
const engine = require('./engine');
const time = require('./time');

module.exports = {
    openCalendarDb,
    SCHEMA_VERSION,
    schema,
    engine,
    time,
};
