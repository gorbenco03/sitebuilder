'use strict';
/**
 * bot/test/suite12-template-preview-cross-env.test.js
 *
 * PLAN-FEEDBACK-2026-09-14 Suite D — owner report: the landing "Previzualizare"
 * modal (builder/index.html "Designuri" gallery → #preview-modal-iframe,
 * opened by builder/app.js's openPreviewModal ~7262) renders fine on the
 * owner's Mac (Safari) but "does not work" on Windows, no error text given.
 *
 * DIAGNOSIS (see PLAN-FEEDBACK-2026-09-14.md and the commit that fixes this):
 * every template marks scroll-reveal content with a class (`.fade-in-section`,
 * `.pr-reveal`) that starts hidden and is only unhidden once IntersectionObserver
 * sees it enter the viewport. Because the preview modal shows the "whole design"
 * without requiring the visitor to scroll, scripts/build-builder.js injects a
 * `data-hidook-forcer` script into every srcdoc preview that sweeps the DOM
 * once on load and forces anything stuck at computed opacity 0 back to opacity
 * 1 — but only elements whose reveal is driven by a CSS @keyframes `animation`
 * (`cs.animationName !== "none"`). Four of the five templates only ever hide
 * content that way. `templates/desserdirina/styles.css` is the exception:
 * `.fade-in-section .service-card` (the dessert menu items) starts at
 * `opacity: 0` with a plain `transition: opacity …`, gated by an ancestor
 * `.fade-in-section.visible` class that only IntersectionObserver adds — no
 * `animation` involved, so the forcer's condition never matches it. Worse,
 * desserdirina is also the one template missing the `<noscript><style>…opacity:
 * 1 !important…</style></noscript>` "visible without JS" fallback block that
 * the other four templates all carry (and that build-builder.js's "PREVIEW
 * MODE, belt-and-suspenders" step re-activates unconditionally inside every
 * srcdoc preview) — so nothing rescues it there either.
 *
 * Whether this bites a given visitor is a pure layout-geometry accident:
 * desserdirina's `<header class="hero">` is exactly `100vh` tall, so the very
 * next section (`.about-card.fade-in-section`, containing the affected
 * `.service-card` list) sits with its top AT window.innerHeight — the exact
 * boundary the template's own "reveal anything already in view" window-load
 * fallback checks (`rect.top < window.innerHeight`). Any sub-pixel rounding
 * that nudges that boundary — a fractional devicePixelRatio (Windows 125%/
 * 150% display scaling), a shorter effective viewport (taskbar + classic,
 * non-overlay scrollbars eating into the window, vs. macOS's full-height,
 * overlay-scrollbar browser chrome) — decides whether the menu below it is
 * ever revealed. That is a plausible, concrete "works on my Mac, not on your
 * Windows laptop" story without any browser-engine or OS sniffing anywhere in
 * the code.
 *
 * This suite proves the failure with a REAL browser rendering the REAL
 * preview modal (not a source-code/DOM-sandbox check), across every condition
 * the plan calls out, and locks in the fix generically: after the preview is
 * "ready" (`data-hb-forcer-done="1"`, the same contract builder/app.js itself
 * waits on), NO element with a non-zero rendered box may be left at computed
 * opacity 0 — for any of the five templates, under any condition below.
 *
 * ENGINES ACTUALLY RUN: only Chromium. Firefox and WebKit are not installed
 * for Playwright in this environment (`~/Library/Caches/ms-playwright/` has
 * no firefox- or webkit- prefixed browser binary) and this suite does not download
 * them (no production/network calls beyond localhost per the task rules).
 * Firefox/WebKit are attempted at startup and SKIPPED with an explicit,
 * printed reason if their executable is missing — never silently treated as
 * passing. See the npm test run notes in the suite12 README for exactly what
 * that produced.
 *
 * CONDITIONS (each run against every template, on every engine actually
 * available):
 *   - baseline          desktop viewport, DPR 1, no motion/contrast prefs
 *   - dpr125 / dpr150   Windows display-scaling factors (fractional DPR)
 *   - reducedMotion     prefers-reduced-motion: reduce (Windows "Animation
 *                       effects" off)
 *   - forcedColors      forced-colors: active (Windows High Contrast)
 *   - shortViewport     a shorter effective viewport standing in for a
 *                       Windows laptop's real usable area after the taskbar
 *                       and classic (non-overlay, width-consuming) scrollbars
 *                       — Chromium already renders classic, width-consuming
 *                       scrollbars in headless mode on every OS this suite
 *                       runs on (there is no macOS-overlay-scrollbar mode to
 *                       compare against locally), so this condition is the
 *                       stand-in the plan asks for: a viewport short enough
 *                       that the 100vh hero's own height shrinks with it.
 *   - windowsUA         Windows Chrome/Edge User-Agent + Sec-CH-UA-Platform,
 *                       to catch any (undiscovered) navigator.platform /
 *                       userAgentData branch — grep confirms none exists in
 *                       builder/app.js or templates/*, this is the runtime
 *                       cross-check.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-template-preview-cross-env.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const playwright = require(path.join(ROOT, 'node_modules', 'playwright'));

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Feedback-2026-09-14', 'preview');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-preview-'));
process.env.SERVER_SECRET = 'suite12-preview-' + crypto.randomBytes(8).toString('hex');
delete process.env.CALENDAR_PUBLIC_BASE_URL;
delete process.env.PUBLIC_BASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

let server;
let base;

test.before(async () => {
    require(path.join(ROOT, 'scripts', 'build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
    if (server) server.close();
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const CONDITIONS = [
    {
        name: 'baseline',
        contextOptions: { viewport: { width: 1280, height: 800 } },
    },
    {
        name: 'dpr125',
        contextOptions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.25 },
    },
    {
        name: 'dpr150',
        contextOptions: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 },
    },
    {
        name: 'reducedMotion',
        contextOptions: { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' },
    },
    {
        name: 'forcedColors',
        contextOptions: { viewport: { width: 1280, height: 800 } },
        afterPage: async (page) => { await page.emulateMedia({ forcedColors: 'active' }); },
    },
    {
        // Stand-in for a Windows laptop's real usable browser area: a 1366px-
        // class screen at 125% scale, minus taskbar, leaves well under 700px
        // of vertical room — short enough to push desserdirina's about/menu
        // section below the fold at load, which is exactly the geometry
        // accident described above.
        name: 'shortViewport',
        contextOptions: { viewport: { width: 1024, height: 620 } },
    },
    {
        name: 'windowsUA',
        contextOptions: {
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
        },
    },
];

// ---------------------------------------------------------------------------
// Engines: Chromium is bundled with node_modules/playwright and works.
// Firefox/WebKit are only used if their browser binary is actually
// installed — verified with a real launch attempt, not assumed.
// ---------------------------------------------------------------------------

async function detectEngines() {
    const candidates = [
        ['chromium', playwright.chromium],
        ['firefox', playwright.firefox],
        ['webkit', playwright.webkit],
    ];
    const engines = [];
    for (const [name, launcher] of candidates) {
        try {
            const browser = await launcher.launch({ headless: true });
            await browser.close();
            engines.push([name, launcher]);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.log(
                '[suite12] SKIPPING engine "' + name + '": ' + String(e.message || e).split('\n')[0]
            );
        }
    }
    return engines;
}

// ---------------------------------------------------------------------------
// Drive the real landing preview modal for one template under one condition.
// ---------------------------------------------------------------------------

async function openTemplatePreview(page, templateId) {
    await page.goto(base + '/app/#templates', { waitUntil: 'load' });
    const btn = page.locator('.btn-preview-tpl[data-id="' + templateId + '"]');
    await btn.waitFor({ state: 'visible', timeout: 20000 });
    await btn.click();

    // Same readiness contract builder/app.js itself waits on before treating
    // the preview as loaded (waitForInteractivePreview → iframe.dataset.previewReady).
    await page.waitForFunction(() => {
        const el = document.getElementById('preview-modal-iframe');
        return !!el && el.dataset && el.dataset.previewReady === 'true';
    }, { timeout: 20000 });

    return page.frameLocator('#preview-modal-iframe');
}

// Generic, template-agnostic "nothing meaningful is stuck invisible" sweep:
// any element with a real rendered box (non-zero width/height), not itself
// hidden (display:none/visibility:hidden — which also correctly leaves
// closed dropdowns/mobile-nav/cookie-banner-before-accept alone), must not
// have computed opacity "0" once the preview reports itself ready. Runs via
// Locator.evaluate, so `document`/`getComputedStyle` below resolve inside the
// srcdoc iframe's own document, not the outer builder page.
//
// Two deliberate exclusions, both standard "not a bug" patterns found while
// building this suite (see professionals's .pr-type radio/checkbox inputs,
// bot/test/suite12 run notes):
//   - form controls (INPUT/SELECT/TEXTAREA/OPTION): visually-hidden-but-
//     present native controls paired with a styled label is a normal
//     accessible-custom-control pattern, not stuck content.
//   - elements with no text of their own and no meaningful visual tag
//     (IMG/SVG/PICTURE/VIDEO/CANVAS): an empty decorative <span>/<div> at
//     opacity 0 carries nothing a visitor would miss.
function opacitySweep(body) {
    // Inlined (not closed-over) on purpose: Locator.evaluate serializes only
    // this function's own source via toString() and runs it inside the
    // frame's browser context — outer Node-side const bindings are not
    // reachable there.
    const HIDDEN_CONTROL_TAGS = ['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'];
    const VISUAL_TAGS = ['IMG', 'SVG', 'PICTURE', 'VIDEO', 'CANVAS'];
    const banner = body.ownerDocument.getElementById('hb-cookie-banner');
    const bad = [];
    body.querySelectorAll('*').forEach((el) => {
        if (banner && (el === banner || banner.contains(el))) return;
        if (HIDDEN_CONTROL_TAGS.indexOf(el.tagName) !== -1) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (cs.opacity !== '0') return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const text = (el.textContent || '').trim();
        if (!text && VISUAL_TAGS.indexOf(el.tagName) === -1) return;
        bad.push({ tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '', text: text.slice(0, 60) });
    });
    return bad;
}

// ---------------------------------------------------------------------------
// A pre-existing, engine/OS-agnostic defect found while building this suite,
// NOT what Suite D investigates (it reproduces identically on every engine
// and every condition below, including baseline — it is not a Mac-vs-Windows
// difference): desserdirina inlines styles.css as a <style> block for every
// srcdoc preview (editor canvas, landing modal, card thumbnail), so its
// self-hosted @font-face `url('fonts/…')` declarations resolve relative to
// the PARENT page's URL (a srcdoc document with no allow-same-origin has no
// independent base) instead of any real font route, 404ing every custom
// font and falling back to the browser default. Already flagged (without a
// fix) in bot/test/suite9-preview-sandbox.test.js's file comment: "desserdirina's
// self-hosted fonts fail CORS inside the preview because of it [the opaque
// origin], and the fix for that is CORS headers on the font route, never
// allow-same-origin." CORS headers alone would not be enough — the request
// path itself is wrong (/app/fonts/… does not exist; the files live under
// templates/desserdirina/fonts/) — the real fix is inlining the font bytes
// as data: URIs in PREVIEW MODE the same way build-builder.js already does
// for images (see builder/app.js's mergePreviewImageMap), which is a bigger,
// separately-scoped change (≈870KB of font files, base64'd, added to every
// preview render including every debounced editor re-render) that does not
// belong in this Windows-preview diagnosis. Tracked here instead of silently
// swallowed: counted separately per run and reported, never allowed to mask
// a genuinely new console error for any template.
// ---------------------------------------------------------------------------
function isKnownDesserdirinaFontNoise(text) {
    return (/blocked by CORS policy/i.test(text) && /\.woff2?/i.test(text)) ||
        text === 'Failed to load resource: net::ERR_FAILED';
}
const KNOWN_CONSOLE_NOISE = { desserdirina: isKnownDesserdirinaFontNoise };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('cross-engine/cross-condition landing preview matrix', async (t) => {
    const engines = await detectEngines();
    assert.ok(engines.length >= 1, 'at least Chromium must be launchable from node_modules/playwright');

    const ranEngineNames = engines.map(([name]) => name);
    // eslint-disable-next-line no-console
    console.log('[suite12] engines actually run: ' + ranEngineNames.join(', '));
    if (!ranEngineNames.includes('firefox') || !ranEngineNames.includes('webkit')) {
        // eslint-disable-next-line no-console
        console.log(
            '[suite12] Firefox and/or WebKit are not installed for Playwright in this ' +
            'environment — only the engines listed above were actually exercised.'
        );
    }

    const summary = [];

    for (const [engineName, launcher] of engines) {
        const browser = await launcher.launch({ headless: true });
        try {
        for (const condition of CONDITIONS) {
            for (const templateId of TEMPLATE_IDS) {
                await t.test(
                    engineName + ' / ' + condition.name + ' / ' + templateId,
                    async () => {
                        const consoleErrors = [];
                        const pageErrors = [];
                        {
                            const context = await browser.newContext(condition.contextOptions || {});
                            const page = await context.newPage();
                            page.on('console', (msg) => {
                                if (msg.type() === 'error') consoleErrors.push(msg.text());
                            });
                            page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
                            if (condition.afterPage) await condition.afterPage(page);

                            const frame = await openTemplatePreview(page, templateId);

                            // 1) Visible rendered content, not just "an iframe exists".
                            const bodyText = await frame.locator('body').innerText();
                            const normalized = bodyText.replace(/\s+/g, ' ').trim();
                            assert.ok(
                                normalized.length > 100,
                                engineName + '/' + condition.name + '/' + templateId +
                                ': preview body text is suspiciously short (' + normalized.length +
                                ' chars) — looks blank. First 200 chars: "' + normalized.slice(0, 200) + '"'
                            );

                            // 2) No content left at opacity 0 once the preview is "ready".
                            const stuck = await frame.locator('body').evaluate(opacitySweep);

                            // 2b) forced-colors (Windows High Contrast) regression lock:
                            // desserdirina's floating WhatsApp button and scroll-line used
                            // to lose all contrast under forced-colors (see the suite12
                            // README / run notes) — the button's #25D366 background and its
                            // icon's `fill: currentColor` were independently remapped to the
                            // SAME colour by the browser, and the scroll-line's gradient
                            // background was stripped outright with no solid fallback.
                            // Fixed with `forced-color-adjust: none` on the brand-colour
                            // elements (templates/desserdirina/styles.css). Assert the
                            // fix's own contract — not a browser/OS sniff, a real computed
                            // style — so removing it fails this test immediately.
                            if (condition.name === 'forcedColors' && templateId === 'desserdirina') {
                                const fcInfo = await frame.locator('body').evaluate((body) => {
                                    const wa = body.querySelector('.whatsapp-float');
                                    const waSvg = body.querySelector('.whatsapp-float svg');
                                    const line = body.querySelector('.scroll-line');
                                    return {
                                        waAdjust: wa && getComputedStyle(wa).getPropertyValue('forced-color-adjust'),
                                        waBg: wa && getComputedStyle(wa).backgroundColor,
                                        waSvgAdjust: waSvg && getComputedStyle(waSvg).getPropertyValue('forced-color-adjust'),
                                        waSvgFill: waSvg && getComputedStyle(waSvg).fill,
                                        lineAdjust: line && getComputedStyle(line).getPropertyValue('forced-color-adjust'),
                                        lineBgImage: line && getComputedStyle(line).backgroundImage,
                                    };
                                });
                                assert.equal(fcInfo.waAdjust, 'none',
                                    'DEFECT (forced-colors): .whatsapp-float lost forced-color-adjust:none — ' +
                                    'its green background and white icon would be remapped to the same colour again');
                                assert.equal(fcInfo.waBg, 'rgb(37, 211, 102)',
                                    'DEFECT (forced-colors): .whatsapp-float background is no longer its brand ' +
                                    'green (#25D366) under forced-colors — got ' + fcInfo.waBg);
                                assert.notEqual(fcInfo.waSvgFill, fcInfo.waBg,
                                    'DEFECT (forced-colors): the WhatsApp icon fill (' + fcInfo.waSvgFill +
                                    ') exactly matches its own button background (' + fcInfo.waBg +
                                    ') again — the icon would be invisible');
                                assert.ok(fcInfo.lineAdjust === 'none' && /gradient/.test(fcInfo.lineBgImage || ''),
                                    'DEFECT (forced-colors): .scroll-line lost its gradient under forced-colors ' +
                                    '(forced-color-adjust=' + fcInfo.lineAdjust + ', backgroundImage=' +
                                    fcInfo.lineBgImage + ') — the scroll cue would render as a blank gap');
                            }

                            const dir = path.join(EVIDENCE_DIR, engineName, condition.name);
                            fs.mkdirSync(dir, { recursive: true });
                            const shotPath = path.join(dir, templateId + '.png');
                            try {
                                await page.locator('#preview-modal-iframe').screenshot({ path: shotPath });
                            } catch (_) { /* best-effort screenshot */ }

                            const knownNoiseFilter = KNOWN_CONSOLE_NOISE[templateId];
                            const knownConsoleErrors = knownNoiseFilter
                                ? consoleErrors.filter(knownNoiseFilter) : [];
                            const unexpectedConsoleErrors = knownNoiseFilter
                                ? consoleErrors.filter((m) => !knownNoiseFilter(m)) : consoleErrors;

                            summary.push({
                                engine: engineName, condition: condition.name, templateId,
                                bodyChars: normalized.length, stuckCount: stuck.length,
                                consoleErrors: unexpectedConsoleErrors.length,
                                knownFontIssueCount: knownConsoleErrors.length,
                                pageErrors: pageErrors.length,
                            });

                            assert.deepEqual(
                                stuck, [],
                                engineName + '/' + condition.name + '/' + templateId +
                                ': ' + stuck.length + ' element(s) rendered with a non-zero box but ' +
                                'computed opacity 0 after the preview reported itself ready — ' +
                                'DEFECT (see suite header): ' + JSON.stringify(stuck).slice(0, 800)
                            );

                            // 3) No console/page errors, except the known pre-existing
                            // desserdirina font-CORS noise documented above (tracked in
                            // the summary, never silently dropped).
                            assert.deepEqual(
                                unexpectedConsoleErrors, [],
                                engineName + '/' + condition.name + '/' + templateId +
                                ': console errors in the preview: ' + JSON.stringify(unexpectedConsoleErrors)
                            );
                            assert.deepEqual(
                                pageErrors, [],
                                engineName + '/' + condition.name + '/' + templateId +
                                ': uncaught page errors in the preview: ' + JSON.stringify(pageErrors)
                            );

                            await context.close();
                        }
                    }
                );
            }
        }
        } finally {
            await browser.close();
        }
    }

    fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'run-summary.json'),
        JSON.stringify(summary, null, 2)
    );
});

