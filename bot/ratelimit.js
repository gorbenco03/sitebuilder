'use strict';
/**
 * bot/ratelimit.js — lightweight, disk-persisted abuse throttle.
 *
 * The expensive, abusable action is a site BUILD (a Sonnet polish call + a deploy).
 * Without a limit, any Telegram user can loop /start → /gata and drain the AI budget
 * (financial DoS). This caps builds per chat per hour AND globally per day. Counters
 * survive restarts (DATA_DIR), so the limit can't be reset by bouncing the bot.
 *
 * Env:
 *   RL_BUILD_PER_CHAT_HOUR  per-chat builds allowed per rolling hour (default 5)
 *   RL_BUILD_GLOBAL_DAY     total builds allowed across all users per day (default 200)
 *
 * Zero dependencies, Node 18+.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE     = path.join(DATA_DIR, '.ratelimit.json');

const PER_CHAT_HOUR = Number(process.env.RL_BUILD_PER_CHAT_HOUR) || 5;
const GLOBAL_DAY    = Number(process.env.RL_BUILD_GLOBAL_DAY)    || 200;
const HOUR_MS       = 3600 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch { return { chat: {}, global: { day: '', count: 0 } }; }
}
let state = _load();

let saveTimer = null;
function _save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try { fs.writeFileSync(FILE, JSON.stringify(state)); }
        catch (e) { console.error('[ratelimit] save failed:', e.message); }
    }, 500);
}

function _today() { return new Date().toISOString().slice(0, 10); }

function _pruneChat(id, now) {
    const arr = (state.chat[id] || []).filter(ts => now - ts < HOUR_MS);
    if (arr.length) state.chat[id] = arr; else delete state.chat[id];
    return arr;
}

function _rollGlobal() {
    const d = _today();
    if (state.global.day !== d) state.global = { day: d, count: 0 };
    return state.global;
}

/**
 * Is a build allowed for this chat right now? Pure check — does NOT consume.
 * @returns {{ok:boolean, scope?:'chat'|'global', reason?:string}}
 */
function allowBuild(chatId) {
    const now = Date.now();
    const id  = String(chatId);
    const arr = _pruneChat(id, now);
    if (arr.length >= PER_CHAT_HOUR) {
        return { ok: false, scope: 'chat', reason: `Ai atins limita de ${PER_CHAT_HOUR} site-uri pe oră. Te rog încearcă din nou mai târziu.` };
    }
    if (_rollGlobal().count >= GLOBAL_DAY) {
        return { ok: false, scope: 'global', reason: 'Sistemul e foarte solicitat momentan. Te rog încearcă peste puțin timp.' };
    }
    return { ok: true };
}

/** Record one build for this chat. Call right before the polish/build step. */
function consumeBuild(chatId) {
    const now = Date.now();
    const id  = String(chatId);
    const arr = _pruneChat(id, now);
    arr.push(now);
    state.chat[id] = arr;
    _rollGlobal().count++;
    _save();
}

module.exports = { allowBuild, consumeBuild, PER_CHAT_HOUR, GLOBAL_DAY };

// Offline self-test: node bot/ratelimit.js
if (require.main === module) {
    const id = 'selftest-' + Date.now();
    let ok = true;
    for (let i = 0; i < PER_CHAT_HOUR; i++) {
        if (!allowBuild(id).ok) ok = false;
        consumeBuild(id);
    }
    const blocked = allowBuild(id);
    console.log('after', PER_CHAT_HOUR, 'builds → next allowed?', blocked.ok, '(expect false)');
    console.log('self-test', (!blocked.ok && ok) ? 'PASSED' : 'FAILED');
    // clean the selftest key so we don't persist garbage
    delete state.chat[id]; _save();
}
