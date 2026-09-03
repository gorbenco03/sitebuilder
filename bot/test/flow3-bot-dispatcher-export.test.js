'use strict';
/**
 * Flow 3 oracle: the combined `node bot.js` HTTP webhook dispatcher must persist
 * subscription entitlement changes before export is resolved.
 *
 * Run: node bot/test/flow3-bot-dispatcher-export.test.js
 */

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-bot-dispatcher-export-'));
const fakeModulesDir = path.join(tmpDir, 'fake-modules');
const fakeGrammyDir = path.join(fakeModulesDir, 'grammy');

process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'flow3-dispatcher-' + crypto.randomBytes(12).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const registry = require('../registry.js');
const auth = require('../auth.js');

function request(port, urlPath, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.on('error', reject);
        if (body != null) req.write(body);
        req.end();
    });
}

function installFakeGrammy() {
    fs.mkdirSync(fakeGrammyDir, { recursive: true });
    fs.writeFileSync(path.join(fakeGrammyDir, 'index.js'), `'use strict';
class Bot {
    constructor() {
        this.api = {
            config: { use() {} },
            sendMessage() { return Promise.resolve(); },
            setMyCommands() { return Promise.resolve(); },
        };
    }
    use() {}
    command() {}
    on() {}
    catch() {}
    start() { return new Promise(() => {}); }
    stop() {}
}
module.exports = { Bot };
`);
}

function startCombinedBot() {
    installFakeGrammy();
    return new Promise((resolve, reject) => {
        const child = childProcess.spawn(process.execPath, [path.join(ROOT, 'bot', 'bot.js')], {
            cwd: ROOT,
            env: {
                ...process.env,
                DATA_DIR: tmpDir,
                PORT: '0',
                TELEGRAM_BOT_TOKEN: '123456:test-only-token',
                NODE_PATH: fakeModulesDir,
                SWEEP_INTERVAL_MS: '3600000',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGTERM');
            reject(new Error('bot.js did not start its HTTP server\n' + output));
        }, 5000);
        const inspect = (chunk) => {
            output += chunk.toString();
            const match = output.match(/HTTP server on :(\d+)/);
            if (!settled && match) {
                settled = true;
                clearTimeout(timer);
                resolve({ child, port: Number(match[1]), output: () => output });
            }
        };
        child.stdout.on('data', inspect);
        child.stderr.on('data', inspect);
        child.once('exit', (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`bot.js exited before listening (${code || signal})\n${output}`));
        });
        child.once('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function stopChild(child) {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    await new Promise((resolve) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
        }, 1000);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

async function waitForBlockedExport(port, urlPath, cookie) {
    let response = null;
    for (let attempt = 0; attempt < 40; attempt++) {
        response = await request(port, urlPath, { headers: { Cookie: cookie } });
        if (response.status === 402) return response;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return response;
}

(async () => {
    const user = registry.getOrCreateUserByEmail(`flow3-dispatcher-${crypto.randomUUID()}@example.test`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'flow3-dispatcher-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    registry.saveVersion(site.id, {
        business: { name: 'Export Dispatcher Test', title: 'Export Dispatcher Test' },
        sections: { hero: { title: 'Export Dispatcher Test' } },
    });
    const subscriptionId = 'sub_flow3_' + crypto.randomBytes(8).toString('hex');
    registry.updateSite(site.id, {
        paid: true,
        paidUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        status: 'live',
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: 'trialing',
        subscriptionStatus: 'trialing',
    });
    const cookie = 'hb_session=' + auth.signSession(user.id);

    let running;
    try {
        running = await startCombinedBot();

        const entitled = await request(running.port, '/api/export-html?siteId=' + encodeURIComponent(site.id), {
            headers: { Cookie: cookie, Accept: 'text/html' },
        });
        assert.strictEqual(entitled.status, 200, 'trialing subscription exports before lifecycle change');
        assert.ok(/attachment/i.test(String(entitled.headers['content-disposition'] || '')), 'trialing export is an attachment');

        const webhookBody = JSON.stringify({
            id: 'evt_flow3_past_due_' + crypto.randomUUID(),
            type: 'customer.subscription.updated',
            data: {
                object: {
                    id: subscriptionId,
                    status: 'past_due',
                    metadata: { siteId: site.id },
                },
            },
        });
        const webhook = await request(running.port, '/webhooks/stripe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(webhookBody),
            },
            body: webhookBody,
        });
        assert.strictEqual(webhook.status, 200, 'combined bot webhook accepts the event');

        for (const kind of ['html', 'zip']) {
            const blocked = await waitForBlockedExport(
                running.port,
                '/api/export-' + kind + '?siteId=' + encodeURIComponent(site.id),
                cookie
            );
            assert.strictEqual(
                blocked.status,
                402,
                `bot.js dispatcher must persist past_due before ${kind} export; got ${blocked.status}`
            );
            assert.ok(/trial|abonament|activează|plăt/i.test(blocked.body), 'blocked export explains entitlement in Romanian');
            assert.ok(!blocked.headers['content-disposition'], 'blocked export has no attachment');
        }

        console.log('PASS bot.js HTTP webhook persists past_due and blocks HTML+ZIP export');
    } finally {
        await stopChild(running && running.child);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('FAIL flow3-bot-dispatcher-export.test.js -', error.message);
    if (process.env.VERBOSE) console.error(error.stack);
    process.exit(1);
});
