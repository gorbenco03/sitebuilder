import { bootServer, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import fs from 'node:fs';

const srv = await bootServer();
console.log('server at', srv.base);

async function throttle(page, opts = {}) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false, latency: opts.latency ?? 150,
    downloadThroughput: opts.download ?? (1.6 * 1024 * 1024 / 8),
    uploadThroughput: opts.upload ?? (750 * 1024 / 8),
  });
  await client.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu ?? 4 });
}

const templateIds = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];
const results = {};
for (const tid of templateIds) {
  const b = await newBrowser({ width: 1440, height: 1000 });
  const responses = [];
  b.page.on('response', async (r) => {
    try {
      const headers = r.headers();
      let bytes = headers['content-length'] ? parseInt(headers['content-length'], 10) : null;
      if (bytes == null) { try { bytes = (await r.body()).length; } catch { bytes = 0; } }
      responses.push({ url: r.url(), bytes: bytes || 0, fromCache: r.fromServiceWorker ? false : undefined });
    } catch (e) {}
  });
  await throttle(b.page);
  await b.page.goto(srv.base + '/app/', { waitUntil: 'load' });
  await b.page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });

  responses.length = 0;
  const t0 = Date.now();
  await b.page.locator(`.template-card[data-template-id="${tid}"] .btn-start-tpl`).click({ timeout: 15000 });
  let tFrameLoad = null;
  let tFrameContentVisible = null;
  try {
    const handle = await b.page.waitForSelector('#preview-iframe', { timeout: 15000 });
    const frame = await handle.contentFrame();
    // Sandboxed opaque-origin iframe -> use Playwright's CDP-backed frame API, not page-context JS.
    await frame.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    tFrameLoad = Date.now() - t0;
    await frame.locator('body *').first().waitFor({ state: 'attached', timeout: 20000 });
    tFrameContentVisible = Date.now() - t0;
  } catch (e) {
    tFrameContentVisible = 'ERROR: ' + e.message.split('\n')[0];
  }
  const totalBytes = responses.reduce((s, r) => s + (r.bytes || 0), 0);
  results[tid] = {
    wallTimeToFrameLoadEventMs: tFrameLoad,
    wallTimeToFrameContentAttachedMs: tFrameContentVisible,
    requestCountSinceClick: responses.length,
    totalBytesSinceClick_includesCacheHitsCountedAsFullSize: totalBytes,
    newAssetsSinceClick: responses.filter(r => r.url.includes('/generated/templates/') || r.url.includes('/generated/template-assets/')).map(r => ({ url: r.url.replace(srv.base, ''), bytes: r.bytes })),
  };
  console.log(tid, JSON.stringify(results[tid]));
  await b.close();
}

fs.writeFileSync('/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/performance/perf-template-timing-corrected.json', JSON.stringify(results, null, 2));
await srv.close();
console.log('DONE2');
