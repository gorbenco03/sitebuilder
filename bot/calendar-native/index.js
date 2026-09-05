'use strict';
/**
 * bot/calendar-native — native Hidook Professional booking core (VISION.md §8).
 *
 * Step (a)+(b): relational model + booking engine.
 * Step (c) part 1: public booking widget + write-mostly public API.
 * Step (c) part 2: owner dashboard + availability editor (authenticated).
 * Step (d): transactional email boundary + local/test harness + retry/audit.
 * Step (e): staged per-site opt-in cutover (appointment.nativeBooking) + manage UI.
 * Legacy POST /api/appointments local-request path stays the default until opt-in.
 */

const { openCalendarDb, SCHEMA_VERSION } = require('./db');
const schema = require('./schema');
const engine = require('./engine');
const time = require('./time');
const publicApi = require('./public-api');
const ownerApi = require('./owner-api');
const email = require('./email');
const cutover = require('./cutover');
const manageApi = require('./manage-api');

module.exports = {
    openCalendarDb,
    SCHEMA_VERSION,
    schema,
    engine,
    time,
    publicApi,
    ownerApi,
    email,
    cutover,
    manageApi,
};
