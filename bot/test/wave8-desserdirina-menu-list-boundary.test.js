'use strict';
/**
 * Wave8 desserdirina — CRITICAL finding #1: a published site can show the
 * wrong products under a menu category, with that category's own items
 * "gone from the entire page".
 *
 * MINIMAL REPRODUCTION (found by hand, not assumed from the report): a
 * single, ordinary owner action — clearing every dish out of one menu
 * category via the editor's own "×" remove control, one click at a time,
 * waiting for each render to settle — is enough. No hidden-tab clicking, no
 * rapid/racing clicks, no multi-step batch sequence required.
 *
 * TWO independent, confirmed bugs compound into the reported symptom:
 *
 * 1. builder/edit-overlay.js's findListItemContainer() climbs from an item's
 *    own field up to the nearest ancestor that is "exclusive" to that item,
 *    stopping as soon as an ancestor contains a SIBLING item's field
 *    (containsOtherListIndex). That check is vacuously false the moment a
 *    list is down to its LAST surviving item — there is no sibling left to
 *    find — so the climb never found a reason to stop. On desserdirina's
 *    menu (the only list in this product nested two levels deep: a
 *    bilingual `menu.ro`/`menu.en` array of categories, each holding its
 *    own `items` array), climbing from a category's last dish walks
 *    <li> -> <ul> -> the category's own <details> -> the shared
 *    <div class="menu-groups"> -> the ENTIRE <div class="menu-panel"> in
 *    just 4 hops — silently rewiring that dish's remove control (and the
 *    `hb-list-item` positioning class) onto a container spanning every
 *    category in that language, not the dish or even its own category.
 *    Fixed by containsForeignField(): stop climbing as soon as an ancestor
 *    contains ANY field that is not part of this item's own subtree, not
 *    only "another index of the same list root" — a strict superset of the
 *    old check, so no list with 2+ items anywhere in this product changes
 *    behavior; only lists reduced to exactly one item newly stop where they
 *    always should have.
 *
 * 2. templates/desserdirina/template.html gated an ENTIRE category — its
 *    `<summary>{{category}}</summary>` heading included — behind
 *    `<!-- @if items -->`, with an `<!-- @if empty -->` fallback keyed on an
 *    `empty` boolean that no code anywhere (app.js, build.js,
 *    edit-overlay.js) ever sets. The moment a category's `items` array
 *    reaches length 0 — reachable once bug #1's misplaced button is used,
 *    or after any other means of clearing a category — NEITHER `@if`
 *    branch renders: the category disappears completely, heading and all,
 *    live, with zero trace. Fixed by always rendering the heading and
 *    gating only the `<ul>` of dishes on `items` being non-empty.
 *
 * Bug #1 alone is what corrupts the REMOVE CONTROL's placement (confirmed
 * below via an isolated real-browser fixture, independent of #2). Bug #2 is
 * what makes the category's own content, heading included, vanish outright
 * once it reaches zero items — reproducing, verbatim, "the category's own
 * items are gone from the entire page". The GREEN end-to-end check drives
 * the REAL editor and REAL publish flow to prove both are fixed together on
 * the live, published site — the only place the original finding was ever
 * confirmed.
 *
 * NOTE on the "wrong items appear under a DIFFERENT category's heading"
 * half of the original finding: it did not reproduce here under any single,
 * correctly re-derived user action (see the careful, step-by-step
 * reproduction this wave's report describes). Tracing the original
 * re-audit's own probe script shows a very plausible self-inflicted cause
 * instead: it computed every removable list's POSITION once, up front
 * (across both the hidden EN tab and the visible RO tab), then re-indexed
 * into a freshly-recomputed list by that same stale position after each
 * removal — and deleting a whole category removes one MORE structural list
 * from the page than deleting a single dish does, permanently shifting
 * every position recorded after it. That is a test-harness bug, not a
 * defect in this product's UI (each real remove button's message carries
 * its own correct path in a closure, never a recomputed position) — see
 * this wave's report for the full trace, including this test's own author
 * making the identical class of mistake by hand while first writing this
 * repro.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path), and the REAL bot/server.js + builder app — this bug lives
 * in the interactive editor's client-side JS, which a static build.js
 * render cannot exercise.
 *
 * Run: node --experimental-sqlite bot/test/wave8-desserdirina-menu-list-boundary.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || 'f0f8d53';
const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave8-desserdirina', 'menu-list-boundary');

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

function loadPlaywright() {
  const candidates = ['playwright', path.join(ROOT, 'node_modules/playwright')];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) {}
  }
  throw new Error('playwright not found');
}

function gitShow(ref, relPath) {
  return execFileSync('git', ['-C', ROOT, 'show', ref + ':' + relPath], { encoding: 'utf8' });
}

/**
 * Builds a minimal, isolated HTML fixture reproducing the desserdirina menu
 * DOM shape for ONE category with exactly one surviving dish (the exact
 * shape captured live from the real editor right before the last dish is
 * removed), runs `overlayJs` (old or current builder/edit-overlay.js
 * content) against it, and reports whether the remove control ends up
 * scoped to the dish/category or ballooned onto the whole panel.
 */