// ---------------------------------------------------------------------------
// A second, real robustness defect found while building the matrix above —
// not reachable through the landing gallery's default preset (desserdirina's
// preset ships `services: []`, so `.service-card` never renders there), but
// real the moment a customer's own config populates `services` and opens
// the preview in the EDITOR canvas (same srcdoc mechanism, same forcer,
// same noscript re-activation as the landing modal — see
// prepareInteractivePreviewDocument/replacePreviewDocument in builder/app.js
// and the "PREVIEW MODE" steps in scripts/build-builder.js).
//
// templates/desserdirina/styles.css's `.fade-in-section .service-card`
// starts at `opacity: 0` with a plain CSS `transition`, only raised to
// opacity 1 once an IntersectionObserver adds `.visible` to its ancestor —
// no `animation` involved. The universal forcer used to only rescue
// animation-driven opacity-0 elements, and this template was also the only
// one of the five missing the `<noscript><style>…opacity:1!important…
// </style></noscript>` "visible without JS" block every sibling template
// carries (which the preview's "belt-and-suspenders" step re-activates
// unconditionally). A section below the fold at load — genuinely likely:
// desserdirina's `<header class="hero">` is exactly 100vh, so the very next
// section starts right at the fold — left its service-cards invisible
// forever inside the preview, with no scroll possible to fix it from a
// customer's point of view (they're editing, not browsing).
//
// Fixed two ways, both asserted below: (1) templates/desserdirina/
// template.html now carries the missing noscript block; (2) scripts/
// build-builder.js's forcer also rescues opacity-0 elements with an
// explicit (non-"all") `transition-property` that lists opacity, not only
// `animation`-driven ones — see that file's comment for why this is safe
// against the app's actual closed-dropdown/hidden-native-input patterns.
test('desserdirina: below-the-fold .service-card is not stuck at opacity 0 once populated', async () => {
    const browser = await playwright.chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1024, height: 620 } });
        const page = await context.newPage();
        await page.goto(base + '/app/', { waitUntil: 'load' });

        await page.evaluate(async () => {
            const tplRes = await fetch('/app/generated/templates/desserdirina.js');
            // eslint-disable-next-line no-new-func
            (new Function(await tplRes.text()))();
            const tplData = window.HIDOOK_TEMPLATE_HEAVY['desserdirina'];
            const config = JSON.parse(JSON.stringify(tplData.presets[0].config));
            // The default preset ships services: [] (see suite header) —
            // populate it the way a real customer's edited config would.
            config.services = [
                { icon: '🎂', label: 'Torturi personalizate' },
                { icon: '🥐', label: 'Patiserie fină' },
                { icon: '🍰', label: 'Prăjituri de sezon' },
            ];
            const html = window.HidookEngine.renderPreview(tplData.files, config);

            const iframe = document.createElement('iframe');
            iframe.id = 'suite12-services-iframe';
            iframe.sandbox = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
            iframe.style.cssText = 'position:fixed;top:0;left:0;width:1024px;height:620px;border:0;';
            document.body.appendChild(iframe);

            const readyToken = 'suite12-services-ready-' + Date.now();
            const readyScript = '<script>(function(){function send(){try{parent.postMessage({type:"suite12-services-ready",token:"' +
                readyToken + '"},"*");}catch(e){}}function arm(){var n=0;var t=setInterval(function(){' +
                'if(document.documentElement.getAttribute("data-hb-forcer-done")==="1"||n>80){clearInterval(t);send();}n++;},25);}' +
                'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",arm);else arm();})();</scr' + 'ipt>';
            const withReady = html.replace(/<\/body>/i, readyScript.replace('</scr' + 'ipt>', '</script>') + '</body>');

            window.__suite12ServicesReady = new Promise((resolve) => {
                window.addEventListener('message', function onMsg(ev) {
                    if (ev.data && ev.data.type === 'suite12-services-ready' && ev.data.token === readyToken) {
                        window.removeEventListener('message', onMsg);
                        resolve();
                    }
                });
            });
            iframe.srcdoc = withReady;
        });
        await page.evaluate(() => window.__suite12ServicesReady);
        await page.waitForTimeout(300);

        const frame = page.frameLocator('#suite12-services-iframe');
        const info = await frame.locator('body').evaluate((body) => {
            const about = body.querySelector('.about-card');
            const cards = Array.from(body.querySelectorAll('.service-card'));
            return {
                aboutTop: about ? about.getBoundingClientRect().top : null,
                innerHeight: window.innerHeight,
                cardsCount: cards.length,
                cardsOpacity: cards.map((c) => getComputedStyle(c).opacity),
            };
        });

        assert.ok(info.cardsCount > 0, 'expected .service-card items to render once services is populated');
        // Confirms this genuinely exercises the below-the-fold path, not a
        // scenario where the section already happened to be visible on load.
        assert.ok(info.aboutTop >= info.innerHeight,
            'test setup assumption broke: .about-card (top=' + info.aboutTop + ') is no longer below ' +
            'the fold (innerHeight=' + info.innerHeight + ') — this no longer exercises the bug');
        for (const opacity of info.cardsOpacity) {
            assert.notEqual(opacity, '0',
                'DEFECT: a .service-card is stuck at opacity 0 below the fold — ' +
                JSON.stringify(info.cardsOpacity));
        }

        await context.close();
    } finally {
        await browser.close();
    }
});
