'use strict';
/**
 * bot/test/audit27-t-1a-add-section.test.js — PLAN-AUDIT-2026-09-27, task
 * T-1A (PLAN-UX-2026-09-27 §5.2, "Bibliotecă minimă de secțiuni opționale" —
 * ignore PLAN-AUDIT task ids, this task is a PLAN-UX follow-up).
 *
 * T-1A is the BUILDER side of "Adaugă o secțiune": the contract shared with
 * the parallel schema tasks (T-1B/T-1C) is that templates/<id>/schema.json's
 * pageSections[] entries gain `addable: true`, `description` and `seed` —
 * neither of those tasks has merged yet (grep confirms: no template ships
 * `addable` today), so this oracle grafts a synthetic-but-realistic fixture
 * onto a REAL template's live schema + config via page.evaluate() (the same
 * established technique as bot/test/suite2-string-gallery-in-photos-panel.
 * test.js and bot/test/wave5-desserdirina-itemshape-schema.test.js), rather
 * than depending on those tasks — so it never blocks on them, and re-proves
 * the real contract's shape the moment either one lands (`addable`/
 * `description`/`seed` read exactly as documented there).
 *
 * The fixture reuses desserdirina's REAL, already-shipped "testimonials"
 * section (templates/desserdirina/template.html's `<!-- @if testimonials
 * --><section id="testimonials">…`) — flagged `addable: true` for this test
 * only — instead of inventing new markup, so what this file proves about
 * visibility is genuine build.js behaviour (reorderSections()), not a test
 * double standing in for it.
 *
 * RED (pre-T-1A behaviour, confirmed by reading build.js's reorderSections()
 * before this task's changes): a `config.sections` entry for a section id
 * the app never explicitly lists is *rendered anyway* — see reorderSections'
 * own doc comment, "any rendered section NOT mentioned in sectionsMeta …
 * keeps rendering". Naively marking a section "addable" without also
 * seeding it into config.sections as `{removed:true, pending:true}` (this
 * task's actual fix — see builder/app.js's pageSectionSeedEntry()) would
 * therefore show it immediately, not hide it — the opposite of "addable
 * section is hidden until added".
 *
 * GREEN (this task): the section starts genuinely hidden — from build.js's
 * own reorderSections(), so both the editor's live preview (same engine.js
 * bundle) and the published /live/<slug>/ page agree — appears the instant
 * "Adaugă o secțiune" is used (seed applied only into still-empty fields,
 * pre-existing content in a non-empty field left untouched, one undo step
 * recorded), and undo takes it back out.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-t-1a-add-section.test.js
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
    try { return require(cand); } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

test('sanity: no shipped template declares `addable` yet — this oracle must not silently depend on T-1B/T-1C', () => {
  const templatesDir = path.join(ROOT, 'templates');
  const ids = fs.readdirSync(templatesDir).filter((name) =>
    fs.existsSync(path.join(templatesDir, name, 'schema.json')));
  ids.forEach((id) => {
    const schema = JSON.parse(fs.readFileSync(path.join(templatesDir, id, 'schema.json'), 'utf8'));
    const addable = (schema.pageSections || []).some((s) => s && s.addable === true);
    assert.equal(addable, false,
      `templates/${id}/schema.json already declares an addable page section — ` +
      'T-1B/T-1C landed; this file\'s synthetic fixture is now redundant with the real contract ' +
      'and should be pointed at a real addable section instead.');
  });
});

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

async function screenshot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-t1a-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

/** Whether the live preview iframe currently renders the given top-level
 * <section id="…">, and (when present) its rendered text. */
async function previewSectionState(page, sectionId) {
  const frame = page.frameLocator('#preview-iframe');
  const count = await frame.locator('#' + sectionId).count();
  if (count === 0) return { present: false, text: '' };
  return { present: true, text: (await frame.locator('#' + sectionId).innerText()).trim() };
}

