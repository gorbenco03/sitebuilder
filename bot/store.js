'use strict';
/**
 * bot/store.js — disk-backed persistence for bot sessions.
 *
 * Sessions live in memory as a Map (bot/flow.js) but must survive process
 * restarts so a client mid-build isn't lost when the bot redeploys/reboots.
 * This mirrors the tiny JSON pattern already used for the Netlify site-map
 * (loadSitesMap/saveSiteId in flow.js): a single JSON file, debounced writes.
 *
 * Zero dependencies. Node 18+.
 */

const fs   = require('fs');
const path = require('path');

// DATA_DIR lets a host (e.g. Railway) point persistence at a mounted volume so
// sessions survive redeploys. Defaults to this folder for local runs.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const SESSIONS_FILE = path.join(DATA_DIR, '.sessions.json');

/**
 * Load persisted sessions as an array of [chatId, session] entries (ready for
 * `new Map(...)`). Telegram chat ids are numeric, so keys are coerced back to
 * Number; non-numeric keys (e.g. test ids) are kept as-is.
 *
 * @returns {Array<[number|string, object]>}
 */
function loadSessions() {
    try {
        const obj = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
        return Object.entries(obj).map(([k, v]) => {
            const n = Number(k);
            return [Number.isFinite(n) && String(n) === k ? n : k, v];
        });
    } catch {
        return [];
    }
}

let saveTimer = null;
let pending = null;

/** Persist the sessions Map to disk, debounced (coalesces rapid updates). */
function scheduleSave(sessionsMap) {
    pending = sessionsMap;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const map = pending;
        pending = null;
        try {
            const obj = Object.fromEntries(map);
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), 'utf8');
        } catch (e) {
            console.error('[store] failed to persist sessions:', e.message);
        }
    }, 800);
}

/** Force a synchronous flush (e.g. on graceful shutdown). */
function flush(sessionsMap) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const map = sessionsMap || pending;
    pending = null;
    if (!map) return;
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(map)), 'utf8');
    } catch (e) {
        console.error('[store] failed to flush sessions:', e.message);
    }
}

module.exports = { loadSessions, scheduleSave, flush };
