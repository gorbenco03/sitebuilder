'use strict';
/**
 * Wave9 desserdirina — CLS non-regression gate for the polish pass.
 *
 * The task's non-negotiable constraint: CLS on this template is currently 0
 * on published sites, and this wave's changes (new demo photography, a new
 * `--color-primary-ink` contrast token, hero overlay tuning) must not move
 * that number. This measures real Cumulative Layout Shift — the same
 * `PerformanceObserver({type:'layout-shift'})` primitive behind Lighthouse/
 * CrUX, not a synthetic proxy — on the actual built page, for:
 *
 *   - BEFORE: the exact commit this wave started from (git HEAD at the time
 *     these changes were made), via wave5-desserdirina-helpers' buildSite
 *     `state: 'before', ref: 'HEAD'` — i.e. the template as it looked before
 *     any Wave9 edit.
 *   - AFTER: the current working tree (state: 'after'), with the new photo
 *     crops, the AA contrast fix, and any hero adjustments applied.
 *
 * at both 1440px desktop and 390px mobile, so a real change in either
 * direction (a new photo's different aspect ratio, a CSS change that adds a
 * layout-affecting property) would show up as a non-zero delta here.
 *
 * Run: node --experimental-sqlite bot/test/wave9-desserdirina-cls.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, serveDir, loadPlaywright } = require('./wave5-desserdirina-helpers.js');

const EVIDENCE_DIR = path.resolve(__dirname, '../../04-QA-Evidence/Wave9-desserdirina');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed += 1;
    console.error('FAIL', name, '-', e.message);
  }
}

const CLS_OBSERVER_INIT_SCRIPT = () => {
  window.__clsValue = 0;
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__clsValue += entry.value;
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });
    window.__clsObserverOk = true;
  } catch (e) {
    window.__clsObserverOk = false;
  }
};

async function measureCls(dir, viewport) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    // Throttle like the existing wave5 CLS oracle does, so a slow-arriving
    // image would actually have time to shift something before we read the
    // value — an unthrottled localhost load can finish faster than any
    // shift has a chance to be observed at all, silently reporting 0
    // regardless of whether the underlying CSS is actually safe.
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
    await page.waitForTimeout(2500);
    // Scroll through so every lazy-loaded gallery photo actually arrives and
    // has a chance to shift something, mirroring a real visitor scrolling
    // down the page rather than only ever seeing the first viewport.
    await page.evaluate(async () => {
      const step = Math.max(200, window.innerHeight - 100);
      const max = document.body.scrollHeight;
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(800);
    const result = await page.evaluate(() => ({ cls: window.__clsValue, observerOk: window.__clsObserverOk }));
    return result;
  } finally {
    await browser.close();
    await close();
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const summary = {};

  for (const viewport of [{ width: 1440, height: 900, label: 'desktop-1440' }, { width: 390, height: 844, label: 'mobile-390' }]) {
    await check(`CLS does not regress at ${viewport.label} (before vs. after this wave's changes)`, async () => {
      const before = buildSite({ state: 'before', ref: 'HEAD' });
      const after = buildSite({ state: 'after' });
      const beforeResult = await measureCls(before.dir, viewport);
      const afterResult = await measureCls(after.dir, viewport);
      assert.ok(beforeResult.observerOk, 'PerformanceObserver(layout-shift) unavailable for "before" — cannot measure');
      assert.ok(afterResult.observerOk, 'PerformanceObserver(layout-shift) unavailable for "after" — cannot measure');
      summary[viewport.label] = { before: beforeResult.cls, after: afterResult.cls };
      console.log(`    ${viewport.label}: before=${beforeResult.cls.toFixed(4)}  after=${afterResult.cls.toFixed(4)}`);
      assert.ok(
        afterResult.cls <= beforeResult.cls + 0.01,
        `CLS regressed at ${viewport.label}: before=${beforeResult.cls.toFixed(4)} after=${afterResult.cls.toFixed(4)}`
      );
      assert.ok(afterResult.cls < 0.1, `CLS ${afterResult.cls.toFixed(4)} at ${viewport.label} exceeds the "good" 0.1 threshold`);
    });
  }

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'cls-before-after.json'), JSON.stringify(summary, null, 2));

  if (failed) {
    console.error(`\nwave9-desserdirina-cls.test.js: ${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nwave9-desserdirina-cls.test.js: all checks passed');
}

main().catch((e) => {
  console.error('FAIL wave9-desserdirina-cls:', e.stack || e.message);
  process.exit(1);
});
