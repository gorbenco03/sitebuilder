'use strict';
/**
 * bot/test/waveB-hero-photo-fills-frame.test.js
 *
 * The hero photograph must cover its frame once, not tile.
 *
 * Every template sets the owner's photo from markup with the SHORTHAND —
 * style="background: url(…)" — and the `background` shorthand resets every
 * longhand it does not mention. So it silently puts background-size back to
 * `auto` and background-repeat back to `repeat`, and because an inline style
 * outranks the stylesheet, a `background-size: cover` declared in the CSS
 * never applies.
 *
 * .ls-hero__media and .pf-hero__bg carry `!important` for exactly this reason.
 * .hero-background on desserdirina did not, and the result was visible on the
 * first screen at desktop width: the box is 1556px wide at a 1440px viewport,
 * the cake photograph rendered at its natural size and repeated, with a seam
 * around x=980. The flagship brand's hero showed the same cake twice, through
 * every audit this template has had.
 *
 * Checked on computed style rather than on the stylesheet text, because the
 * stylesheet was right the whole time — it was being overridden.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-hero-photo-fills-frame.test.js
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

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')) &&
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'template.html')));
}

test('no hero-sized background image tiles or renders at its natural size', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    const checked = [];
    try {
        for (const tpl of templates()) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herofill-'));
            try {
                const cfg = JSON.parse(
                    fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
                ).presets[0].config;
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

                for (const width of [1440, 1920]) {
                    const page = await browser.newPage({ viewport: { width, height: 900 } });
                    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                    await page.waitForTimeout(600);
                    const bad = await page.evaluate(() => {
                        // background-image/-size/-repeat are per-layer, comma
                        // separated. Split on TOP-LEVEL commas only: a
                        // gradient layer is full of commas of its own, and a
                        // naive split reports every template as broken.
                        const splitLayers = (v) => {
                            const out = [];
                            let depth = 0, cur = '';
                            for (const ch of String(v)) {
                                if (ch === '(') depth++;
                                else if (ch === ')') depth--;
                                if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
                                else cur += ch;
                            }
                            if (cur.trim()) out.push(cur.trim());
                            return out;
                        };
                        const out = [];
                        for (const el of document.querySelectorAll('*')) {
                            const cs = getComputedStyle(el);
                            if (!cs.backgroundImage || !cs.backgroundImage.includes('url(')) continue;
                            const r = el.getBoundingClientRect();
                            // Hero-sized surfaces only: a repeating texture on a
                            // small chip is a legitimate design choice.
                            // Media-sized surfaces. Not 600px: the
                            // product-menu hero frame is 534x460 and was
                            // showing an arbitrary natural-size crop, which a
                            // 600px floor walked straight past.
                            if (r.width < 300 || r.height < 250) continue;
                            const imgs = splitLayers(cs.backgroundImage);
                            const sizes = splitLayers(cs.backgroundSize);
                            const repeats = splitLayers(cs.backgroundRepeat);
                            imgs.forEach((img, i) => {
                                // Only a raster layer can tile visibly. A
                                // gradient at background-size:auto simply fills
                                // the box, so `repeat` never shows a seam.
                                if (!img.startsWith('url(')) return;
                                const size = sizes[i % sizes.length] || 'auto';
                                const repeat = repeats[i % repeats.length] || 'repeat';
                                const natural = size === 'auto' || size === 'auto auto';
                                if (natural) {
                                    out.push({
                                        cls: String(el.className || el.tagName).slice(0, 34),
                                        w: Math.round(r.width), h: Math.round(r.height),
                                        layer: i, size, repeat,
                                    });
                                }
                            });
                        }
                        return out;
                    });
                    await page.close();
                    checked.push(`${tpl} @${width}`);
                    for (const b of bad) {
                        failures.push(
                            `${tpl} @${width}: .${b.cls} is ${b.w}x${b.h}; its photo layer (#${b.layer}) has ` +
                            `background-size:${b.size} and background-repeat:${b.repeat} — it renders at its ` +
                            `natural size — tiling if the source is smaller than the box, and showing an ` +
                            `arbitrary top-left crop if it is larger. ` +
                            `The inline "background:" shorthand reset the longhands; the stylesheet needs ` +
                            `background-size/-repeat with !important, as .ls-hero__media and .pf-hero__bg have.`
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
    assert.ok(checked.length >= 8, 'expected to check every template at both widths, got ' + checked.length);
    assert.deepStrictEqual(failures, [], 'hero photographs not covering their frame:\n' + failures.join('\n'));
});
