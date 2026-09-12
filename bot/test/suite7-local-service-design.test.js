'use strict';
/**
 * bot/test/suite7-local-service-design.test.js
 *
 * PLAN-QA-2026-09-12 §"Suita 7" — S7-1 (local-service). Four client design
 * requirements, confirmed as real by the QA explore report
 * (`04-QA-Evidence/QA-Explorare-2026-09-12/reports/06-published-sites-quality.md`,
 * D4/V1/V2) and by `04-sections-schema.md`. All measured on the actually
 * rendered, published page (`buildStaticSiteTree`), not on CSS source.
 *
 * M6 — navbar-left option: today `.ls-util` always shows the phone number.
 * The only "workaround" (overwrite contact.phoneDisplay with the business
 * name) leaves the element as `<a href="tel:{{contact.phone}}">`, so the
 * call link still dials the real number under the business-name label — and
 * blanking contact.phone too turns it into `<a href="tel:">`. This test
 * proves a REAL schema field instead: `header.left` ("" / unset = phone,
 * "name" = business name), and that picking "name" removes the tel: link
 * entirely rather than relabeling it.
 *
 * D2 — the phone CTA (utility strip, and the two "Sună · …" ghost buttons in
 * the hero and the closing contact band) and the sticky call dock must be a
 * solid cream/paper button on dark ink text, not white-on-transparent or
 * ghost-bordered, so it reads as a button rather than blending into its bar.
 *
 * D1 — the primary CTA's border-radius goes from 6px to ~12px ("mai
 * rotunjite, efect mai moale"), the same design token (`--r`) every
 * rounded element on this template already shares.
 *
 * m12 — the "Build by hidook.tech powered by hidook.agency" footer credit
 * measured 3.33:1 (rgba(15,23,32,0.5) on rgb(238,241,244), 12px) — under the
 * WCAG AA 4.5:1 floor for normal text. The other four templates already
 * clear it (4.62–17.4:1).
 *
 * Run: node --experimental-sqlite --test bot/test/suite7-local-service-design.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

function relLum([r, g, b]) {
    const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contrastRatio(c1, c2) {
    const l1 = relLum(c1), l2 = relLum(c2);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(str) {
    const m = /rgba?\(([^)]+)\)/.exec(str);
    if (!m) return null;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}
/** A translucent foreground (this template's `--mute: rgba(ink, .5)`
 * convention) does not render as its own raw RGB — composite its alpha
 * over the real background first, the same way suite7-template-contract.
 * test.js's own `composite()` does, or a passing result here would just
 * mean "alpha was ignored", not "the text is actually legible." */
function composite(fg, bg) {
    const a = fg[3] == null ? 1 : fg[3];
    if (a >= 1) return fg.slice(0, 3);
    return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a),
    ];
}

function basePreset() {
    return JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', 'local-service', 'presets.json'), 'utf8')
    ).presets[0].config;
}

async function buildAndOpen(browser, config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-design-'));
    siteExport.buildStaticSiteTree({ templateId: 'local-service', config, images: [], siteDir: dir });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
    await page.waitForTimeout(150);
    return { context, page, dir };
}

async function cleanup({ context, dir }) {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
}

/** Solid-fill contrast: own computed color vs own computed background-color
 * (both expected OPAQUE — a real bug if either is not, which the assertion
 * on bgAlpha below catches on its own). No pixel sampling needed here since
 * both are declared solid colours, not photos/gradients. */
async function measureSolidFill(page, selector) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
            color: cs.color,
            backgroundColor: cs.backgroundColor,
            fontSize: parseFloat(cs.fontSize),
            fontWeight: parseInt(cs.fontWeight, 10) || 400,
            borderRadius: cs.borderRadius,
        };
    }, selector);
}

test('M6 — header.left lets the owner show the business name instead of the phone, with no orphan tel: link', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        // Default / unset header.left: unchanged behaviour — phone shown, real tel: link.
        {
            const cfg = basePreset();
            const { context, page, dir } = await buildAndOpen(browser, cfg);
            try {
                const info = await page.evaluate(() => {
                    const util = document.querySelector('.ls-util');
                    const phone = util && util.querySelector('.ls-util__phone');
                    const name = util && util.querySelector('.ls-util__name');
                    return {
                        phoneVisible: !!phone && phone.getBoundingClientRect().width > 0 && getComputedStyle(phone).display !== 'none',
                        phoneHref: phone && phone.getAttribute('href'),
                        nameVisible: !!name && name.getBoundingClientRect().width > 0 && getComputedStyle(name).display !== 'none',
                    };
                });
                assert.equal(info.phoneVisible, true, 'default header.left: phone link must still show (no regression for existing sites)');
                assert.equal(info.phoneHref, 'tel:+40721234567', 'default header.left: phone link must dial the real number');
                assert.equal(info.nameVisible, false, 'default header.left: business name must not also be showing');
            } finally {
                await cleanup({ context, dir });
            }
        }

        // header.left = "name": business name shown, and — the actual defect —
        // there must be NO tel: link left over in the utility strip at all.
        {
            const cfg = basePreset();
            cfg.header = { left: 'name' };
            const { context, page, dir } = await buildAndOpen(browser, cfg);
            try {
                const info = await page.evaluate(() => {
                    const util = document.querySelector('.ls-util');
                    const phone = util && util.querySelector('.ls-util__phone');
                    const name = util && util.querySelector('.ls-util__name');
                    const anyTel = util ? [...util.querySelectorAll('a')].some((a) => (a.getAttribute('href') || '').startsWith('tel:')) : true;
                    return {
                        phonePresent: !!phone,
                        nameVisible: !!name && name.getBoundingClientRect().width > 0 && getComputedStyle(name).display !== 'none',
                        nameText: name ? name.textContent.trim() : null,
                        nameIsLink: name ? name.tagName === 'A' : null,
                        anyTelLinkInUtilityStrip: anyTel,
                    };
                });
                assert.equal(info.phonePresent, false, 'header.left="name": the old phone element must not be rendered at all (not just visually hidden)');
                assert.equal(info.nameVisible, true, 'header.left="name": the business name must be visible');
                assert.equal(info.nameText, cfg.business.name, 'header.left="name": must show the real business name');
                assert.equal(info.nameIsLink, false, 'header.left="name": the business name must NOT be a link (must not resemble a stale tel: CTA)');
                assert.equal(info.anyTelLinkInUtilityStrip, false, 'header.left="name": no tel: link of any kind may remain in the utility strip — this is exactly the orphan-link bug the client hit with the phoneDisplay-overwrite hack');
            } finally {
                await cleanup({ context, dir });
            }
        }
    } finally {
        await browser.close();
    }
});

