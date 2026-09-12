'use strict';
/**
 * bot/test/suite10-instagram-teaser-connect.test.js
 *
 * A parallel agent is adding an example ("teaser") Instagram section that
 * renders in the builder preview ONLY in edit mode, only when the customer
 * has not connected Instagram. That agent owns the markup and all the CSS
 * (including the blurred/veiled look, keyed off `.is-revealed`). This oracle
 * covers the BEHAVIOUR this task owns instead (builder/edit-overlay.js +
 * builder/app.js):
 *
 *   1. Clicking anywhere on [data-hb-ig-teaser] reveals it once — adds
 *      `.is-revealed` and un-hides the veil (`hidden = false`). Revealing is
 *      one-way per render: clicking again outside the CTA does not un-reveal.
 *   2. The teaser tiles are not part of the inline-edit surface: the existing
 *      photo-replace machinery (setupImages() in edit-overlay.js) must not
 *      wrap the teaser's <img> tiles with a "Înlocuiește fotografia" button,
 *      and clicking inside the section must never post {hb:'image'} (or any
 *      draft-dirtying message) to the parent.
 *   3. Clicking [data-hb-ig-connect] posts {hb:'connect-instagram'} to the
 *      parent, and — this is the integration seam with app.js — the parent's
 *      REAL postMessage switch opens the SAME Instagram modal the top-bar
 *      "Adaugă Instagram" button opens (openInstagramModal()), not a
 *      reimplementation of it.
 *   4. Keyboard access: the CTA is a real <button> (Enter/Space + a focus
 *      ring come for free). The section itself is click-to-reveal with no
 *      visible affordance in its fixed markup, so edit-overlay.js adds
 *      tabindex="0" + role="button" to any not-yet-revealed teaser section at
 *      mount, and Enter/Space on the SECTION ITSELF (not a child control)
 *      reveals it exactly like a click. Once revealed, that affordance is
 *      removed — the CTA is the only interactive control left inside.
 *
 * As the teaser markup was not yet present in this worktree at the time this
 * oracle was written (a parallel agent owns build.js/templates), suite A
 * below runs the REAL edit-overlay.js against a fixture containing exactly
 * the fixed markup from the task brief, loaded fresh into a sandboxed
 * `srcdoc` iframe so mount() runs for real, including the setupImages()
 * exclusion and the tabindex/role a11y wiring. Suite B then proves the other
 * half — that the message really reaches the REAL, already-running builder
 * app and opens the REAL modal — by injecting that same fixture into the
 * live #preview-iframe (edit-overlay.js's reveal/CTA handling is delegated
 * at the document level, so it applies to content added after mount, exactly
 * as it will once the teaser ships for real inside a template's srcdoc).
 *
 * Run: node --experimental-sqlite --test bot/test/suite10-instagram-teaser-connect.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

// ---------------------------------------------------------------------------
// Fixture: the exact teaser markup from the task brief (six tiles spelled
// out, a distinguishing `id` added purely so a test with several instances
// on one page can tell them apart — it changes nothing the other agent owns).
// ---------------------------------------------------------------------------

const TILE_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function teaserMarkup(id) {
    const tiles = new Array(6).fill('<li><img src="' + TILE_IMG + '" alt=""></li>').join('');
    return (
        '<section id="' + id + '" class="hb-ig-teaser" data-hb-ig-teaser aria-label="Instagram — exemplu">\n' +
        '  <p class="hb-ig-teaser__badge">Exemplu — așa va arăta pe site</p>\n' +
        '  <ul class="hb-ig-teaser__grid">' + tiles + '</ul>\n' +
        '  <div class="hb-ig-teaser__veil" hidden>\n' +
        '    <p class="hb-ig-teaser__lead">Conectează Instagram ca să afișezi fluxul tău real.</p>\n' +
        '    <button type="button" class="hb-ig-teaser__cta" data-hb-ig-connect>Conectează Instagram</button>\n' +
        '  </div>\n' +
        '</section>'
    );
}

const OVERLAY_SRC = fs.readFileSync(path.join(ROOT, 'builder', 'edit-overlay.js'), 'utf8');

// ===========================================================================
// Suite A — real edit-overlay.js, fresh mount, fixture-only harness.
// ===========================================================================

test('suite A: teaser reveal, photo/dirty isolation and keyboard access (fixture, real edit-overlay.js)', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);

        // Parent harness: records every postMessage that actually came FROM
        // the sandboxed child iframe's own window (the same event.source
        // check app.js's real listener performs).
        await page.setContent(
            '<!doctype html><html><body>' +
            '<iframe id="fixture-iframe" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>' +
            '<script>\n' +
            'window.__messages = [];\n' +
            'window.addEventListener("message", function (e) {\n' +
            '  var f = document.getElementById("fixture-iframe");\n' +
            '  if (!f || e.source !== f.contentWindow) return;\n' +
            '  window.__messages.push(e.data);\n' +
            '});\n' +
            '</script>' +
            '</body></html>'
        );

        const childHtml =
            '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
            teaserMarkup('t1') +
            teaserMarkup('t2') +
            teaserMarkup('t3') +
            '<script>' + OVERLAY_SRC + '</script>' +
            '</body></html>';

        await page.evaluate((html) => {
            document.getElementById('fixture-iframe').srcdoc = html;
        }, childHtml);

        const iframeHandle = await page.$('#fixture-iframe');
        const frame = await iframeHandle.contentFrame();
        assert.ok(frame, 'fixture iframe must expose a contentFrame');

        // Real mount() ran: setupIgTeaser() gave every not-yet-revealed
        // section a keyboard path, and setupImages() must have skipped the
        // six tiles entirely (no "Înlocuiește fotografia" wrapping button).
        await frame.waitForFunction(() => {
            const t1 = document.getElementById('t1');
            return !!t1 && t1.getAttribute('tabindex') === '0';
        });

        const preReveal = await frame.evaluate(() => {
            const out = {};
            ['t1', 't2', 't3'].forEach((id) => {
                const s = document.getElementById(id);
                out[id] = {
                    revealed: s.classList.contains('is-revealed'),
                    tabindex: s.getAttribute('tabindex'),
                    role: s.getAttribute('role'),
                    veilHidden: s.querySelector('.hb-ig-teaser__veil').hidden,
                };
            });
            out.wrappedImages = document.querySelectorAll('[data-hb-ig-teaser] .hb-img-btn').length;
            out.wrappedSpans = document.querySelectorAll('[data-hb-ig-teaser] .hb-img-wrap').length;
            return out;
        });
        assert.equal(preReveal.wrappedImages, 0,
            'setupImages() must not add a photo-replace button inside the teaser');
        assert.equal(preReveal.wrappedSpans, 0,
            'setupImages() must not wrap the teaser tiles at all');
        for (const id of ['t1', 't2', 't3']) {
            assert.equal(preReveal[id].revealed, false, id + ' must start unrevealed');
            assert.equal(preReveal[id].veilHidden, true, id + ' veil must start hidden');
            assert.equal(preReveal[id].tabindex, '0', id + ' needs a keyboard path before reveal');
            assert.equal(preReveal[id].role, 'button', id + ' needs role=button before reveal');
        }

        // --- t1: click reveal (on an image tile — also proves that click
        //     never fires the (absent) photo-replace control) ------------
        await frame.locator('#t1 .hb-ig-teaser__grid img').first().click();
        let t1State = await frame.evaluate(() => {
            const s = document.getElementById('t1');
            return {
                revealed: s.classList.contains('is-revealed'),
                veilHidden: s.querySelector('.hb-ig-teaser__veil').hidden,
                tabindex: s.getAttribute('tabindex'),
                role: s.getAttribute('role'),
            };
        });
        assert.equal(t1State.revealed, true, 'click on the section must reveal it');
        assert.equal(t1State.veilHidden, false, 'reveal must un-hide the veil');
        assert.equal(t1State.tabindex, null, 'the one-time keyboard affordance is retired once revealed');
        assert.equal(t1State.role, null, 'role=button is retired once revealed');

        // Clicking again, outside the CTA, must not un-reveal it.
        await frame.locator('#t1 .hb-ig-teaser__badge').click();
        t1State = await frame.evaluate(() => {
            const s = document.getElementById('t1');
            return {
                revealed: s.classList.contains('is-revealed'),
                veilHidden: s.querySelector('.hb-ig-teaser__veil').hidden,
            };
        });
        assert.equal(t1State.revealed, true, 'a second click outside the CTA must not un-reveal the section');
        assert.equal(t1State.veilHidden, false, 'veil must stay visible after the second click');

        // No message must have been sent by any of this — the teaser must
        // never mark the draft dirty on its own.
        let messages = await page.evaluate(() => window.__messages.filter((m) => m && m.hb !== 'ready'));
        assert.deepEqual(messages, [], 'reveal clicks must not post anything to the parent');

        // CTA click posts exactly {hb:'connect-instagram'}. postMessage
        // delivery is async, so wait for it rather than racing a read.
        await frame.locator('#t1 [data-hb-ig-connect]').click();
        await page.waitForFunction(() => window.__messages.some((m) => m && m.hb === 'connect-instagram'));
        messages = await page.evaluate(() => window.__messages.filter((m) => m && m.hb !== 'ready'));
        assert.equal(messages.length, 1, 'the CTA click must post exactly one message');
        assert.equal(messages[0].hb, 'connect-instagram');

        // --- t2: keyboard reveal via Enter --------------------------------
        await frame.locator('#t2').focus();
        await frame.locator('#t2').press('Enter');
        const t2State = await frame.evaluate(() => {
            const s = document.getElementById('t2');
            return {
                revealed: s.classList.contains('is-revealed'),
                veilHidden: s.querySelector('.hb-ig-teaser__veil').hidden,
                tabindex: s.getAttribute('tabindex'),
            };
        });
        assert.equal(t2State.revealed, true, 'Enter on the focused section must reveal it');
        assert.equal(t2State.veilHidden, false);
        assert.equal(t2State.tabindex, null, 'affordance retired after keyboard reveal too');

        // --- t3: keyboard reveal via Space ---------------------------------
        await frame.locator('#t3').focus();
        await frame.locator('#t3').press(' ');
        const t3State = await frame.evaluate(() => {
            const s = document.getElementById('t3');
            return {
                revealed: s.classList.contains('is-revealed'),
                veilHidden: s.querySelector('.hb-ig-teaser__veil').hidden,
            };
        });
        assert.equal(t3State.revealed, true, 'Space on the focused section must reveal it');
        assert.equal(t3State.veilHidden, false);

        await page.close();
    } finally {
        await browser.close();
    }
});

// ===========================================================================
// Suite B — the real, already-running builder: the message must reach the
// real app.js switch and open the real Instagram modal.
// ===========================================================================

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-ig-teaser-'));
process.env.SERVER_SECRET = 'ig-teaser-' + crypto.randomBytes(8).toString('hex');
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
    // The Details drawer opens over the canvas by default and its overlay
    // intercepts pointer events there — close it so clicks reach the iframe.
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
    }
}

test('suite B: the teaser CTA opens the real, existing Instagram modal', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(20000);
        await openProfessionalsEditor(page);

        // The isolation this whole feature depends on: no allow-same-origin.
        const sandbox = await page.locator('#preview-iframe').getAttribute('sandbox');
        const tokens = new Set(String(sandbox || '').split(/\s+/).filter(Boolean));
        assert.ok(!tokens.has('allow-same-origin'),
            '#preview-iframe must not carry allow-same-origin');
        assert.ok(tokens.has('allow-scripts'), '#preview-iframe needs allow-scripts to run edit-overlay.js');

        // Record every raw postMessage the parent actually receives from the
        // preview iframe, independent of what app.js's own switch does with it.
        await page.evaluate(() => {
            window.__igRaw = [];
            window.addEventListener('message', (e) => {
                const f = document.getElementById('preview-iframe');
                if (!f || e.source !== f.contentWindow) return;
                if (e.data && e.data.hb === 'connect-instagram') window.__igRaw.push(e.data);
            });
        });

        assert.equal(
            await page.evaluate(() => document.getElementById('modal-instagram').style.display),
            'none',
            'the Instagram modal must start closed'
        );

        // The teaser markup is owned by a parallel agent and not yet in this
        // template's rendered output — inject the exact fixture into the
        // LIVE preview iframe (edit-overlay.js's reveal/CTA handling is
        // document-level delegation, so it applies to this injected content
        // exactly as it will once the markup ships for real).
        const iframeHandle = await page.$('#preview-iframe');
        const iframeCtx = await iframeHandle.contentFrame();
        assert.ok(iframeCtx, 'preview iframe must expose a contentFrame');
        // The template's own cookie banner floats over the bottom of the
        // page and would otherwise intercept clicks meant for the fixture —
        // dismiss it first, same as a real visitor would.
        await iframeCtx.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
        await iframeCtx.evaluate((html) => {
            document.body.insertAdjacentHTML('afterbegin', html);
        }, teaserMarkup('hb-ig-teaser-fixture'));

        const frame = page.frameLocator('#preview-iframe');
        await frame.locator('#hb-ig-teaser-fixture .hb-ig-teaser__badge').click();
        const revealed = await iframeCtx.evaluate(
            () => document.getElementById('hb-ig-teaser-fixture').classList.contains('is-revealed')
        );
        assert.equal(revealed, true, 'click must reveal the injected teaser inside the real preview');

        await frame.locator('#hb-ig-teaser-fixture [data-hb-ig-connect]').click();

        await page.waitForFunction(
            () => document.getElementById('modal-instagram').style.display !== 'none',
            null,
            { timeout: 5000 }
        );

        const raw = await page.evaluate(() => window.__igRaw);
        assert.equal(raw.length, 1, 'the CTA must post exactly one {hb:"connect-instagram"} message');

        // It really is openInstagramModal()'s own modal, with its own inner
        // panels — not a stand-in dialog.
        const hasIgPanels = await page.evaluate(() => (
            !!document.getElementById('ig-auth-panel') &&
            !!document.getElementById('ig-connect-panel') &&
            !!document.getElementById('ig-connected-panel')
        ));
        assert.ok(hasIgPanels, 'the opened modal must be the real #modal-instagram with its real state panels');

        await page.close();
    } finally {
        await browser.close();
    }
});
