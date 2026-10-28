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
 * UPDATE 2026-10-28: the form editor was removed, so bug #1's own checks (the
 * edit-overlay.js static check, the pre-fix/current overlay fixtures in a real
 * browser, and the editor-preview heading check) are gone with it. Bug #2 is
 * template output and stays: the template source always renders the category
 * heading, and a config with every dish of one category removed — published
 * through the real API pipeline (/api/publish + test checkout) — keeps that
 * heading and its sibling categories intact on the live site.
 *
 * Run: node --experimental-sqlite bot/test/wave8-desserdirina-menu-list-boundary.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { startHarness, publishConfig } = require('./lib/old-template-live.js');

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

async function runPublishFlow() {
  const H = await startHarness('wave8-desserd-menu');
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    // Clear every dish out of "Torturi" (RO): the config an owner ends up with
    // after emptying that category.
    let emptied = false;
    const { liveUrl } = await H.publish('desserdirina', publishConfig('desserdirina', (cfg) => {
      const cat = cfg.menu.ro.find((c) => String(c.category).trim() === 'Torturi');
      if (!cat) throw new Error('Torturi category missing from the desserdirina preset');
      cat.items = [];
      emptied = true;
    }), { slug: 'wave8-desserd-menu-' + Date.now() });
    assert.ok(emptied);

    // Verify on the LIVE PUBLISHED SITE -- the original finding was only ever
    // confirmed there.
    const livePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await livePage.goto(liveUrl, { waitUntil: 'networkidle' });

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
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'live-menu-after-emptying-torturi.json'), JSON.stringify({ liveMenu }, null, 2));
    await livePage.screenshot({ path: path.join(EVIDENCE_DIR, 'live-site-after-fix.png'), fullPage: true });

    return { liveMenu };
  } finally {
    await browser.close();
    await H.close();
  }
}

(async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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

  await check('RED (pre-fix / ' + BEFORE_REF + '): template.html gated the WHOLE category (heading included) on items', () => {
    const html = gitShow(BEFORE_REF, 'templates/desserdirina/template.html');
    const roBlock = html.split('data-menu-panel="ro"')[1].split('<!-- @end -->')[0];
    const summaryIdx = roBlock.indexOf('<summary class="menu-cat">');
    const ifItemsIdx = roBlock.indexOf('<!-- @if items -->');
    assert.ok(ifItemsIdx !== -1 && ifItemsIdx < summaryIdx, 'expected the pre-fix file to gate the heading behind @if items (the bug)');
  });

  await check('GREEN (real API publish, live site): emptying a category leaves its heading + siblings intact', async () => {
    const { liveMenu } = await runPublishFlow();

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
