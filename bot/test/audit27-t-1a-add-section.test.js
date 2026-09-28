'use strict';
/**
 * bot/test/audit27-t-1a-add-section.test.js — PLAN-AUDIT-2026-09-27, task
 * T-1A (PLAN-UX-2026-09-27 §5.2, "Bibliotecă minimă de secțiuni opționale" —
 * ignore PLAN-AUDIT task ids, this task is a PLAN-UX follow-up).
 *
 * T-1A is the BUILDER side of "Adaugă o secțiune": templates/<id>/
 * schema.json's pageSections[] entries carry `addable: true`, `description`
 * and `seed`. This file originally proved the builder machinery
 * (pageSectionSeedEntry/ensurePageSectionsInitialized/hidookAddSection —
 * builder/app.js §14b) against a synthetic fixture grafted onto
 * desserdirina's schema at runtime, because at the time no shipped template
 * declared `addable` yet (T-1B/T-1C, the schema-side tasks, had not landed).
 *
 * T-1B/T-1C have since landed: every one of the five shipped templates now
 * declares real `addable` page sections (FAQ, Program/Schedule, and
 * "Unde ne găsești" — see each templates/<id>/schema.json's pageSections).
 * The synthetic graft is now redundant with the real contract, so this file
 * exercises the REAL shipped sections instead — one full add/publish/undo
 * cycle per (template, addable section) pair, 13 in total.
 *
 * Doing this rewrite surfaced a genuine product bug this file's synthetic
 * fixture could never have caught (it only ever grafted onto desserdirina,
 * whose seed shape happens to be correct): templates/portfolio/schema.json
 * and templates/professionals/schema.json shipped `seed` objects for their
 * addable sections FLAT (e.g. `{ "title": …, "items": […] }`) instead of
 * nested under the section's own config key (e.g. `{ "faq": { "title": …,
 * "items": […] } }`), while every template's own template.html reads
 * `{{faq.title}}` / `<!-- @if faq.items -->` etc. — i.e. nested. Applying a
 * flat seed via applySectionSeed(draft.config, def.seed) wrote straight
 * onto draft.config.title/draft.config.items (clobbering unrelated fields,
 * e.g. the site's own title) while draft.config.faq stayed empty — so the
 * section would never actually appear after "adding" it. Fixed by nesting
 * those four seed objects (portfolio faq/location, professionals
 * schedule/location) under their section id, matching every other
 * template's already-correct shape. The sanity test below now guards that
 * shape directly so this can't regress silently again.
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
const TEMPLATES_DIR = path.join(ROOT, 'templates');

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

function shippedTemplateIds() {
  return fs.readdirSync(TEMPLATES_DIR).filter((id) =>
    fs.existsSync(path.join(TEMPLATES_DIR, id, 'schema.json')) &&
    fs.existsSync(path.join(TEMPLATES_DIR, id, 'template.html')));
}

function readSchema(templateId) {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'schema.json'), 'utf8'));
}

/** The first string leaf found by walking `seed` depth-first — a marker
 * string cheap to assert is present (after adding) or absent (before). */
function firstSeedString(seed) {
  if (seed == null) return null;
  if (typeof seed === 'string') return seed || null;
  if (Array.isArray(seed)) {
    for (const v of seed) { const f = firstSeedString(v); if (f) return f; }
    return null;
  }
  if (typeof seed === 'object') {
    for (const k of Object.keys(seed)) { const f = firstSeedString(seed[k]); if (f) return f; }
    return null;
  }
  return null;
}

