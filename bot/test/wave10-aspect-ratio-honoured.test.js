'use strict';
/**
 * bot/test/wave10-aspect-ratio-honoured.test.js
 *
 * A declared `aspect-ratio` on a template image must actually govern the
 * rendered box.
 *
 * It silently did not. build.js bakes real width/height HTML attributes onto
 * every image from its source pixels — a deliberate CLS fix — and an explicit
 * height attribute satisfies the box before `aspect-ratio` is ever consulted.
 * So the ratio was ignored and the photo rendered at its full source height.
 *
 * On local-service, the template that scored 9/10 from an independent
 * auditor, that meant gallery photos rendered 322x960 instead of 322x201:
 * a 1004px-tall container cropped to a sliver of blank wall, on the section
 * meant to show a tradesman's finished work. Nothing errored, CLS stayed at 0,
 * every oracle passed, and two audits looked straight at it.
 *
 * This checks the RESULT — what a visitor's browser computes — rather than the
 * presence of a CSS property, because the property was present the whole time.
 *
 * Run: node --experimental-sqlite --test bot/test/wave10-aspect-ratio-honoured.test.js
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
const TOLERANCE_PX = 3;

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')) &&
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'template.html')));
}

test('every image with an aspect-ratio renders at that ratio', async () => {
    const browser = await chromium.launch({ headless: true });
    const violations = [];
    try {
        for (const tpl of templates()) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-check-'));
            try {
                const cfg = JSON.parse(
                    fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
                ).presets[0].config;
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

                const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
                await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                await page.waitForTimeout(600);

                const bad = await page.evaluate((tol) => {
                    const out = [];
                    for (const img of document.querySelectorAll('img')) {
                        const cs = getComputedStyle(img);
                        const ratio = cs.aspectRatio;
                        if (!ratio || ratio === 'auto') continue;
                        const r = img.getBoundingClientRect();
                        // Ignore images that are not laid out (hidden nav, etc).
                        if (r.width < 20 || r.height < 5) continue;
                        const parts = ratio.split('/').map((n) => parseFloat(n));
                        if (parts.length !== 2 || !parts[1]) continue;
                        const expected = r.width / (parts[0] / parts[1]);
                        if (Math.abs(expected - r.height) > tol) {
                            out.push({
                                cls: img.className || '(no class)',
                                ratio,
                                rendered: Math.round(r.width) + 'x' + Math.round(r.height),
                                expectedHeight: Math.round(expected),
                            });
                        }
                    }
                    return out;
                }, TOLERANCE_PX);
                await page.close();

                for (const b of bad) {
                    violations.push(
                        `${tpl}: .${b.cls} declares ${b.ratio} but renders ${b.rendered} ` +
                        `(the ratio wants height ${b.expectedHeight}) — a baked height attribute is winning; ` +
                        `add "height: auto" beside the aspect-ratio`
                    );
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(violations, [], 'aspect-ratio declared but not honoured:\n' + violations.join('\n'));
});
