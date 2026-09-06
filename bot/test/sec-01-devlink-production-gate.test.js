'use strict';
/**
 * SEC-01: an unconfigured production email provider must never expose the
 * raw magic-link token in the API response, while local/test login keeps its
 * explicit devLink fallback.
 *
 * Run: node bot/test/sec-01-devlink-production-gate.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-01-devlink-prod-gate-'));
const previous = {
    DATA_DIR: process.env.DATA_DIR,
    SERVER_SECRET: process.env.SERVER_SECRET,
    PUBLIC_URL: process.env.PUBLIC_URL,
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
};

process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'sec-01-' + crypto.randomBytes(16).toString('hex');
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
delete process.env.RESEND_API_KEY;

const { startServer } = require('../server.js');

async function postAuthEmail(base, email) {
    return fetch(base + '/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
}

function restoreEnv() {
    for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

(async () => {
    const server = startServer({ port: 0 });
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
        process.env.NODE_ENV = 'production';
        delete process.env.RESEND_API_KEY;
        const productionResponse = await postAuthEmail(base, 'production@example.com');
        const productionBody = await productionResponse.json();

        assert.strictEqual(productionResponse.status, 200, JSON.stringify(productionBody));
        assert.deepStrictEqual(
            productionBody,
            { ok: true, sent: false },
            'production without Resend must acknowledge safely without a raw login link'
        );
        assert.ok(!Object.hasOwn(productionBody, 'devLink'), 'production response must not expose devLink');

        process.env.NODE_ENV = 'test';
        const testResponse = await postAuthEmail(base, 'test@example.com');
        const testBody = await testResponse.json();

        assert.strictEqual(testResponse.status, 200, JSON.stringify(testBody));
        assert.strictEqual(testBody.ok, true);
        assert.strictEqual(testBody.sent, false);
        assert.ok(testBody.devLink, 'non-production without Resend must retain local devLink login');
        assert.ok(new URL(testBody.devLink).searchParams.get('token'), 'local devLink must contain the login token');

        console.log('PASS SEC-01 production devLink gate');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        restoreEnv();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error('FAIL SEC-01 production devLink gate -', error.stack || error.message);
    process.exitCode = 1;
});
