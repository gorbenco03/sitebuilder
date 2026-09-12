'use strict';
/**
 * bot/test/waveC-builder-own-accessibility.test.js
 *
 * The BUILDER's accessibility — the product the customer sits in front of.
 *
 * Every accessibility oracle in this repository measures the sites the product
 * generates. None measured the product. The difference showed immediately:
 *
 *   .how-step-num      3.67:1 at 11px   the numbered steps on the landing page
 *   checklist pill     3.07:1 at 12px   the one element that tells an owner
 *                                       whether the site is ready to publish,
 *                                       on every editor screen
 *   .hb-secrow__lock   3.67:1 at 11px   "Obligatorie" in the sections panel
 *   footer legal links 101x20, 50x20, 65x20
 *   consent accept     35px tall, #25d366 on #06210f
 *
 * The last two are the same defects this product fixed for its customers'
 * sites months ago and last night — shipped by a tool that was still carrying
 * them on its own front door.
 *
 * Screens covered: the landing page, the editor with its canvas, the editor
 * with the details drawer open, the publish modal, and (Suite 4 QA) the
 * #save-status pill in both its "Salvat" and "Nu s-a salvat" states — at
 * 1440x900 and 390x844. Each is driven through the real app, not rendered
 * in isolation.
 *
 * Suite 4 QA (m15) found #save-status failing the same contrast rule this
 * file already enforced on everything else: "Salvat" (green text on a
 * green tint) measured 3.00:1, "Nu s-a salvat" (red on red tint) 4.41:1 —
 * both under the 4.5:1 floor at this pill's 12.48px. Fixed in
 * builder/app.css by darkening both to shades already used elsewhere in
 * this app for the same tint pairing (see the CSS comment there).
 *
 * Two exemptions are applied, both from the criteria themselves:
 *   - WCAG 2.5.8 exempts a target whose size is constrained by the line-height
 *     of the sentence it sits in. The consent card's "Cookie-uri" link is one.
 *   - WCAG 1.4.3 asks 3:1 rather than 4.5:1 for text at 24px, or 18.66px bold.
 *
 * Run: node --experimental-sqlite --test bot/test/waveC-builder-own-accessibility.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const AA_TARGET = 24;   // WCAG 2.5.8, Level AA
const VIEWPORTS = [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 390, height: 844, label: 'phone' },
];

function auditFn(AA_TARGET) {
    const parse = (c) => {
        const m = String(c).match(/[\d.]+/g);
        return m ? m.slice(0, 3).map(Number) : null;
    };
    const lum = (c) => {
        const p = parse(c);
        if (!p) return null;
        const f = p.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    };
    const alpha = (c) => { const m = String(c).match(/[\d.]+/g); return m && m.length > 3 ? parseFloat(m[3]) : 1; };
    /* The surface a text sits on, COMPOSITED.
     *
     * An earlier version walked up to the first ancestor with alpha > 0.9 and
     * used that, skipping anything translucent. It reported .photo-thumb-badge
     * — white 9px text on `background: rgba(17,24,39,.7)`, a dark chip over a
     * photo thumbnail — as 1.02:1, because it walked straight past the chip to
     * the light modal behind it and compared white against white. The badge is
     * perfectly readable; the method was wrong.
     *
     * Compositing each translucent layer over what is behind it is both the
     * correct answer and cheaper than a screenshot. Layers are collected
     * outward and folded back in, so a stack of translucent boxes resolves the
     * way the compositor resolves it. */
    const surfaceOf = (el) => {
        const layers = [];
        let n = el;
        while (n && n !== document.documentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            const a = alpha(bg);
            if (a > 0) {
                layers.push({ rgb: parse(bg) || [255, 255, 255], a });
                if (a >= 0.999) break;   // opaque: nothing behind it shows
            }
            n = n.parentElement;
        }
        let out = [255, 255, 255];       // the page beneath everything
        for (let i = layers.length - 1; i >= 0; i--) {
            const { rgb, a } = layers[i];
            out = [0, 1, 2].map((k) => rgb[k] * a + out[k] * (1 - a));
        }
        return 'rgb(' + out.map((v) => Math.round(v)).join(',') + ')';
    };
    const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };

    const out = { targets: [], contrast: [], unnamed: [], dupIds: [] };

    for (const el of document.querySelectorAll(
        'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
    )) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        const own = (el.textContent || '').trim();
        const name = (el.getAttribute('aria-label') || own).replace(/\s+/g, ' ').trim();
        // 2.5.8 inline exception.
        const p = el.closest('p');
        const inline = !!p && (p.textContent || '').trim().length > own.length + 2;
        if (!inline && (r.width < AA_TARGET - 0.5 || r.height < AA_TARGET - 0.5)) {
            out.targets.push({
                tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 30),
                name: name.slice(0, 34), w: Math.round(r.width), h: Math.round(r.height),
            });
        }
        const labelled = (el.labels && el.labels.length) || el.closest('label');
        if (!name && !labelled && !el.getAttribute('aria-labelledby') && !el.getAttribute('title')) {
            out.unnamed.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 30) });
        }
    }

    for (const el of document.querySelectorAll('button, a, p, span, h1, h2, h3, h4, label, li, td, div')) {
        if (!visible(el)) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').trim();
        if (own.length < 2) continue;
        const cs = getComputedStyle(el);
        const lf = lum(cs.color);
        const lb = lum(surfaceOf(el));
        if (lf === null || lb === null) continue;
        const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
        const px = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const bar = (px >= 24 || (px >= 18.66 && weight >= 700)) ? 3 : 4.5;
        if (ratio < bar - 0.01) {
            out.contrast.push({
                cls: String(el.className || el.tagName).slice(0, 30), text: own.slice(0, 32),
                ratio: +ratio.toFixed(2), bar, px: Math.round(px), fg: cs.color,
            });
        }
    }

    const seen = new Map();
    document.querySelectorAll('[id]').forEach((e) => seen.set(e.id, (seen.get(e.id) || 0) + 1));
    for (const [k, v] of seen) if (v > 1) out.dupIds.push(k + ' x' + v);
    return out;
}

