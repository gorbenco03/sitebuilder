'use strict';
/**
 * bot/auth.js — web sessions + Telegram Mini Apps verification.
 *
 * Exports:
 *   signSession, verifySession, buildSessionCookie, buildClearSessionCookie,
 *   getSessionCookieValue, getSessionUserId, revokeSession,
 *   revokeAllSessionsForUser, verifyTelegramInitData
 *
 * Session revocation (Wave 8 / AUDIT-07 re-audit): a signed hb_session
 * cookie is a stateless 30-day HMAC token — there is nothing to invalidate
 * about the token itself, so signSession() now also records a row in the
 * registry's `sessions` table (bot/registry-schema.js#SCHEMA_SQL_V2) keyed
 * by a random `sid` carried in the payload, and verifySession() additionally
 * requires that row to be present, unexpired and unrevoked. See that
 * schema's doc comment for the full design rationale and trade-offs.
 *
 * Zero npm dependencies. Node 18+ CommonJS.
 */

const crypto = require('crypto');

/**
 * Lazy require — mirrors bot/server.js's getAuth()/getRegistry() pattern so
 * merely requiring bot/auth.js (e.g. from a test that only needs
 * verifyTelegramInitData) doesn't force-open the registry's SQLite file.
 */
function _registry() { return require('./registry.js'); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** URL-safe base64 (no padding). */
function b64url(buf) {
    return buf.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function b64urlDecode(s) {
    // Restore standard base64 padding
    const pad = (4 - (s.length % 4)) % 4;
    const std = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    return Buffer.from(std, 'base64');
}

/** Constant-time comparison that works even when lengths differ (returns false fast). */
function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * In-memory session secret for isolated/dev/test boots when the owner has not
 * set SERVER_SECRET. Never written to disk or process.env (no factory leak).
 * @type {string|null}
 */
let _ephemeralSecret = null;

/** True when an ephemeral local secret is allowed (never in production). */
function _allowEphemeralSecret() {
    if (process.env.NODE_ENV === 'production') return false;
    return (
        process.env.HIDOOK_ISOLATED_DEPLOY === '1' ||
        process.env.HIDOOK_TEST_PAY === '1' ||
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test'
    );
}

/**
 * Resolve the HMAC secret: owner env wins; else ephemeral in isolated/dev/test.
 * @returns {string|null}
 */
function _resolveSecret() {
    const envSecret = process.env.SERVER_SECRET;
    if (typeof envSecret === 'string' && envSecret.length > 0) return envSecret;
    if (!_allowEphemeralSecret()) return null;
    if (!_ephemeralSecret) {
        _ephemeralSecret = crypto.randomBytes(32).toString('hex');
    }
    return _ephemeralSecret;
}

/** Guard: returns true when a session secret is available. */
function _hasSecret() {
    return _resolveSecret() != null;
}

// ---------------------------------------------------------------------------
// Session signing / verification
// ---------------------------------------------------------------------------

/**
 * Sign a session for `userId`.
 *
 * Token format:  v1.<b64url(JSON payload)>.<b64url(HMAC-SHA256)>
 * Payload:       { uid, exp, sid } — sid is the server-side revocation key.
 *
 * @param {string} userId
 * @param {{ days?: number }} [opts]
 * @returns {string}
 */
function signSession(userId, { days = 30 } = {}) {
    const secret = _resolveSecret();
    // Human-readable message only — never name env vars (browser/JSON must not see them).
    if (!secret) throw new Error("Sessions can't be signed right now. Please try again shortly.");
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const sid = crypto.randomBytes(16).toString('hex');

    // Record the session so it can be revoked later. If the registry write
    // fails, fail closed — an unrecorded session would be a cookie nothing
    // can ever revoke, which is exactly the bug this exists to fix.
    try {
        _registry().createSession(sid, userId, exp);
    } catch (e) {
        throw new Error("Sessions can't be signed right now. Please try again shortly.");
    }

    const payload = b64url(Buffer.from(JSON.stringify({ uid: userId, exp, sid })));
    const sig     = b64url(
        crypto.createHmac('sha256', secret)
            .update(`v1.${payload}`)
            .digest()
    );
    return `v1.${payload}.${sig}`;
}

/**
 * HMAC-verify + decode a cookie value's payload. Does NOT check expiry or
 * revocation — shared by verifySession() (which checks both) and
 * revokeSession() (which needs the sid regardless of expiry).
 *
 * @param {string} cookieValue
 * @returns {{ uid: string, exp: number, sid?: string }|null}
 */
function _decodeSessionPayload(cookieValue) {
    const secret = _resolveSecret();
    if (!secret) return null;
    if (!cookieValue || typeof cookieValue !== 'string') return null;

    const parts = cookieValue.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, payloadB64, sigB64] = parts;

    // Verify HMAC
    const expectedSig = b64url(
        crypto.createHmac('sha256', secret)
            .update(`v1.${payloadB64}`)
            .digest()
    );
    const sigBuf      = Buffer.from(sigB64,      'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (!safeEqual(sigBuf, expectedBuf)) return null;

    // Decode payload
    let payload;
    try {
        payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
    } catch {
        return null;
    }

    if (!payload || typeof payload.uid !== 'string') return null;
    return payload;
}

/**
 * Verify a session cookie value: valid signature, unexpired, and — the
 * server-side check a stateless HMAC token cannot do on its own — not
 * revoked (logout) or superseded by "log out everywhere".
 *
 * A cookie with no `sid` claim (signed before this migration shipped) is
 * treated as invalid: there is no session row to check revocation against,
 * so trusting it would silently reintroduce the un-revocable-cookie bug this
 * fixes. This forces one re-login per already-open session at deploy time.
 *
 * @param {string} cookieValue
 * @returns {string|null} userId or null
 */
function verifySession(cookieValue) {
    const payload = _decodeSessionPayload(cookieValue);
    if (!payload) return null;
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;
    if (typeof payload.sid !== 'string' || !payload.sid) return null;

    let active;
    try {
        active = _registry().isSessionValid(payload.sid);
    } catch {
        active = false; // fail closed: can't confirm it's live → treat as revoked.
    }
    if (!active) return null;

    return payload.uid;
}

/**
 * Build the Set-Cookie header value for the session.
 *
 * @param {string} value  Output of signSession()
 * @returns {string}
 */
function buildSessionCookie(value) {
    const base = `hb_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
    const publicUrl = (process.env.PUBLIC_URL || '').trim();
    const secure =
        process.env.NODE_ENV === 'production' ||
        publicUrl.startsWith('https');
    return secure ? `${base}; Secure` : base;
}

/**
 * Build a Set-Cookie header value that clears hb_session in the browser.
 * Clearing the cookie alone is necessary but not sufficient for logout — a
 * copy of the old cookie value captured elsewhere must also stop working;
 * that half is revokeSession() below, keyed by the sid inside the cookie.
 *
 * @returns {string}
 */
function buildClearSessionCookie() {
    const base = 'hb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
    const publicUrl = (process.env.PUBLIC_URL || '').trim();
    const secure =
        process.env.NODE_ENV === 'production' ||
        publicUrl.startsWith('https');
    return secure ? `${base}; Secure` : base;
}

/**
 * Extract the raw hb_session cookie value from a request, unverified.
 * Used by the logout route to find the sid to revoke even when the cookie
 * itself is otherwise about to be treated as invalid.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function getSessionCookieValue(req) {
    const cookieHeader = (req.headers && req.headers['cookie']) || '';
    if (!cookieHeader) return null;
    // Parse simple Cookie: key=val; key=val
    for (const part of cookieHeader.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k === 'hb_session') return v || null;
    }
    return null;
}

/**
 * Extract the userId from the Cookie header of an incoming request.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function getSessionUserId(req) {
    const v = getSessionCookieValue(req);
    if (!v) return null;
    return verifySession(v);
}

/**
 * Logout: revoke the one session this cookie names. Safe to call with an
 * already-invalid, already-revoked, or garbage cookie value (returns false).
 *
 * @param {string} cookieValue
 * @returns {boolean} true iff a live session was revoked
 */
function revokeSession(cookieValue) {
    const payload = _decodeSessionPayload(cookieValue);
    if (!payload || typeof payload.sid !== 'string' || !payload.sid) return false;
    try {
        return !!_registry().revokeSession(payload.sid);
    } catch {
        return false;
    }
}

/**
 * "Log out everywhere": revoke every live session belonging to `userId`.
 * Intended for the emailed-magic-link recovery flow — if a user suspects
 * their inbox was read, this ends every session, not just the one that
 * asked for it.
 *
 * @param {string} userId
 * @returns {number} count of sessions revoked
 */
function revokeAllSessionsForUser(userId) {
    if (!userId) return 0;
    try {
        return _registry().revokeAllSessionsForUser(userId);
    } catch {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Telegram Mini Apps — initData verification
// Algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// ---------------------------------------------------------------------------

/**
 * Verify Telegram Mini Apps initData string.
 *
 * @param {string} initDataRaw  Raw query-string, e.g. "auth_date=...&hash=...&user=..."
 * @returns {{ tgId: string, username?: string, firstName?: string }|null}
 */
function verifyTelegramInitData(initDataRaw) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !initDataRaw) return null;

    // Parse key=value pairs
    let params;
    try {
        params = new URLSearchParams(initDataRaw);
    } catch {
        return null;
    }

    const hash = params.get('hash');
    if (!hash) return null;

    // Build data_check_string: all pairs except 'hash', sorted alphabetically, joined with \n
    const pairs = [];
    for (const [k, v] of params.entries()) {
        if (k === 'hash') continue;
        pairs.push(`${k}=${v}`);
    }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    // secret_key = HMAC_SHA256(key='WebAppData', data=BOT_TOKEN)
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(token)
        .digest();

    // expected hash
    const expectedHex = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    // Constant-time compare
    const hashBuf     = Buffer.from(hash,        'utf8');
    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    if (!safeEqual(hashBuf, expectedBuf)) return null;

    // Check auth_date freshness (≤ 24h)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) return null;

    // Decode user object
    let tgId, username, firstName;
    const userStr = params.get('user');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            tgId      = String(user.id);
            username  = user.username   || undefined;
            firstName = user.first_name || undefined;
        } catch {
            return null;
        }
    } else {
        // Some Mini App contexts omit user — use id directly if present
        const idStr = params.get('id');
        if (!idStr) return null;
        tgId = idStr;
    }

    if (!tgId) return null;
    return { tgId, ...(username  !== undefined ? { username }  : {}), ...(firstName !== undefined ? { firstName } : {}) };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    signSession,
    verifySession,
    buildSessionCookie,
    buildClearSessionCookie,
    getSessionCookieValue,
    getSessionUserId,
    revokeSession,
    revokeAllSessionsForUser,
    verifyTelegramInitData,
};
