'use strict';
/**
 * bot/test/suite1-lists-from-schema.test.js — PLAN-QA-2026-09-12, Suite 1, S1-1/S1-4.
 *
 * Root cause (verified in builder/edit-overlay.js): whether a repeated group of
 * `[data-hb-edit]` fields gets a "+ Adaugă" / "×" control was decided by
 * `SAFE_LIST_PATHS`, a hand-typed array of six guessed root names
 * (services/menu/pricing/packages/steps/reviews) plus a couple of regex
 * special-cases for "categories" and the bilingual restaurant menu. Any list
 * whose schema key didn't happen to match one of those names got zero
 * add/remove UI, no matter how many items schema.json allowed
 * (`type:"list"`, `min`/`max`). Confirmed defects from this cause:
 *
 *   - B3 professionals `faq.items`         (ends in ".items", not allow-listed)
 *   - M2 professionals `credentials.items` (ends in ".items", not allow-listed)
 *   - B4 professionals `instagram.gallery` (ends in ".gallery", not allow-listed)
 *   - local-service `trust` / `certifications` (HANDOFF note; worked around
 *     by templates/local-service/script.js injecting its OWN `.hb-ls-add`/
 *     `.hb-ls-remove` controls and stripping the generic ones — see below)
 *   - portfolio `schedule.rows` / `team.members` (same cause, never worked
 *     around — undiscovered until this oracle)
 *
 * `process.steps` (professionals) happened to work only because "steps" is
 * one of the six guessed names — not because anyone decided FAQ shouldn't
 * get the same treatment.
 *
 * Fix under test: builder/edit-overlay.js's `isSafeList()` no longer
 * consults a name allowlist. builder/app.js's buildSrcdoc() embeds a
 * `<script type="application/json" id="hb-list-schema">` tag (computed from
 * the template's own schema.json, `type:"list"` fields only, skipping any
 * field explicitly marked `editable:false`) into every rendered srcdoc, and
 * the overlay reads that tag synchronously at mount time — no postMessage
 * round trip, so it is available for the very first render, not just after
 * a "ready" round trip. A list is safe to add/remove from iff schema.json
 * says `type:"list"` for that exact key (or it is a nested itemShape list,
 * e.g. product-menu's `menu.en.<N>.items` dish array nested inside the
 * `menu.en` section list — carried in the same payload's `nested` field).
 *
 * Three fields are deliberately excluded via schema.json's `"editable":
 * false` rather than smuggling a name-based exception back in:
 *
 *   - professionals `appointment.types` / `appointment.weekly` — structured
 *     booking configuration consumed by the native calendar widget (a
 *     slug-like `id`, an enum-ish `mode`, a numeric `durationMin`;
 *     weekday/start/end clock times) rather than freeform text content, and
 *     the generic add/remove mechanism only knows how to seed itemShape
 *     fields with empty strings — a "+ Adaugă" here would hand the calendar
 *     widget a half-filled, unvalidated appointment type or time slot.
 *   - portfolio `schedule.rows` — a template-markup defect independent of
 *     this fix: templates/portfolio/template.html renders `@each
 *     schedule.rows` TWICE (the "Program" section's `<li class="pf-sched__
 *     row">` list, and again inside the appointment panel as `<p
 *     class="pf-appt__hr">`), so `schedule.rows.0.day` etc. exist as TWO
 *     separate DOM elements. Once this list is schema-recognised,
 *     edit-overlay.js's findListItemContainer() correctly-but-unhappily
 *     climbs to the lowest ancestor containing BOTH occurrences — `<main>`
 *     itself — and tags the whole page body `.hb-list-item`, which then
 *     makes `.closest('.hb-list-item')` from any OTHER list's "+ Adaugă"
 *     button (e.g. services) falsely report "nested inside a list item",
 *     regressing bot/test/audit-editor-list-add.test.js's portfolio case.
 *     Discovered by exactly that regression during this fix's own testing
 *     (see the implementation report's Riscuri/FAILING-FIRST log). Excluded
 *     here until the template's duplicate rendering is fixed — that is a
 *     template.html change, out of this fix's scope (S1-4 is the allowlist
 *     → schema-derived swap, not a portfolio markup rewrite).
 *
 * local-service is intentionally checked against `.hb-ls-add`/`.hb-ls-remove`
 * instead of the generic `.hb-add-btn`/`.hb-remove-btn`: that template
 * already ships its own bespoke controls for all four of its lists (see
 * templates/local-service/script.js's initEditableLists — proven end to end
 * by bot/test/wave5-local-service-list-add-remove.test.js) and deliberately
 * removes any `.hb-add-btn`/`.hb-remove-btn` the generic overlay injects, to
 * avoid double controls on the same item. Making the overlay schema-driven
 * does make it newly recognise local-service's `trust`/`certifications` as
 * safe lists too — harmless, since that removal is unconditional and already
 * covers whichever lists the generic overlay decides to touch.
 *
 * RED (pre-fix, `SAFE_LIST_PATHS` in place): fails on `faq.items`,
 * `credentials.items`, `instagram.gallery`, `appointment.types`
 * (professionals — the last of these is later excluded via `editable:false`,
 * see above); `trust`, `certifications` (local-service, generic overlay
 * only — masked by that template's own controls, see above, so NOT asserted
 * here); `schedule.rows` (later also excluded, see above), `team.members`
 * (portfolio).
 *
 * GREEN (post-fix): every `type:"list"` field in every one of the 5
 * templates' schema.json, except fields explicitly `editable:false`, has a
 * working add control and a working remove control per item; the add
 * control disappears at `max` and the remove controls disappear at `min`.
 *
 * Run: node --experimental-sqlite --test bot/test/suite1-lists-from-schema.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}
const { chromium } = loadPlaywright();

/** Read every `type:"list"` field straight from schema.json — the same file
 *  the product ships and the same one edit-overlay.js is now supposed to
 *  consult. Nothing here is hand-typed per template. */
