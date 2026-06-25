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

/**
 * Atomically replace SESSIONS_FILE with `json`: write a sibling .tmp file, then
 * rename it over the target. rename(2) is atomic on the same filesystem, so a
 * crash mid-write leaves either the old intact file or the new one — never a
 * truncated/corrupt .sessions.json. Throws on failure (callers log).
 */
function atomicWrite(json) {
    const tmp = SESSIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, SESSIONS_FILE);
}

/** Persist the sessions Map to disk, debounced (coalesces rapid updates). */
function scheduleSave(sessionsMap) {
    pending = sessionsMap;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const map = pending;
        pending = null;
        try {
            atomicWrite(JSON.stringify(Object.fromEntries(map)));
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
        atomicWrite(JSON.stringify(Object.fromEntries(map)));
    } catch (e) {
        console.error('[store] failed to flush sessions:', e.message);
    }
}

module.exports = { loadSessions, scheduleSave, flush };