const SEED_TITLE = 'Ce spun clienții';
const PRE_EXISTING_QUOTE = 'Deja excelent înainte de adăugare';
const SEED_QUOTE_MARKER = 'SEED-CONTENT-MARKER-nu-trebuie-sa-apara';
const ADDABLE_DESCRIPTION = 'Arată recenzii reale de la clienți mulțumiți.';

/** Grafts the T-1A fixture onto the live page: marks desserdirina's real
 * "testimonials" pageSections entry `addable: true` (+ description + seed),
 * resets config.sections so it reseeds from the patched schema, and starts
 * `testimonials` NON-EMPTY (a placeholder quote) while `testimonialsTitle`
 * stays empty — so the seed's own array is provably NOT applied (existing
 * content survives) while the seed's scalar IS applied (still-empty field),
 * and the section's hidden→shown transition is provably reorderSections'
 * `removed` flag at work, not `<!-- @if testimonials -->` reacting to an
 * empty array (see this file's header comment).
 */
async function graftFixtureAndReset(page) {
  await page.evaluate(({ seedTitle, preQuote, seedQuote, description }) => {
    /* eslint-disable no-undef */
    const schema = currentTemplate.data.schema;
    const def = schema.pageSections.find((s) => s.id === 'testimonials');
    if (!def) throw new Error('fixture precondition failed: desserdirina schema has no "testimonials" pageSections entry');
    def.addable = true;
    def.description = description;
    def.seed = {
      testimonialsTitle: seedTitle,
      testimonials: [{ quote: seedQuote, name: 'Seed Name', role: 'Seed Role' }],
    };
    // Start from a clean slate: real config.sections (populated by the
    // ORIGINAL, non-addable schema when the drawer auto-opened earlier)
    // must be rebuilt from the just-patched schema, not merged onto stale
    // entries.
    delete draft.config.sections;
    draft.config.testimonials = [{ quote: preQuote, name: 'Test Pre', role: '' }];
    draft.config.testimonialsTitle = '';
    ensurePageSectionsInitialized(schema);
    // Record this as its own undo baseline (saveDraft() -> pushHistory())
    // BEFORE the add below — otherwise the add's own saveDraft() would be
    // the first history write since the page loaded, and undo would jump
    // all the way back to the pristine demo config instead of to "just
    // before this section was added", which is what step 6 below means to
    // prove.
    saveDraft();
    fullRerender();
    /* eslint-enable no-undef */
  }, { seedTitle: SEED_TITLE, preQuote: PRE_EXISTING_QUOTE, seedQuote: SEED_QUOTE_MARKER, description: ADDABLE_DESCRIPTION });
  await page.waitForTimeout(700);
}

let browser;
let server;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-t1a-'));
  process.env.SERVER_SECRET = 'audit27-t1a-' + crypto.randomBytes(8).toString('hex');
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

