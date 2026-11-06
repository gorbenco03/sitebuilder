'use strict';
// Loopback-only development harness. Never reads .env; every run owns fresh data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../../..');
async function startLocalServer() {
    const scratch = process.env.TMPDIR;
    if (!scratch || !fs.statSync(scratch).isDirectory()) throw Error('Existing TMPDIR scratch required');
    const keep = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH']);
    for (const key of Object.keys(process.env)) if (!keep.has(key)) delete process.env[key];
    const dataDir = fs.mkdtempSync(path.join(scratch, 'assembled-gate-'));
    Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: dataDir,
        SERVER_SECRET: crypto.randomUUID(), HIDOOK_ISOLATED_DEPLOY: '1', HIDOOK_TEST_PAY: '1',
        CALENDAR_EMAIL_TRANSPORT: 'memory' });
    // Prevent accidental backend provider requests as well as clearing provider credentials.
    const nativeFetch = global.fetch;
    global.fetch = (url, opts) => {
        const parsed = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw Error('External fetch refused in local gate');
        return nativeFetch(url, opts);
    };
    const { createHandler } = require(path.join(ROOT, 'bot/server.js'));
    const server = http.createServer(createHandler({}));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, { PUBLIC_URL: base, PUBLIC_BASE_URL: base, CALENDAR_PUBLIC_BASE_URL: base });
    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        clearTimeout(expiry);
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections();
        });
        global.fetch = nativeFetch;
    };
    const expiry = setTimeout(() => { close().finally(() => process.exit(0)); }, 3 * 60 * 60 * 1000);
    expiry.unref();
    return { server, base, dataDir, close };
}
module.exports = { startLocalServer };
if (require.main === module) (async () => {
    const owned = await startLocalServer();
    const stop = () => owned.close().then(() => process.exit(0));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log(JSON.stringify({ base: owned.base, dataDir: owned.dataDir, localSimulation: true, expiresHours: 3 }));
    if (process.argv.includes('--smoke')) {
        let browser;
        try {
            const assert = require('node:assert/strict');
            assert.equal((await fetch(owned.base + '/health')).status, 200);
            const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
            browser = await chromium.launch();
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
            await context.route('**/*', route => {
                const u = new URL(route.request().url());
                return u.origin === owned.base || !/^https?:$/.test(u.protocol) ? route.continue() : route.abort();
            });
            const page = await context.newPage();
            await page.goto(owned.base + '/app/');
            await page.locator('.btn-start-tpl[data-id=gol]').waitFor();
            await page.screenshot({ path: path.join(__dirname, 'smoke-open-local-landing-390.png') });
            console.log('SMOKE PASS: loopback health + real mobile landing; owned server/browser closing');
        } finally { if (browser) await browser.close(); await owned.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
