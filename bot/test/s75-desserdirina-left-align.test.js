'use strict';
/**
 * bot/test/s75-desserdirina-left-align.test.js
 *
 * S7-5 / D3 — the client's explicit complaint: "nu arată bine deloc dacă
 * lăsăm centrat scrisul" (centered text does not look good at all). The QA
 * exploration pass confirmed, as a fact, that the hero `<h1>`/tagline and the
 * ENTIRE footer (address, copyright, legal links, "Build by…", the
 * Instagram/Facebook icons) are centered — on a wide screen this leaves
 * uneven true margins from the viewport edges even though the text itself is
 * centered inside its own box, which reads as the copy "floating" in the
 * middle of the page.
 *
 * Decision (none was mandated by the plan beyond ">=992px"): keep mobile
 * centered — a narrow viewport does not have the "floating in a wide empty
 * page" problem the client is describing, and centering reads fine there —
 * and left-align the hero copy and the footer's text column at >=992px. This
 * is the smallest, fully reversible change that satisfies the client's
 * literal complaint. The alternative considered (indent the CENTERED block
 * to the left rather than left-aligning per-glyph) was skipped because it
 * would still leave the visual "block floating in the middle of a bigger
 * block" effect the client already flagged in the footer, just moved over —
 * left-aligning the text itself is the more direct fix for "centered text
 * doesn't look good."
 *
 * This measures REAL rendered boxes — the hero-content container's left/right
 * gap from the viewport edges, and how far the address paragraph sits in from
 * its own container's left edge — plus the resulting computed `text-align`,
 * not just the CSS declaration in the stylesheet, on a static-exported page
 * (`buildStaticSiteTree`), the same function that serves `/live/<slug>/`.
 *
 * Run: node --experimental-sqlite --test bot/test/s75-desserdirina-left-align.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const DESKTOP_WIDTHS = [1440, 992];
const MOBILE_WIDTHS = [768, 390];

function config() {
    return JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'presets.json'), 'utf8')
    ).presets[0].config;
}

let siteDir;

test.before(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 's75-leftalign-'));
    siteExport.buildStaticSiteTree({ templateId: 'desserdirina', config: config(), images: [], siteDir });
});

test.after(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
});

async function measure(width) {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto('file://' + path.join(siteDir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(300);
        const out = await page.evaluate(() => {
            const hero = document.querySelector('.hero-content').getBoundingClientRect();
            const tagline = document.querySelector('.hero-tagline');
            const taglineAlign = getComputedStyle(tagline).textAlign;
            const footerInfo = document.querySelector('.footer-info').getBoundingClientRect();
            const footerInfoAlign = getComputedStyle(document.querySelector('.footer-info')).textAlign;
            const address = document.querySelector('.footer-address').getBoundingClientRect();
            return {
                vw: window.innerWidth,
                heroLeft: hero.left,
                heroRight: hero.right,
                taglineAlign,
                footerInfoLeft: footerInfo.left,
                footerInfoAlign,
                addressLeft: address.left,
            };
        });
        await page.close();
        return out;
    } finally {
        await browser.close();
    }
}

test('hero copy is left-anchored at >=992px (not centered on the page)', async () => {
    const failures = [];
    for (const width of DESKTOP_WIDTHS) {
        const m = await measure(width);
        const leftGap = m.heroLeft;
        const rightGap = m.vw - m.heroRight;
        if (!(leftGap < rightGap - 150)) {
            failures.push(
                `width=${width}: hero-content leftGap=${leftGap.toFixed(1)} rightGap=${rightGap.toFixed(1)} — ` +
                `still centered (symmetric margins) instead of anchored left`
            );
        }
        if (m.taglineAlign !== 'left') {
            failures.push(`width=${width}: .hero-tagline computed text-align is "${m.taglineAlign}", expected "left"`);
        }
    }
    assert.deepStrictEqual(failures, [], failures.join('\n'));
});

test('hero copy stays centered on mobile (<992px) — deliberate, unchanged', async () => {
    const failures = [];
    for (const width of MOBILE_WIDTHS) {
        const m = await measure(width);
        const leftGap = m.heroLeft;
        const rightGap = m.vw - m.heroRight;
        if (!(Math.abs(leftGap - rightGap) < 20)) {
            failures.push(`width=${width}: hero-content leftGap=${leftGap.toFixed(1)} rightGap=${rightGap.toFixed(1)} — expected still centered`);
        }
    }
    assert.deepStrictEqual(failures, [], failures.join('\n'));
});

test('footer text column is left-anchored at >=992px (not floating centered)', async () => {
    const failures = [];
    for (const width of DESKTOP_WIDTHS) {
        const m = await measure(width);
        const offset = m.addressLeft - m.footerInfoLeft;
        if (!(offset < 30)) {
            failures.push(
                `width=${width}: .footer-address sits ${offset.toFixed(1)}px in from .footer-info's own left ` +
                `edge — still centered inside its box instead of flush left`
            );
        }
        if (m.footerInfoAlign !== 'left') {
            failures.push(`width=${width}: .footer-info computed text-align is "${m.footerInfoAlign}", expected "left"`);
        }
    }
    assert.deepStrictEqual(failures, [], failures.join('\n'));
});

test('footer text column stays centered on mobile (<992px) — deliberate, unchanged', async () => {
    const failures = [];
    for (const width of MOBILE_WIDTHS) {
        const m = await measure(width);
        if (m.footerInfoAlign !== 'center') {
            failures.push(`width=${width}: .footer-info computed text-align is "${m.footerInfoAlign}", expected still "center"`);
        }
    }
    assert.deepStrictEqual(failures, [], failures.join('\n'));
});
