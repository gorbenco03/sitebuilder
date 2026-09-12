'use strict';
/**
 * bot/test/suite3-two-tabs-no-silent-loss.test.js
 *
 * M12 (PLAN-QA-2026-09-12, Suita 3 / S3-3): opening the same draft in two
 * browser tabs and editing two DIFFERENT fields, one per tab, silently drops
 * one of the edits.
 *
 * Root cause (04-QA-Evidence/QA-Explorare-2026-09-12/reports/09-robustness-
 * performance.md, D4): saveDraft() (builder/app.js) writes the WHOLE
 * `draft.config` object it holds in memory to the single shared
 * `hb.draft.v1` localStorage key. Tab B's in-memory config is a snapshot
 * from whenever IT loaded the page — it never learns that Tab A wrote a
 * newer version in the meantime. So when Tab B saves (even a field Tab A
 * never touched), it overwrites the whole record with its own stale copy,
 * silently erasing Tab A's edit. A conflict banner appears in both tabs
 * (`initTabConflictWatcher`, the `storage` event), so the loss is not
 * completely silent — but it is generic ("cineva a modificat ciorna") and
 * happens regardless of whether the two tabs actually touched the same field.
 *
 * The fix is a per-field (leaf-value) 3-way merge in saveDraft(): each tab
 * keeps a snapshot of the config it started from (its baseline/common
 * ancestor with whatever is in storage). When it is about to save and
 * another tab has written since, it merges leaf-by-leaf: a field THIS tab
 * changed (differs from its own baseline) wins; a field only the OTHER tab
 * changed is kept from storage instead of being clobbered. Two tabs editing
 * the exact same field is explicitly still last-write-wins (no CRDT).
 *
 * This oracle proves the DIFFERENT-fields case must never lose data, and
 * checks the conflict banner names what changed instead of staying generic.
 *
 * Run: node --experimental-sqlite --test bot/test/suite3-two-tabs-no-silent-loss.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s3b-twotabs-'));
process.env.SERVER_SECRET = 's3b-twotabs-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

async function acceptCookiesIfShown(page) {
  const banner = page.locator('#hb-cookie-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click();
    await banner.waitFor({ state: 'hidden' }).catch(() => {});
  }
}

async function closeDrawerIfOpen(page) {
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
      await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
    });
    await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  }
}

test('editing two DIFFERENT fields in two tabs on the same draft must not silently drop either one', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // Same context = same origin storage = the exact "two tabs, same browser
    // profile" scenario from the QA report (not two isolated sessions).
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    // ---- Tab A: start a fresh product-menu draft. ----
    const pageA = await context.newPage();
    pageA.setDefaultTimeout(20000);
    await pageA.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(pageA);
    await pageA.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await pageA.waitForURL(/#edit$/, { timeout: 25000 });
    await pageA.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
    await pageA.waitForTimeout(600);
    await closeDrawerIfOpen(pageA);

    // ---- Tab B: same URL (#edit), same browser context — resumes the SAME
    // localStorage draft Tab A just created, into its OWN in-memory copy. ----
    const pageB = await context.newPage();
    pageB.setDefaultTimeout(20000);
    await pageB.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(pageB);
    await pageB.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
    await pageB.waitForTimeout(600);
    await closeDrawerIfOpen(pageB);

    const originalTagline = await pageB.evaluate(() => draft.config.business.tagline);

    // ---- Tab A edits business.name and its autosave settles first. ----
    const frameA = () => pageA.frameLocator('#preview-iframe');
    const nameFieldA = frameA().locator('[data-hb-edit="business.name"]').first();
    await nameFieldA.click({ clickCount: 3 });
    await pageA.keyboard.type('Numele Din Tab A', { delay: 15 });
    await nameFieldA.blur().catch(() => {});
    await pageA.waitForTimeout(500);

    // ---- THEN Tab B — whose in-memory config still has the OLD business.name
    // from before Tab A's write — edits a DIFFERENT field. ----
    const frameB = () => pageB.frameLocator('#preview-iframe');
    const taglineFieldB = frameB().locator('[data-hb-edit="business.tagline"]').first();
    await taglineFieldB.click({ clickCount: 3 });
    await pageB.keyboard.type('Sloganul Din Tab B', { delay: 15 });
    await taglineFieldB.blur().catch(() => {});
    await pageB.waitForTimeout(500);

    const stored = await pageB.evaluate(() => JSON.parse(localStorage.getItem('hb.draft.v1') || 'null'));
    assert.ok(stored && stored.config, 'a draft must be present in localStorage after both tabs saved');

    assert.equal(
      stored.config.business.name, 'Numele Din Tab A',
      `Tab A's edit to business.name must survive Tab B saving a DIFFERENT field — ` +
      `found "${stored.config.business.name}" (started as something else, expected the name Tab A typed)`
    );
    assert.equal(
      stored.config.business.tagline, 'Sloganul Din Tab B',
      "Tab B's own edit to business.tagline must of course also be present"
    );
    assert.notEqual(
      stored.config.business.tagline, originalTagline,
      'sanity: business.tagline must actually have changed from its preset value'
    );

    // The conflict banner must have fired in at least one tab, and must name
    // WHICH section changed elsewhere rather than a bare generic sentence —
    // the report's own suggestion (S2) for what a merge-aware banner needs.
    const bannerTextA = await pageA.locator('#tab-conflict-banner .tab-conflict-text').innerText().catch(() => '');
    const bannerTextB = await pageB.locator('#tab-conflict-banner .tab-conflict-text').innerText().catch(() => '');
    const combined = bannerTextA + ' ' + bannerTextB;
    assert.match(
      combined, /business|firm/i,
      `at least one tab's conflict banner should name the affected section (business.*) — got A:"${bannerTextA}" B:"${bannerTextB}"`
    );

    await context.close();
  } finally {
    await browser.close();
  }
});