async function measureContainerScope(overlayJs) {
  const { chromium } = loadPlaywright();
  const html = `<!doctype html><html><body>
    <div class="menu-panel" data-menu-panel="ro">
      <div class="menu-groups">
        <details class="menu-group" open>
          <summary class="menu-cat"><span data-hb-edit="menu.ro.0.category" data-hb-kind="text">Torturi</span></summary>
          <ul class="menu-items">
            <li><span data-hb-edit="menu.ro.0.items.0" data-hb-kind="text">Medovic</span></li>
          </ul>
        </details>
        <details class="menu-group" open>
          <summary class="menu-cat"><span data-hb-edit="menu.ro.1.category" data-hb-kind="text">La comanda</span></summary>
          <ul class="menu-items">
            <li><span data-hb-edit="menu.ro.1.items.0" data-hb-kind="text">Torturi</span></li>
            <li><span data-hb-edit="menu.ro.1.items.1" data-hb-kind="text">Colaci</span></li>
          </ul>
        </details>
      </div>
    </div>
    <script>window.parent = window; /* overlay posts to window.parent */</script>
    <script>${overlayJs}</script>
  </body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return await page.evaluate(() => {
      const panel = document.querySelector('.menu-panel');
      const groups = document.querySelector('.menu-groups');
      const torturiDetails = document.querySelectorAll('.menu-group')[0];
      return {
        panelIsListItem: panel.classList.contains('hb-list-item'),
        groupsIsListItem: groups.classList.contains('hb-list-item'),
        torturiUlIsListItem: torturiDetails.querySelector('.menu-items').classList.contains('hb-list-item'),
        removeButtonsOnPanel: panel.querySelectorAll(':scope > .hb-remove-btn').length,
        removeButtonsOnGroups: groups.querySelectorAll(':scope > .hb-remove-btn').length,
      };
    });
  } finally {
    await browser.close();
  }
}

async function runEditorFlow() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-desserd-menu-'));
  process.env.DATA_DIR = dataDir;
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;
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

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const frame = () => page.frameLocator('#preview-iframe');

  async function waitStable({ maxMs = 6000, intervalMs = 250, requiredStable = 2 } = {}) {
    let last = null, stableCount = 0;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const len = await frame().locator('body').evaluate(() => document.body.innerHTML.length).catch(() => -1);
      if (len === last && len >= 0) { stableCount++; if (stableCount >= requiredStable) return len; } else stableCount = 0;
      last = len;
      await page.waitForTimeout(intervalMs);
    }
    return last;
  }

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await frame().locator('body').waitFor({ state: 'attached', timeout: 20000 });
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await waitStable();

    // Clear every dish out of "Torturi" (RO), one owner click at a time,
    // waiting for a fresh, settled render between clicks -- the realistic
    // way a person would empty out a menu section by hand. This alone is
    // the minimal reproduction; no hidden-tab interaction, no rapid
    // clicking, no multi-step batch sequence needed.
    for (let i = 0; i < 4; i++) {
      await frame().locator('body').evaluate(() => {
        const panel = document.querySelector('[data-menu-panel="ro"]');
        const cats = Array.prototype.slice.call(panel.querySelectorAll('.menu-group'));
        const target = cats.find((c) => (c.querySelector('.menu-cat') || {}).textContent.replace(/×$/, '').trim() === 'Torturi');
        if (!target) throw new Error('Torturi category disappeared before all items were removed (index ' + i + ')');
        const btn = target.querySelector('.menu-items .hb-remove-btn');
        if (!btn) throw new Error('no remove button reachable for a Torturi dish (index ' + i + ')');
        btn.click();
      });
      await waitStable();
    }

    const afterEmptying = await frame().locator('body').evaluate(() => {
      const panel = document.querySelector('[data-menu-panel="ro"]');
      const cats = Array.prototype.slice.call(panel.querySelectorAll('.menu-group'));
      return cats.map((c) => ({
        heading: (c.querySelector('.menu-cat') || {}).textContent.replace(/×$/, '').trim(),
        itemCount: c.querySelectorAll('.menu-items > li').length,
      }));
    });

    // Publish and verify on the LIVE PUBLISHED SITE -- the original finding
    // was only ever confirmed there, not in the editor preview.
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const runSlug = 'wave8-desserd-menu-' + Date.now();
    await page.locator('#input-slug').fill(runSlug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('wave8-menu@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: /live/i }).waitFor({ state: 'visible', timeout: 20000 });

    const opened = context.waitForEvent('page');
    await page.locator('#success-url-link').click();
    const livePage = await opened;
    await livePage.waitForLoadState('networkidle');

    const liveMenu = await livePage.evaluate(() => {
      const panel = document.querySelector('[data-menu-panel="ro"]');
      if (!panel) return null;
      const cats = Array.prototype.slice.call(panel.querySelectorAll('.menu-group'));
      return cats.map((c) => ({
        heading: (c.querySelector('.menu-cat') || {}).textContent.trim(),
        items: Array.prototype.slice.call(c.querySelectorAll('.menu-items > li')).map((li) => li.textContent.trim()),
      }));
    });

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'live-menu-after-emptying-torturi.json'), JSON.stringify({ afterEmptying, liveMenu }, null, 2));
    await livePage.screenshot({ path: path.join(EVIDENCE_DIR, 'live-site-after-fix.png'), fullPage: true });

    return { afterEmptying, liveMenu };
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

(async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await check('static: builder/edit-overlay.js has the general foreign-field boundary check', () => {
    const js = fs.readFileSync(path.join(ROOT, 'builder', 'edit-overlay.js'), 'utf8');
    assert.match(js, /function containsForeignField/, 'expected containsForeignField() to exist');
    assert.match(js, /containsOtherListIndex\(up, root, idx\) \|\| containsForeignField\(up, itemPath\)/, 'expected both checks to gate the climb');
  });

  await check('static: templates/desserdirina/template.html always renders the category heading', () => {
    const html = fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'template.html'), 'utf8');
    // The RO menu block: heading must appear BEFORE any @if items guard now
    // (it used to be INSIDE the guard -- see the RED check below).
    const roBlock = html.split('data-menu-panel="ro"')[1].split('<!-- @end -->')[0];
    const summaryIdx = roBlock.indexOf('<summary class="menu-cat">');
    const ifItemsIdx = roBlock.indexOf('<!-- @if items -->');
    assert.ok(summaryIdx !== -1, 'expected a category heading in the RO menu block');
    assert.ok(ifItemsIdx === -1 || summaryIdx < ifItemsIdx, 'category heading must render before (outside) the @if items guard');
  });

  await check('RED (pre-fix / ' + BEFORE_REF + '): edit-overlay.js lacked the foreign-field check', () => {
    const js = gitShow(BEFORE_REF, 'builder/edit-overlay.js');
    assert.doesNotMatch(js, /function containsForeignField/, 'expected the pre-fix file to lack containsForeignField (the bug)');
  });

  await check('RED (pre-fix / ' + BEFORE_REF + '): template.html gated the WHOLE category (heading included) on items', () => {
    const html = gitShow(BEFORE_REF, 'templates/desserdirina/template.html');
    const roBlock = html.split('data-menu-panel="ro"')[1].split('<!-- @end -->')[0];
    const summaryIdx = roBlock.indexOf('<summary class="menu-cat">');
    const ifItemsIdx = roBlock.indexOf('<!-- @if items -->');
    assert.ok(ifItemsIdx !== -1 && ifItemsIdx < summaryIdx, 'expected the pre-fix file to gate the heading behind @if items (the bug)');
  });

  await check('MECHANISM (isolated fixture, real browser): pre-fix edit-overlay.js balloons the remove control onto the whole panel', async () => {
    const oldJs = gitShow(BEFORE_REF, 'builder/edit-overlay.js');
    const result = await measureContainerScope(oldJs);
    assert.strictEqual(result.panelIsListItem, true, 'pre-fix: the whole .menu-panel should get wrongly marked hb-list-item');
    assert.strictEqual(result.removeButtonsOnPanel, 1, 'pre-fix: a stray remove button should land directly on .menu-panel');
  });

  await check('MECHANISM (isolated fixture, real browser): current edit-overlay.js scopes the remove control correctly', async () => {
    const newJs = fs.readFileSync(path.join(ROOT, 'builder', 'edit-overlay.js'), 'utf8');
    const result = await measureContainerScope(newJs);
    assert.strictEqual(result.panelIsListItem, false, 'current: .menu-panel must never be marked hb-list-item for a single-item nested list');
    assert.strictEqual(result.removeButtonsOnPanel, 0, 'current: no remove button should land directly on .menu-panel');
    assert.strictEqual(result.torturiUlIsListItem, true, "current: the remove control must land on Torturi's OWN items <ul>");
  });

  await check('GREEN (real editor + real publish, live site): emptying a category leaves its heading + siblings intact', async () => {
    const { afterEmptying, liveMenu } = await runEditorFlow();

    const torturiInEditor = afterEmptying.find((c) => c.heading === 'Torturi');
    assert.ok(torturiInEditor, 'Torturi heading must survive in the editor preview after removing all its dishes');
    assert.strictEqual(torturiInEditor.itemCount, 0);

    assert.ok(liveMenu, 'RO menu panel must exist on the live published site');
    const torturiLive = liveMenu.find((c) => c.heading === 'Torturi');
    assert.ok(torturiLive, 'Torturi heading must be present on the LIVE PUBLISHED SITE, not vanished — this is the direct fix for "own items are gone from the entire page"');
    assert.strictEqual(torturiLive.items.length, 0, 'Torturi should show zero items live, not borrow another category\'s items');

    const laComanda = liveMenu.find((c) => c.heading === 'La comandă');
    assert.ok(laComanda, 'La comandă must still be present, untouched');
    assert.deepStrictEqual(laComanda.items, ['Torturi', 'Colaci', 'Sarmale', 'Mâncare la cutie', 'Plăcinte și brânzoaice', 'Prăjituri și platouri cu prăjituri'], 'La comandă items must be exactly the originals, no cross-contamination from Torturi');

    const servicii = liveMenu.find((c) => c.heading === 'Servicii și Evenimente');
    assert.ok(servicii, 'Servicii și Evenimente must still be present, untouched');
    assert.deepStrictEqual(servicii.items, ['Catering și mâncare la comandă', 'Zile de naștere în local', 'Evenimente']);
  });

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave8-desserdirina-menu-list-boundary');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
