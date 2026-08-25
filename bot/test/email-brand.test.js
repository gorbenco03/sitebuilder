'use strict';
/**
 * Test: magic-link email brand is Hidook, never DESSERD.
 * Run:  node bot/test/email-brand.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const emailSrcPath = path.join(__dirname, '..', 'email.js');
const emailSrc = fs.readFileSync(emailSrcPath, 'utf8');

let failed = false;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => { console.log('PASS', name); },
                (e) => { failed = true; console.error('FAIL', name, '-', e.message); }
            );
        }
        console.log('PASS', name);
        return Promise.resolve();
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        return Promise.resolve();
    }
}

async function run() {
    await check('email.js source has no DESSERD in subject or HTML brand copy', () => {
        assert.ok(
            !/subject\s*=\s*'Sign in to\s+DESSERD/i.test(emailSrc),
            'subject must not say DESSERD'
        );
        assert.ok(
            !/<h2[^>]*>\s*Sign in to\s+DESSERD/i.test(emailSrc),
            'HTML heading must not say DESSERD'
        );
        assert.ok(
            !/\bDESSERD\b/.test(emailSrc),
            'email.js must not contain the word DESSERD anywhere'
        );
    });

    await check('email.js subject and HTML name Hidook', () => {
        assert.ok(
            /subject\s*=\s*'Sign in to\s+Hidook/.test(emailSrc),
            'subject must name Hidook'
        );
        assert.ok(
            /<h2[^>]*>\s*Sign in to\s+Hidook/.test(emailSrc),
            'HTML heading must name Hidook'
        );
    });

    await check('sendMagicLink without RESEND_API_KEY still returns devLink', async () => {
        const prev = process.env.RESEND_API_KEY;
        delete process.env.RESEND_API_KEY;
        const origWrite = process.stdout.write;
        process.stdout.write = () => true;
        try {
            delete require.cache[require.resolve('../email.js')];
            const { sendMagicLink } = require('../email.js');
            const url = 'https://example.test/auth/verify?t=abc';
            const result = await sendMagicLink('stranger@example.com', url);
            assert.strictEqual(result.sent, false);
            assert.strictEqual(result.devLink, url);
        } finally {
            process.stdout.write = origWrite;
            if (prev === undefined) delete process.env.RESEND_API_KEY;
            else process.env.RESEND_API_KEY = prev;
            delete require.cache[require.resolve('../email.js')];
        }
    });

    await check('sendMagicLink with API key posts Hidook subject/html (no DESSERD)', async () => {
        const prev = process.env.RESEND_API_KEY;
        process.env.RESEND_API_KEY = 'test-key-not-real';
        const origFetch = global.fetch;
        let posted;
        global.fetch = async (url, opts) => {
            posted = { url, opts };
            return { ok: true, status: 200, text: async () => '' };
        };
        const origWrite = process.stdout.write;
        process.stdout.write = () => true;
        try {
            delete require.cache[require.resolve('../email.js')];
            const { sendMagicLink } = require('../email.js');
            const result = await sendMagicLink('stranger@example.com', 'https://example.test/m');
            assert.strictEqual(result.sent, true);
            assert.ok(posted, 'fetch must be called');
            assert.strictEqual(posted.url, 'https://api.resend.com/emails');
            const body = JSON.parse(posted.opts.body);
            assert.ok(!/\bDESSERD\b/i.test(body.subject), 'posted subject must not contain DESSERD');
            assert.ok(!/\bDESSERD\b/i.test(body.html), 'posted html must not contain DESSERD');
            assert.ok(/Hidook/.test(body.subject), 'posted subject must name Hidook');
            assert.ok(/Hidook/.test(body.html), 'posted html must name Hidook');
        } finally {
            global.fetch = origFetch;
            process.stdout.write = origWrite;
            if (prev === undefined) delete process.env.RESEND_API_KEY;
            else process.env.RESEND_API_KEY = prev;
            delete require.cache[require.resolve('../email.js')];
        }
    });

    if (failed) {
        console.error('\nemail-brand.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nemail-brand.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
