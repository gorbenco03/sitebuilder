import { bootServer, makeEvidence, newBrowser, ROOT } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/performance';
const ev = makeEvidence(EVDIR, 'performance');
const perf = { generatedAt: new Date().toISOString(), sections: {} };

const srv = await bootServer();
console.log('server at', srv.base);

const INIT_SCRIPT = () => {
  window.__perf = { fcp: null, lcp: null, cls: 0, lsEntries: [] };
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
        if (!e.hadRecentInput) { window.__perf.cls += e.value; window.__perf.lsEntries.push({ value: e.value, time: e.startTime }); }
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
  page.on('response', async (r) => {
    try {
      const req = r.request();
      const headers = r.headers();
      let bytes = headers['content-length'] ? parseInt(headers['content-length'], 10) : null;
      if (bytes == null) {
        try { const buf = await r.body(); bytes = buf.length; } catch { bytes = 0; }
      }
      bucket.push({
        url: r.url(), status: r.status(), type: req.resourceType(), bytes: bytes || 0,
        cacheControl: headers['cache-control'] || null, etag: headers['etag'] || null,
        lastModified: headers['last-modified'] || null, contentType: headers['content-type'] || null,
      });
    } catch (e) {}
  });
}

// ---------------------------------------------------------------------------
// 1. COLD LOAD /app/
// ---------------------------------------------------------------------------
{
  const b = await newBrowser({ width: 1440, height: 1000 });
  const responses = [];
  attachResponseCollector(b.page, responses);
  await b.page.addInitScript(INIT_SCRIPT);
  await throttle(b.page);

  const t0 = Date.now();
  await b.page.goto(srv.base + '/app/', { waitUntil: 'load' });
  const tLoad = Date.now() - t0;
  await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
  const tCards = Date.now() - t0;
  await ev.shot(b.page, 'cold-load-app-templates-visible', { action: 'goto /app/ throttled (150ms RTT, 1.6Mbps down, CPU x4)', detail: 'template cards visible' });

  await b.page.waitForTimeout(500); // settle LCP/CLS observers
  const nav = await b.page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? { domContentLoaded: n.domContentLoadedEventEnd, loadEvent: n.loadEventEnd, responseEnd: n.responseEnd, transferSize: n.transferSize, encodedBodySize: n.encodedBodySize } : null;
  });
  const paints = await b.page.evaluate(() => window.__perf);

  const totalBytes = responses.reduce((s, r) => s + (r.bytes || 0), 0);
  const top10 = [...responses].sort((a, b2) => b2.bytes - a.bytes).slice(0, 10)
    .map(r => ({ url: r.url.replace(srv.base, ''), bytes: r.bytes, type: r.type, contentType: r.contentType }));

  perf.sections.coldLoadApp = {
    throttling: '150ms RTT, 1.6Mbps down / 750kbps up, CPU x4',
    wallTimeToLoadEventMs: tLoad,
    wallTimeToTemplateCardsVisibleMs: tCards,
    navigationTiming: nav,
    firstContentfulPaintMs: paints.fcp,
    largestContentfulPaintMs: paints.lcp,
    cumulativeLayoutShift: paints.cls,
    requestCount: responses.length,
    totalTransferBytes: totalBytes,
    totalTransferKB: Math.round(totalBytes / 1024),
    top10LargestResources: top10,
    consoleErrors: b.consoleErrors,
    failedRequests: b.failedRequests,
  };
  ev.note('Cold /app/ load: loadEvent=' + tLoad + 'ms, cards visible=' + tCards + 'ms, LCP=' + paints.lcp + 'ms, CLS=' + paints.cls + ', requests=' + responses.length + ', bytes=' + totalBytes);
  await b.close();
}