test('sanity: every shipped template declares at least one real `addable` page section, and its seed nests under the section\'s own config key', () => {
  const ids = shippedTemplateIds();
  const problems = [];
  ids.forEach((id) => {
    const schema = readSchema(id);
    const addable = (schema.pageSections || []).filter((s) => s && s.addable === true);
    if (addable.length === 0) {
      problems.push(`templates/${id}/schema.json declares no addable page section`);
      return;
    }
    addable.forEach((def) => {
      if (!def.description || typeof def.description !== 'string' || !def.description.trim()) {
        problems.push(`templates/${id}/schema.json: addable section "${def.id}" has no description`);
      }
      if (!def.seed || typeof def.seed !== 'object') {
        problems.push(`templates/${id}/schema.json: addable section "${def.id}" has no seed`);
        return;
      }
      // The contract (builder/app.js's applySectionSeed()) deep-merges
      // `seed` straight onto draft.config — so unless `seed` itself is
      // nested under the section's own id, it clobbers unrelated top-level
      // fields instead of ever populating what the template actually reads
      // (`{{<id>.field}}` / `<!-- @if <id>.field -->`). See this file's
      // header comment for the real bug this caught (portfolio/professionals).
      if (!(def.id in def.seed)) {
        problems.push(
          `templates/${id}/schema.json: addable section "${def.id}"'s seed is not nested under "${def.id}" ` +
          `(keys: ${Object.keys(def.seed).join(', ')}) — it would write onto the wrong config fields and the ` +
          'section would never actually appear after being added'
        );
      }
    });
  });
  assert.deepEqual(problems, [], 'addable-section contract violations:\n' + problems.join('\n'));
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

test('T-1A/T-1B/T-1C: every real addable section stays hidden until added — via the catalog, in the preview and on the published /live page — and undo removes it again', async () => {
  const failures = [];
  const combos = [];
  shippedTemplateIds().forEach((templateId) => {
    const schema = readSchema(templateId);
    (schema.pageSections || []).filter((s) => s && s.addable === true).forEach((def) => {
      combos.push({ templateId, def });
    });
  });
  assert.ok(combos.length > 0, 'no shipped template declares any addable section — nothing for this oracle to prove');

  for (const { templateId, def } of combos) {
    const label = `${templateId}/${def.id}`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await openTemplateEditor(page, templateId);

      // ---- 1) Hidden before it is ever added ----
      const before = await previewSectionState(page, def.id);
      if (before.present) failures.push(`${label}: section already visible before being added — addable sections must start hidden`);
      await screenshot(page, `${templateId}-${def.id}-01-hidden-before-add`);

      // ---- 2) Not listed as an ordinary row in "Secțiuni pagină" either ----
      await page.locator('#btn-open-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'visible' });
      const rowLabels = await page.locator('.hb-secrow__label').allInnerTexts();
      if (rowLabels.some((t) => t.trim() === def.label)) {
        failures.push(`${label}: a still-pending addable section must not appear as an ordinary row`);
      }

      // ---- 3) The catalog lists it, with its schema-declared description ----
      const addBtn = page.locator('#btn-add-section-panel');
      if (!(await addBtn.isVisible().catch(() => false))) {
        failures.push(`${label}: "Adaugă o secțiune" button not visible — an owner cannot reach the catalog`);
        continue;
      }
      await addBtn.click();
      await page.locator('#modal-add-section').waitFor({ state: 'visible' });
      const card = page.locator('.add-section-card', { hasText: def.label });
      if (!(await card.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false))) {
        failures.push(`${label}: no catalog card labelled "${def.label}"`);
        continue;
      }
      if (def.description && !(await card.innerText()).includes(def.description)) {
        failures.push(`${label}: catalog card does not show the schema's own description`);
      }
      await screenshot(page, `${templateId}-${def.id}-02-add-section-catalog-open`);

      // ---- 4) Adding it: shows the section, toasts, closes the modal ----
      await card.locator(`[data-add-section-id="${def.id}"]`).click();
      await page.locator('#modal-add-section').waitFor({ state: 'hidden', timeout: 5000 });
      const toastText = await page.locator('#toast').innerText().catch(() => '');
      if (!toastText.includes(def.label)) failures.push(`${label}: toast did not name the added section, got: "${toastText}"`);
      await page.waitForTimeout(700);
      await screenshot(page, `${templateId}-${def.id}-03-section-added-toast-and-preview`);

      const seedMarker = firstSeedString(def.seed);
      const after = await previewSectionState(page, def.id);
      if (!after.present) failures.push(`${label}: section did not appear in the preview after being added`);
      if (seedMarker && after.present && !after.text.includes(seedMarker)) {
        failures.push(`${label}: seeded content ("${seedMarker.slice(0, 40)}") not found in the rendered section`);
      }

      const rowLabelsAfter = await page.locator('.hb-secrow__label').allInnerTexts();
      if (!rowLabelsAfter.some((t) => t.trim() === def.label)) {
        failures.push(`${label}: once added, the section must appear as an ordinary row in "Secțiuni pagină"`);
      }
      await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});

      // ---- 5) Publish, then check the REAL /live/<slug>/ page ----
      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      // Slugs are capped server-side at 40 chars (bot/server.js's slug
      // validation) — a longer one is silently replaced with an
      // auto-generated fallback (bot/server.js ~line 3568), which would
      // make this test's own guess at the published URL wrong, not prove a
      // product defect. Stay well under the cap: short hash, not the full
      // template/section id, keeps every one of the 13 combos unique.
      const slug = 't1a-' + crypto.createHash('md5').update(templateId + '/' + def.id + '/' + Date.now() + '/' + Math.random()).digest('hex').slice(0, 16);
      await page.locator('#input-slug').fill(slug);
      await page.locator('#btn-publish-continue').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      await page.locator('#input-email').fill(`audit27-t1a-${def.id}@example.com`);
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();
      await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
      await page.locator('#btn-pay-publish').click();
      await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
      await screenshot(page, `${templateId}-${def.id}-04-published-site-with-added-section`);

      // 13 full publish cycles run back-to-back in this one test — under
      // cumulative disk/DB load, a later iteration's site can take longer
      // than a couple of seconds to become servable. Generous retry budget
      // (up to 15s) rather than a tight one, so this proves reachability,
      // not this machine's momentary I/O latency.
      let liveResp;
      let liveHtml = '';
      for (let attempt = 0; attempt < 30; attempt++) {
        liveResp = await page.request.get(global.__BASE__ + '/live/' + slug + '/').catch(() => null);
        if (liveResp && liveResp.status() === 200) { liveHtml = await liveResp.text(); break; }
        await page.waitForTimeout(500);
      }
      if (!liveResp || liveResp.status() !== 200) {
        failures.push(`${label}: published page not reachable at /live/${slug}/ (last status: ${liveResp ? liveResp.status() : 'request failed'})`);
      } else {
        if (!new RegExp('<section[^>]*\\bid="' + def.id + '"').test(liveHtml)) {
          failures.push(`${label}: the published /live/<slug>/ page does not render the added section — a customer cannot reach it`);
        }
        if (seedMarker && !liveHtml.includes(seedMarker)) {
          failures.push(`${label}: the published page is missing the seeded content`);
        }
      }

      // ---- 6) Undo removes it again ----
      await page.locator('#btn-close-success').click({ timeout: 4000 }).catch(() => {});
      await page.evaluate(() => { undo(); });
      await page.waitForTimeout(700);
      await screenshot(page, `${templateId}-${def.id}-05-after-undo-section-removed`);

      const afterUndo = await previewSectionState(page, def.id);
      if (afterUndo.present) failures.push(`${label}: undo did not remove the just-added section from the preview`);
    } catch (err) {
      failures.push(`${label}: threw — ${err && err.message}`);
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(failures, [], `addable-section add/publish/undo cycle failed for ${failures.length} case(s):\n` + failures.join('\n'));
});
