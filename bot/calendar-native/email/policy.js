'use strict';
/**
 * bot/calendar-native/email/policy.js — retry + delivery policy (VISION.md §8).
 *
 * Documented exponential backoff, bounded attempts, then dead-letter with audit.
 * No silent drop. No production sender secrets on this track.
 */

/** Max transport attempts before dead_letter (inclusive of first try). */
const MAX_ATTEMPTS = 5;

/** Base delay in ms for attempt 1→2 (then doubles each failure). */
const BACKOFF_BASE_MS = 1000;

/** Cap so retries cannot grow unbounded. */
const BACKOFF_CAP_MS = 60 * 1000;

/**
 * Delay before the next attempt after `attemptCount` failures
 * (attemptCount is the count already performed, so first retry uses attemptCount=1).
 *
 * attempt 1 failed → wait 1s
 * attempt 2 failed → wait 2s
 * attempt 3 failed → wait 4s
 * attempt 4 failed → wait 8s
 * attempt 5 failed → dead_letter (no further wait)
 *
 * @param {number} attemptCount  attempts already finished (1..MAX_ATTEMPTS)
 * @returns {number|null} ms to wait, or null if no more retries
 */
function nextBackoffMs(attemptCount) {
    const n = Number(attemptCount) || 0;
    if (n >= MAX_ATTEMPTS) return null;
    if (n < 1) return 0;
    const ms = BACKOFF_BASE_MS * Math.pow(2, n - 1);
    return Math.min(BACKOFF_CAP_MS, ms);
}

/**
 * ISO timestamp for next_attempt_at, or null when exhausted.
 * @param {number} attemptCount
 * @param {number} [nowMs]
 */
function nextAttemptAtIso(attemptCount, nowMs = Date.now()) {
    const delay = nextBackoffMs(attemptCount);
    if (delay == null) return null;
    return new Date(nowMs + delay).toISOString();
}

/** Human-readable policy block for docs / audit exports (no secrets). */
function policyDescription() {
    return {
        maxAttempts: MAX_ATTEMPTS,
        backoff: 'exponential',
        backoffBaseMs: BACKOFF_BASE_MS,
        backoffCapMs: BACKOFF_CAP_MS,
        schedule: [0, 1000, 2000, 4000, 8000],
        onExhausted: 'dead_letter',
        silentDrop: false,
        productionSecretsRequired: false,
        defaultProvider: 'local-memory',
    };
}

module.exports = {
    MAX_ATTEMPTS,
    BACKOFF_BASE_MS,
    BACKOFF_CAP_MS,
    nextBackoffMs,
    nextAttemptAtIso,
    policyDescription,
};
