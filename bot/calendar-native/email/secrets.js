'use strict';
/**
 * bot/calendar-native/email/secrets.js — never leak provider secrets.
 *
 * Scans strings/objects destined for logs, UI, exports, or audit detail_json.
 * API keys, SMTP passwords, Authorization headers must never appear.
 */

const SECRET_ENV_NAMES = Object.freeze([
    'RESEND_API_KEY',
    'SENDGRID_API_KEY',
    'SMTP_PASS',
    'SMTP_PASSWORD',
    'SMTP_URL',
    'EMAIL_API_KEY',
    'MAILGUN_API_KEY',
    'POSTMARK_SERVER_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
]);

const SECRET_KEY_RE = /^(authorization|api[_-]?key|smtp[_-]?(pass(word)?|url)|password|secret|token|bearer|private[_-]?key)$/i;

const SECRET_VALUE_RE = new RegExp(
    [
        're_[A-Za-z0-9]{20,}',           // Resend-like
        'SG\\.[A-Za-z0-9._-]{20,}',      // SendGrid
        'Bearer\\s+[A-Za-z0-9._\\-+/=]{8,}',
        'smptp?://[^\\s]+',
        'smtp://[^\\s]+',
        'api[_-]?key\\s*[:=]\\s*\\S+',
    ].join('|'),
    'gi'
);

function collectLiveSecretValues() {
    const out = [];
    for (const name of SECRET_ENV_NAMES) {
        const v = process.env[name];
        if (v && String(v).trim().length >= 4) out.push(String(v).trim());
    }
    return out;
}

/**
 * Redact secrets from a free-form string.
 * @param {unknown} input
 * @returns {string}
 */
function scrubString(input) {
    let s = input == null ? '' : String(input);
    for (const live of collectLiveSecretValues()) {
        if (live.length >= 4) {
            s = s.split(live).join('[REDACTED]');
        }
    }
    s = s.replace(SECRET_VALUE_RE, '[REDACTED]');
    return s;
}

/**
 * Deep-scrub plain objects/arrays for audit JSON. Drops secret-named keys.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function scrubValue(value, depth = 0) {
    if (depth > 6) return '[truncated]';
    if (value == null) return value;
    if (typeof value === 'string') return scrubString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Error) {
        return { name: value.name, message: scrubString(value.message) };
    }
    if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
            if (SECRET_KEY_RE.test(k)) {
                out[k] = '[REDACTED]';
                continue;
            }
            out[k] = scrubValue(value[k], depth + 1);
        }
        return out;
    }
    return scrubString(value);
}

/**
 * Safe JSON for audit rows / exports.
 * @param {unknown} value
 * @returns {string}
 */
function scrubJson(value) {
    try {
        return JSON.stringify(scrubValue(value));
    } catch (_) {
        return JSON.stringify({ error: 'unserializable' });
    }
}

/**
 * Assert a blob (log line, export, UI string) contains no live secrets.
 * Throws if a known env secret value is present.
 * @param {string} blob
 * @param {string} [label]
 */
function assertNoSecrets(blob, label = 'payload') {
    const text = String(blob || '');
    for (const live of collectLiveSecretValues()) {
        if (live.length >= 4 && text.includes(live)) {
            const err = new Error(label + ' leaked a provider secret value');
            err.code = 'SECRET_LEAK';
            throw err;
        }
    }
    // Structural markers that must never ship in visitor-facing exports
    if (/\bRESEND_API_KEY\s*[:=]/i.test(text) && /re_[A-Za-z0-9]{10,}/.test(text)) {
        const err = new Error(label + ' looks like a Resend key dump');
        err.code = 'SECRET_LEAK';
        throw err;
    }
}

module.exports = {
    SECRET_ENV_NAMES,
    scrubString,
    scrubValue,
    scrubJson,
    assertNoSecrets,
};
