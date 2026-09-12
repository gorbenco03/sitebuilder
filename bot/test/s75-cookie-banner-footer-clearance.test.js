'use strict';
/**
 * bot/test/s75-cookie-banner-footer-clearance.test.js
 *
 * S7-5 / m11 — before the visitor accepts cookies, the fixed bottom-left
 * consent card must not sit on top of a link in the page's own `<footer>`
 * (social icons, legal pages, "Build by…").
 *
 * QA exploration measured this concretely on desserdirina at 390x844,
 * scrolled to the bottom, before accepting: `#hb-cookie-banner` occupies
 * left:8->right:296, top:722->bottom:836 while the Instagram/Facebook links
 * sit at left:147-243, top:772-812 — entirely inside the banner's box. The
 * banner is `position: fixed`, so once the page is scrolled to its end the
 * footer is exactly what the card can land on top of.
 *
 * `bot/site-legal.js`'s COOKIE_BANNER_CSS already reserved clearance
 * (`--hb-cookie-clearance`) for several per-template hero/scroll-cue classes
 * while the banner is open, but never for the one element every one of the
 * five templates ships: a plain `<footer>`. This is why the task calls the
 * fix out as shared rather than desserdirina-specific — this oracle checks
 * all 5 templates for exactly that reason, even though only site-legal.js is
 * touched to fix it.
 *
 * Measures the real rendered boxes of a static-exported page
 * (`buildStaticSiteTree`) at 390x844, before any click on the accept button
 * (fresh localStorage/cookies, matching a first-time visitor) — not CSS
 * declarations.
 *
 * Run: node --experimental-sqlite --test bot/test/s75-cookie-banner-footer-clearance.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const VIEWPORT = { width: 390, height: 844 };

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')));
}

test('the cookie consent card never covers a footer link, before acceptance, on any template', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    let measured = 0;
    try {
        for (const tpl of templates()) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's75-cookie-footer-'));
            try {
                const cfg = JSON.parse(
                    fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
                ).presets[0].config;
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

                const page = await browser.newPage({ viewport: VIEWPORT });
                await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                await page.waitForTimeout(500);
                // A visitor reading down to the footer before deciding on cookies.
                await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
                await page.waitForTimeout(300);

                const out = await page.evaluate(() => {
                    const banner = document.getElementById('hb-cookie-banner');
                    if (!banner || banner.hidden) return { noBanner: true };
                    const b = banner.getBoundingClientRect();
                    if (b.width < 4 || b.height < 4) return { noBanner: true };
                    const footer = document.querySelector('footer');
                    if (!footer) return { noFooter: true };
                    const hits = [];
                    for (const a of footer.querySelectorAll('a')) {
                        const cs = getComputedStyle(a);
                        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
                        const r = a.getBoundingClientRect();
                        if (r.width < 4 || r.height < 4) continue;
                        const ix = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
                        const iy = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
                        if (ix > 2 && iy > 2) {
                            hits.push({
                                href: a.getAttribute('href'),
                                rect: { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), right: Math.round(r.right) },
                                overlap: Math.round(ix) + 'x' + Math.round(iy),
                            });
                        }
                    }
                    return {
                        hits,
                        banner: { top: Math.round(b.top), left: Math.round(b.left), bottom: Math.round(b.bottom), right: Math.round(b.right) },
                    };
                });
                await page.close();

                assert.ok(!out.noFooter, `${tpl}: template has no <footer> element — cannot measure`);
                assert.ok(!out.noBanner, `${tpl}: cookie banner did not render before acceptance — cannot measure`);
                measured++;
                for (const h of out.hits) {
                    failures.push(
                        `${tpl} @390x844: cookie banner ${JSON.stringify(out.banner)} covers footer link ` +
                        `href="${h.href}" at ${JSON.stringify(h.rect)} (overlap ${h.overlap})`
                    );
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    } finally {
        await browser.close();
    }
    assert.strictEqual(measured, templates().length, 'every template must have been measured');
    assert.deepStrictEqual(failures, [], 'cookie banner covering footer links:\n' + failures.join('\n'));
});