test('T-1A: an addable section stays hidden until added — via the catalog, in the preview and on the published /live page — and undo removes it again', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'desserdirina');
    await graftFixtureAndReset(page);

    // ---- 1) Hidden before it is ever added — despite non-empty content ----
    const before = await previewSectionState(page, 'testimonials');
    assert.equal(before.present, false,
      'an addable section must be hidden until added, even though its `testimonials` array is non-empty ' +
      '(this proves reorderSections\' `removed:true` is what hides it, not "<!-- @if testimonials -->" reacting to empty content)');
    await screenshot(page, '01-addable-section-hidden-before-add');

    // ---- 2) Not listed as an ordinary row in "Secțiuni pagină" either ----
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const rowLabels = await page.locator('.hb-secrow__label').allInnerTexts();
    assert.ok(!rowLabels.some((t) => t.includes('Recenzii')),
      'a still-pending addable section must not appear as an ordinary row — only in the "Adaugă o secțiune" catalog');

    // ---- 3) The catalog lists it, with its schema-declared description ----
    const addBtn = page.locator('#btn-add-section-panel');
    await addBtn.waitFor({ state: 'visible' });
    await addBtn.click();
    await page.locator('#modal-add-section').waitFor({ state: 'visible' });
    const card = page.locator('.add-section-card', { hasText: 'Recenzii' });
    await card.waitFor({ state: 'visible', timeout: 5000 });
    assert.ok((await card.innerText()).includes(ADDABLE_DESCRIPTION),
      'the catalog card must show the schema\'s own `description`');
    await screenshot(page, '02-add-section-catalog-open');

    // ---- 4) Adding it: applies the seed only into still-empty fields, ----
    //         shows the section, records one undo step, closes + toasts.
    await card.locator('[data-add-section-id="testimonials"]').click();
    await page.locator('#modal-add-section').waitFor({ state: 'hidden', timeout: 5000 });
    const toastText = await page.locator('#toast').innerText().catch(() => '');
    assert.ok(toastText.includes('Recenzii'), `toast must name the added section in Romanian, got: "${toastText}"`);
    await page.waitForTimeout(700);
    await screenshot(page, '03-section-added-toast-and-preview');

    const after = await previewSectionState(page, 'testimonials');
    assert.equal(after.present, true, 'the section must appear in the preview immediately after adding it');
    assert.ok(after.text.includes(SEED_TITLE), 'the seeded title (a field that was empty) must be applied');
    assert.ok(after.text.includes(PRE_EXISTING_QUOTE),
      'pre-existing, non-empty testimonial content must survive the add — the seed must not overwrite it');
    assert.ok(!after.text.includes(SEED_QUOTE_MARKER),
      'the seed\'s own testimonial content must NOT appear — `testimonials` was already non-empty, so the seed must skip it (only still-empty fields get seeded)');

    const configAfterAdd = await page.evaluate(() => ({
      title: draft.config.testimonialsTitle,
      entry: (draft.config.sections || []).find((e) => e.id === 'testimonials'),
    }));
    assert.equal(configAfterAdd.title, SEED_TITLE);
    assert.ok(configAfterAdd.entry, 'config.sections must carry an entry for the added section');
    assert.equal(configAfterAdd.entry.removed, false);
    assert.equal(configAfterAdd.entry.pending, undefined, 'the `pending` marker must be cleared once added');

    // Now an ordinary row — reorderable/hideable like any other section,
    // no longer only reachable through the catalog.
    const rowLabelsAfter = await page.locator('.hb-secrow__label').allInnerTexts();
    assert.ok(rowLabelsAfter.some((t) => t.includes('Recenzii')),
      'once added, the section must appear as an ordinary row in "Secțiuni pagină"');

    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});

    // ---- 5) Publish, then check the REAL /live/<slug>/ page ----
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'audit27-t1a-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit27-t1a@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
    await screenshot(page, '04-published-site-with-added-section');

    let liveResp;
    let liveHtml = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      liveResp = await page.request.get(global.__BASE__ + '/live/' + slug + '/');
      if (liveResp.status() === 200) { liveHtml = await liveResp.text(); break; }
      await page.waitForTimeout(300);
    }
    assert.equal(liveResp.status(), 200, 'the published page must be reachable');
    assert.match(liveHtml, /<section[^>]*\bid="testimonials"/,
      'the published /live/<slug>/ page must render the added section — a customer, not just the editor, must be able to reach it');
    assert.ok(liveHtml.includes(SEED_TITLE), 'the published page must include the seeded title');
    assert.ok(liveHtml.includes(PRE_EXISTING_QUOTE), 'the published page must include the pre-existing testimonial content');

    // ---- 6) Undo removes it again ----
    await page.locator('#btn-close-success').click({ timeout: 4000 }).catch(() => {});
    await page.evaluate(() => { undo(); });
    await page.waitForTimeout(700);
    await screenshot(page, '05-after-undo-section-removed');

    const afterUndo = await previewSectionState(page, 'testimonials');
    assert.equal(afterUndo.present, false, 'undo must remove the just-added section from the preview again');
    const titleAfterUndo = await page.evaluate(() => draft.config.testimonialsTitle);
    assert.equal(titleAfterUndo, '', 'undo must revert the seeded title along with the section');
  } finally {
    await page.close();
  }
});
