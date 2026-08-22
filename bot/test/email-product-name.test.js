'use strict';
/**
 * bot/test/email-product-name.test.js — S37 magic-link email names
 * Hidook Site Builder.
 *
 * PRODUCT: public name is Hidook Site Builder. Strangers receive the
 * sign-in magic-link email as part of open builder → edit → magic-link → pay.
 * Subject and HTML <h2> must use the full product name, not bare "Hidook".
 *
 * Run: node bot/test/email-product-name.test.js
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

/** Extract the subject string literal assigned in email.js */
function extractSubjectLiteral(src) {
    const m = src.match(/const\s+subject\s*=\s*'([^']*)'/);
    assert.ok(m, 'email.js must assign const subject = \'...\'');
    return m[1];
}

/** Extract the first <h2>...</h2> text from the HTML template in email.js */
function extractH2Text(src) {
    const m = src.match(/<h2[^>]*>([^<]*)<\/h2>/i);
    assert.ok(m, 'email.js HTML must contain an <h2> heading');
    return m[1].trim();
}

async function run() {
    await check('subject contains exact phrase Hidook Site Builder', () => {
        const subject = extractSubjectLiteral(emailSrc);
        assert.ok(
            subject.includes('Hidook Site Builder'),
            'subject must contain exact phrase "Hidook Site Builder", got: ' + subject
        );
    });

    await check('HTML <h2> contains exact phrase Hidook Site Builder', () => {
        const h2 = extractH2Text(emailSrc);
        assert.ok(
            h2.includes('Hidook Site Builder'),
            'h2 must contain exact phrase "Hidook Site Builder", got: ' + h2
        );
    });

    await check('subject is not bare Hidook without Site Builder', () => {
        const subject = extractSubjectLiteral(emailSrc);
        // Reject trailing bare product token after "autentificare " if Site Builder missing
        assert.ok(
            /Hidook Site Builder/.test(subject),
            'subject must not say only generic Hidook without Site Builder'
        );
        assert.ok(
            !/Link de autentificare\s+Hidook\s*$/.test(subject.trim()),
            'subject must not end with bare Hidook (missing Site Builder)'
        );
    });

    await check('HTML <h2> is not bare Hidook without Site Builder', () => {
        const h2 = extractH2Text(emailSrc);
        assert.ok(
            /Hidook Site Builder/.test(h2),
            'h2 must not say only generic Hidook without Site Builder'
        );
        assert.ok(
            !/Autentific[aă]-te\s+[îi]n\s+Hidook\s*$/i.test(h2),
            'h2 must not end with bare Hidook (missing Site Builder)'
        );
    });

    await check('email.js must not introduce DESSERD / desserdina / trial / keep-site', () => {
        assert.ok(!/\bDESSERD\b/i.test(emailSrc), 'must not contain DESSERD');
        assert.ok(!/desserdina/i.test(emailSrc), 'must not contain desserdina');
        assert.ok(!/\btrial\b/i.test(emailSrc), 'must not introduce trial copy');
        assert.ok(!/keep-site|keep site/i.test(emailSrc), 'must not introduce keep-site copy');
    });

    await check('sendMagicLink posts subject and h2 with Hidook Site Builder', async () => {
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
            const body = JSON.parse(posted.opts.body);
            assert.ok(
                body.subject.includes('Hidook Site Builder'),
                'posted subject must contain "Hidook Site Builder", got: ' + body.subject
            );
            const h2m = body.html.match(/<h2[^>]*>([^<]*)<\/h2>/i);
            assert.ok(h2m, 'posted html must contain <h2>');
            assert.ok(
                h2m[1].includes('Hidook Site Builder'),
                'posted h2 must contain "Hidook Site Builder", got: ' + h2m[1]
            );
            assert.ok(!/\bDESSERD\b/i.test(body.subject + body.html), 'posted mail must not name DESSERD');
        } finally {
            global.fetch = origFetch;
            process.stdout.write = origWrite;
            if (prev === undefined) delete process.env.RESEND_API_KEY;
            else process.env.RESEND_API_KEY = prev;
            delete require.cache[require.resolve('../email.js')];
        }
    });

    if (failed) {
        console.error('\nemail-product-name.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nemail-product-name.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