// ---------------------------------------------------------------------------
// 2. WARM RELOAD /app/ — cache header + 304 audit
// ---------------------------------------------------------------------------
{
  const b = await newBrowser({ width: 1440, height: 1000 });
  await b.page.goto(srv.base + '/app/', { waitUntil: 'load' });
  await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });

  const responses = [];
  attachResponseCollector(b.page, responses);
  const t0 = Date.now();
  await b.page.reload({ waitUntil: 'load' });
  const tReload = Date.now() - t0;
  await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
  await ev.shot(b.page, 'warm-reload-app', { action: 'reload /app/ (warm, no throttle)', detail: 'second load, browser cache active' });

  const statusCounts = {};
  for (const r of responses) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

  const keyPaths = [
    '/app/', '/app/generated/engine.js', '/app/generated/templates-data.js', '/app/app.js', '/app/app.css',
    '/app/generated/thumbs/product-menu.jpg',
  ];
  const keyHeaders = {};
  for (const kp of keyPaths) {
    const match = responses.find(r => r.url.endsWith(kp) || r.url === srv.base + kp);
    keyHeaders[kp] = match ? { status: match.status, cacheControl: match.cacheControl, etag: match.etag, lastModified: match.lastModified } : 'NOT REQUESTED (bfcache or not found)';
  }

  perf.sections.warmReload = {
    wallTimeToReloadEventMs: tReload,
    requestCount: responses.length,
    statusCounts,
    keyResourceHeaders: keyHeaders,
    allResponses: responses.map(r => ({ url: r.url.replace(srv.base, ''), status: r.status, cacheControl: r.cacheControl, etag: !!r.etag })),
  };
  ev.note('Warm reload: ' + tReload + 'ms, status counts=' + JSON.stringify(statusCounts));
  await b.close();
}

// ---------------------------------------------------------------------------
// 3. PER-TEMPLATE START — payload + time to iframe content
// ---------------------------------------------------------------------------
{
  const templateIds = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
  perf.sections.perTemplateStart = {};
  for (const tid of templateIds) {
    const b = await newBrowser({ width: 1440, height: 1000 });
    const responses = [];
    attachResponseCollector(b.page, responses);
    await throttle(b.page);
    await b.page.goto(srv.base + '/app/', { waitUntil: 'load' });
    await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });

    responses.length = 0; // reset — only count from click onward
    const t0 = Date.now();
    const card = b.page.locator(`.template-card[data-template-id="${tid}"] .btn-start-tpl`);
    await card.click({ timeout: 15000 });
    await b.page.waitForSelector('#screen-edit:not([style*="display: none"]), #screen-edit.active, #preview-iframe', { timeout: 20000 }).catch(() => {});
    // wait for iframe to actually have content
    let tIframe = null;
    try {
      await b.page.waitForFunction(() => {
        const f = document.querySelector('#preview-iframe');
        return f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerHTML.length > 200;
      }, { timeout: 20000 });
      tIframe = Date.now() - t0;
    } catch (e) { tIframe = 'TIMEOUT>20000'; }
    if (tid === templateIds[0]) await ev.shot(b.page, `template-start-${tid}-editor-open`, { action: `click .btn-start-tpl[${tid}]`, detail: 'editor opened, iframe populated' });

    const totalBytes = responses.reduce((s, r) => s + (r.bytes || 0), 0);
    perf.sections.perTemplateStart[tid] = {
      wallTimeToIframeContentMs: tIframe,
      requestCount: responses.length,
      totalTransferBytes: totalBytes,
      totalTransferKB: Math.round(totalBytes / 1024),
      largest: [...responses].sort((a, c) => c.bytes - a.bytes).slice(0, 5).map(r => ({ url: r.url.replace(srv.base, ''), bytes: r.bytes })),
    };
    ev.note(`Template ${tid}: iframe content in ${tIframe}ms, ${responses.length} reqs, ${Math.round(totalBytes/1024)}KB`);
    await b.close();
  }
}

fs.writeFileSync(path.join(EVDIR, 'perf.json'), JSON.stringify(perf, null, 2));