async function openEditor(page) {
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(2200);
}

const SCREENS = [
    ['landing', async () => {}],
    // Added after darkening --text-light: it is used in thirteen places, and
    // four screens were not enough to know whether any of them sits on a dark
    // surface, where a DARKER muted colour reduces contrast instead of raising
    // it. The gallery and the design-preview modal are the two that could.
    ['design preview modal', async (page) => {
        await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
        await page.locator('.template-card[data-template-id="professionals"] .btn-preview-tpl')
            .click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1800);
    }],
    ['photo gallery modal', async (page) => {
        await openEditor(page);
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.locator('#btn-open-gallery').click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
    }],
    ['editor canvas', openEditor],
    ['details drawer', async (page) => {
        await openEditor(page);
        if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
            await page.locator('#btn-open-drawer').click().catch(() => {});
        }
        await page.waitForTimeout(800);
    }],
    ['publish modal', async (page) => {
        await openEditor(page);
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.locator('#btn-publish').click().catch(() => {});
        await page.waitForTimeout(1200);
    }],
    // Suite 4 QA (m15): #save-status's "Salvat"/"Nu s-a salvat" pill was
    // never on any prior screen here — it only appears after a real edit
    // (saved) or a real network failure (error), neither of which the
    // other screens above trigger. setSaveState() is the exact function
    // renderSaveIndicator()'s caller uses for both real transitions (see
    // builder/app.js) — called directly here instead of staging a live
    // edit + debounce or an aborted /api/draft request, which would only
    // reach the same two DOM states less deterministically. No bespoke
    // contrast check needed: the generic scan below already measures every
    // visible button/a/p/span/h1-4/label/li/td/div, so #save-status-text
    // (a <span>) is caught by the same rule as everything else once one of
    // these screens puts it on screen.
    ['save status: saved', async (page) => {
        await openEditor(page);
        await page.evaluate(() => setSaveState('saved'));
        await page.waitForTimeout(200);
    }],
    ['save status: error', async (page) => {
        await openEditor(page);
        await page.evaluate(() => setSaveState('error', 'Nu s-a putut salva.'));
        await page.waitForTimeout(200);
    }],
];

test('the builder meets the accessibility bar it enforces on its own output', async () => {
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-a11y-'));
    process.env.SERVER_SECRET = 'ba11y-' + crypto.randomBytes(8).toString('hex');
    delete process.env.PUBLIC_URL;

    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const server = startServer({ port: 0 });
    await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    const failures = [];
    let screensMeasured = 0;
    try {
        for (const [name, setup] of SCREENS) {
            for (const vp of VIEWPORTS) {
                const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
                page.setDefaultTimeout(25000);
                await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(700);
                await setup(page);
                const r = await page.evaluate(auditFn, AA_TARGET);
                // Guard: a screen that renders nothing interactive would pass
                // every check below by having nothing to check.
                const controls = await page.evaluate(() =>
                    [...document.querySelectorAll('button, a[href], input, textarea, select')]
                        .filter((e) => e.getBoundingClientRect().width > 0).length);
                await page.close();
                assert.ok(controls > 3,
                    `${name} @${vp.width}: only ${controls} visible controls — the screen did not load, ` +
                    `so this viewport would pass by measuring nothing`);
                screensMeasured++;

                const where = `${name} @${vp.width} (${vp.label})`;
                for (const t of r.targets) {
                    failures.push(`${where}: ${t.tag}.${t.cls} "${t.name}" is ${t.w}x${t.h}, under the ` +
                        `${AA_TARGET}x${AA_TARGET} WCAG 2.5.8 Level AA minimum, and it is not inline in a sentence`);
                }
                for (const c of r.contrast) {
                    failures.push(`${where}: .${c.cls} "${c.text}" at ${c.px}px is ${c.ratio}:1 against its ` +
                        `surface, under the ${c.bar}:1 WCAG 1.4.3 AA floor (colour ${c.fg})`);
                }
                for (const u of r.unnamed) {
                    failures.push(`${where}: ${u.tag}.${u.cls} has no accessible name — no text, no label, no ARIA`);
                }
                for (const d of r.dupIds) {
                    failures.push(`${where}: duplicate id ${d}`);
                }
            }
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    }
    assert.strictEqual(screensMeasured, SCREENS.length * VIEWPORTS.length,
        'every screen/viewport pair must have been measured');
    assert.deepStrictEqual(failures, [], 'builder accessibility failures:\n' + failures.join('\n'));
});