function readListFields(templateId) {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
  const fields = [];
  (schema.sections || []).forEach((section) => {
    (section.fields || []).forEach((f) => {
      if (f && f.type === 'list') fields.push(f);
    });
  });
  return fields;
}

async function openTemplateEditor(page, templateId) {
  await page.goto(global.__BASE__ + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

/** professionals.instagram.gallery is the one list field that starts EMPTY
 *  in the default preset, and its whole section is gated on
 *  `@if instagram.handle` in template.html — so it renders nothing at all
 *  to attach a button to until both are filled. Seed both directly on the
 *  document model the same way a customer's own edits would land there
 *  (app.js's own setPath/fullRerender — these are plain top-level `function`
 *  declarations in a classic, non-module script, so they are ordinary
 *  globals in the page's JS realm even though `draft` itself is a
 *  block-scoped `const` never attached to `window`).
 */
async function seedProfessionalsInstagramGallery(page) {
  await page.evaluate(() => {
    /* eslint-disable no-undef */
    setPath(draft.config, 'instagram.handle', 'qa_salon');
    setPath(draft.config, 'instagram.gallery', ['images/pr-hero.jpg', 'images/pr-hero.jpg']);
    fullRerender();
    /* eslint-enable no-undef */
  });
  await page.waitForTimeout(900);
}

/** Inspect one schema list root inside the (possibly reloaded) preview
 *  iframe. Returns item count, whether an add control exists FOR THIS LIST
 *  SPECIFICALLY, and how many items have their own remove control — using
 *  EITHER the generic overlay's classes or a template's own bespoke ones
 *  (local-service), since both are valid ways for a customer to reach the
 *  same capability.
 *
 *  Both checks are scoped to this root's own bounding container (the lowest
 *  common ancestor of every item's data-hb-edit fields — or, for a
 *  currently-tagged list, its nearest `.hb-list-item` ancestor) rather than
 *  `document.querySelector`/`querySelectorAll` over the WHOLE iframe: a
 *  template routinely renders several lists on one page (e.g. professionals
 *  has services/steps/credentials/faq all on screen at once), so an
 *  unscoped global search for ".hb-add-btn" would report "found" from a
 *  completely different, already-working list and silently hide a missing
 *  control on the one actually under test.
 */
async function inspectList(page, root, addSelectors, removeSelector) {
  const iframeHandle = await page.$('#preview-iframe');
  const iframeCtx = await iframeHandle.contentFrame();
  return iframeCtx.evaluate(
    ({ root, addSelectors, removeSelector }) => {
      const prefix = root + '.';
      const byIdx = {};
      document.querySelectorAll('[data-hb-edit]').forEach((el) => {
        const p = el.getAttribute('data-hb-edit');
        if (p.indexOf(prefix) !== 0) return;
        const idx = p.slice(prefix.length).split('.')[0];
        if (/^\d+$/.test(idx)) (byIdx[idx] = byIdx[idx] || []).push(el);
      });
      const indices = Object.keys(byIdx);
      const itemCount = indices.length;
      if (itemCount === 0) return { itemCount: 0, hasAddBtn: false, removeCountFound: 0 };

      // Does `node`'s subtree contain a data-hb-edit field of this SAME root
      // but a DIFFERENT item index? Mirrors edit-overlay.js's own
      // containsOtherListIndex/containsForeignField guards — used to stop a
      // bounded climb from a field before it swallows a sibling item.
      function crossesIntoOtherItem(node, idx) {
        const all = node.querySelectorAll('[data-hb-edit^="' + prefix + '"]');
        for (let i = 0; i < all.length; i++) {
          const seg = all[i].getAttribute('data-hb-edit').slice(prefix.length).split('.')[0];
          if (seg !== idx) return true;
        }
        return false;
      }

      // The item's own bounding container: its tagged `.hb-list-item`
      // ancestor when the overlay has already wired it up, else a bounded
      // climb (mirrors findListItemContainer()'s own bound) that stops
      // before absorbing a sibling item's fields — accurate whether or not
      // this particular root is recognised yet, and regardless of whose
      // add/remove mechanism (generic overlay vs. a template's own bespoke
      // one, e.g. local-service) actually attached the controls.
      function itemScope(idx) {
        const field = byIdx[idx][0];
        const tag = field.closest('.hb-list-item');
        if (tag) return tag;
        let node = field;
        for (let i = 0; i < 6 && node.parentElement; i++) {
          const next = node.parentElement;
          if (crossesIntoOtherItem(next, idx)) break;
          node = next;
        }
        return node;
      }

      function commonAncestor(a, b) {
        const ancestorsA = new Set();
        for (let n = a; n; n = n.parentElement) ancestorsA.add(n);
        for (let n = b; n; n = n.parentElement) if (ancestorsA.has(n)) return n;
        return document.body;
      }

      const itemScopes = indices.map(itemScope);
      let listScope = itemScopes[0];
      for (let i = 1; i < itemScopes.length; i++) listScope = commonAncestor(listScope, itemScopes[i]);
      // With 2+ items, folding their containers already climbs to the shared
      // parent that hosts the sibling-inserted add button as a direct child.
      // A single-item list has no sibling to fold against, so `listScope`
      // above is still just that one item's own container — widen by
      // exactly one level to reach its parent, the same place the fold
      // would have landed had there been a second item.
      if (itemScopes.length === 1 && listScope.parentElement) listScope = listScope.parentElement;

      // The add control is inserted as a sibling of the last item's own
      // container (both the generic overlay and local-service's bespoke
      // mechanism do this), so it is a child of `listScope` — the fold of
      // every item's own container — without needing to widen further.
      const hasAddBtn = addSelectors.some((sel) => !!listScope.querySelector(sel));
      const removeCountFound = itemScopes.filter((s) => !!s.querySelector(removeSelector)).length;
      return { itemCount, hasAddBtn, removeCountFound };
    },
    { root, addSelectors, removeSelector }
  );
}

const CASES = [
  { templateId: 'desserdirina', addSel: ['.hb-add-btn'], removeSel: '.hb-remove-btn' },
  { templateId: 'local-service', addSel: ['.hb-ls-add', '.hb-add-btn'], removeSel: '.hb-ls-remove, .hb-remove-btn' },
  { templateId: 'portfolio', addSel: ['.hb-add-btn'], removeSel: '.hb-remove-btn' },
  { templateId: 'product-menu', addSel: ['.hb-add-btn'], removeSel: '.hb-remove-btn' },
  { templateId: 'professionals', addSel: ['.hb-add-btn'], removeSel: '.hb-remove-btn' },
];

let browser;
let server;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite1-lists-'));
  process.env.SERVER_SECRET = 'suite1-lists-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  global.__BASE__ = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

for (const kase of CASES) {
  test(`${kase.templateId}: every schema type:"list" field has add + per-item remove controls`, async () => {
    const fields = readListFields(kase.templateId);
    assert.ok(fields.length > 0, kase.templateId + ': schema.json declares no type:"list" fields at all — test setup is broken');

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    const skipped = [];
    const failures = [];
    try {
      await openTemplateEditor(page, kase.templateId);

      if (kase.templateId === 'professionals') {
        await seedProfessionalsInstagramGallery(page);
      }

      for (const field of fields) {
        if (field.editable === false) continue; // explicit, schema-documented exclusion — see file header
        const info = await inspectList(page, field.key, kase.addSel, kase.removeSel);
        if (info.itemCount === 0) {
          // Field renders no items under the current preset/seed (its section
          // is likely `@if`-gated on an empty array) — not the defect this
          // oracle targets (that is Suite 1's separate "empty field stays
          // clickable" / placeholder work). Recorded, not asserted.
          skipped.push(field.key);
          continue;
        }
        if (!info.hasAddBtn) failures.push(field.key + ': no add control found (checked ' + kase.addSel.join(', ') + ')');
        if (info.removeCountFound !== info.itemCount) {
          failures.push(field.key + ': ' + info.removeCountFound + '/' + info.itemCount + ' items have a remove control');
        }
      }
    } finally {
      await page.close();
    }

    if (skipped.length) console.log('  (skipped, 0 items rendered under current preset:', skipped.join(', ') + ')');
    assert.deepEqual(failures, [], kase.templateId + ' — broken lists:\n  ' + failures.join('\n  '));
  });
}

test('professionals: "+ Adaugă" is disabled with a reason at schema max, "×" disappears at schema min', async () => {
  const fields = readListFields('professionals');
  const services = fields.find((f) => f.key === 'services');
  assert.ok(services && typeof services.min === 'number' && typeof services.max === 'number',
    'test setup assumes professionals.services declares numeric min/max in schema.json');

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');

    // Positive control: with the default preset count (well inside
    // min..max), both controls must be present. Without this, "no button
    // found" below at the min/max boundaries could pass for the wrong
    // reason — e.g. if listSchema failed to load at all, NOTHING would ever
    // get a button, min/max or not, and the two assertions after this would
    // both trivially "pass". This is exactly the bug this test caught during
    // development (see FAILING-FIRST log in the implementation report): an
    // eager top-level read of the schema tag executed before that tag
    // existed in the DOM, so every list silently lost its controls, and this
    // test still went green until the positive control below was added.
    const before = await inspectList(page, 'services', ['.hb-add-btn'], '.hb-remove-btn');
    assert.ok(before.itemCount > services.min && before.itemCount < services.max,
      'test setup assumes the default preset count sits strictly between schema min and max');
    assert.equal(before.hasAddBtn, true, 'sanity: "+ Adaugă" must be present when not at schema max');
    assert.equal(before.removeCountFound, before.itemCount, 'sanity: every item must offer "×" when not at schema min');

    // Drive the count to exactly `min` via the same document-model mutation
    // a real remove click performs (setPath + fullRerender), then confirm no
    // remove control survives on the last remaining item(s).
    await page.evaluate((min) => {
      /* eslint-disable no-undef */
      const arr = getPath(draft.config, 'services').slice(0, min);
      setPath(draft.config, 'services', arr);
      fullRerender();
      /* eslint-enable no-undef */
    }, services.min);
    await page.waitForTimeout(900);
    let info = await inspectList(page, 'services', ['.hb-add-btn'], '.hb-remove-btn');
    assert.equal(info.itemCount, services.min, 'setup: services count must equal schema min after trimming');
    assert.equal(info.removeCountFound, 0, 'at schema min, no item should offer a remove ("×") control');

    // Now drive the count to exactly `max`. The button must STAY and say why
    // it cannot be used. This started out asserting the button disappeared;
    // a vanished control just sends the owner hunting for it, so S1-6's
    // disabled-with-a-reason won and this assertion follows the behaviour.
    const filler = Array.from({ length: services.max }, (_, i) => ({ label: 'Serviciu ' + i, blurb: '' }));
    await page.evaluate((arr) => {
      /* eslint-disable no-undef */
      setPath(draft.config, 'services', arr);
      fullRerender();
      /* eslint-enable no-undef */
    }, filler);
    await page.waitForTimeout(900);
    info = await inspectList(page, 'services', ['.hb-add-btn'], '.hb-remove-btn');
    assert.equal(info.itemCount, services.max, 'setup: services count must equal schema max after filling');
    assert.equal(info.hasAddBtn, true, 'at schema max, "+ Adaugă" must still be visible');
    const atMaxHandle = await page.$('#preview-iframe');
    const atMaxCtx = await atMaxHandle.contentFrame();
    const atMax = await atMaxCtx.evaluate(() => {
      const b = document.querySelector('.hb-add-btn');
      return b ? { disabled: b.disabled, text: (b.textContent || '').trim() } : null;
    });
    assert.ok(atMax && atMax.disabled, 'at schema max, "+ Adaugă" must be disabled');
    assert.match(atMax.text, /limită atinsă/,
      'a disabled "+ Adaugă" must say why: ' + JSON.stringify(atMax));
  } finally {
    await page.close();
  }
});
