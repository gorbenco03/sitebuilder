#!/usr/bin/env node
'use strict';
/**
 * scripts/suite10-ig-teaser-evidence.js — visual evidence for the Instagram
 * teaser: screenshots the REAL builder-preview render (same
 * builder/generated/engine.js renderPreview() bundle builder/app.js uses,
 * via bot/test/lib/suite10-real-preview.js — see that file for why the real
 * bundle is used instead of a hand-simulated reveal) for all five
 * templates, at rest and revealed, at 390px and 1280px.
 *
 * Reveal is a real Playwright click on `.hb-ig-teaser__badge`, exactly the
 * interaction builder/edit-overlay.js's click handler expects (see
 * revealIgTeaser() there). Also records console errors and horizontal
 * scroll per shot, same checks bot/test/suite7-template-contract.test.js
 * makes for the rest of each template.
 *
 * Run: node scripts/suite10-ig-teaser-evidence.js
 * (requires `npm run build:app` to have produced a fresh
 * builder/generated/engine.js — this script rebuilds it itself, first.)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence', 'Instagram-Teaser');
fs.mkdirSync(OUT, { recursive: true });

// Rebuild the engine so this always reflects the templates/build.js/
// edit-overlay.js currently on disk (the bundle is gitignored, not checked in).
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-builder.js')], { stdio: 'inherit' });

const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { materializePreviewSite } = require(path.join(ROOT, 'bot', 'test', 'lib', 'suite10-real-preview.js'));

const TEMPLATES = ['product-menu', 'portfolio', 'local-service', 'professionals', 'desserdirina'];
const VIEWPORTS = [
    { name: '390w', width: 390, height: 844 },
    { name: '1280w', width: 1280, height: 900 },
];

async function shootOne(browser, tpl, vp) {
    const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')).presets[0].config;
    const dir = materializePreviewSite(tpl, preset);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + String(err && err.message || err)));

    const result = { tpl, vp: vp.name, restScroll: null, revealedScroll: null, consoleErrors: null, revealedOk: null, ctaClickable: null };
    try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(200);

        const section = page.locator('[data-hb-ig-teaser]').first();
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);

        // AT REST
        result.restScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        await page.screenshot({ path: path.join(OUT, `${tpl}-${vp.name}-01-rest.png`) });

        // REVEAL
        const badge = page.locator('.hb-ig-teaser__badge').first();
        await badge.click();
        result.revealedOk = await page.evaluate(
            () => !!document.querySelector('.hb-ig-teaser.is-revealed .hb-ig-teaser__veil:not([hidden])')
        );
        const ctaLocator = page.locator('[data-hb-ig-connect]').first();
        try {
            await ctaLocator.click({ trial: true, timeout: 2000 });
            result.ctaClickable = true;
        } catch (e) {
            result.ctaClickable = false;
        }
        await section.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        result.revealedScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        await page.screenshot({ path: path.join(OUT, `${tpl}-${vp.name}-02-revealed.png`) });

        result.consoleErrors = consoleErrors.slice();
    } finally {
        await context.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return result;
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const results = [];
    try {
        for (const tpl of TEMPLATES) {
            for (const vp of VIEWPORTS) {
                const r = await shootOne(browser, tpl, vp);
                results.push(r);
                console.log(
                    `${tpl} @ ${vp.name}: rest-hscroll=${r.restScroll} revealed=${r.revealedOk} ` +
                    `revealed-hscroll=${r.revealedScroll} cta-clickable=${r.ctaClickable} ` +
                    `console-errors=${r.consoleErrors.length}`
                );
                if (r.consoleErrors.length) {
                    for (const e of r.consoleErrors) console.log('    console error:', e);
                }
            }
        }
    } finally {
        await browser.close();
    }
    fs.writeFileSync(path.join(OUT, 'capture-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
    const anyHscroll = results.some((r) => r.restScroll || r.revealedScroll);
    const anyConsoleError = results.some((r) => r.consoleErrors.length > 0);
    const anyNotRevealed = results.some((r) => !r.revealedOk);
    const anyNotClickable = results.some((r) => !r.ctaClickable);
    console.log('\nSummary: horizontal scroll=' + anyHscroll + ', console errors=' + anyConsoleError +
        ', reveal failed anywhere=' + anyNotRevealed + ', CTA unclickable anywhere=' + anyNotClickable);
})();
