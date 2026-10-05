'use strict';
/**
 * bot/test/audit27-w-6-addable-reviews-team-demo-marks.test.js
 *
 * W-6 (VERIFICARE-2026-10-04, templates-live#1 and #4):
 *
 *  #4 "Recenzii" (every template) and "Echipă" (professionals) used to be
 *     listed as ACTIVE rows in "Secțiuni pagină" although the page had no such
 *     section and nothing could add one — a dead switch. They are now
 *     `addable` sections: absent from the page and from the row list until the
 *     owner adds them from "Adaugă o secțiune".
 *
 *  #1 Starter text seeded by "Adaugă o secțiune" (FAQ, Program, Unde ne
 *     găsești, Recenzii, Echipă) shipped live unmarked. It is now counted by
 *     computeDemoTextPaths() — the walk behind both the amber "text de
 *     exemplu" tint in the editor and the publish checklist's
 *     "N blocuri cu text de exemplu" row — until the owner rewrites it. The
 *     address of "Unde ne găsești" starts from the owner's contact.address.
 *
 * Real browser, isolated server, no publish. Screenshots go to os.tmpdir(),
 * named after the action just performed.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-6-addable-reviews-team-demo-marks.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

function loadPlaywright() {
  const candidates = [path.join(ROOT, 'node_modules/playwright'), 'playwright'];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) { /* next */ }
  }
  throw new Error('playwright not found');
}
const { chromium } = loadPlaywright();

function readSchema(id) {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, 'schema.json'), 'utf8'));
}

function expectedNewlyAddable(id) {
  return id === 'professionals' ? ['testimonials', 'team'] : ['testimonials'];
}

test('schema: testimonials (every template) and team (professionals) are addable, seeded, described', () => {
  const problems = [];
  TEMPLATES.forEach((id) => {
    const defs = readSchema(id).pageSections;
    expectedNewlyAddable(id).forEach((sid) => {
      const def = defs.find((s) => s.id === sid);
      if (!def) { problems.push(`${id}: no pageSection "${sid}"`); return; }
      if (def.addable !== true) problems.push(`${id}/${sid}: not addable`);
      if (!def.description || !def.description.trim()) problems.push(`${id}/${sid}: no description`);
      if (!def.seed || !(sid in def.seed)) problems.push(`${id}/${sid}: seed missing or not nested under "${sid}"`);
    });
    const loc = defs.find((s) => s.id === 'location' && s.addable);
    if (loc && !(loc.seedFrom && loc.seedFrom['location.address'] === 'contact.address')) {
      problems.push(`${id}/location: address must start from contact.address (seedFrom)`);
    }
  });
  assert.deepEqual(problems, []);
});

let browser;
let server;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w6-'));
  process.env.SERVER_SECRET = 'audit27-w6-' + crypto.randomBytes(8).toString('hex');
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

async function shot(page, action) {
  await page.screenshot({ path: path.join(os.tmpdir(), `audit27-w6-${action}.png`) }).catch(() => {});
}

const demoPaths = (page) => page.evaluate(() => computeDemoTextPaths());
const checklistDemoLabel = (page) => page.evaluate(() => {
  const items = computePublishChecklist(currentTemplate.data.schema, draft.config, currentTemplate.data);
  return items.find((i) => i.id === 'demoText').label;
});

async function addFromCatalog(page, def) {
  const addBtn = page.locator('#btn-add-section-panel');
  await addBtn.waitFor({ state: 'visible', timeout: 8000 });
  await addBtn.click();
  await page.locator('#modal-add-section').waitFor({ state: 'visible' });
  const card = page.locator('.add-section-card', { hasText: def.label });
  await card.waitFor({ state: 'visible', timeout: 5000 });
  await card.locator(`[data-add-section-id="${def.id}"]`).click();
  await page.locator('#modal-add-section').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(1300);
}

