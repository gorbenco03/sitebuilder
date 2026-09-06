'use strict';
/**
 * bot/test/waveB-hero-contrast-any-photo.test.js
 *
 * Hero headline contrast must survive the photograph the OWNER uploads, not
 * just the one the template ships with.
 *
 * Three of the five templates put white display text straight onto a
 * background photo and rely on a gradient wash to keep it readable. A wash
 * tuned against a stock photo is not a contrast guarantee — it is a bet on
 * that photo. Measured on rendered pixels before this oracle existed:
 *
 *   portfolio      seed photo  1.94:1 at p10, 1.55:1 worst   (FAILS on its own art)
 *   portfolio      light photo 1.40:1
 *   local-service  seed photo 10.08:1                        (passes)
 *   local-service  light photo 1.84:1                        (FAILS once replaced)
 *
 * against the 3:1 WCAG 1.4.3 floor for large text. portfolio was failing on
 * the photograph in its own repository, through two audits and a contrast
 * oracle that sampled a different, darker part of the same hero.
 *
 * professionals is included as a positive control: it solves the same problem
 * structurally with .pr-hero__card and should be far above the bar in both
 * conditions, which is what makes a failure here meaningful rather than a
 * threshold that happens to be set where the current CSS lands.
 *
 * Method: render the template, hide the headline glyphs, screenshot exactly
 * the box they occupied, and compute the contrast of the declared text colour
 * against every background pixel behind it. The 10th percentile is the
 * assertion (a handful of antialiased edge pixels should not fail a build);
 * the worst pixel is reported. Then force the hero photo to white — the worst
 * case an owner can produce with a real photo — and measure again.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-hero-contrast-any-photo.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

// [templateId, [every hero text selector, not just the headline], hero photo layer]
// The lede matters as much as the headline and has a STRICTER bar: at under
// 24px it is normal text, so WCAG asks 4.5:1 rather than 3:1. A hierarchy pass
// that shrinks a tagline from display size to lede size therefore raises the
// bar it has to clear, which is exactly the kind of change that quietly
// regresses contrast if nothing measures it.
const CASES = [
    ['portfolio', ['.pf-hero__word', '.pf-hero__tag'], '.pf-hero__bg'],
    ['local-service', ['.ls-hero__name, .ls-hero__tag', '.ls-hero__tag'], '.ls-hero__media'],
    ['professionals', ['.pr-display', '.pr-lede'], '.pr-hero__bg'],
    // Added after the final evidence run put desserdirina's wordmark at 3.24:1
    // — over its 3:1 large-text bar, but by a margin thin enough that nobody
    // should have to find out about it from a screenshot. Covering all five
    // means the two that were left out are no longer the two nobody measures.
    ['desserdirina', ['.hero-wordmark', '.hero-tagline'], '.hero-background'],
    ['product-menu', ['.pm-hero__tag', '.pm-kicker'], '.pm-hero__frame'],
];

const PERCENTILE = 0.10;

function relLum(c) {
    const f = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

async function measure(page, textSel) {
    const info = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        el.dataset.hbPrevVis = el.style.visibility;
        el.style.visibility = 'hidden';
        return {
            rect: { x: r.x, y: r.y, w: r.width, h: r.height },
            fg: cs.color,
            fontPx: parseFloat(cs.fontSize),
            weight: parseInt(cs.fontWeight, 10) || 400,
        };
    }, textSel);
    if (!info) return null;

    const vp = page.viewportSize();
    const clip = {
        x: Math.max(0, info.rect.x),
        y: Math.max(0, info.rect.y),
        width: Math.max(8, Math.min(vp.width - Math.max(0, info.rect.x), info.rect.w)),
        height: Math.max(8, Math.min(vp.height - Math.max(0, info.rect.y), info.rect.h)),
    };
    const shot = await page.screenshot({ clip });
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.style.visibility = el.dataset.hbPrevVis || '';
    }, textSel);

    const pixels = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
        const out = [];
        for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
        return out;
    }, shot.toString('base64'));

    const fg = info.fg.match(/[\d.]+/g).map(Number).slice(0, 3);
    const lf = relLum(fg);
    const ratios = pixels
        .map((c) => {
            const lb = relLum(c);
            return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
        })
        .sort((a, b) => a - b);

    // WCAG 1.4.3: large text is >=24px, or >=18.66px when bold.
    const bar = info.fontPx >= 24 || (info.fontPx >= 18.66 && info.weight >= 700) ? 3.0 : 4.5;
    return {
        bar,
        worst: ratios[0],
        p10: ratios[Math.floor(ratios.length * PERCENTILE)],
        fontPx: info.fontPx,
    };
}

test('hero headlines clear WCAG AA over the seed photo AND over a light one', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    const report = [];
    try {
        for (const [tpl, textSels, bgSel] of CASES) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-ct-'));
            try {
                const cfg = JSON.parse(
                    fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')
                ).presets[0].config;
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

                const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
                await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                await page.waitForTimeout(700);
                // The consent card is measured by its own oracles; keep it out of these pixels.
                await page.evaluate(() => {
                    const c = document.getElementById('hb-cookie-banner');
                    if (c) c.style.display = 'none';
                });

                for (const condition of ['seed photo', 'light photo']) {
                    if (condition === 'light photo') {
                        const applied = await page.evaluate((sel) => {
                            const els = document.querySelectorAll(sel);
                            els.forEach((e) => {
                                e.style.setProperty('background', '#ffffff', 'important');
                                e.style.setProperty('background-image', 'none', 'important');
                            });
                            return els.length;
                        }, bgSel);
                        assert.ok(
                            applied > 0,
                            `${tpl}: hero photo layer "${bgSel}" not found — this oracle would silently measure the seed photo twice`
                        );
                        await page.waitForTimeout(250);
                    }
                    for (const textSel of textSels) {
                        const m = await measure(page, textSel);
                        assert.ok(m, `${tpl}: hero text "${textSel}" not found`);
                        report.push(
                            `${tpl} / ${condition} / ${textSel}: p10 ${m.p10.toFixed(2)}:1, ` +
                            `worst ${m.worst.toFixed(2)}:1 (bar ${m.bar}:1, ${Math.round(m.fontPx)}px)`
                        );
                        if (m.p10 < m.bar) {
                            failures.push(
                                `${tpl} "${textSel}" over a ${condition}: contrast is ${m.p10.toFixed(2)}:1 at ` +
                                `the 10th percentile (worst pixel ${m.worst.toFixed(2)}:1), under the ${m.bar}:1 ` +
                                `WCAG AA floor for ${Math.round(m.fontPx)}px text`
                            );
                        }
                    }
                }
                await page.close();
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    } finally {
        await browser.close();
    }
    report.forEach((r) => console.log('  ' + r));
    assert.deepStrictEqual(failures, [], 'hero contrast failures:\n' + failures.join('\n'));
});
