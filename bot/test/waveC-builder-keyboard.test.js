'use strict';
/**
 * bot/test/waveC-builder-keyboard.test.js
 *
 * The editor from a keyboard.
 *
 * Two things this locks, both found by driving the real app rather than by
 * reading the markup:
 *
 * 1. **The details drawer was modal for a mouse and porous for a keyboard.**
 *    It has a full-screen overlay at z-index 450 whose click handler closes it,
 *    so nothing behind it is reachable with a pointer. From the keyboard, 14 of
 *    30 Tab presses left the drawer and landed on the topbar behind the
 *    curtain — on controls the user could not see and could not click.
 *
 * 2. **There was no way past the chrome.** The landing page puts a nav before
 *    its content and the editor puts seventeen toolbar controls before the
 *    canvas. WCAG 2.4.1 Bypass Blocks is Level A.
 *
 * What this test deliberately does NOT claim: the publish/success modals were
 * already containing focus before any of this — measured 0 of 20 escapes both
 * before and after. They are asserted here so they stay that way, not as
 * something that was repaired.
 *
 * Run: node --experimental-sqlite --test bot/test/waveC-builder-keyboard.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

function focusProbe() {
    const el = document.activeElement;
    if (!el || el === document.body) return { none: true };
    const cs = getComputedStyle(el);
    const hasRing = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow && cs.boxShadow !== 'none');
    return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: String(el.className || '').slice(0, 30),
        name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        hasRing,
        inSurface: !!el.closest('#details-drawer, [role="dialog"]'),
    };
}

async function boot() {
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kbd-'));
    process.env.SERVER_SECRET = 'kbd-' + crypto.randomBytes(8).toString('hex');
    delete process.env.PUBLIC_URL;
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const server = startServer({ port: 0 });
    await new Promise((r) => { if (server.listening) return r(); server.once('listening', r); });
    return { server, base: 'http://127.0.0.1:' + server.address().port };
}

test('the editor is operable and containable from the keyboard', async () => {
    const { server, base } = await boot();
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.setDefaultTimeout(25000);
        await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        // Dismiss consent first. The banner is a dialog and correctly takes
        // focus when it appears, so on a first-ever visit the first Tab stays
        // inside it — that is right, not a bypass failure. The skip link's job
        // is the ordinary case: a visitor who has already answered.
        await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(400);
        await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });

        // --- Bypass Blocks: the first tab stop must skip the chrome ---
        await page.keyboard.press('Tab');
        const first = await page.evaluate(focusProbe);
        assert.ok(!first.none, 'the first Tab must land on something');
        if (first.id !== 'skip-to-content') {
            failures.push(
                `the first tab stop is ${first.tag}#${first.id} "${first.name}", not a skip link — ` +
                `WCAG 2.4.1 Bypass Blocks (Level A)`
            );
        } else {
            const shown = await page.evaluate(() => {
                const el = document.getElementById('skip-to-content');
                const r = el.getBoundingClientRect();
                return { top: r.top, h: r.height, w: r.width };
            });
            // Focused, it has to be on screen and a real target.
            if (shown.top < 0 || shown.h < 23.5 || shown.w < 23.5) {
                failures.push(
                    `the skip link is focusable but not usable when focused: top ${Math.round(shown.top)}, ` +
                    `${Math.round(shown.w)}x${Math.round(shown.h)}`
                );
            }
            // And it must actually move focus into the main region.
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => {
                const el = document.activeElement;
                return { isMain: !!(el && el.getAttribute && el.getAttribute('role') === 'main'), id: el ? el.id : '' };
            });
            if (!after.isMain) failures.push(`activating the skip link left focus on ${after.id || '(unknown)'}, not the main region`);
        }

        // --- Every tab stop shows focus ---
        const noRing = [];
        for (let i = 0; i < 20; i++) {
            await page.keyboard.press('Tab');
            const f = await page.evaluate(focusProbe);
            if (f.none) break;
            if (!f.hasRing) noRing.push(`${f.tag}.${f.cls} "${f.name}"`);
        }
        for (const n of noRing) failures.push(`tab stop with no visible focus indicator: ${n} — WCAG 2.4.7`);

        // --- The drawer contains focus while it is open ---
        await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(2200);
        if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
            await page.locator('#btn-open-drawer').click().catch(() => {});
        }
        await page.waitForTimeout(800);
        assert.ok(
            await page.locator('#details-drawer').isVisible(),
            'the details drawer must be open for this check to mean anything'
        );

        const escaped = [];
        for (let i = 0; i < 30; i++) {
            await page.keyboard.press('Tab');
            const f = await page.evaluate(focusProbe);
            if (f.none) continue;
            if (!f.inSurface) escaped.push(`${f.tag}#${f.id}.${f.cls}`);
        }
        if (escaped.length) {
            failures.push(
                `focus left the open details drawer on ${escaped.length} of 30 tabs (e.g. ` +
                `${[...new Set(escaped)].slice(0, 3).join(', ')}). Its overlay blocks the pointer, so a ` +
                `keyboard user is being sent to controls they can neither see focused nor click.`
            );
        }

        // --- Escape closes it ---
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
            failures.push('Escape did not close the details drawer');
        }

        // --- The publish modal contains focus too (already true; kept true) ---
        await page.locator('#btn-publish').click().catch(() => {});
        await page.waitForTimeout(1200);
        const modalOpen = await page.evaluate(() => {
            const m = document.getElementById('modal-publish');
            return !!m && getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().width > 10;
        });
        assert.ok(modalOpen, 'the publish modal must open for this check to mean anything');
        const modalEscaped = [];
        for (let i = 0; i < 20; i++) {
            await page.keyboard.press('Tab');
            const f = await page.evaluate(focusProbe);
            if (f.none) continue;
            if (!f.inSurface) modalEscaped.push(`${f.tag}#${f.id}`);
        }
        if (modalEscaped.length) {
            failures.push(`focus left the open publish modal on ${modalEscaped.length} of 20 tabs`);
        }
        await page.close();
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    }
    assert.deepStrictEqual(failures, [], 'keyboard operability failures:\n' + failures.join('\n'));
});
