'use strict';
/** Boot the server against a good DATA_DIR, then corrupt registry.sqlite
 * WHILE the process keeps running (no restart), and query /health + /health/ready
 * to see whether they tell the truth about a database that goes bad mid-flight. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a210a955143021a0f';
const DATA_DIR = process.argv[2];
if (!DATA_DIR) { console.error('usage: node corrupt-while-running.js <dataDir>'); process.exit(1); }

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = DATA_DIR;
process.env.SERVER_SECRET = 'reaudit-corrupt-' + crypto.randomBytes(12).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[k];

async function main() {
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const BASE = 'http://127.0.0.1:' + server.address().port;

    const healthBefore = await fetch(BASE + '/health').then(r => r.json());
    const readyBefore = await fetch(BASE + '/health/ready').then(r => r.json().then(j => ({ ok: j.ok, checks: j.checks })));
    console.log('BEFORE_CORRUPTION', JSON.stringify({ healthBefore, readyBefore }));

    // Corrupt the live database file out from under the running process.
    fs.writeFileSync(path.join(DATA_DIR, 'registry.sqlite'), 'GARBAGE NOT A DB ' + crypto.randomBytes(64).toString('hex'));
    fs.rmSync(path.join(DATA_DIR, 'registry.sqlite-wal'), { force: true });
    fs.rmSync(path.join(DATA_DIR, 'registry.sqlite-shm'), { force: true });

    const healthAfterRes = await fetch(BASE + '/health');
    const healthAfter = { status: healthAfterRes.status, body: await healthAfterRes.json() };
    let readyAfter;
    try {
        const r = await fetch(BASE + '/health/ready');
        const body = await r.text();
        let json = null; try { json = JSON.parse(body); } catch (_) {}
        readyAfter = { status: r.status, body: json || body };
    } catch (e) { readyAfter = { error: e.message }; }
    console.log('AFTER_CORRUPTION', JSON.stringify({ healthAfter, readyAfter }));

    // Does an actual customer-facing API call now fail loudly or silently?
    let apiCallResult;
    try {
        const r = await fetch(BASE + '/api/sites');
        apiCallResult = { status: r.status, body: await r.text() };
    } catch (e) { apiCallResult = { error: e.message }; }
    console.log('API_CALL_WITH_CORRUPTED_DB', JSON.stringify(apiCallResult));

    server.close();
    process.exit(0);
}
main().catch(e => { console.log(JSON.stringify({ fatal: e.message, stack: e.stack })); process.exit(1); });
