'use strict';
/**
 * bot/test/waveB-consent-control-quality.test.js
 *
 * The consent card is the first interactive thing a stranger meets on every
 * site this product generates. Two defects shipped on all of them:
 *
 *   1. The accept button rendered 35px tall — under the 44px minimum target
 *      size in WCAG 2.5.8. Every template's own buttons honour 48px; this one
 *      control, injected as shared chrome, did not.
 *   2. It was painted #25d366 on #06210f — WhatsApp green, borrowed from the
 *      chat FAB in the opposite corner — so an advocate's paper-and-brass
 *      hero, a patisserie's pinks and a monochrome portfolio all carried the
 *      same neon control as their most prominent first-screen element.
 *
 * Both are checked on rendered pixels rather than on the CSS source, because
 * the source read fine: the size came out of padding and line-height, and the
 * colour only looks wrong next to a palette the stylesheet cannot see.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-consent-control-quality.test.js
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
const MIN_TARGET_PX = 44;   // WCAG 2.5.8 AA
const MIN_CONTRAST = 4.5;   // WCAG 1.4.3 AA for the button label

// The chat FAB's green. Reserved for the chat FAB.
const WHATSAPP_GREEN = 'rgb(37, 211, 102)';

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')) &&
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'template.html')));
}

async function measure(browser, tpl, viewport) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-'));
    try {
        const cfg = JSON.parse(
            fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
        ).presets[0].config;
        siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

        const page = await browser.newPage({ viewport });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(500);
        const out = await page.evaluate(() => {
            const card = document.getElementById('hb-cookie-banner');
            if (!card) return { missing: true };
            const btn = card.querySelector('button');
            if (!btn) return { missingButton: true };
            const r = btn.getBoundingClientRect();
            const cs = getComputedStyle(btn);
            const lum = (c) => {
                const m = String(c).match(/[\d.]+/g).map(Number);
                const f = m.slice(0, 3).map((v) => {
                    v /= 255;
                    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
            };
            const l1 = lum(cs.color);
            const l2 = lum(cs.backgroundColor);
            return {
                w: r.width,
                h: r.height,
                bg: cs.backgroundColor,
                fg: cs.color,
                contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
            };
        });
        await page.close();
        return out;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('consent accept button meets the 44px target size on every template', async () => {
    const browser = await chromium.launch({ headless: true });
    const small = [];
    try {
        for (const tpl of templates()) {
            for (const viewport of [
                { width: 1440, height: 900 },
                { width: 390, height: 844 },
            ]) {
                const m = await measure(browser, tpl, viewport);
                assert.ok(!m.missing, tpl + ': consent card must be present');
                assert.ok(!m.missingButton, tpl + ': consent card must have an accept button');
                if (m.h < MIN_TARGET_PX - 0.5 || m.w < MIN_TARGET_PX - 0.5) {
                    small.push(
                        `${tpl} @${viewport.width}: accept button renders ` +
                        `${Math.round(m.w)}x${Math.round(m.h)}, under the ${MIN_TARGET_PX}px WCAG 2.5.8 minimum`
                    );
                }
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(small, [], 'consent tap targets below minimum:\n' + small.join('\n'));
});

test('consent accept button is palette-neutral, not the chat FAB green', async () => {
    const browser = await chromium.launch({ headless: true });
    const bad = [];
    try {
        for (const tpl of templates()) {
            const m = await measure(browser, tpl, { width: 1440, height: 900 });
            if (m.bg === WHATSAPP_GREEN) {
                bad.push(
                    `${tpl}: accept button is painted the chat FAB green (${m.bg}) — ` +
                    `the most prominent first-screen control must not borrow another widget's brand colour`
                );
            }
            if (m.contrast < MIN_CONTRAST) {
                bad.push(
                    `${tpl}: accept label ${m.fg} on ${m.bg} is ${m.contrast.toFixed(2)}:1, ` +
                    `under the ${MIN_CONTRAST}:1 AA minimum`
                );
            }
        }
    } finally {
        await browser.close();
    }
    assert.deepStrictEqual(bad, [], 'consent control palette defects:\n' + bad.join('\n'));
});
