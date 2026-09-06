'use strict';
/**
 * bot/ratelimit.js — lightweight, disk-persisted abuse throttle.
 *
 * The expensive, abusable action is a site BUILD (a Sonnet polish call + a deploy).
 * Without a limit, any Telegram user can loop /start → /gata and drain the AI budget
 * (financial DoS). This caps builds per chat per hour AND globally per day. Counters
 * survive restarts (DATA_DIR), so the limit can't be reset by bouncing the bot.
 *
 * Also covers POST /api/auth/email (BE-01, 2026-09-06 audit): that endpoint is public,
 * accepts any email address, and previously had zero throttling — anyone could flood
 * it to spam arbitrary inboxes with magic links and grow the login-token store without
 * bound. allowAuthEmail()/consumeAuthEmail() apply the same sliding-window pattern,
 * keyed per normalized email AND per IP, independently.
 *
 * Env:
 *   RL_BUILD_PER_CHAT_HOUR       per-chat builds allowed per rolling hour (default 5)
 *   RL_BUILD_GLOBAL_DAY          total builds allowed across all users per day (default 200)
 *   RL_AUTH_EMAIL_PER_EMAIL_HOUR magic-link requests allowed per email per hour (default 5)
 *   RL_AUTH_EMAIL_PER_IP_HOUR    magic-link requests allowed per IP per hour (default 20)
 *
 * Zero dependencies, Node 18+.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE     = path.join(DATA_DIR, '.ratelimit.json');

const PER_CHAT_HOUR = Number(process.env.RL_BUILD_PER_CHAT_HOUR) || 5;
const GLOBAL_DAY    = Number(process.env.RL_BUILD_GLOBAL_DAY)    || 200;
const AUTH_EMAIL_PER_EMAIL_HOUR = Number(process.env.RL_AUTH_EMAIL_PER_EMAIL_HOUR) || 5;
const AUTH_EMAIL_PER_IP_HOUR    = Number(process.env.RL_AUTH_EMAIL_PER_IP_HOUR)    || 20;
const HOUR_MS       = 3600 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch { return { chat: {}, global: { day: '', count: 0 } }; }
}
let state = _load();
if (!state.authEmail) state.authEmail = { byEmail: {}, byIp: {} };

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

/** Prune a rolling-window bucket (object keyed by id → sorted timestamp array). */
function _pruneBucket(bucket, id, now, windowMs) {
    const arr = (bucket[id] || []).filter(ts => now - ts < windowMs);
    if (arr.length) bucket[id] = arr; else delete bucket[id];
    return arr;
}

/**
 * Is a magic-link email allowed right now for this (email, ip) pair?
 * Pure check — does NOT consume. Blocks on whichever limit is hit first.
 * @returns {{ok:boolean, scope?:'email'|'ip', retryAfterSec?:number, reason?:string}}
 */
function allowAuthEmail(email, ip) {
    const now = Date.now();
    const emailKey = String(email || '').trim().toLowerCase();
    const ipKey    = String(ip || 'unknown');

    const emailArr = _pruneBucket(state.authEmail.byEmail, emailKey, now, HOUR_MS);
    if (emailArr.length >= AUTH_EMAIL_PER_EMAIL_HOUR) {
        return {
            ok: false,
            scope: 'email',
            retryAfterSec: Math.max(1, Math.ceil((emailArr[0] + HOUR_MS - now) / 1000)),
            reason: 'Ai cerut deja prea multe linkuri de autentificare pentru acest email. Încearcă din nou peste o oră.',
        };
    }

    const ipArr = _pruneBucket(state.authEmail.byIp, ipKey, now, HOUR_MS);
    if (ipArr.length >= AUTH_EMAIL_PER_IP_HOUR) {
        return {
            ok: false,
            scope: 'ip',
            retryAfterSec: Math.max(1, Math.ceil((ipArr[0] + HOUR_MS - now) / 1000)),
            reason: 'Prea multe cereri de autentificare de la această conexiune. Încearcă din nou peste o oră.',
        };
    }

    return { ok: true };
}

/** Record one magic-link send for this (email, ip) pair. Call only after allowAuthEmail() passed. */
function consumeAuthEmail(email, ip) {
    const now = Date.now();
    const emailKey = String(email || '').trim().toLowerCase();
    const ipKey    = String(ip || 'unknown');

    const emailArr = _pruneBucket(state.authEmail.byEmail, emailKey, now, HOUR_MS);
    emailArr.push(now);
    state.authEmail.byEmail[emailKey] = emailArr;

    const ipArr = _pruneBucket(state.authEmail.byIp, ipKey, now, HOUR_MS);
    ipArr.push(now);
    state.authEmail.byIp[ipKey] = ipArr;

    _save();
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
        return { ok: false, scope: 'chat', reason: `You've reached the limit of ${PER_CHAT_HOUR} sites per hour. Please try again later.` };
    }
    if (_rollGlobal().count >= GLOBAL_DAY) {
        return { ok: false, scope: 'global', reason: 'The system is under heavy load right now. Please try again shortly.' };
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

module.exports = {
    allowBuild, consumeBuild, PER_CHAT_HOUR, GLOBAL_DAY,
    allowAuthEmail, consumeAuthEmail, AUTH_EMAIL_PER_EMAIL_HOUR, AUTH_EMAIL_PER_IP_HOUR,
};

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
