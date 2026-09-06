'use strict';
/**
 * bot/test/waveB-consent-never-covers-copy.test.js
 *
 * The consent card must not sit on top of first-screen copy — at every
 * viewport the product actually meets, not only the two an earlier oracle
 * happened to pick.
 *
 * advocate-eed3ca0-repair tests 1440x1000 and 390x844 inside the editor's
 * preview iframe. An adversarial audit widened the matrix and found two things
 * it could not see:
 *
 *   professionals @720x450   hero meta strip 16px under the card
 *   local-service @720x450   hero tagline 7px under the card
 *   portfolio    @1440x900   "EXPLOREAZĂ" 21px under the card, on a plain desktop
 *
 * 720x450 is not exotic: it is the CSS-pixel viewport a 1440x900 laptop reports
 * at 200% browser zoom, which is a setting people who need it actually use.
 * The professionals case was a width-scoped media query meeting a problem that
 * was about height.
 *
 * Two things this measures differently from its predecessor, both learned the
 * hard way while fixing the above:
 *
 *   - It compares RENDERED TEXT, via a Range over each element's contents, not
 *     element boxes. .pf-hint is a full-width button with a large left padding:
 *     its box spans the viewport and always "overlaps" the card, while its
 *     glyphs sit 24px clear of it. Comparing boxes reports a defect no visitor
 *     can see, and then you go and fix the wrong thing.
 *   - It runs against the static export, so it measures what a visitor loads
 *     rather than what the editor canvas happens to render.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-consent-never-covers-copy.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');

const VIEWPORTS = [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 720, height: 450, label: '200% zoom on a 1440x900 laptop' },
    { width: 390, height: 844, label: 'phone' },
    { width: 1024, height: 640, label: 'small laptop' },
];

// First-screen copy and cues, across all five templates. A selector that
// matches nothing on a given template simply contributes nothing.
const FIRST_SCREEN = [
    '.pr-display', '.pr-lede', '.pr-hero__meta', '.pr-scroll',
    '.pf-hero__word', '.pf-hero__tag', '.pf-hint',
    '.ls-hero__name', '.ls-hero__tag', '.ls-scroll',
    '.pm-hero__tag', '.pm-kicker', '.pm-scroll',
    '.hero-wordmark', '.hero-tagline', '.scroll-indicator',
].join(',');

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')));
}

test('the consent card never covers first-screen copy, at any viewport', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    let measured = 0;
    try {
        for (const tpl of templates()) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-cover-'));
            try {
                const cfg = JSON.parse(
                    fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
                ).presets[0].config;
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

                for (const vp of VIEWPORTS) {
                    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
                    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                    await page.waitForTimeout(800);
                    const out = await page.evaluate((sel) => {
                        const banner = document.getElementById('hb-cookie-banner');
                        if (!banner || banner.hidden) return { noBanner: true };
                        const b = banner.getBoundingClientRect();
                        if (b.width < 4 || b.height < 4) return { noBanner: true };
                        const hits = [];
                        for (const el of document.querySelectorAll(sel)) {
                            const cs = getComputedStyle(el);
                            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
                            if (banner.contains(el)) continue;
                            // Rendered text, not the element box.
                            const range = document.createRange();
                            range.selectNodeContents(el);
                            const tr = range.getBoundingClientRect();
                            const r = (tr.width > 2 && tr.height > 2) ? tr : el.getBoundingClientRect();
                            if (r.width < 4 || r.height < 4) continue;
                            if (r.bottom < 0 || r.top > window.innerHeight + 4) continue;
                            const ix = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
                            const iy = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
                            if (ix > 2 && iy > 2) {
                                hits.push({
                                    cls: String(el.className || '').slice(0, 30),
                                    text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
                                    overlap: Math.round(ix) + 'x' + Math.round(iy),
                                });
                            }
                        }
                        return { hits, banner: { y: Math.round(b.y), h: Math.round(b.height) } };
                    }, FIRST_SCREEN);
                    await page.close();

                    assert.ok(
                        !out.noBanner,
                        `${tpl} @${vp.width}x${vp.height}: the consent card is not rendered, so this ` +
                        `viewport would pass by measuring nothing`
                    );
                    measured++;
                    for (const h of out.hits) {
                        failures.push(
                            `${tpl} @${vp.width}x${vp.height} (${vp.label}): the consent card covers ` +
                            `.${h.cls} "${h.text}" by ${h.overlap}px`
                        );
                    }
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    } finally {
        await browser.close();
    }
    assert.strictEqual(measured, templates().length * VIEWPORTS.length,
        'every template/viewport pair must have been measured');
    assert.deepStrictEqual(failures, [], 'consent card covering copy:\n' + failures.join('\n'));
});
