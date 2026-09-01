'use strict';
/**
 * Flow 2 — builder chrome serves and declares the Hidook favicon.
 *
 * Run: node bot/test/flow2-builder-favicon.test.js
 */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

async function reservePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

async function waitForServer(base, child) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (child.exitCode != null) {
            throw new Error(`bot/web.js exited before listening (${child.exitCode})`);
        }
        try {
            const response = await fetch(base + '/health');
            if (response.ok) return;
        } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('bot/web.js did not become ready');
}

(async () => {
    const port = await reservePort();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow2-favicon-'));
    const env = {
        ...process.env,
        DATA_DIR: dataDir,
        HIDOOK_ISOLATED_DEPLOY: '1',
        HIDOOK_TEST_PAY: '1',
        PORT: String(port),
        SERVER_SECRET: 'flow2-favicon-local-test-secret',
    };
    delete env.PUBLIC_URL;
    delete env.HIDOOK_FAKE_DEPLOY;

    const child = spawn(process.execPath, ['bot/web.js'], {
        cwd: ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    try {
        const base = `http://127.0.0.1:${port}`;
        await waitForServer(base, child);

        const iconResponse = await fetch(base + '/favicon.ico');
        assert.strictEqual(iconResponse.status, 200, 'GET /favicon.ico status');
        const iconType = (iconResponse.headers.get('content-type') || '').toLowerCase();
        assert.match(iconType, /^image\//, `favicon content-type: ${iconType}`);
        assert.ok((await iconResponse.arrayBuffer()).byteLength > 0, 'favicon has image bytes');

        const appResponse = await fetch(base + '/app/');
        assert.strictEqual(appResponse.status, 200, 'GET /app/ status');
        assert.match(appResponse.headers.get('content-type') || '', /text\/html/i);
        const html = await appResponse.text();
        assert.match(html, /<link\b[^>]*\brel=["']icon["'][^>]*>/i, 'builder HTML declares favicon');

        console.log('flow2-builder-favicon: ok');
    } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
            if (child.exitCode != null) return resolve();
            child.once('exit', resolve);
            setTimeout(resolve, 2000).unref();
        });
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('flow2-builder-favicon: FAILED -', error.message);
    if (process.env.VERBOSE) console.error(error.stack);
    process.exit(1);
});
