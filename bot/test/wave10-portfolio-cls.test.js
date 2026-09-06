'use strict';
/**
 * Wave10 portfolio (Salon) — CLS non-regression gate for the polish pass.
 *
 * The task's non-negotiable constraint: CLS on this template is 0 on
 * published sites today, and this wave's changes (a 6-unit sub-grid so a
 * gallery category's trailing row fills completely instead of leaving a
 * lone thumbnail beside empty space, plus `height: auto` added next to every
 * `aspect-ratio` on an `<img>` so the box height actually comes from that
 * ratio instead of the raw HTML width/height attribute) must not move that
 * number. Both changes are pure, static CSS — no JS, no content reflow after
 * paint — but the whole point of measuring is to not take that on faith.
 *
 * This measures real Cumulative Layout Shift — the same
 * `PerformanceObserver({type:'layout-shift'})` primitive behind Lighthouse/
 * CrUX, not a synthetic proxy — on the actual built page, for:
 *
 *   - BEFORE: git ref 20a3a2b (this wave's starting commit), via
 *     wave10-portfolio-helpers' buildSite `state: 'before'`.
 *   - AFTER: the current working tree (state: 'after'), with the gallery
 *     grid + aspect-ratio fixes applied.
 *
 * at both 1440px desktop and 390px mobile, on all 3 shipped presets (every
 * preset has at least one gallery category whose photo count is not a
 * multiple of 3, so every preset actually exercises the new grid-span CSS).
 *
 * Run: node --experimental-sqlite bot/test/wave10-portfolio-cls.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, serveDir, loadPlaywright } = require('./wave10-portfolio-helpers.js');

const EVIDENCE_DIR = path.resolve(__dirname, '../../04-QA-Evidence/Wave10-portfolio');

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
    // Throttle like the existing wave5/wave9 CLS oracles do, so a
    // slow-arriving image would actually have time to shift something
    // before we read the value — an unthrottled localhost load can finish
    // faster than any shift has a chance to be observed at all, silently
    // reporting 0 regardless of whether the underlying CSS is actually safe.
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
    // Scroll all the way through so every lazy-loaded image (including the
    // gallery's new full-width "feature" shot) actually loads and has a
    // chance to shift something, not just what's above the fold.
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += 500) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => ({ cls: window.__clsValue, ok: window.__clsObserverOk }));
    return result;
  } finally {
    await browser.close();
    await close();
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = {};

  for (const presetIndex of [0, 1, 2]) {
    for (const state of ['before', 'after']) {
      const { dir } = buildSite({ state, presetIndex });
      for (const viewport of [
        { width: 1440, height: 1000, name: '1440' },
        { width: 390, height: 844, name: '390' },
      ]) {
        const key = `preset${presetIndex}-${state}-${viewport.name}`;
        await check(`CLS ${key}`, async () => {
          const { cls, ok } = await measureCls(dir, viewport);
          assert.ok(ok, 'PerformanceObserver(layout-shift) unavailable in this browser');
          results[key] = cls;
          // The non-negotiable constraint is 0 CLS on the AFTER (current)
          // state. We also record BEFORE for the evidence trail, but only
          // gate on AFTER — the whole exercise here is proving Wave10 didn't
          // regress it, not re-litigating whatever the pre-existing number
          // was (the pre-existing template was already at 0 too, per the
          // task brief, so this is a true non-regression check both ways).
          if (state === 'after') {
            assert.ok(cls < 0.001, `expected ~0 CLS, got ${cls}`);
          }
        });
      }
    }
  }

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'cls-before-after.json'), JSON.stringify(results, null, 2));
  console.log('\nCLS results:', JSON.stringify(results, null, 2));

  if (failed) {
    console.error(`\nwave10-portfolio-cls.test.js: ${failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nwave10-portfolio-cls.test.js: all checks passed');
}

main().catch((e) => {
  console.error('FAIL wave10-portfolio-cls:', e.stack || e.message);
  process.exit(1);
});
