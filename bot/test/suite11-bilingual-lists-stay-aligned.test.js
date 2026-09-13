'use strict';
/**
 * bot/test/suite11-bilingual-lists-stay-aligned.test.js
 *
 * PLAN-FEEDBACK-2026-09-13, Suite A (points 1, 9).
 *
 * Root cause (verified in builder/app.js): `menu.ro` and `menu.en` are two
 * completely independent `type:"list"` fields in templates/product-menu and
 * templates/desserdirina's schema.json. `onListAdd()` mutated only the list
 * at the path being edited; `onListRemove()` and every inline text-edit
 * commit (`onInlineTextEdit()`) did the same. An owner working in RO who
 * added a category/dish, removed one, or retyped its name never saw that
 * change reflected on the EN side — the EN panel silently drifted out of
 * sync from the very first edit.
 *
 * Fix under test (all in builder/app.js):
 *   - findLangListPairs()/siblingLangListPath(): detect a RO/EN list pair
 *     GENERICALLY from schema.json (two `type:"list"` fields whose keys
 *     differ only by a trailing ".ro"/".en") — nothing here hardcodes
 *     "menu", so both product-menu and desserdirina (and any future
 *     template declaring its own such pair) get it for free.
 *   - mirrorListAddToSibling()/mirrorListRemoveToSibling(): add and remove
 *     mirror onto the sibling language at the SAME index, including nested
 *     lists (a category's own "items" dish array) — but only while the pair
 *     is/stays aligned; an already-misaligned draft is never forced into
 *     alignment (point 5) and a sibling at its own schema `max` refuses the
 *     add on BOTH sides (point 6) instead of letting the pair drift further
 *     apart.
 *   - classifyLangPairLeaf(): a text leaf (itemShape "text", or a nested
 *     itemShape "list" dish array's own bare-string entries) propagates to
 *     the sibling only while the sibling still holds the untranslated value
 *     (empty, or equal to what THIS side used to say) — point 4. Anything
 *     declared some OTHER itemShape type (not "text") is treated as
 *     language-neutral and is always kept identical on both sides — point 3.
 *
 * Reorder: this codebase has NO reorder/move control for schema-driven list
 * ITEMS (categories or dishes) on any template — the only "move" mechanism
 * anywhere is the photo-reorder buttons inside a single gallery item's own
 * "Poze" panel (builder/app.js's makeMoveBtn(), operating on a `photos`
 * array, unrelated to language pairing). Searched for any postMessage/
 * button wired to reorder a `menu.ro`/`menu.en` category or dish and found
 * none — see the two `test.skip()`s below, one per template, which record
 * this instead of silently omitting the point-2 requirement.
 *
 * Uses the same direct page.evaluate() technique as
 * bot/test/suite2-string-gallery-in-photos-panel.test.js: call app.js's own
 * onListAdd()/onListRemove()/onInlineTextEdit() inside the real editor page
 * and assert on draft.config afterwards — exercising the exact functions a
 * real click/keystroke would call, without the extra flake of driving the
 * iframe's contenteditable nodes pixel by pixel.
 *
 * Run: node --experimental-sqlite --test bot/test/suite11-bilingual-lists-stay-aligned.test.js
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
    '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s11-bilingual-'));
process.env.SERVER_SECRET = 's11-bilingual-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;
let browser;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function openTemplateEditor(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
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
  await page.waitForTimeout(300);
}

/** Force menu.ro/menu.en to a known, ALIGNED starting shape, independent of
 *  whatever a template's shipped presets happen to look like today (see the
 *  desserdirina test below — its own presets already ship misaligned). */
async function setAlignedMenu(page) {
  return page.evaluate(() => {
    /* eslint-disable no-undef */
    setPath(draft.config, 'menu.ro', [
      { category: 'Aperitive', items: ['Salată de vinete', 'Icre'] },
      { category: 'Feluri principale', items: ['Sarmale', 'Ciorbă'] },
    ]);
    setPath(draft.config, 'menu.en', [
      { category: 'Starters', items: ['Eggplant salad', 'Fish roe'] },
      { category: 'Main courses', items: ['Cabbage rolls', 'Sour soup'] },
    ]);
    fullRerender();
    /* eslint-enable no-undef */
  });
}

function menuTemplates() {
  return ['product-menu', 'desserdirina'];
}

