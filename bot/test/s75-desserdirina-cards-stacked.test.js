'use strict';
/**
 * bot/test/s75-desserdirina-cards-stacked.test.js
 *
 * S7-5 / M10 — the "About us" / "Order now" cards must stack vertically
 * (About first, then Order) at ANY viewport width, not only below 992px.
 *
 * `.content-wrapper` used to put `.about-card` and `.contact-card` on a
 * 2-column CSS grid with `align-items: stretch` at >=992px
 * (templates/desserdirina/styles.css). Stretch forces both cards to the
 * height of the taller one — harmless when both cards happen to hold similar
 * amounts of copy, but the client's own explicit request was to stack them
 * because "About us" has an add-section option and can grow arbitrarily tall
 * vertically, and a grid row can only be as short as its tallest cell.
 * Measured on the QA exploration pass: with the stock preset copy the two
 * cards already tied at an equal, taller-than-needed height at 1440px;
 * inflating `business.about` 6x (303 -> 1818 chars, a realistic amount of
 * copy for a business that also lists services/menu inside the same card)
 * forced both cards to an identical 1665px, leaving roughly 1100px of blank
 * pink card underneath the "Order now" card's actual (much shorter) content.
 *
 * This measures the real rendered boxes of a static-exported page
 * (`buildStaticSiteTree`, the same function used for `/live/<slug>/` and the
 * ZIP export) — not CSS declarations — at 1440/992/768/390px, with both the
 * stock preset and the 6x-inflated "About" copy from the QA report.
 *
 * Run: node --experimental-sqlite --test bot/test/s75-desserdirina-cards-stacked.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const WIDTHS = [1440, 992, 768, 390];

function baseConfig() {
    return JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'presets.json'), 'utf8')
    ).presets[0].config;
}

function longAboutConfig() {
    const cfg = JSON.parse(JSON.stringify(baseConfig()));
    // Same technique as the QA exploration pass: repeat the real preset copy
    // 6x rather than inventing lorem ipsum, so the measurement reflects an
    // actual (if verbose) business description, not synthetic filler.
    cfg.business.about = cfg.business.about.repeat(6);
    return cfg;
}

async function measure(dir, width) {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(300);
        const out = await page.evaluate(() => {
            const about = document.querySelector('.about-card').getBoundingClientRect();
            const contact = document.querySelector('.contact-card').getBoundingClientRect();
            return {
                about: { top: about.top, bottom: about.bottom, height: about.height },
                contact: { top: contact.top, bottom: contact.bottom, height: contact.height },
            };
        });
        await page.close();
        return out;
    } finally {
        await browser.close();
    }
}

async function buildAndMeasure(config, width) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's75-stacked-'));
    try {
        siteExport.buildStaticSiteTree({ templateId: 'desserdirina', config, images: [], siteDir: dir });
        return await measure(dir, width);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('about-card and contact-card stack vertically (About first) at every width, stock preset', async () => {
    const cfg = baseConfig();
    const failures = [];
    for (const width of WIDTHS) {
        const { about, contact } = await buildAndMeasure(cfg, width);
        if (!(about.bottom <= contact.top + 2)) {
            failures.push(
                `width=${width}: about-card (top=${about.top.toFixed(1)} bottom=${about.bottom.toFixed(1)}) ` +
                `is not fully above contact-card (top=${contact.top.toFixed(1)} bottom=${contact.bottom.toFixed(1)}) — ` +
                `they overlap/sit side by side instead of stacking`
            );
        }
    }
    assert.deepStrictEqual(failures, [], 'cards not stacked (stock preset):\n' + failures.join('\n'));
});

test('about-card and contact-card stack vertically at every width, 6x-inflated About copy', async () => {
    const cfg = longAboutConfig();
    const failures = [];
    for (const width of WIDTHS) {
        const { about, contact } = await buildAndMeasure(cfg, width);
        if (!(about.bottom <= contact.top + 2)) {
            failures.push(
                `width=${width}: about-card (bottom=${about.bottom.toFixed(1)}) overlaps contact-card ` +
                `(top=${contact.top.toFixed(1)}) with a 6x-inflated About text`
            );
        }
    }
    assert.deepStrictEqual(failures, [], 'cards not stacked (long About):\n' + failures.join('\n'));
});

test('contact-card height is driven by its own content, not stretched to match a long about-card', async () => {
    const cfg = longAboutConfig();
    const failures = [];
    for (const width of WIDTHS) {
        const { about, contact } = await buildAndMeasure(cfg, width);
        // Once stacked, a grid row per card means each card's height comes
        // from its own content. If contact-card is still forced as tall as
        // about-card (the `align-items: stretch` bug), the two heights come
        // out equal — the exact 1665.09px-both symptom from the QA report.
        if (!(contact.height < about.height * 0.6)) {
            failures.push(
                `width=${width}: contact-card height ${contact.height.toFixed(1)}px is not meaningfully ` +
                `smaller than about-card height ${about.height.toFixed(1)}px — contact-card looks stretched ` +
                `to match, leaving blank space under its real content`
            );
        }
    }
    assert.deepStrictEqual(failures, [], 'contact-card stretched to about-card height:\n' + failures.join('\n'));
});
