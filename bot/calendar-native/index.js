'use strict';
/**
 * bot/calendar-native — native Hidook Professional booking core (VISION.md §8).
 *
 * Step (a)+(b): relational model + booking engine.
 * Step (c) part 1: public booking widget + write-mostly public API.
 * Step (c) part 2: owner dashboard + availability editor (authenticated).
 * Legacy POST /api/appointments local-request path stays untouched.
 */

const { openCalendarDb, SCHEMA_VERSION } = require('./db');
const schema = require('./schema');
const engine = require('./engine');
const time = require('./time');
const publicApi = require('./public-api');
const ownerApi = require('./owner-api');

module.exports = {
    openCalendarDb,
    SCHEMA_VERSION,
    schema,
    engine,
    time,
    publicApi,
    ownerApi,
};
