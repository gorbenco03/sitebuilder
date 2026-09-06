'use strict';
/**
 * bot/test/wave8-legal-link-targets.test.js
 *
 * The footer legal links must meet WCAG 2.5.8's 24x24 CSS px target size on
 * EVERY template, measured on the rendered page rather than read off the CSS.
 *
 * The original audit reported this. The fix was then written into a single
 * template's own stylesheet, so one template passed and four kept shipping
 * ~20px targets for months. The markup is generated centrally by
 * bot/site-legal.js, so the rule belongs there — and this oracle checks all
 * five, because a per-template fix is exactly how the first attempt went wrong.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-legal-link-targets.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
const MIN = 24;

function buildSite(tpl, dir) {
    const cfg = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')
    ).presets[0].config;
    siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });
}

test('footer legal links meet the 24px target on every template', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    try {
        for (const tpl of TEMPLATES) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legaltarget-'));
            try {
                buildSite(tpl, dir);
                const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
                await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                await page.waitForTimeout(300);

                const measured = await page.evaluate(() => {
                    return [...document.querySelectorAll('.hb-legal-links a')].map((a) => {
                        const r = a.getBoundingClientRect();
                        return { text: (a.textContent || '').trim().slice(0, 24), w: r.width, h: r.height };
                    });
                });
                await page.close();

                assert.ok(measured.length > 0, tpl + ': expected footer legal links to exist');
                for (const m of measured) {
                    if (m.h < MIN) {
                        failures.push(`${tpl}: "${m.text}" is ${m.h.toFixed(1)}px tall, needs >= ${MIN}`);
                    }
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(failures, [], 'targets below the WCAG minimum:\n' + failures.join('\n'));
});

test('the rule lives in the shared component, not in one template stylesheet', () => {
    // Guards against the shape of the original mistake: fixing this per
    // template means the next template added starts out failing again.
    const shared = fs.readFileSync(path.join(ROOT, 'bot', 'site-legal.js'), 'utf8');
    const start = shared.indexOf('.hb-legal-links a {');
    assert.notStrictEqual(start, -1, 'the shared legal-links rule must exist');
    const block = shared.slice(start, shared.indexOf('}', start));
    assert.match(block, /min-height:\s*24px/,
        'bot/site-legal.js must carry the target-size rule for every template');
});
