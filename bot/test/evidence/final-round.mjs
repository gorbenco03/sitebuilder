// Final evidence round for the finished product.
//
// The owner's rule: once everything is verified and integrated, the repository
// keeps ONE round of evidence — this one — and the historical rounds go.
// So this has to stand on its own: the screenshots a person would look at, and
// the numbers behind every claim, regenerated from the code as it ships.
//
// Run: node --experimental-sqlite bot/test/evidence/final-round.mjs
// Writes: 04-QA-Evidence/Final/

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const OUT = path.join(ROOT, '04-QA-Evidence', 'Final');
const SITES = path.join(OUT, 'sites');
const EDITOR = path.join(OUT, 'editor');
for (const d of [OUT, SITES, EDITOR]) fs.mkdirSync(d, { recursive: true });

const TPLS = fs.readdirSync(path.join(ROOT, 'templates'))
    .filter((t) => fs.existsSync(path.join(ROOT, 'templates', t, 'presets.json')))
    .sort();

const lum = (c) => {
    const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};

const report = { generatedAt: new Date().toISOString(), commit: null, templates: {} };
try {
    report.commit = require('node:child_process')
        .execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch (_) {}

const browser = await chromium.launch({ headless: true });

for (const tpl of TPLS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'final-'));
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')).presets[0].config;
    siteExport.buildStaticSiteTree({ templateId: tpl, config: cfg, images: [], siteDir: dir });

    const t = { viewports: {}, exportBytes: 0 };
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else t.exportBytes += fs.statSync(f).size; } };
    walk(dir);

    for (const vp of [{ w: 1440, h: 900, label: 'desktop' }, { w: 390, h: 844, label: 'mobile' }]) {
        const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
        await page.addInitScript(() => {
            window.__cls = 0;
            new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
                .observe({ type: 'layout-shift', buffered: true });
        });
        let bytes = 0;
        page.on('response', async (res) => { try { bytes += (await res.body()).length; } catch (_) {} });
        await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
        await page.waitForTimeout(2600);

        const cls = await page.evaluate(() => +window.__cls.toFixed(4));
        const targets = await page.evaluate(() => {
            let under24 = 0, under44 = 0, total = 0;
            for (const el of document.querySelectorAll('a[href], button, [role="button"]')) {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) continue;
                const p = el.closest('p');
                const own = (el.textContent || '').trim();
                if (p && (p.textContent || '').trim().length > own.length + 2) continue; // inline exemption
                total++;
                if (r.width < 23.5 || r.height < 23.5) under24++;
                if (r.height < 43.5) under44++;
            }
            return { total, under24, under44 };
        });

        // Hero headline contrast on rendered pixels, with the glyphs hidden.
        const heroSel = ['.pr-display', '.pf-hero__word', '.ls-hero__tag', '.pm-hero__tag', '.hero-wordmark']
            .find(async () => true);
        const contrast = await (async () => {
            const sel = await page.evaluate((cands) => cands.find((s) => document.querySelector(s)) || null,
                ['.pr-display', '.pf-hero__word', '.ls-hero__tag', '.pm-hero__tag', '.hero-wordmark', '.hero-tagline']);
            if (!sel) return null;
            const info = await page.evaluate((s) => {
                const el = document.querySelector(s); const r = el.getBoundingClientRect();
                el.dataset.v = el.style.visibility; el.style.visibility = 'hidden';
                return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, fg: getComputedStyle(el).color, sel: s };
            }, sel);
            const clip = { x: Math.max(0, info.rect.x), y: Math.max(0, info.rect.y),
                width: Math.max(8, Math.min(vp.w - Math.max(0, info.rect.x), info.rect.w)),
                height: Math.max(8, Math.min(vp.h - Math.max(0, info.rect.y), info.rect.h)) };
            const shot = await page.screenshot({ clip });
            await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.style.visibility = el.dataset.v || ''; }, sel);
            const px = await page.evaluate(async (b64) => {
                const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
                const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
                const o = []; for (let i = 0; i < d.length; i += 4) o.push([d[i], d[i + 1], d[i + 2]]);
                return o;
            }, shot.toString('base64'));
            const fg = info.fg.match(/[\d.]+/g).map(Number).slice(0, 3);
            const lf = lum(fg);
            const ratios = px.map((c) => { const lb = lum(c); return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05); })
                .sort((a, b) => a - b);
            return { selector: info.sel, p10: +ratios[Math.floor(ratios.length * 0.1)].toFixed(2), worst: +ratios[0].toFixed(2) };
        })();

        await page.evaluate(() => { const c = document.getElementById('hb-cookie-banner'); if (c) c.scrollIntoView(); });
        await page.screenshot({ path: path.join(SITES, `${tpl}-${vp.label}.png`) });
        await page.close();

        t.viewports[vp.label] = { cls, targets, heroContrast: contrast, firstLoadBytes: bytes };
    }
    report.templates[tpl] = t;
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('site evidence:', tpl);
}

// ---- Editor ----
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'final-ed-'));
process.env.SERVER_SECRET = 'final-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const server = startServer({ port: 0 });
await new Promise((r) => { if (server.listening) return r(); server.once('listening', r); });
const base = 'http://127.0.0.1:' + server.address().port;

for (const vp of [{ w: 1440, h: 900, label: 'desktop' }, { w: 390, h: 844, label: 'mobile' }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    page.setDefaultTimeout(25000);
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(EDITOR, `01-landing-${vp.label}.png`) });
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(EDITOR, `02-editor-details-${vp.label}.png`) });
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(EDITOR, `03-editor-canvas-${vp.label}.png`) });
    if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
        await page.locator('#btn-open-drawer').click().catch(() => {});
    }
    await page.waitForTimeout(700);
    await page.locator('.hb-sections-list').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(EDITOR, `04-sections-panel-${vp.label}.png`) });
    await page.close();
    console.log('editor evidence:', vp.label);
}

await browser.close();
await new Promise((r) => server.close(r));
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(report, null, 2));
console.log('\nwrote ' + path.relative(ROOT, OUT));
