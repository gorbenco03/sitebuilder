'use strict';
/**
 * bot/test/wave9-edit-label-no-activate.test.js
 *
 * Clicking a label to rename it must not fire the control that label sits in.
 *
 * Reported by the product owner from real use: trying to edit the "Programare"
 * button's text activated the button and jumped the canvas down to the booking
 * section. Most editable text in these templates is a <span data-hb-edit>
 * inside an <a> or <button> -- the whole nav, and the appointment CTA -- so
 * contenteditable alone was never enough: the caret landed AND the link fired.
 *
 * The failure is quiet and constant rather than dramatic. Nothing errors; the
 * owner just cannot rename their own buttons without being thrown somewhere
 * else in the page, which reads as the editor being broken.
 *
 * Run: node --experimental-sqlite --test bot/test/wave9-edit-label-no-activate.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'editclick-'));
process.env.SERVER_SECRET = 'editclick-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;

const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

test('clicking an editable label inside a link edits it instead of following the link', async () => {
    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({ headless: true });

    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(base + '/app/', { waitUntil: 'load' });
        await page.waitForSelector('#templates-grid .template-card', { timeout: 25000 });
        await page.click('#hb-cookie-accept').catch(() => {});
        await page.click('.template-card[data-template-id="professionals"] .btn-start-tpl');
        await page.waitForSelector('#preview-iframe', { timeout: 25000 });
        await page.waitForTimeout(2500);
        await page.locator('#btn-close-drawer').click().catch(() => {});

        const frame = page.frameLocator('#preview-iframe');

        // The appointment CTA the owner reported: an editable span inside an
        // anchor whose href jumps to the booking section.
        const shape = await frame.locator('body').evaluate(() => {
            const el = document.querySelector('[data-hb-edit="labels.navBook"]');
            if (!el) return null;
            const link = el.closest('a');
            return {
                editable: el.getAttribute('contenteditable'),
                insideLink: !!link,
                href: link ? link.getAttribute('href') : null,
                scrollY: window.scrollY,
            };
        });
        assert.ok(shape, 'fixture needs the appointment CTA label');
        assert.strictEqual(shape.editable, 'true', 'the label must be editable');
        assert.ok(shape.insideLink, 'this test only means anything while the label sits inside a link');
        assert.match(shape.href || '', /^#/, 'the surrounding link must be an in-page jump');

        // Click it the way an owner does when they want to rename it.
        // The same path renders twice -- desktop nav and mobile nav -- and both
        // are editable, which is correct: an owner renaming the button expects
        // both to change. Drive the desktop one.
        await frame.locator('[data-hb-edit="labels.navBook"]').first().click();
        await page.waitForTimeout(700);

        const after = await frame.locator('body').evaluate(() => ({
            scrollY: window.scrollY,
            hash: location.hash,
            focused: document.activeElement
                ? document.activeElement.getAttribute('data-hb-edit')
                : null,
        }));

        assert.strictEqual(after.scrollY, 0,
            'the canvas jumped to the linked section instead of letting the owner type (scrollY ' + after.scrollY + ')');
        assert.notStrictEqual(after.hash, '#appointment',
            'the link fired: the preview navigated to ' + after.hash);
        assert.strictEqual(after.focused, 'labels.navBook',
            'the click must place focus in the label being renamed, got ' + after.focused);

        // And renaming must actually work afterwards.
        await page.keyboard.press('Control+a');
        await page.keyboard.type('Rezervă acum');
        await page.waitForTimeout(600);
        const text = await frame.locator('[data-hb-edit="labels.navBook"]').first().textContent();
        assert.match(text || '', /Rezervă acum/, 'the label must accept the new text');
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    }
});