menuTemplates().forEach((templateId) => {
  test(`suite11-bilingual-lists-stay-aligned: ${templateId}`, async (t) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await openTemplateEditor(page, templateId);

      // -----------------------------------------------------------------
      // Real-world misalignment check FIRST, before we touch anything: run
      // it against whatever the template's OWN preset shipped, not a
      // contrived setup. desserdirina's shipped presets are, in fact,
      // already misaligned (menu.ro has 3 categories, menu.en has 2) — a
      // genuine "existing draft" per point 5. product-menu's shipped preset
      // is aligned (3/3), so its equivalent check runs against a
      // synthetically-desynced copy instead, right below.
      // -----------------------------------------------------------------
      await t.test(`${templateId}: an already-misaligned pair is never corrupted by an add`, async () => {
        const before = await page.evaluate(() => ({
          ro: JSON.parse(JSON.stringify(draft.config.menu.ro)),
          en: JSON.parse(JSON.stringify(draft.config.menu.en)),
        }));
        if (before.ro.length === before.en.length) {
          // product-menu: force a desync first so this check is meaningful.
          await page.evaluate(() => {
            /* eslint-disable no-undef */
            const en = draft.config.menu.en.slice();
            en.pop();
            setPath(draft.config, 'menu.en', en);
            /* eslint-enable no-undef */
          });
        }
        const preAdd = await page.evaluate(() => ({
          ro: JSON.parse(JSON.stringify(draft.config.menu.ro)),
          en: JSON.parse(JSON.stringify(draft.config.menu.en)),
        }));
        assert.notEqual(preAdd.ro.length, preAdd.en.length, 'precondition: ro/en must be misaligned before this check means anything');

        await page.evaluate(() => onListAdd('menu.ro'));
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => ({
          ro: JSON.parse(JSON.stringify(draft.config.menu.ro)),
          en: JSON.parse(JSON.stringify(draft.config.menu.en)),
        }));
        assert.equal(after.ro.length, preAdd.ro.length + 1, 'the side actually being edited must still grow by exactly one');
        assert.deepEqual(after.en, preAdd.en, 'the misaligned sibling must be left byte-for-byte untouched — never fabricated into alignment, never truncated');
      });

      // Reset to a known-good, ALIGNED shape for every scenario below.
      await setAlignedMenu(page);

      // -----------------------------------------------------------------
      // Point 1/2: add a category on RO -> mirrored onto EN, same index,
      // same text (visible in the other language immediately).
      // -----------------------------------------------------------------
      await t.test(`${templateId}: adding a category in RO mirrors into EN at the same index with the same text`, async () => {
        const before = await page.evaluate(() => ({
          ro: draft.config.menu.ro.length,
          en: draft.config.menu.en.length,
        }));
        await page.evaluate(() => onListAdd('menu.ro'));
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(after.ro.length, before.ro + 1, 'menu.ro must grow by exactly one');
        assert.equal(after.en.length, before.en + 1, 'menu.en must mirror the add and grow by exactly one too');
        const newIdx = after.ro.length - 1;
        assert.equal(after.en[newIdx].category, after.ro[newIdx].category,
          'the mirrored EN category must start with the SAME text as the RO side it was created from');
      });

      // -----------------------------------------------------------------
      // Point 1/2: add a dish INSIDE a category (nested list) -> mirrors.
      // -----------------------------------------------------------------
      await t.test(`${templateId}: adding a dish inside a RO category mirrors into the matching EN category`, async () => {
        const before = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        await page.evaluate(() => onListAdd('menu.ro.0.items'));
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(after.ro[0].items.length, before.ro[0].items.length + 1, 'menu.ro.0.items must grow by exactly one');
        assert.equal(after.en[0].items.length, before.en[0].items.length + 1, 'menu.en.0.items must mirror the nested add');
        const newIdx = after.ro[0].items.length - 1;
        assert.equal(after.en[0].items[newIdx], after.ro[0].items[newIdx],
          'the mirrored EN dish must start with the same text as the RO dish it was created from');
      });

      // -----------------------------------------------------------------
      // Point 2: remove mirrors too, not just add.
      // -----------------------------------------------------------------
      await t.test(`${templateId}: removing a category from RO mirrors the removal onto EN`, async () => {
        const before = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        const lastIdx = before.ro.length - 1;
        await page.evaluate((idx) => onListRemove('menu.ro.' + idx), lastIdx);
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(after.ro.length, before.ro.length - 1, 'menu.ro must shrink by exactly one');
        assert.equal(after.en.length, before.en.length - 1, 'menu.en must mirror the removal and shrink by exactly one too');
      });

      // -----------------------------------------------------------------
      // Reorder: no such control exists anywhere in this codebase for
      // schema-driven list items (menu categories/dishes) — recorded, not
      // silently skipped. See the file-level doc comment for what was
      // searched.
      // -----------------------------------------------------------------
      await t.test(`${templateId}: reorder mirroring`, (st) => {
        st.skip('no reorder/move control exists for menu categories or dishes anywhere in builder/app.js, ' +
          'builder/edit-overlay.js, or this template\'s own script.js — the only "move" mechanism in the ' +
          'codebase reorders photos WITHIN a single gallery item (makeMoveBtn(), unrelated to menu.ro/menu.en) — ' +
          'so there is no add/remove-style mutation entry point to mirror here. If one is ever added, it must ' +
          'call mirrorListAddToSibling()/mirrorListRemoveToSibling()\'s sibling-path logic (siblingLangListPath()) ' +
          'the same way add/remove do.');
      });

      // -----------------------------------------------------------------
      // Point 4: text fallback until translated, then independent.
      // -----------------------------------------------------------------
      await t.test(`${templateId}: a RO category name propagates to EN until EN is translated independently, then stops`, async () => {
        await page.evaluate(() => onListAdd('menu.ro'));
        await page.waitForTimeout(400);
        const afterAdd = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        const idx = afterAdd.ro.length - 1;
        assert.equal(afterAdd.en[idx].category, afterAdd.ro[idx].category, 'sanity: starts mirrored');

        // RO edited once — EN (never independently touched) must follow.
        await page.evaluate((idx) => onInlineTextEdit('menu.ro.' + idx + '.category', 'Aperitive'), idx);
        let cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(cfg.en[idx].category, 'Aperitive', 'EN must still fall back to RO\'s text — nobody has translated it yet');

        // RO edited again — EN must keep following, still untranslated.
        await page.evaluate((idx) => onInlineTextEdit('menu.ro.' + idx + '.category', 'Aperitive reci'), idx);
        cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(cfg.en[idx].category, 'Aperitive reci', 'EN must keep falling back through repeated RO edits');

        // The owner now types a REAL, independent EN translation.
        await page.evaluate((idx) => onInlineTextEdit('menu.en.' + idx + '.category', 'Cold appetizers'), idx);
        cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(cfg.en[idx].category, 'Cold appetizers', 'the direct EN edit must apply');

        // From now on, RO edits must NEVER overwrite the translated EN text again.
        await page.evaluate((idx) => onInlineTextEdit('menu.ro.' + idx + '.category', 'Aperitive reci și calde'), idx);
        cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(cfg.ro[idx].category, 'Aperitive reci și calde', 'RO itself must still update normally');
        assert.equal(cfg.en[idx].category, 'Cold appetizers', 'EN must be independent now — it must NOT be overwritten by a later RO edit');
      });

      // -----------------------------------------------------------------
      // Point 3: language-neutral leaves (anything not itemShape "text",
      // e.g. price/photos/icon) are shared — always identical both ways.
      // Neither product-menu nor desserdirina's real schema.json declares
      // such a field on menu.ro/menu.en today (only "category":"text" and
      // "items":"list"), so this grafts a synthetic one onto the live
      // in-memory schema, the same technique
      // suite2-string-gallery-in-photos-panel.test.js uses to exercise a
      // generic mechanism independent of what any shipped schema declares.
      // -----------------------------------------------------------------
      await t.test(`${templateId}: a language-neutral itemShape leaf (e.g. price) stays identical on both sides`, async () => {
        await page.evaluate(() => {
          /* eslint-disable no-undef */
          const schema = currentTemplate.data.schema;
          schema.sections.forEach((s) => {
            (s.fields || []).forEach((f) => {
              if (f.key === 'menu.ro' || f.key === 'menu.en') {
                f.itemShape = Object.assign({}, f.itemShape, { price: 'price' }); // any non-"text", non-"list" type
              }
            });
          });
          if (!draft.config.menu.ro[0].price) draft.config.menu.ro[0].price = '';
          if (!draft.config.menu.en[0].price) draft.config.menu.en[0].price = '';
          /* eslint-enable no-undef */
        });

        await page.evaluate(() => onInlineTextEdit('menu.ro.0.price', '25 lei'));
        let cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(cfg.en[0].price, '25 lei', 'a neutral leaf edited on RO must update EN too — it is shared, not translated');

        await page.evaluate(() => onInlineTextEdit('menu.en.0.price', '5 EUR'));
        cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config.menu)));
        assert.equal(cfg.ro[0].price, '5 EUR', 'changing the shared leaf from the EN side must update RO too — same underlying value either way');
      });
    } finally {
      await page.close();
    }
  });
});
