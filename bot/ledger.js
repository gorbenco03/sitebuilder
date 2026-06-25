'use strict';
/**
 * bot/ledger.js — append-only order ledger (JSONL).
 *
 * Records the lifecycle of every order — built / checkout / paid / published /
 * failed — as one JSON object per line in DATA_DIR/.ledger.jsonl. This is a
 * durable, human-readable audit trail for reconciliation and accounting that is
 * independent of the live session store: even if .sessions.json is reset, the
 * ledger preserves what happened. Append-only by design (we never rewrite it),
 * so a crash mid-write can at worst lose/garble the last line, never prior ones.
 *
 * Zero dependencies. Node 18+.
 */

const fs   = require('fs');
const path = require('path');

// Share the same persistent volume as the session store (Railway DATA_DIR).
const DATA_DIR    = process.env.DATA_DIR || __dirname;
const LEDGER_FILE = path.join(DATA_DIR, '.ledger.jsonl');

/**
 * Append one record to the ledger as a single JSON line. A `ts` (ISO 8601) is
 * injected when absent. Never throws — accounting must not crash the bot — but
 * returns the written record (or null on failure) so callers/tests can assert.
 *
 * @param {object} record  e.g. { event:'paid', chatId, slug, amount, currency }
 * @returns {object|null}  the record actually written, or null if the write failed
 */
function append(record) {
    const rec = (record && typeof record === 'object') ? { ...record } : { value: record };
    if (rec.ts === undefined) rec.ts = new Date().toISOString();
    let line;
    try {
        line = JSON.stringify(rec);
    } catch (_) {
        return null; // unserializable record — drop rather than corrupt the file
    }
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });   // ensure the volume dir exists (no silent audit loss)
        fs.appendFileSync(LEDGER_FILE, line + '\n', 'utf8');
        return rec;
    } catch (e) {
        console.error('[ledger] append failed:', e.message);
        return null;
    }
}

/**
 * Read the whole ledger back as an array of records. Tolerant of a partially
 * written / corrupt trailing line (skips any line that fails to parse). Returns
 * [] when the file does not exist yet.
 *
 * @returns {object[]}
 */
function read() {
    let raw;
    try {
        raw = fs.readFileSync(LEDGER_FILE, 'utf8');
    } catch {
        return [];
    }
    const out = [];
    for (const line of raw.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try { out.push(JSON.parse(s)); } catch { /* skip malformed line */ }
    }
    return out;
}

module.exports = { append, read, LEDGER_FILE };