// ---------------------------------------------------------------------------
// 4. LIVE PUBLISHED SITE — publish a real test site, then measure at 1440 + 390
// ---------------------------------------------------------------------------
let liveSlug = null;
try {
  const b = await newBrowser({ width: 1440, height: 1000 });
  await b.page.goto(srv.base + '/app/', { waitUntil: 'load' });
  await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
  // accept cookie if present
  try { await b.page.click('#hb-cookie-accept', { timeout: 2000 }); } catch (e) {}
  await b.page.click('.template-card[data-template-id="product-menu"] .btn-start-tpl');
  await b.page.waitForSelector('#preview-iframe', { timeout: 20000 });
  await b.page.waitForTimeout(800);
  // Details drawer opens automatically on template start; close it, its overlay blocks #btn-publish.
  if (await b.page.locator('#details-drawer').isVisible().catch(() => false)) {
    await b.page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
      await b.page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
    });
    await b.page.locator('#drawer-overlay').waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  }

  liveSlug = 'perfaudit-' + Date.now().toString(36);
  await b.page.locator('#btn-publish').click();
  await b.page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 10000 });
  await b.page.locator('#input-slug').fill(liveSlug);
  await b.page.locator('#btn-publish-continue').click();
  await b.page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 10000 });
  await b.page.locator('#input-email').fill('perfaudit@example.com');
  await b.page.locator('#btn-send-magic').click();
  await b.page.locator('#dev-link').waitFor({ state: 'visible', timeout: 10000 });
  await b.page.locator('#dev-link').click();
  try {
    await b.page.waitForSelector('#btn-pay-publish', { timeout: 8000 });
    await b.page.click('#btn-pay-publish');
  } catch (e) { ev.note('publish flow: #btn-pay-publish not reached — ' + e.message); }
  try {
    await b.page.waitForSelector('#success-url-link', { timeout: 15000 });
    const successHref = await b.page.getAttribute('#success-url-link', 'href');
    await ev.shot(b.page, 'publish-success', { action: 'complete test-pay publish flow', detail: 'success modal with live URL: ' + successHref });
    ev.note('Published test site live at: ' + successHref);
  } catch (e) {
    ev.defect('high', 'Nu s-a putut finaliza publicarea pentru testul de performanță pe site live', e.message, null);
  }
  await b.close();
} catch (e) {
  ev.note('Publish flow for live-site perf test threw: ' + e.message);
  perf.sections.publishFlowError = String(e && e.message || e);
  liveSlug = null;
}
fs.writeFileSync(path.join(EVDIR, 'perf.json'), JSON.stringify(perf, null, 2));

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
      await b.page.goto(srv.base + '/live/' + liveSlug + '/', { waitUntil: 'load', timeout: 30000 });
    } catch (e) { ok = false; ev.note('Live site load failed for ' + viewport.label + ': ' + e.message); }
    const tLoad = Date.now() - t0;
    if (ok) {
      await b.page.waitForTimeout(600);
      await ev.shot(b.page, `live-site-${viewport.label}`, { action: `goto /live/${liveSlug}/ throttled`, detail: viewport.label, fullPage: true });
      const nav = await b.page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        return n ? { domContentLoaded: n.domContentLoadedEventEnd, loadEvent: n.loadEventEnd, transferSize: n.transferSize } : null;
      });
      const paints = await b.page.evaluate(() => window.__perf);
      const imgInfo = await b.page.evaluate(() => Array.from(document.images).map(img => ({
        src: img.currentSrc || img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
        displayWidth: img.clientWidth, displayHeight: img.clientHeight, loading: img.loading, hasSrcset: !!img.srcset,
      })));
      const totalBytes = responses.reduce((s, r) => s + (r.bytes || 0), 0);
      const top10 = [...responses].sort((a, c) => c.bytes - a.bytes).slice(0, 10).map(r => ({ url: r.url.replace(srv.base, ''), bytes: r.bytes, contentType: r.contentType, cacheControl: r.cacheControl }));
      perf.sections['liveSite_' + viewport.label] = {
        wallTimeToLoadMs: tLoad, navigationTiming: nav, fcp: paints.fcp, lcp: paints.lcp, cls: paints.cls,
        requestCount: responses.length, totalTransferBytes: totalBytes, totalTransferKB: Math.round(totalBytes / 1024),
        top10LargestResources: top10, images: imgInfo, consoleErrors: b.consoleErrors, failedRequests: b.failedRequests,
      };
      ev.note(`Live site ${viewport.label}: load=${tLoad}ms LCP=${paints.lcp} CLS=${paints.cls} bytes=${totalBytes} reqs=${responses.length}`);
    }
    await b.close();
  }

  // warm reload of live site + header audit
  {
    const b = await newBrowser({ width: 1440, height: 1000 });
    await b.page.goto(srv.base + '/live/' + liveSlug + '/', { waitUntil: 'load' });
    const responses = [];
    attachResponseCollector(b.page, responses);
    await b.page.reload({ waitUntil: 'load' });
    const statusCounts = {};
    for (const r of responses) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    perf.sections.liveSiteWarmReload = {
      statusCounts,
      sampleHeaders: responses.slice(0, 8).map(r => ({ url: r.url.replace(srv.base, ''), status: r.status, cacheControl: r.cacheControl, etag: r.etag, lastModified: r.lastModified })),
    };
    ev.note('Live site warm reload status counts: ' + JSON.stringify(statusCounts) + ' (expect 304s if cached; live handler has no ETag/Cache-Control by code inspection)');
    await b.close();
  }
}