test('D2 — phone CTA (top bar, hero, contact band) and the sticky call dock are a solid cream/ink button, contrast >= 4.5:1', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    try {
        const cfg = basePreset();
        const { context, page, dir } = await buildAndOpen(browser, cfg);
        try {
            const cases = [
                ['.ls-util__phone', 'top utility-bar phone'],
                ['.ls-btn--phone', 'hero "Sună" phone button (first match)'],
                ['.ls-dock__call', 'sticky call-dock phone button'],
            ];
            for (const [sel, label] of cases) {
                const m = await measureSolidFill(page, sel);
                assert.ok(m, `${label}: selector "${sel}" not found`);
                const fg = parseRgb(m.color);
                const bg = parseRgb(m.backgroundColor);
                assert.ok(fg, `${label}: could not parse text colour "${m.color}"`);
                assert.ok(bg, `${label}: could not parse background colour "${m.backgroundColor}"`);
                assert.ok((bg[3] == null ? 1 : bg[3]) > 0.95, `${label}: must be an OPAQUE solid fill, got background-color ${m.backgroundColor}`);
                const ratio = contrastRatio(fg.slice(0, 3), bg.slice(0, 3));
                const isLarge = m.fontSize >= 24 || (m.fontSize >= 18.66 && m.fontWeight >= 700);
                const bar = isLarge ? 3.0 : 4.5;
                if (ratio < bar) {
                    failures.push(`${label} (${sel}): ${ratio.toFixed(2)}:1, need ${bar}:1 — color ${m.color} on ${m.backgroundColor}`);
                }
            }
            // The two ghost-phone buttons (hero + contact band) must both have
            // picked up the fix — not just "the first querySelector match".
            const bothPhoneButtons = await page.evaluate(() => {
                return [...document.querySelectorAll('.ls-btn--phone')].map((el) => {
                    const cs = getComputedStyle(el);
                    return { color: cs.color, backgroundColor: cs.backgroundColor, text: el.textContent.trim() };
                });
            });
            assert.equal(bothPhoneButtons.length, 2, 'expected exactly 2 phone buttons (hero + contact band) using the fixed style, found ' + bothPhoneButtons.length);
            for (const btn of bothPhoneButtons) {
                const fg = parseRgb(btn.color);
                const bg = parseRgb(btn.backgroundColor);
                const ratio = contrastRatio(fg.slice(0, 3), bg.slice(0, 3));
                if (ratio < 4.5) failures.push(`.ls-btn--phone "${btn.text}": ${ratio.toFixed(2)}:1, need 4.5:1 — color ${btn.color} on ${btn.backgroundColor}`);
            }
        } finally {
            await cleanup({ context, dir });
        }
    } finally {
        await browser.close();
    }
    assert.deepEqual(failures, [], 'D2 phone-button contrast failures:\n' + failures.join('\n'));
});

test('D1 — primary CTA border-radius is ~12px (was 6px)', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const cfg = basePreset();
        const { context, page, dir } = await buildAndOpen(browser, cfg);
        try {
            const radiusPx = await page.evaluate(() => {
                const el = document.querySelector('.hero-cta');
                return parseFloat(getComputedStyle(el).borderTopLeftRadius);
            });
            assert.ok(radiusPx >= 11 && radiusPx <= 13, `.hero-cta border-radius is ${radiusPx}px, expected ~12px (was 6px)`);
        } finally {
            await cleanup({ context, dir });
        }
    } finally {
        await browser.close();
    }
});

test('m12 — footer "Build by hidook.tech" credit clears 4.5:1', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const cfg = basePreset();
        const { context, page, dir } = await buildAndOpen(browser, cfg);
        try {
            const m = await page.evaluate(() => {
                const el = document.querySelector('.hb-built-by');
                const bgEl = document.querySelector('.ls-foot');
                return {
                    color: getComputedStyle(el).color,
                    fontSize: parseFloat(getComputedStyle(el).fontSize),
                    bg: getComputedStyle(bgEl).backgroundColor,
                };
            });
            const fg = parseRgb(m.color);
            const bg = parseRgb(m.bg);
            const ratio = contrastRatio(composite(fg, bg), bg.slice(0, 3));
            assert.ok(
                ratio >= 4.5,
                `.hb-built-by contrast is ${ratio.toFixed(2)}:1 (color ${m.color} on ${m.bg}, ${m.fontSize}px), need >= 4.5:1`
            );
        } finally {
            await cleanup({ context, dir });
        }
    } finally {
        await browser.close();
    }
});
