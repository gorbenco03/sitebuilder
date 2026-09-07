'use strict';
/**
 * bot/test/waveD-calendar-flash.test.js
 *
 * The confirmation banner on the bookings page.
 *
 * Reported by the product owner, with a screenshot: "Programul săptămânal a
 * fost salvat." sitting flush against the tab row, and never going away.
 *
 * Both were true. `.hod-msg` had 16px of internal padding and no margin, so the
 * banner and the tabs touched; and setMsg() only ever replaced the message, so
 * a confirmation from the morning was still on screen an hour later — by which
 * point it says nothing about the present and only crowds the page.
 *
 * The part worth being careful about: errors do NOT auto-dismiss. A message
 * telling someone their save failed is the one they most need time to read,
 * and the one most likely to be missed by a reader slower than a timer. Only
 * confirmations clear themselves.
 *
 * Run: node --experimental-sqlite --test bot/test/waveD-calendar-flash.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

function boot() {
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    process.env.HIDOOK_TEST_PAY = '1';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-'));
    process.env.DATA_DIR = dir;
    process.env.SERVER_SECRET = 'flash-' + crypto.randomBytes(8).toString('hex');
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    return { dir, server: startServer({ port: 0 }) };
}

test('a saved confirmation is spaced off the tabs and clears itself', async () => {
    const { dir, server } = boot();
    await new Promise((r) => { if (server.listening) return r(); server.once('listening', r); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true });
    try {
        const ctx = await browser.newContext();
        await ctx.request.post(base + '/api/calendar-native/owner/preview-session');
        const page = await ctx.newPage();
        await page.goto(base + '/calendar-native/owner/', { waitUntil: 'load' });
        await page.waitForTimeout(2200);

        // Save something for real, rather than calling the renderer directly —
        // the bug was reported from a real save.
        await page.locator('[data-hod-tab="avail"]').click().catch(() => {});
        await page.waitForTimeout(1200);
        const save = page.locator('button:has-text("Salvează")').first();
        assert.ok(await save.count(), 'expected a save control on the availability tab');
        await save.click();
        await page.waitForTimeout(1500);

        const shown = await page.evaluate(() => {
            const el = document.querySelector('.hod-msg');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const tabs = document.querySelector('.hod-tabs');
            const tr = tabs ? tabs.getBoundingClientRect() : null;
            return {
                text: el.textContent.trim(),
                marginBottom: parseFloat(getComputedStyle(el).marginBottom) || 0,
                gapToTabs: tr ? Math.round(tr.top - r.bottom) : null,
            };
        });
        assert.ok(shown, 'saving must show a confirmation');
        assert.ok(
            shown.gapToTabs >= 8,
            `the confirmation sits ${shown.gapToTabs}px from the tab row — they touch. ` +
            `.hod-msg has internal padding but had no margin of its own.`
        );

        // ... and it goes away on its own.
        await page.waitForTimeout(7000);
        const later = await page.evaluate(() => {
            const el = document.querySelector('.hod-msg');
            return el ? el.textContent.trim() : null;
        });
        assert.strictEqual(later, null,
            'the confirmation was still on screen 7 seconds later. A banner that never leaves stops ' +
            'describing the present and just crowds the page.');
        await page.close();
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an error message does not vanish on a timer', () => {
    // Deliberately a source-level check: reproducing a save failure in a live
    // browser would take mocking the API, and the property that matters is the
    // rule itself — only non-error messages get a dismissal timer.
    const js = fs.readFileSync(
        path.join(ROOT, 'bot', 'calendar-native', 'owner', 'owner-dashboard.js'), 'utf8');
    const fn = /function setMsg\([\s\S]*?\n    }/.exec(js);
    assert.ok(fn, 'expected setMsg in the owner dashboard');
    assert.match(fn[0], /kind !== 'err'/,
        'setMsg must only schedule a dismissal for non-error messages — a failed save is the message ' +
        'a reader most needs time to read');
    assert.match(fn[0], /clearTimeout/,
        'a pending dismissal must be cancelled when a new message arrives, or an earlier timer will ' +
        'wipe a later message');
    assert.match(fn[0], /state\.msg === mine/,
        'the timer must only clear the message it was started for');
});
