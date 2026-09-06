'use strict';
/** Boot the server against a fixed, pre-existing DATA_DIR (not a temp one) and
 * hit /health and /health/ready, then exit. Used to test health checks against
 * a corrupted/restored database, and to verify a restored site round-trips.
 */
const crypto = require('crypto');
const path = require('path');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a210a955143021a0f';
const DATA_DIR = process.argv[2];
if (!DATA_DIR) { console.error('usage: node boot-against-datadir.js <dataDir>'); process.exit(1); }

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = DATA_DIR;
process.env.SERVER_SECRET = 'reaudit-boot-' + crypto.randomBytes(12).toString('hex');
process.env.HIDOOK_ADMIN_TOKEN = 'reaudit-admin-token';
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[k];

async function main() {
    let bootError = null;
    let startServer, onStripeEvent;
    try {
        ({ startServer } = require(path.join(ROOT, 'bot', 'server.js')));
        ({ onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js')));
    } catch (e) {
        console.log(JSON.stringify({ phase: 'require', bootError: e.message }));
        process.exit(1);
    }
    let server;
    try {
        server = startServer({ port: 0, onStripeEvent });
        await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    } catch (e) {
        console.log(JSON.stringify({ phase: 'listen', bootError: e.message }));
        process.exit(1);
    }
    const BASE = 'http://127.0.0.1:' + server.address().port;

    const health = await fetch(BASE + '/health').then(r => r.json().then(j => ({ status: r.status, body: j })));
    console.log('HEALTH', JSON.stringify(health));

    let ready;
    try {
        const r = await fetch(BASE + '/health/ready');
        const body = await r.text();
        let json = null; try { json = JSON.parse(body); } catch (_) {}
        ready = { status: r.status, body: json || body };
    } catch (e) {
        ready = { error: e.message };
    }
    console.log('READY', JSON.stringify(ready));

    // Admin listing (proves whether site data is actually readable end-to-end)
    let admin;
    try {
        const r = await fetch(BASE + '/admin?token=' + process.env.HIDOOK_ADMIN_TOKEN);
        admin = { status: r.status, bodyLen: (await r.text()).length };
    } catch (e) {
        admin = { error: e.message };
    }
    console.log('ADMIN', JSON.stringify(admin));

    // GET /api/sites for the seeded user, if credentials passed via env for convenience.
    server.close();
    process.exit(0);
}
main().catch(e => { console.log(JSON.stringify({ phase: 'main', bootError: e.message, stack: e.stack })); process.exit(1); });
