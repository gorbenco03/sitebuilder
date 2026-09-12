'use strict';
/**
 * bot/test/suite8-drawer-edit-survives-rebuild.test.js
 *
 * What the owner is typing must survive a drawer rebuild.
 *
 * `buildDrawer()` starts with `body.innerHTML = ''`, which destroys every
 * input in the Details drawer. That is fine when the rebuild is the owner's
 * own doing and the field is committed — and not fine at all when a rebuild
 * arrives from somewhere else while they are mid-edit. Several paths call it
 * for reasons unrelated to the field in hand: reordering a page section,
 * toggling native booking, an undo. If one lands between a keystroke and the
 * input handler that writes it to draft.config, the text is gone with no
 * error and no way to tell it happened.
 *
 * fullpass caught it once, instrumented, on the Cal.com field: after a fill
 * that had demonstrably run, both the input's value and
 * `draft.config.appointment.bookingUrl` were empty. It reproduces in roughly
 * one run in four there and never in isolation, which is exactly the shape of
 * bug that gets dismissed as flakiness and shipped.
 *
 * This does not chase the trigger. It asserts the property directly: rebuild
 * the drawer while a field holds an uncommitted value, and the value — and
 * the caret — are still there afterwards, having gone through the field's own
 * input handler rather than around it.
 *
 * Run: node --experimental-sqlite --test bot/test/suite8-drawer-edit-survives-rebuild.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-drawer-rebuild-'));
process.env.SERVER_SECRET = 'drawer-rebuild-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => { if (server) server.close(); });

async function openProfessionalsEditor(page) {
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
    await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    const drawer = page.locator('#details-drawer');
    if (!(await drawer.isVisible().catch(() => false))) {
        await page.locator('#btn-open-drawer').click();
    }
    await drawer.waitFor({ state: 'visible' });
}

test('a value being typed into Detalii survives a drawer rebuild', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(20000);
        await openProfessionalsEditor(page);

        const url = 'https://cal.com/hidook-rebuild/consultatie';
        const field = page.locator('#dr_appointment_bookingUrl');
        await field.waitFor({ state: 'visible' });
        await field.click();
        await field.fill(url);

        // Rebuild while the field still has focus and its value has NOT been
        // committed — the exact window the bug lives in. Suppressing the input
        // event first is what makes this deterministic instead of a race.
        const after = await page.evaluate((typed) => {
            const el = document.getElementById('dr_appointment_bookingUrl');
            el.focus();
            el.value = typed;
            try { el.setSelectionRange(7, 7); } catch (_) {}
            /* eslint-disable no-undef */
            buildDrawer();
            /* eslint-enable no-undef */
            const fresh = document.getElementById('dr_appointment_bookingUrl');
            let caret = null;
            try { caret = fresh ? fresh.selectionStart : null; } catch (_) {}
            return {
                fieldValue: fresh ? fresh.value : '(field gone)',
                configValue: (typeof draft !== 'undefined' && draft.config && draft.config.appointment)
                    ? draft.config.appointment.bookingUrl : '(no config)',
                focused: document.activeElement === fresh,
                caret,
            };
        }, url);

        assert.equal(after.fieldValue, url,
            'the rebuilt field must still show what the owner had typed');
        assert.equal(after.configValue, url,
            'the carried value must reach draft.config through the normal input handler, not around it');
        assert.equal(after.focused, true,
            'focus must come back to the field the owner was in');
        assert.equal(after.caret, 7, 'the caret must not jump to the end');

        await page.close();
    } finally {
        await browser.close();
    }
});
