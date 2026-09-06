'use strict';
/**
 * bot/test/waveB-touch-targets.test.js
 *
 * Tap targets on the sites this product generates, measured on rendered boxes.
 *
 * Two different bars, because they are two different claims:
 *
 *   Tier 1 — WCAG 2.5.8 Target Size (Minimum), Level AA: 24x24 CSS pixels.
 *     This is a conformance criterion and it applies to every standalone
 *     target. It has an explicit "Inline" exception for a target sitting in a
 *     sentence, whose size is constrained by the line-height of the text
 *     around it — forcing those to a box would break the paragraph, so they
 *     are skipped here the way the criterion skips them.
 *
 *   Tier 2 — 44x44 for the primary actions: the masthead navigation and the
 *     calls to action. This is WCAG 2.5.5 (Level AAA) and the figure both the
 *     iOS and Android guidelines give for a thumb. Not a conformance
 *     requirement — a product decision, because these are the controls that
 *     make a small business's phone ring.
 *
 * What this found when it was written, across all five templates at 1440 and
 * 390: 11 to 19 sub-44px interactive elements each. Masthead navigation links
 * rendered 17px tall — text with no padding at all, which fails even the AA
 * 24px bar, on the primary navigation of a paying customer's site. Calls to
 * action came in between 34px and 42px; several already carried a min-height,
 * set just under the mark.
 *
 * Footer legal links are deliberately not in tier 2: bot/test/
 * wave8-legal-link-targets.test.js owns that rule at the AA 24px figure, in
 * the shared component, and they are a compact utility row rather than an
 * action.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-touch-targets.test.js
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
const AA_MIN = 24;        // WCAG 2.5.8, Level AA
const ACTION_MIN = 44;    // WCAG 2.5.5 / iOS + Android platform guidance

// The primary actions, named explicitly so this file says what it protects
// rather than guessing from class-name substrings.
//
// Split per template on purpose. An earlier version was one flat list with a
// single "did anything match?" guard, and an adversarial audit defeated it:
// rename every one of portfolio's own action selectors, shrink its CTA to
// 38px, and the oracle still reported green — because the SHARED consent-card
// selector matched on every page and kept the guard satisfied. A guard that
// any template can satisfy on behalf of all of them guards nothing.
const OWN_ACTIONS = {
    portfolio: ['.pf-chrome__nav a', '.pf-hero__cta', '.pf-appt__wa', '.pf-row'],
    'product-menu': ['.pm-mast__nav a', '.pm-mast__pill', '.pm-hero__cta', '.pm-link', '.menu-lang-btn'],
    'local-service': ['.ls-util__cta', '.ls-util__phone', '.ls-btn', '.ls-lead__row', '.ls-foot__soc a'],
    professionals: ['.pr-nav__links a', '.pr-nav__cta', '.pr-btn'],
    desserdirina: ['.contact-item', '.menu-lang-btn'],
};
// Chrome injected into every generated site. Measured, but never allowed to
// stand in for a template's own controls.
const SHARED_ACTIONS = ['.hb-cookie-actions button', '.hb-cookie-actions .hb-cookie-link', '.hero-cta'];

function ownSelector(tpl) {
    const own = OWN_ACTIONS[tpl];
    assert.ok(own && own.length, `${tpl}: no primary actions declared — add them to OWN_ACTIONS`);
    return own.join(', ');
}
const PRIMARY_ACTIONS = (tpl) => [...(OWN_ACTIONS[tpl] || []), ...SHARED_ACTIONS].join(', ');

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')) &&
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'template.html')));
}

async function collect(browser, tpl, viewport, primarySel, ownSel) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-'));
    try {
        const cfg = JSON.parse(
            fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
        ).presets[0].config;
        siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

        const page = await browser.newPage({ viewport });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(500);
        const rows = await page.evaluate(({ sel, ownSel: ownSelector }) => {
            const out = [];
            const interactive = 'a[href], button, [role="button"]';
            for (const el of document.querySelectorAll(interactive)) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) continue;

                // WCAG 2.5.8 "Inline" exception: the target sits inside a run
                // of text and its box is set by that text's line-height.
                const p = el.closest('p');
                const own = (el.textContent || '').trim();
                const inline = !!p && (p.textContent || '').trim().length > own.length + 2;

                out.push({
                    inline,
                    primary: el.matches(sel),
                    own: ownSelector ? el.matches(ownSelector) : false,
                    tag: el.tagName.toLowerCase(),
                    cls: String(el.className || '').slice(0, 34),
                    text: String(el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 30),
                    w: r.width,
                    h: r.height,
                });
            }
            return out;
        }, { sel: primarySel, ownSel });
        await page.close();
        return rows;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('every standalone target meets the WCAG 2.5.8 AA minimum of 24x24', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    try {
        for (const tpl of templates()) {
            for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
                const rows = await collect(browser, tpl, viewport, PRIMARY_ACTIONS(tpl), ownSelector(tpl));
                assert.ok(rows.length > 5, `${tpl}: expected interactive elements to be found`);
                for (const r of rows) {
                    if (r.inline) continue;
                    if (r.w < AA_MIN - 0.5 || r.h < AA_MIN - 0.5) {
                        failures.push(
                            `${tpl} @${viewport.width}: ${r.tag}.${r.cls} "${r.text}" renders ` +
                            `${Math.round(r.w)}x${Math.round(r.h)} — under the ${AA_MIN}x${AA_MIN} ` +
                            `WCAG 2.5.8 Level AA minimum, and it is not inline in a sentence`
                        );
                    }
                }
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(failures, [], 'targets below the AA minimum:\n' + failures.join('\n'));
});

test('primary actions and navigation meet the 44x44 platform floor', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    try {
        for (const tpl of templates()) {
            for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
                const rows = await collect(browser, tpl, viewport, PRIMARY_ACTIONS(tpl), ownSelector(tpl));
                const primaries = rows.filter((r) => r.primary && !r.inline);
                const ownMatched = rows.filter((r) => r.own && !r.inline);
                assert.ok(
                    ownMatched.length > 0,
                    `${tpl} @${viewport.width}: none of THIS template's own action selectors matched ` +
                    `(${OWN_ACTIONS[tpl].join(', ')}). The shared consent-card controls do not count: ` +
                    `they match on every page and would let a stale list pass by measuring nothing.`
                );
                for (const r of primaries) {
                    if (r.h < ACTION_MIN - 0.5) {
                        failures.push(
                            `${tpl} @${viewport.width}: ${r.tag}.${r.cls} "${r.text}" is ` +
                            `${Math.round(r.h)}px tall, under the ${ACTION_MIN}px platform touch floor`
                        );
                    }
                }
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(failures, [], 'primary actions below the platform floor:\n' + failures.join('\n'));
});