// ---------------------------------------------------------------------------
// 5. SERVER MICRO-BENCH — /api/templates, /live/<slug>/, memory after 50 reqs
// ---------------------------------------------------------------------------
{
  const http = await import('node:http');
  function timedGet(url) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      http.get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ms: Date.now() - t0, status: res.statusCode, bytes: Buffer.concat(chunks).length, headers: res.headers }));
      }).on('error', reject);
    });
  }

  const apiTemplatesTimes = [];
  for (let i = 0; i < 10; i++) apiTemplatesTimes.push(await timedGet(srv.base + '/api/templates'));
  const liveTimes = [];
  if (liveSlug) for (let i = 0; i < 10; i++) liveTimes.push(await timedGet(srv.base + '/live/' + liveSlug + '/'));

  const memBefore = process.memoryUsage();
  for (let i = 0; i < 50; i++) await timedGet(srv.base + '/api/templates');
  if (liveSlug) for (let i = 0; i < 50; i++) await timedGet(srv.base + '/live/' + liveSlug + '/');
  const memAfter = process.memoryUsage();

  perf.sections.serverMicroBench = {
    apiTemplates: { firstCallMs: apiTemplatesTimes[0].ms, subsequentAvgMs: apiTemplatesTimes.slice(1).reduce((s, r) => s + r.ms, 0) / (apiTemplatesTimes.length - 1), bytes: apiTemplatesTimes[0].bytes, cacheControl: apiTemplatesTimes[0].headers['cache-control'] || null, allMs: apiTemplatesTimes.map(r => r.ms) },
    liveSlugRoot: liveSlug ? { firstCallMs: liveTimes[0].ms, subsequentAvgMs: liveTimes.slice(1).reduce((s, r) => s + r.ms, 0) / (liveTimes.length - 1), bytes: liveTimes[0].bytes, cacheControl: liveTimes[0].headers['cache-control'] || null, etag: liveTimes[0].headers['etag'] || null, allMs: liveTimes.map(r => r.ms) } : null,
    processMemoryRss_beforeMB: Math.round(memBefore.rss / 1024 / 1024 * 10) / 10,
    processMemoryRss_after100ReqsMB: Math.round(memAfter.rss / 1024 / 1024 * 10) / 10,
    processMemoryHeapUsed_beforeMB: Math.round(memBefore.heapUsed / 1024 / 1024 * 10) / 10,
    processMemoryHeapUsed_afterMB: Math.round(memAfter.heapUsed / 1024 / 1024 * 10) / 10,
  };
  ev.note('Server microbench: /api/templates avg=' + perf.sections.serverMicroBench.apiTemplates.subsequentAvgMs.toFixed(2) + 'ms, /live/<slug>/ avg=' + (perf.sections.serverMicroBench.liveSlugRoot ? perf.sections.serverMicroBench.liveSlugRoot.subsequentAvgMs.toFixed(2) : 'n/a') + 'ms, RSS before/after=' + perf.sections.serverMicroBench.processMemoryRss_beforeMB + '/' + perf.sections.serverMicroBench.processMemoryRss_after100ReqsMB + 'MB');
}

// ---------------------------------------------------------------------------
// 6. BUILD SIZE FACTS
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
  perf.sections.buildSizes = {
    builderGeneratedTotalMB: Math.round(dirSize(path.join(ROOT, 'builder/generated')) / 1024 / 1024 * 100) / 100,
    templateAssetsTotalMB: Math.round(dirSize(path.join(ROOT, 'builder/generated/template-assets')) / 1024 / 1024 * 100) / 100,
    thumbsTotalKB: Math.round(dirSize(path.join(ROOT, 'builder/generated/thumbs')) / 1024),
    engineJsBytes: fs.statSync(path.join(ROOT, 'builder/generated/engine.js')).size,
    appJsBytes: fs.statSync(path.join(ROOT, 'builder/app.js')).size,
    appCssBytes: fs.statSync(path.join(ROOT, 'builder/app.css')).size,
    templatesSourceImagesTotalMB: Math.round(dirSize(path.join(ROOT, 'templates')) / 1024 / 1024 * 100) / 100,
  };
}

fs.writeFileSync(path.join(EVDIR, 'perf.json'), JSON.stringify(perf, null, 2));
ev.finish();
await srv.close();
console.log('DONE. perf.json written.');
