'use strict';
/**
 * bot/calendar-boundary.js — Professional calendar integration boundary (Flow 4.3).
 *
 * Authority: VISION.md §8 — owner chose option C (Hidook hosts cal.diy later).
 *
 * This module is the ONLY product code surface for future cal.diy wiring.
 * Until owner gates (domain / secrets / DB / deploy / spend) complete, the
 * public product stays on the existing local appointment *request* path
 * (POST /api/appointments → status=requested). No fake live booking widget,
 * no cal.diy iframe, no "book now on hosted calendar" claim.
 *
 * Env placeholders (all optional; unset = disabled):
 *   CAL_DIY_BASE_URL          — public base of a future self-hosted cal.diy
 *   CAL_DIY_PUBLIC_EMBED_URL  — embed URL template (not served until enabled)
 *   CAL_DIY_API_KEY           — server secret (never expose to templates)
 *   CAL_DIY_WEBHOOK_SECRET    — inbound webhook verify secret
 *   CAL_DIY_DATABASE_URL      — Postgres for the separate cal.diy app (not this repo)
 *   CAL_DIY_ENABLED           — must be exactly "1" AND base URL set to arm boundary
 *
 * See OWNER-CALENDAR-CAL-DIY.md for the runbook and owner-gate list.
 */

/** Chosen path per VISION §8 — not option A/B/D. */
const CHOSEN_OPTION = 'C';

/** Human label for docs / /api/config honesty. */
const CHOSEN_OPTION_LABEL =
    'Hidook hosts cal.diy later for Professional (option C)';

/**
 * Current product booking mode on public templates.
 * local-request = existing honesty; never "confirmed" auto-booking.
 */
const PUBLIC_MODE_LOCAL_REQUEST = 'local-request';

/**
 * Read env without inventing production hosts.
 * @returns {{
 *   chosenOption: 'C',
 *   chosenOptionLabel: string,
 *   publicMode: 'local-request',
 *   calDiyEnabled: boolean,
 *   calDiyConfigured: boolean,
 *   baseUrl: string|null,
 *   publicEmbedUrl: string|null,
 *   hasApiKey: boolean,
 *   hasWebhookSecret: boolean,
 *   hasDatabaseUrl: boolean,
 *   ownerGatesPending: string[],
 * }}
 */
function getCalendarBoundary() {
    const baseUrl = _trimEnv('CAL_DIY_BASE_URL');
    const publicEmbedUrl = _trimEnv('CAL_DIY_PUBLIC_EMBED_URL');
    const hasApiKey = Boolean(_trimEnv('CAL_DIY_API_KEY'));
    const hasWebhookSecret = Boolean(_trimEnv('CAL_DIY_WEBHOOK_SECRET'));
    const hasDatabaseUrl = Boolean(_trimEnv('CAL_DIY_DATABASE_URL'));
    const enabledFlag = process.env.CAL_DIY_ENABLED === '1';

    // Arm only when explicitly enabled AND a base URL exists. Still does not
    // inject embeds into templates — that is a future slice after owner gates.
    const calDiyConfigured = Boolean(baseUrl);
    const calDiyEnabled = enabledFlag && calDiyConfigured;

    const ownerGatesPending = [];
    if (!baseUrl) ownerGatesPending.push('domain');
    if (!hasApiKey || !hasWebhookSecret) ownerGatesPending.push('secrets');
    if (!hasDatabaseUrl) ownerGatesPending.push('db');
    if (!calDiyEnabled) ownerGatesPending.push('deploy');
    ownerGatesPending.push('spend'); // always owner-owned; never auto-cleared here

    return {
        chosenOption: CHOSEN_OPTION,
        chosenOptionLabel: CHOSEN_OPTION_LABEL,
        publicMode: PUBLIC_MODE_LOCAL_REQUEST,
        calDiyEnabled: false, // product never serves cal.diy embeds in this slice
        calDiyConfigured,
        // Expose presence only — never leak secret values on /api/config
        baseUrl: calDiyConfigured ? baseUrl : null,
        publicEmbedUrl: null, // withhold embed until a future honest wiring slice
        hasApiKey,
        hasWebhookSecret,
        hasDatabaseUrl,
        ownerGatesPending: unique(ownerGatesPending),
        // Internal readiness (not a production green light)
        _envEnabledFlag: enabledFlag,
    };
}

/**
 * Public subset safe for GET /api/config (no secrets).
 */
function getPublicCalendarConfig() {
    const b = getCalendarBoundary();
    return {
        chosenOption: b.chosenOption,
        chosenOptionLabel: b.chosenOptionLabel,
        publicMode: b.publicMode,
        calDiyEnabled: false,
        calDiyReady: false,
        ownerGatesPending: b.ownerGatesPending,
    };
}

/**
 * True if any template/runtime must refuse a fake hosted-calendar claim.
 * Always true today: public mode is local-request only.
 */
function mustUseLocalAppointmentRequest() {
    return getCalendarBoundary().publicMode === PUBLIC_MODE_LOCAL_REQUEST;
}

function _trimEnv(name) {
    const v = process.env[name];
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
}

function unique(arr) {
    return Array.from(new Set(arr));
}

module.exports = {
    CHOSEN_OPTION,
    CHOSEN_OPTION_LABEL,
    PUBLIC_MODE_LOCAL_REQUEST,
    getCalendarBoundary,
    getPublicCalendarConfig,
    mustUseLocalAppointmentRequest,
};
