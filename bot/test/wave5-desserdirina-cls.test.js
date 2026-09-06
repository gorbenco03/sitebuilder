'use strict';
/**
 * Wave5 desserdirina — Cumulative Layout Shift (audit performance finding).
 *
 * The audit measured CLS 0.20 desktop / 0.17 mobile on published sites
 * (threshold for "good" is 0.1), attributing it mainly to photos served at
 * 3.7-7.5x their displayed size with no reserved intrinsic box (verified
 * below: the shipped photos are real 1280x1280 files rendered at a ~200-280px
 * box — a genuine ~5-6x oversize, matching the audit's range), plus a
 * render-blocking third-party Google Fonts request delaying first paint.
 *
 * Two measurements:
 *
 *  1. MECHANISM PROOF (hard pass/fail): an isolated fixture with just the old
 *     vs. new `.collage-photo` / `.collage-photo img` CSS rules, serving a
 *     REAL shipped photo (torturi-1.jpg, 1280x1280) through a server that
 *     deliberately delays the response — so if the box isn't reserved by CSS
 *     alone, the image's arrival visibly resizes it after first paint. This
 *     isolates exactly the mechanism the audit named and is reliably
 *     reproducible in any environment.
 *
 *  2. FULL PAGE (reported, not gated): real CLS via
 *     PerformanceObserver({type:'layout-shift'}) — the same primitive behind
 *     Lighthouse/CrUX — on the actual built pre-Wave5 vs current page, over a
 *     throttled-bandwidth CDP session. This is reported for the record, but
 *     not asserted strictly-improving: this sandbox serves everything from
 *     localhost with no real DNS/TCP/TLS to a third party and a fast nearby
 *     Google Fonts edge, so the render-blocking-request penalty the audit's
 *     production measurement captured does not fully reproduce headlessly.
 *     See HANDOFF-desserdirina.md for the full discussion.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path). Numbers are written to 04-QA-Evidence/Wave5-desserdirina/.
 *
 * Run: node bot/test/wave5-desserdirina-cls.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { buildSite, serveDir, loadPlaywright, TEMPLATE_DIR } = require('./wave5-desserdirina-helpers.js');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

const EVIDENCE_DIR = path.join(TEMPLATE_DIR, '..', '..', '04-QA-Evidence', 'Wave5-desserdirina');
const REAL_PHOTO = path.join(TEMPLATE_DIR, 'images', 'torturi-1.jpg');

const CLS_OBSERVER_INIT_SCRIPT = () => {
  window.__clsValue = 0;
  window.__clsEntries = [];
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__clsValue += entry.value;
          window.__clsEntries.push({ value: entry.value, time: entry.startTime });
        }
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });
    window.__clsObserverOk = true;
  } catch (e) {
    window.__clsObserverOk = false;
  }
};

// ---------------------------------------------------------------------------
// 1) Isolated mechanism proof: old vs new .collage-photo rules, real photo,
//    deliberately-delayed response.
// ---------------------------------------------------------------------------

function extractRule(css, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  if (!m) throw new Error('rule not found: ' + selector);
  return m[1];
}

function buildFixtureHtml(photoRuleCss, imgRuleCss) {
  // The "below-the-fold-ish" marker div forces an early, real first paint
  // (text content, no network dependency) BEFORE the deliberately-delayed
  // photo arrives — mirroring a real page, where surrounding chrome (nav,
  // headings, other already-loaded content) paints first and the gallery
  // photo shows up later. Without something to paint early, a single-image
  // page just waits for the image and the "shift" never has an earlier
  // painted state to shift away from, so CLS reads zero regardless of the
  // CSS rule being tested.
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px sans-serif; }
  .marker { padding: 12px; background: #eee; }
  .collage-deck { position: relative; width: 900px; height: 500px; }
  .collage-photo { ${photoRuleCss} left: 0; transform: none; top: 20px; }
  .collage-photo img { ${imgRuleCss} }
</style></head>
<body>
  <p class="marker">page chrome that paints immediately</p>
  <div class="collage-deck">
    <figure class="collage-photo"><img src="/photo.jpg" alt="test"></figure>
  </div>
</body></html>`;
}

async function serveFixture(html, photoPath, delayMs) {
  const server = http.createServer((req, res) => {
    if (req.url === '/photo.jpg') {
      const buf = fs.readFileSync(photoPath);
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length });
        res.end(buf);
      }, delayMs);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function measureFixtureCls(html, delayMs) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveFixture(html, REAL_PHOTO, delayMs);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.addInitScript(CLS_OBSERVER_INIT_SCRIPT);
    // domcontentloaded (not 'load'): we need the browser to actually commit a
    // first paint of the page chrome BEFORE the deliberately-delayed photo
    // resolves, so there is an earlier painted state for the photo's arrival
    // to shift away from. Waiting for 'load' would block until the slow
    // image finishes, painting everything at once with nothing to compare
    // against — CLS would read (correctly, but uselessly) as zero.
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(150); // let the first paint actually happen
    const before = await page.evaluate(() => {
      const r = document.querySelector('.collage-photo').getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    await page.waitForTimeout(delayMs + 500); // then let the photo arrive
    const after = await page.evaluate(() => {
      const r = document.querySelector('.collage-photo').getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    const perf = await page.evaluate(() => ({ cls: window.__clsValue, entryCount: window.__clsEntries.length }));
    return { before, after, perf };
  } finally {
    await browser.close();
    await close();
  }
}

// ---------------------------------------------------------------------------
// 2) Full page, throttled, reported (not gated).
// ---------------------------------------------------------------------------

async function measurePageCls(dir, viewport, screenshotPath) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      latency: 100,
    });
    await page.addInitScript(CLS_OBSERVER_INIT_SCRIPT);
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(() => ({ cls: window.__clsValue, observerOk: window.__clsObserverOk }));
    if (screenshotPath) {
      // CLS is already captured above; this scroll is purely so the evidence
      // screenshot shows the gallery's real scattered layout (collage.js only
      // applies its scatter positions once the deck has scrolled into view)
      // instead of the pre-scatter stacked placeholder state.
      await page.evaluate(() => document.querySelector('.gallery-section')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(600);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    return result;
  } finally {
    await browser.close();
    await close();
  }
}

(async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const summary = {};

  await check('sanity: the shipped demo photo is genuinely oversized vs. its gallery display box', () => {
    // sips (macOS) reports 1280x1280 for torturi-1.jpg; displayed at a
    // clamp(200px,20vw,280px) box -> ~4.6-6.4x oversize, in the audit's
    // reported 3.7-7.5x range. Confirm via a JPEG SOF marker parse so this
    // doesn't depend on a platform tool.
    const buf = fs.readFileSync(REAL_PHOTO);
    let width = null, height = null;
    for (let i = 2; i < buf.length - 9; i++) {
      if (buf[i] !== 0xff) continue;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3) {
        height = buf.readUInt16BE(i + 5);
        width = buf.readUInt16BE(i + 7);
        break;
      }
    }
    assert.ok(width && height, 'could not parse JPEG dimensions from torturi-1.jpg');
    const oversizeFactor = width / 280; // widest end of the new clamp() box
    assert.ok(oversizeFactor > 3, `expected the shipped photo to be meaningfully oversized; got ${width}x${height} (~${oversizeFactor.toFixed(1)}x)`);
    console.log(`    torturi-1.jpg is ${width}x${height}px, ~${oversizeFactor.toFixed(1)}x its gallery display width`);
  });

  await check('MECHANISM (hard gate): old .collage-photo rule (auto width) leaves the box unreserved until the photo arrives', async () => {
    const oldCss = require('child_process')
      .execFileSync('git', ['-C', TEMPLATE_DIR, 'show', 'HEAD:templates/desserdirina/styles.css'], { encoding: 'utf8' })
      .toString();
    const photoRule = extractRule(oldCss, '.collage-photo');
    const imgRule = 'height: 320px; width: auto; object-fit: contain; display: block;';
    const html = buildFixtureHtml(photoRule, imgRule);
    const r = await measureFixtureCls(html, 700);
    summary.mechanismProof = summary.mechanismProof || {};
    summary.mechanismProof.old = r;
    console.log(`    old rule: box was ${r.before.width}x${r.before.height} before the photo arrived, ${r.after.width}x${r.after.height} after (PerformanceObserver CLS=${r.perf.cls})`);
    // This is the literal bug: the browser has NO width to give the box until
    // the real image bytes arrive and it can read the file's own dimensions —
    // exactly "no intrinsic size the browser can reserve before load".
    assert.notStrictEqual(r.before.width, r.after.width, `expected the un-reserved box's width to change once the photo loads; stayed at ${r.before.width} throughout`);
    assert.strictEqual(r.before.width, 0, `expected the auto-width box to start unreserved (0px) before the photo arrives; got ${r.before.width}`);
  });

  await check('MECHANISM (hard gate): new .collage-photo rule (fixed box) is fully reserved before the photo arrives', async () => {
    const newCss = fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8');
    const photoRule = extractRule(newCss, '.collage-photo');
    const imgRule = 'width: 100%; height: 100%; object-fit: cover; display: block;';
    const html = buildFixtureHtml(photoRule, imgRule);
    const r = await measureFixtureCls(html, 700);
    summary.mechanismProof = summary.mechanismProof || {};
    summary.mechanismProof.new = r;
    console.log(`    new rule: box was ${r.before.width}x${r.before.height} before the photo arrived, ${r.after.width}x${r.after.height} after (PerformanceObserver CLS=${r.perf.cls})`);
    assert.strictEqual(r.before.width, r.after.width, `expected the reserved box's width to stay IDENTICAL before/after the photo loads; was ${r.before.width}, became ${r.after.width}`);
    assert.strictEqual(r.before.height, r.after.height);
    assert.ok(r.before.width > 100, `expected a real, non-zero reserved width from CSS alone; got ${r.before.width}`);
  });

  await check('FULL PAGE (reported): desktop (1440) CLS, pre-Wave5 vs current, throttled', async () => {
    const before = buildSite({ state: 'before' });
    const after = buildSite({ state: 'after' });
    const beforeR = await measurePageCls(before.dir, { width: 1440, height: 900 }, path.join(EVIDENCE_DIR, 'cls-before-desktop-1440.png'));
    const afterR = await measurePageCls(after.dir, { width: 1440, height: 900 }, path.join(EVIDENCE_DIR, 'cls-after-desktop-1440.png'));
    summary.fullPageDesktop1440 = { before: beforeR.cls, after: afterR.cls };
    console.log(`    [reported, not gated] full-page desktop 1440 CLS: before=${beforeR.cls.toFixed(4)} after=${afterR.cls.toFixed(4)}`);
  });

  await check('FULL PAGE (reported): mobile (390) CLS, pre-Wave5 vs current, throttled', async () => {
    const before = buildSite({ state: 'before' });
    const after = buildSite({ state: 'after' });
    const beforeR = await measurePageCls(before.dir, { width: 390, height: 844 }, path.join(EVIDENCE_DIR, 'cls-before-mobile-390.png'));
    const afterR = await measurePageCls(after.dir, { width: 390, height: 844 }, path.join(EVIDENCE_DIR, 'cls-after-mobile-390.png'));
    summary.fullPageMobile390 = { before: beforeR.cls, after: afterR.cls };
    console.log(`    [reported, not gated] full-page mobile 390 CLS: before=${beforeR.cls.toFixed(4)} after=${afterR.cls.toFixed(4)}`);
  });

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'cls-summary.json'), JSON.stringify(summary, null, 2));

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave5-desserdirina-cls');
  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
