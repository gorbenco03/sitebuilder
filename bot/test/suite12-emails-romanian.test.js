'use strict';
/**
 * bot/test/suite12-emails-romanian.test.js — Wave 12: every transactional
 * email this product sends is Romanian, matching the rest of the product's
 * copy (the builder UI, the dashboard, the dunning emails are all Romanian
 * already).
 *
 * VERIFIED FINDING (minor): the magic-link sign-in email (bot/email.js) was
 * entirely in English ("Sign in to Hidook Site Builder", "Sign in", "Click
 * the button below to sign in.", …) while the rest of the product is
 * Romanian. Fixed in bot/email.js#sendMagicLink: subject, HTML heading,
 * button, disclaimer/footer, and a new Romanian plain-text part are all
 * Romanian now; the link/token handling itself is untouched.
 *
 * Inventory of every OTHER transactional email this product sends (grepped
 * bot/email.js and bot/calendar-native/email/**), kept here as a regression
 * guard so nothing English creeps back in near this fix:
 *   - bot/webpublish.js dunning emails (buildPaymentDeclinedEmailRo /
 *     buildSiteDownEmailRo) — already Romanian.
 *   - bot/calendar-native/email/templates-ro.js — already Romanian (subjects
 *     like "Programare confirmată — …"); owned by another agent, not
 *     touched here, only asserted to still be Romanian.
 *
 * Run: node bot/test/suite12-emails-romanian.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const BOT_ROOT = path.resolve(__dirname, '..');

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
    const emailSrc = fs.readFileSync(path.join(BOT_ROOT, 'email.js'), 'utf8');
    const webpublishSrc = fs.readFileSync(path.join(BOT_ROOT, 'webpublish.js'), 'utf8');

    await check('bot/email.js magic-link subject is Romanian, not the old English "Sign in to..."', () => {
        assert.ok(!/subject\s*=\s*'Sign in/.test(emailSrc), 'subject must not be the old English "Sign in..." literal');
        const m = emailSrc.match(/const\s+subject\s*=\s*'([^']*)'/);
        assert.ok(m, 'email.js must assign const subject = \'...\'');
        assert.ok(/[ăâîșț]/i.test(m[1]) || /autentificare/i.test(m[1]), 'subject must read as Romanian, got: ' + m[1]);
    });

    await check('bot/email.js HTML declares lang="ro" and the heading is Romanian', () => {
        assert.ok(/<html lang="ro">/.test(emailSrc), 'email HTML must declare lang="ro"');
        assert.ok(!/<h2[^>]*>\s*Sign in to/.test(emailSrc), 'h2 must not be the old English "Sign in to..."');
    });

    await check('bot/email.js has no leftover English copy in the button, body or footer', () => {
        assert.ok(!/>\s*Sign in\s*</.test(emailSrc), 'button must not say the English "Sign in"');
        assert.ok(!/Click the button below/i.test(emailSrc), 'body must not be the English "Click the button below..."');
        assert.ok(!/If you didn't request this link/i.test(emailSrc), 'footer must not be the English disclaimer');
        assert.ok(!/Or copy this link/i.test(emailSrc), 'footer must not be the English "Or copy this link"');
        assert.ok(!/This link is valid for/i.test(emailSrc), 'body must not be the English validity sentence');
    });

    await check('bot/email.js builds a Romanian plain-text part (not HTML-only)', () => {
        assert.ok(/const\s+text\s*=/.test(emailSrc), 'email.js must build a plain-text part alongside the HTML');
        assert.ok(!/Bun[ăa],[\s\S]{0,10}Click the button/i.test(emailSrc), 'the plain-text part must not itself be English');
    });

    await check('sendMagicLink actually posts the Romanian subject/html/text to Resend (not just the source)', async () => {
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
            const result = await sendMagicLink('stranger@example.com', 'https://example.test/m?t=abc');
            assert.strictEqual(result.sent, true);
            assert.ok(posted, 'fetch must be called');
            const body = JSON.parse(posted.opts.body);
            assert.ok(!/^Sign in to/.test(body.subject), 'posted subject must not be the old English literal');
            assert.ok(/Hidook/.test(body.subject), 'posted subject still names Hidook');
            assert.ok(typeof body.text === 'string' && body.text.length > 0, 'posted body must include a non-empty plain-text part');
            assert.ok(!/Click the button below/i.test(body.html), 'posted html must not be English');
            assert.ok(!/Click the button below/i.test(body.text), 'posted text must not be English');
        } finally {
            global.fetch = origFetch;
            process.stdout.write = origWrite;
            if (prev === undefined) delete process.env.RESEND_API_KEY;
            else process.env.RESEND_API_KEY = prev;
            delete require.cache[require.resolve('../email.js')];
        }
    });

    await check('sendMagicLink dev fallback (no RESEND_API_KEY) is untouched — still returns devLink, link/token intact', async () => {
        const prev = process.env.RESEND_API_KEY;
        delete process.env.RESEND_API_KEY;
        const origWrite = process.stdout.write;
        process.stdout.write = () => true;
        try {
            delete require.cache[require.resolve('../email.js')];
            const { sendMagicLink } = require('../email.js');
            const url = 'https://example.test/auth/verify?t=abc123';
            const result = await sendMagicLink('stranger@example.com', url);
            assert.strictEqual(result.sent, false);
            assert.strictEqual(result.devLink, url, 'the dev-mode devLink must be the exact same URL — link/token handling is untouched by the copy change');
        } finally {
            process.stdout.write = origWrite;
            if (prev === undefined) delete process.env.RESEND_API_KEY;
            else process.env.RESEND_API_KEY = prev;
            delete require.cache[require.resolve('../email.js')];
        }
    });

    // ── Inventory: every other transactional email already Romanian ───────
    await check('bot/webpublish.js dunning emails (payment declined / site down) are Romanian', () => {
        assert.ok(/buildPaymentDeclinedEmailRo/.test(webpublishSrc), 'payment-declined email builder must exist');
        assert.ok(/buildSiteDownEmailRo/.test(webpublishSrc), 'site-down email builder must exist');
        assert.ok(/<html lang="ro">/.test(webpublishSrc), 'owner-email HTML shell must declare lang="ro"');
        assert.ok(!/Sign in to Hidook/i.test(webpublishSrc), 'no leftover English magic-link subject/heading copy');
    });

    const calendarEmailDir = path.join(BOT_ROOT, 'calendar-native', 'email');
    if (fs.existsSync(path.join(calendarEmailDir, 'templates-ro.js'))) {
        await check('bot/calendar-native/email/templates-ro.js is Romanian (untouched, out of scope, asserted only)', () => {
            const templatesSrc = fs.readFileSync(path.join(calendarEmailDir, 'templates-ro.js'), 'utf8');
            assert.ok(/[ăâîșț]/i.test(templatesSrc), 'calendar email templates must contain Romanian diacritics');
            assert.ok(!/subject\s*=\s*'[A-Za-z ]*Confirmed\b/.test(templatesSrc), 'no leftover English "Confirmed" subject');
        });
    }

    if (failed) {
        console.error('\nsuite12-emails-romanian.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nsuite12-emails-romanian.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
