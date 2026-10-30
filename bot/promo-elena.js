'use strict';
/**
 * /elena — sales page for one beauty event (owner request 2026-10-29).
 *
 * Elena types a buyer's email on her phone. That account gets a sign-in link
 * and can publish ONE site with no card and no trial (paid for a year, the
 * buyer paid Elena 100 EUR in person). Her page lists every buyer, shows
 * whether their site is live, and lets her tick "achitat" once she has the
 * money.
 *
 * Everything is gated by the ELENA_KEY env var: without it /elena and
 * /api/elena/* are 404 and no account publishes for free. Removing the
 * variable after the event switches the offer off; sites already published
 * stay paid until their paidUntil.
 *
 * Buyers live in $DATA_DIR/promo-elena.json — a handful of rows for one day,
 * not worth a table.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE = path.join(__dirname, 'promo-elena.html');

function enabled() {
    return typeof process.env.ELENA_KEY === 'string' && process.env.ELENA_KEY.length >= 4;
}

function file() {
    return path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'promo-elena.json');
}

function load() {
    try {
        const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
        return d && Array.isArray(d.buyers) ? d : { buyers: [] };
    } catch (_) {
        return { buyers: [] };
    }
}

function save(d) {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, f);
}

function normEmail(v) {
    return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// The code can be 4 digits, so wrong guesses are capped per client IP.
const MAX_WRONG = 10;
const LOCK_MS = 15 * 60 * 1000;
const wrong = new Map();

function clientIp(req) {
    const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
    return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function keyOk(req) {
    if (!enabled()) return false;
    const ip = clientIp(req);
    const now = Date.now();
    const w = wrong.get(ip);
    if (w && now - w.since > LOCK_MS) wrong.delete(ip);
    else if (w && w.n >= MAX_WRONG) return false;
    const got = String((req.headers && req.headers['x-elena-key']) || '');
    const a = crypto.createHash('sha256').update(process.env.ELENA_KEY).digest();
    const b = crypto.createHash('sha256').update(got).digest();
    if (crypto.timingSafeEqual(a, b)) return true;
    const cur = wrong.get(ip) || { n: 0, since: now };
    cur.n += 1;
    wrong.set(ip, cur);
    return false;
}

/** True when this email was added by Elena and the offer is on. */
function isBuyer(email) {
    if (!enabled()) return false;
    const e = normEmail(email);
    return !!e && load().buyers.some((b) => b.email === e);
}

/**
 * @param {object} deps  helpers owned by bot/server.js
 *   { sendJson, parseJson, sendNotFound, isSameOriginRequest, getRegistry, getEmail, withPublicUrl, log }
 */
function createRoutes(deps) {
    const { sendJson, parseJson, sendNotFound, isSameOriginRequest, getRegistry, getEmail, withPublicUrl, log } = deps;

    async function sendLink(email) {
        const { token } = await getRegistry().createLoginToken({ email, purpose: 'login' });
        const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
        const r = await getEmail().sendMagicLink(email, `${publicUrl}/auth/verify?token=${token}`, { welcome: true });
        return { sent: r.sent !== false, devLink: process.env.NODE_ENV !== 'production' ? r.devLink : undefined };
    }

    async function listBuyers() {
        const reg = getRegistry();
        const out = [];
        for (const b of load().buyers) {
            let sites = [];
            try {
                const user = await reg.getOrCreateUserByEmail(b.email);
                sites = (await reg.listSites(user.id))
                    .filter((s) => s.status !== 'deleted')
                    .map((s) => {
                        const pub = withPublicUrl(s);
                        return {
                            name: s.projectName || s.businessName || s.slug,
                            url: pub.publicUrl || pub.url || null,
                            live: s.paid === true && (s.status === 'live' || s.status === 'active'),
                        };
                    });
            } catch (e) {
                log('promo.elena.list_error', { err: e.message }, 'error');
            }
            out.push({ email: b.email, name: b.name || '', addedAt: b.addedAt, cashPaid: !!b.cashPaid, sites });
        }
        return out;
    }

    /** Returns true when the request was an /elena route (handled). */
    return async function handle(req, res, url) {
        if (url !== '/elena' && url !== '/elena/' && !url.startsWith('/api/elena/')) return false;
        if (!enabled()) { sendNotFound(req, res, 'not found'); return true; }

        if (req.method === 'GET' && (url === '/elena' || url === '/elena/')) {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Robots-Tag': 'noindex, nofollow',
            });
            res.end(fs.readFileSync(PAGE));
            return true;
        }

        if (!keyOk(req)) { sendJson(res, 401, { error: 'Cod greșit.' }); return true; }
        if (!isSameOriginRequest(req)) { sendJson(res, 403, { error: 'Cerere refuzată.' }); return true; }

        if (req.method === 'GET' && url === '/api/elena/buyers') {
            sendJson(res, 200, { buyers: await listBuyers() });
            return true;
        }

        if (req.method !== 'POST') return false;
        let body;
        try { body = await parseJson(req); } catch (e) { sendJson(res, 400, { error: 'Cerere invalidă.' }); return true; }
        const email = normEmail(body && body.email);
        if (!EMAIL_RE.test(email)) { sendJson(res, 400, { error: 'Adresă de email invalidă.' }); return true; }

        const d = load();
        let buyer = d.buyers.find((b) => b.email === email);

        if (url === '/api/elena/buyers') {
            if (!buyer) {
                buyer = { email, name: '', addedAt: new Date().toISOString(), cashPaid: false };
                d.buyers.unshift(buyer);
            }
            if (body && typeof body.name === 'string') buyer.name = body.name.trim().slice(0, 80);
            save(d);
            await getRegistry().getOrCreateUserByEmail(email);
            let link = { sent: false };
            try { link = await sendLink(email); } catch (e) { log('promo.elena.link_error', { err: e.message }, 'error'); }
            log('promo.elena.add', { sent: link.sent });
            sendJson(res, 200, { ok: true, sent: link.sent, devLink: link.devLink });
            return true;
        }

        if (!buyer) { sendJson(res, 404, { error: 'Nu e în listă.' }); return true; }

        if (url === '/api/elena/link') {
            let link = { sent: false };
            try { link = await sendLink(email); } catch (e) { log('promo.elena.link_error', { err: e.message }, 'error'); }
            sendJson(res, 200, { ok: true, sent: link.sent, devLink: link.devLink });
            return true;
        }

        if (url === '/api/elena/paid') {
            buyer.cashPaid = !!(body && body.cashPaid);
            buyer.cashPaidAt = buyer.cashPaid ? new Date().toISOString() : null;
            save(d);
            sendJson(res, 200, { ok: true, cashPaid: buyer.cashPaid });
            return true;
        }

        if (url === '/api/elena/remove') {
            d.buyers = d.buyers.filter((b) => b.email !== email);
            save(d);
            sendJson(res, 200, { ok: true });
            return true;
        }

        return false;
    };
}

module.exports = { enabled, isBuyer, createRoutes };
