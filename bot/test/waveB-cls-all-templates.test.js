'use strict';
/**
 * bot/test/waveB-cls-all-templates.test.js
 *
 * Cumulative Layout Shift on every generated site, at both viewports.
 *
 * There were per-template CLS oracles (portfolio, wave5/wave10) and every one
 * of them passed. Measuring all five together is what showed the problem:
 *
 *   professionals   0.000 / 0.000
 *   portfolio       0.000 / 0.000
 *   product-menu    0.000 / 0.000
 *   desserdirina    0.042 / 0.089
 *   local-service   0.226 / 0.315      <- Google calls anything over 0.25 poor
 *
 * One shift each, at about 25ms, and the source was the same on both: the hero
 * copy growing by the consent-card clearance and sliding up the page. The
 * mechanism that stops the consent card covering the hero was itself the
 * largest layout shift on the page.
 *
 * Three templates already carried a synchronous pre-paint consent check in
 * <head> that sets html.hb-cookie-open before the first frame, plus the
 * cookie-banner stylesheet in <head> rather than at the end of <body>. Two did
 * not, and nothing compared them. That is the whole difference between 0.000
 * and 0.315, and it is invisible to a per-template oracle: each template was
 * only ever measured against itself.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-cls-all-templates.test.js
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
// Google's "good" threshold for CLS. Held at the good bar, not the poor one:
// every template measures 0.000 today, so anything above this is a regression
// someone introduced, not a budget being spent.
const CLS_BUDGET = 0.1;
const SETTLE_MS = 2500;

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')) &&
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'template.html')));
}

test('every template stays inside the CLS budget on desktop and mobile', async () => {
    const browser = await chromium.launch({ headless: true });
    const failures = [];
    const report = [];
    try {
        for (const tpl of templates()) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-'));
            try {
                const cfg = JSON.parse(
                    fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8')
                ).presets[0].config;
                siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

                for (const vp of [
                    { width: 1440, height: 900, label: 'desktop' },
                    { width: 390, height: 844, label: 'mobile' },
                ]) {
                    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
                    await page.addInitScript(() => {
                        window.__cls = 0;
                        window.__worst = null;
                        new PerformanceObserver((list) => {
                            for (const e of list.getEntries()) {
                                if (e.hadRecentInput) continue;
                                window.__cls += e.value;
                                if (!window.__worst || e.value > window.__worst.value) {
                                    window.__worst = {
                                        value: e.value,
                                        at: Math.round(e.startTime),
                                        sources: (e.sources || []).slice(0, 2).map((s) => {
                                            const n = s.node;
                                            return n && n.nodeType === 1
                                                ? n.tagName.toLowerCase() + '.' + String(n.className || '').slice(0, 30)
                                                : String(n && n.nodeName);
                                        }),
                                    };
                                }
                            }
                        }).observe({ type: 'layout-shift', buffered: true });
                    });
                    await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
                    await page.waitForTimeout(SETTLE_MS);
                    const m = await page.evaluate(() => ({ cls: window.__cls, worst: window.__worst }));
                    await page.close();

                    report.push(`${tpl} ${vp.label}: CLS ${m.cls.toFixed(4)}`);
                    if (m.cls > CLS_BUDGET) {
                        failures.push(
                            `${tpl} @${vp.width}: CLS ${m.cls.toFixed(4)} exceeds the ${CLS_BUDGET} budget` +
                            (m.worst
                                ? ` — largest shift ${m.worst.value.toFixed(4)} at ${m.worst.at}ms, ` +
                                  `moving ${m.worst.sources.join(' / ')}`
                                : '')
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
    report.forEach((r) => console.log('  ' + r));
    assert.deepStrictEqual(failures, [], 'CLS budget exceeded:\n' + failures.join('\n'));
});

test('every template resolves consent state before the first paint', async () => {
    // The structural cause, checked directly so a regression is reported as
    // "the pre-paint check went missing" rather than as a number drifting.
    const missing = [];
    for (const tpl of templates()) {
        const html = fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'template.html'), 'utf8');
        const headEnd = html.indexOf('</head>');
        assert.notStrictEqual(headEnd, -1, tpl + ': expected a <head>');
        const head = html.slice(0, headEnd);
        if (!/hb-cookie-open/.test(head)) {
            missing.push(`${tpl}: no synchronous pre-paint consent check in <head> — the clearance ` +
                `class lands after the first frame and the hero shifts`);
        }
        if (!/<link[^>]+cookie-banner\.css/.test(head)) {
            missing.push(`${tpl}: cookie-banner.css is not linked from <head> — its clearance rules ` +
                `arrive after content has already painted without them`);
        }
    }
    assert.deepStrictEqual(missing, [], 'pre-paint consent wiring missing:\n' + missing.join('\n'));
});