test('every template: Recenzii (and Echipă on professionals) are off the page until added; once added their sample text is tinted and counted by the checklist', async () => {
  const failures = [];

  for (const templateId of TEMPLATES) {
    const schema = readSchema(templateId);
    const addableDefs = schema.pageSections.filter((s) => s.addable === true);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await openTemplateEditor(page, templateId);
      const frame = page.frameLocator('#preview-iframe');

      // 1) absent from the page and from the active rows, listed in the catalog
      await page.locator('#btn-open-drawer').click();
      await page.locator('#details-drawer').waitFor({ state: 'visible' });
      const rows = (await page.locator('.hb-secrow__label').allInnerTexts()).map((t) => t.trim());
      const baseline = (await demoPaths(page)).length;
      await shot(page, `${templateId}-01-sections-panel-before-adding`);

      for (const sid of expectedNewlyAddable(templateId)) {
        const def = schema.pageSections.find((s) => s.id === sid);
        if ((await frame.locator('#' + sid).count()) !== 0) failures.push(`${templateId}: #${sid} is on the page before being added`);
        if (rows.includes(def.label)) failures.push(`${templateId}: "${def.label}" listed as an active row before being added`);
      }
      await page.locator('#btn-add-section-panel').click();
      await page.locator('#modal-add-section').waitFor({ state: 'visible' });
      const catalogText = await page.locator('#add-section-modal-body').innerText();
      for (const sid of expectedNewlyAddable(templateId)) {
        const def = schema.pageSections.find((s) => s.id === sid);
        if (!catalogText.includes(def.label)) failures.push(`${templateId}: "Adaugă o secțiune" does not list "${def.label}"`);
      }
      await shot(page, `${templateId}-02-add-section-catalog-open`);
      await page.locator('#btn-close-add-section').click();
      await page.locator('#modal-add-section').waitFor({ state: 'hidden' });

      // the owner's own address, so "Unde ne găsești" can start from it
      const ownAddress = 'Strada Verificării 7, Cluj-Napoca';
      await page.evaluate((a) => { setPath(draft.config, 'contact.address', a); saveDraft(); }, ownAddress);
      const baselineAfterAddress = (await demoPaths(page)).length;
      if (baselineAfterAddress > baseline) failures.push(`${templateId}: editing contact.address added demo marks`);

      // 2) add every addable section from the catalog, one by one
      for (const def of addableDefs) {
        const before = (await demoPaths(page)).length;
        await addFromCatalog(page, def);
        await shot(page, `${templateId}-03-added-${def.id}`);
        const sectionPresent = (await frame.locator('#' + def.id).count()) > 0;
        if (!sectionPresent) { failures.push(`${templateId}/${def.id}: not on the page after being added`); continue; }
        const tinted = await frame.locator('#' + def.id + ' .hb-demo-text').count();
        const paths = await demoPaths(page);
        const own = paths.filter((p) => p.split('.')[0] === def.id || p.indexOf('testimonials') === 0 && def.id === 'testimonials');
        if (def.id === 'location') {
          const addr = await page.evaluate(() => draft.config.location && draft.config.location.address);
          if (addr !== ownAddress) failures.push(`${templateId}/location: address is "${addr}", expected the owner's contact.address`);
          if (own.length !== 0) failures.push(`${templateId}/location: the owner's own address must not count as sample text, got ${own}`);
          continue;
        }
        if (paths.length <= before) failures.push(`${templateId}/${def.id}: seeded text not counted as sample (paths ${before} -> ${paths.length})`);
        if (tinted === 0) failures.push(`${templateId}/${def.id}: no .hb-demo-text in the preview section`);
        if (own.length === 0) failures.push(`${templateId}/${def.id}: no demo path under "${def.id}"`);
      }

      // 3) the publish checklist counts them too
      const total = (await demoPaths(page)).length;
      const label = await checklistDemoLabel(page);
      if (!label.startsWith(String(total) + ' ')) failures.push(`${templateId}: checklist says "${label}", expected ${total} blocks`);
      if (total <= baseline) failures.push(`${templateId}: demo count did not grow (${baseline} -> ${total})`);

      // 4) rewriting a seeded text drops its mark; hiding the section drops all of its marks
      const first = addableDefs.find((d) => d.id !== 'location');
      const firstPath = (await demoPaths(page)).find((p) => p.indexOf(first.id) === 0 || (first.id === 'testimonials' && p.indexOf('testimonials') === 0));
      if (firstPath) {
        await page.evaluate((p) => { setPath(draft.config, p, 'Textul meu real'); saveDraft(); }, firstPath);
        if ((await demoPaths(page)).includes(firstPath)) failures.push(`${templateId}: ${firstPath} still counted after the owner rewrote it`);
      }
      await page.evaluate((sid) => { togglePageSectionRemoved(currentTemplate.data.schema, sid, true); }, first.id);
      const afterHide = await demoPaths(page);
      if (afterHide.some((p) => p.indexOf(first.id) === 0 && first.id !== 'testimonials')) failures.push(`${templateId}: hidden ${first.id} still counted`);
      if (first.id === 'testimonials' && afterHide.some((p) => p.indexOf('testimonials') === 0)) failures.push(`${templateId}: hidden testimonials still counted`);
      await shot(page, `${templateId}-04-after-rewrite-and-hide`);
    } catch (err) {
      failures.push(`${templateId}: threw - ${err && err.message}`);
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
