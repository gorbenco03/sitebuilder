#!/usr/bin/env node
/**
 * Perf measurement harness for AUDIT-2026-09-06 performance fixes.
 * Reproduces the audit's own CDP throttling methodology (150ms RTT, 1.6Mbps
 * down / 750kbps up, CPU x4) so before/after numbers are mechanically
 * comparable. Boots an isolated server exactly like bot/test/flow2-template-e2e.mjs.
 *
 * Usage:
 *   node 04-QA-Evidence/Audit-Fixes-2026-09-06/performance/measure.mjs before
 *   node 04-QA-Evidence/Audit-Fixes-2026-09-06/performance/measure.mjs after
 *
 * Writes 04-QA-Evidence/Audit-Fixes-2026-09-06/performance/<label>.json
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const require = createRequire(import.meta.url);
const EVDIR = path.dirname(new URL(import.meta.url).pathname);

const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label)) {
  console.error('Usage: node measure.mjs <label>   (label = before | after | ...)');
  process.exit(1);
}

// ── Boot isolated server (same recipe as bot/test/flow2-template-e2e.mjs) ──
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-measure-' + label + '-'));
process.env.SERVER_SECRET = 'perf-measure-' + crypto.randomBytes(12).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.CLOUDFLARE_API_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
const server = startServer({ port: 0, onStripeEvent });
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const base = 'http://127.0.0.1:' + server.address().port;
console.log('server at', base);

const perf = { label, generatedAt: new Date().toISOString(), sections: {} };

const INIT_SCRIPT = () => {
  window.__perf = { fcp: null, lcp: null, cls: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__perf.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__perf.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
};

async function throttle(page, opts = {}) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: opts.latency ?? 150,
    downloadThroughput: opts.download ?? (1.6 * 1024 * 1024 / 8),
    uploadThroughput: opts.upload ?? (750 * 1024 / 8),
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu ?? 4 });
  return client;
}

function attachResponseCollector(page, bucket) {
  // 'requestfinished' fires once the full response BODY has been received —
  // unlike 'response' (headers-only), this gives an honest download-complete
  // timestamp under throttling, which is what the PERF-01 stage breakdown needs.
  page.on('requestfinished', async (req) => {
    try {
      const r = await req.response();
      if (!r) return;
      const headers = r.headers();
      let bytes = headers['content-length'] ? parseInt(headers['content-length'], 10) : null;
      if (bytes == null) { try { const buf = await r.body(); bytes = buf.length; } catch { bytes = 0; } }
      bucket.push({
        url: req.url(), status: r.status(), type: req.resourceType(), bytes: bytes || 0,
        finishedAt: Date.now(),
        contentEncoding: headers['content-encoding'] || null,
        cacheControl: headers['cache-control'] || null,
      });
    } catch (e) {}
  });
}

async function newBrowser(viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  return {
    browser, page,
    consoleErrors, failedRequests,
    async close() { await browser.close(); },
  };
}

// ---------------------------------------------------------------------------
// 1. PER-TEMPLATE START — timed in stages: click -> API/heavy-JS fetch done ->
//    image fetch done -> iframe load. This is the PERF-01 breakdown.
// ---------------------------------------------------------------------------
{
  const templateIds = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
  perf.sections.perTemplateStart = {};
  for (const tid of templateIds) {
    const b = await newBrowser({ width: 1440, height: 1000 });
    const responses = [];
    attachResponseCollector(b.page, responses);
    await throttle(b.page);
    await b.page.goto(base + '/app/', { waitUntil: 'load' });
    await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
    try { await b.page.click('#hb-cookie-accept', { timeout: 1500 }); } catch (e) {}

    responses.length = 0;
    const t0 = Date.now();
    const card = b.page.locator(`.template-card[data-template-id="${tid}"] .btn-start-tpl`);
    await card.click({ timeout: 15000 });

    let tIframe = null;
    try {
      const handle = await b.page.waitForSelector('#preview-iframe', { timeout: 15000 });
      const frame = await handle.contentFrame();
      await frame.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
      tIframe = Date.now() - t0;
      await frame.locator('body *').first().waitFor({ state: 'attached', timeout: 20000 });
    } catch (e) {
      tIframe = 'ERROR: ' + e.message.split('\n')[0];
    }
    await b.page.waitForTimeout(200); // let trailing responses settle

    const totalBytes = responses.reduce((s, r) => s + (r.bytes || 0), 0);
    const apiTemplates = responses.filter((r) => r.url.includes('/api/templates'));
    const heavyJs = responses.filter((r) => r.url.includes('/generated/templates/'));
    const heroImg = responses.filter((r) => r.url.includes('/generated/template-assets/') && /\.(jpe?g|png|webp)$/i.test(r.url));

    perf.sections.perTemplateStart[tid] = {
      wallTimeToIframeLoadMs: tIframe,
      requestCountSinceClick: responses.length,
      totalTransferBytesSinceClick: totalBytes,
      breakdown: {
        apiTemplatesMs: apiTemplates.length ? (apiTemplates[0].finishedAt - t0) : null,
        apiTemplatesBytes: apiTemplates.reduce((s, r) => s + r.bytes, 0),
        heavyJsMs: heavyJs.length ? Math.max(...heavyJs.map((r) => r.finishedAt - t0)) : null,
        heavyJsBytes: heavyJs.reduce((s, r) => s + r.bytes, 0),
        imagesMs: heroImg.length ? Math.max(...heroImg.map((r) => r.finishedAt - t0)) : null,
        imagesBytes: heroImg.reduce((s, r) => s + r.bytes, 0),
      },
      newAssetsSinceClick: responses
        .filter((r) => r.url.includes('/generated/templates/') || r.url.includes('/generated/template-assets/') || r.url.includes('/api/templates'))
        .map((r) => ({ url: r.url.replace(base, ''), bytes: r.bytes, encoding: r.contentEncoding })),
    };
    console.log(label, tid, JSON.stringify(perf.sections.perTemplateStart[tid].breakdown), 'iframe=' + tIframe);
    await b.close();
  }
}
fs.writeFileSync(path.join(EVDIR, label + '.json'), JSON.stringify(perf, null, 2));

// ---------------------------------------------------------------------------
// 2. BUILD SIZE FACTS
// ---------------------------------------------------------------------------
{
  function dirSize(p) {
    let total = 0;
    function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, entry.name);
        if (entry.isDirectory()) walk(fp); else total += fs.statSync(fp).size;
      }
    }
    try { walk(p); } catch (e) {}
    return total;
  }
  const heavyDir = path.join(ROOT, 'builder/generated/templates');
  const heavySizes = {};
  try {
    for (const f of fs.readdirSync(heavyDir)) heavySizes[f] = fs.statSync(path.join(heavyDir, f)).size;
  } catch (e) {}
  perf.sections.buildSizes = {
    builderGeneratedTotalMB: Math.round(dirSize(path.join(ROOT, 'builder/generated')) / 1024 / 1024 * 100) / 100,
    templateAssetsTotalMB: Math.round(dirSize(path.join(ROOT, 'builder/generated/template-assets')) / 1024 / 1024 * 100) / 100,
    templatesSourceImagesTotalMB: Math.round(dirSize(path.join(ROOT, 'templates')) / 1024 / 1024 * 100) / 100,
    engineJsBytes: fs.statSync(path.join(ROOT, 'builder/generated/engine.js')).size,
    appJsBytes: fs.statSync(path.join(ROOT, 'builder/app.js')).size,
    appCssBytes: fs.statSync(path.join(ROOT, 'builder/app.css')).size,
    perTemplateHeavyJsBytes: heavySizes,
  };
  ev_note('Build sizes: ' + JSON.stringify(perf.sections.buildSizes));
}
fs.writeFileSync(path.join(EVDIR, label + '.json'), JSON.stringify(perf, null, 2));

// ---------------------------------------------------------------------------
// 3. LIVE PUBLISHED SITE (product-menu) — LCP/CLS at 1440 + 390, matches audit
// ---------------------------------------------------------------------------
let liveSlug = null;
try {
  const b = await newBrowser({ width: 1440, height: 1000 });
  await b.page.goto(base + '/app/', { waitUntil: 'load' });
  await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
  try { await b.page.click('#hb-cookie-accept', { timeout: 2000 }); } catch (e) {}
  await b.page.click('.template-card[data-template-id="product-menu"] .btn-start-tpl');
  await b.page.waitForSelector('#preview-iframe', { timeout: 20000 });
  await b.page.waitForTimeout(800);
  if (await b.page.locator('#details-drawer').isVisible().catch(() => false)) {
    await b.page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
      await b.page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
    });
    await b.page.locator('#drawer-overlay').waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  }
  liveSlug = 'perffix-' + label + '-' + Date.now().toString(36);
  await b.page.locator('#btn-publish').click();
  await b.page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 10000 });
  await b.page.locator('#input-slug').fill(liveSlug);
  await b.page.locator('#btn-publish-continue').click();
  await b.page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 10000 });
  await b.page.locator('#input-email').fill('perffix@example.com');
  await b.page.locator('#btn-send-magic').click();
  await b.page.locator('#dev-link').waitFor({ state: 'visible', timeout: 10000 });
  await b.page.locator('#dev-link').click();
  await b.page.waitForSelector('#btn-pay-publish', { timeout: 8000 });
  await b.page.click('#btn-pay-publish');
  await b.page.waitForSelector('#success-url-link', { timeout: 15000 });
  await b.close();
} catch (e) {
  console.error('publish flow failed:', e.message);
  perf.sections.publishFlowError = String(e && e.message || e);
  liveSlug = null;
}
fs.writeFileSync(path.join(EVDIR, label + '.json'), JSON.stringify(perf, null, 2));

if (liveSlug) {
  for (const viewport of [{ width: 1440, height: 1000, label: 'desktop-1440' }, { width: 390, height: 844, label: 'mobile-390' }]) {
    const b = await newBrowser({ width: viewport.width, height: viewport.height });
    const responses = [];
    attachResponseCollector(b.page, responses);
    await b.page.addInitScript(INIT_SCRIPT);
    await throttle(b.page);
    const t0 = Date.now();
    let ok = true;
    try {
      await b.page.goto(base + '/live/' + liveSlug + '/', { waitUntil: 'load', timeout: 30000 });
    } catch (e) { ok = false; }
    const tLoad = Date.now() - t0;
    if (ok) {
      await b.page.waitForTimeout(600);
      await b.page.screenshot({ path: path.join(EVDIR, `${label}-live-site-${viewport.label}.png`), fullPage: true });
      const paints = await b.page.evaluate(() => window.__perf);
      const imgInfo = await b.page.evaluate(() => Array.from(document.images).map((img) => ({
        src: (img.currentSrc || img.src).split('/').pop(),
        naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        displayWidth: img.clientWidth, displayHeight: img.clientHeight, loading: img.loading,
      })));
      const totalBytes = responses.reduce((s, r) => s + (r.bytes || 0), 0);
      perf.sections['liveSite_' + viewport.label] = {
        wallTimeToLoadMs: tLoad, lcp: paints.lcp, cls: paints.cls,
        requestCount: responses.length, totalTransferBytes: totalBytes, totalTransferKB: Math.round(totalBytes / 1024),
        images: imgInfo, consoleErrors: b.consoleErrors, failedRequests: b.failedRequests,
      };
      console.log(label, 'liveSite', viewport.label, 'lcp=' + paints.lcp, 'cls=' + paints.cls, 'bytes=' + totalBytes);
    }
    await b.close();
  }
}
fs.writeFileSync(path.join(EVDIR, label + '.json'), JSON.stringify(perf, null, 2));

function ev_note(msg) { console.log('[note]', msg); }

await new Promise((resolve) => server.close(resolve));
try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (e) {}
console.log('DONE', label);
process.exit(0);
