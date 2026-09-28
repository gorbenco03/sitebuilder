'use strict';
/**
 * bot/test/audit27-t-1b-addable-sections.test.js
 *
 * T-1B (PLAN-AUDIT-2026-09-27 §9 / PLAN-UX-2026-09-27 §5.2 "Bibliotecă
 * minimă de secțiuni opționale"): product-menu, local-service and
 * desserdirina each gain three optional page sections — "Întrebări
 * frecvente" (FAQ), "Program" (orar) and "Unde ne găsești" (adresă + link
 * Google Maps) — declared in schema.json's pageSections with the CONTRACT
 * fields `addable`, `description` and `seed`. They are hidden until a seed
 * is applied (no content = no <section>, same @if-gated pattern as the
 * existing optional "testimonials" section), and once visible they must
 * render correctly at both a phone width (390) and a desktop width (1440)
 * with no horizontal overflow.
 *
 * Causal RED: built from PARENT_SHA (the commit this task started from,
 * before any of templates/{product-menu,local-service,desserdirina}'s
 * schema.json/template.html/styles.css/script.js changed), the same seeded
 * config produces no #faq/#hours/#location markup at all — the old
 * template.html has no matching <section id="…">, so there is nothing to
 * hide or show. GREEN: the current template.html renders all three,
 * hidden by default, visible and overflow-free once seeded.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-t-1b-addable-sections.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATES = ['product-menu', 'local-service', 'desserdirina'];
const ADDABLE_IDS = ['faq', 'hours', 'location'];

// The commit this task branched from — before templates/{product-menu,
// local-service,desserdirina} gained the addable faq/hours/location
// sections. Pinned to a SHA (not HEAD) so the RED half keeps meaning what
// it says after this task is committed, the same convention as s56/
// wave7-sections-e2e-all-templates' PRE_SECTIONS_SHA.
const PARENT_SHA = '98ae941712ada203d4b50ede5f83a06535229adc';

function loadPlaywright() {
  const candidates = ['playwright', path.join(ROOT, 'node_modules/playwright')];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) { /* try next */ }
  }
  throw new Error('playwright not found — install devDependency (npm install in the repo root)');
}

function readGitFile(ref, relPath) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return null; // did not exist at that ref
  }
}

/**
 * Materialize a servable copy of `templateId` into a fresh tmp dir, using
 * either the CURRENT working tree ("after") or `PARENT_SHA` ("before") for
 * template.html/styles.css/script.js, and rendering `config` through the
 * REAL build.js renderHtml() — the same engine every live/published site
 * uses. Images/collage/qrcode assets always come from the working tree
 * (irrelevant to this task's markup/overflow assertions).
 */
function buildSite(templateId, config, { useOldTemplate } = {}) {
  const tplDir = path.join(ROOT, 'templates', templateId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `audit27-t1b-${templateId}-`));

  const chromeFiles = ['template.html', 'styles.css', 'script.js'];
  for (const name of chromeFiles) {
    const content = useOldTemplate
      ? readGitFile(PARENT_SHA, `templates/${templateId}/${name}`)
      : fs.readFileSync(path.join(tplDir, name), 'utf8');
    assert.ok(content != null, `${templateId}/${name}: missing at ${useOldTemplate ? PARENT_SHA : 'working tree'}`);
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  for (const name of ['collage.js', 'qrcode.js']) {
    const src = path.join(tplDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, name));
  }
  const imagesSrc = path.join(tplDir, 'images');
  if (fs.existsSync(imagesSrc)) {
    const imagesOut = path.join(dir, 'images');
    fs.mkdirSync(imagesOut, { recursive: true });
    for (const img of fs.readdirSync(imagesSrc)) {
      const from = path.join(imagesSrc, img);
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(imagesOut, img));
    }
  }
  if (templateId === 'desserdirina') {
    const fontsSrc = path.join(tplDir, 'fonts');
    if (fs.existsSync(fontsSrc)) {
      const fontsOut = path.join(dir, 'fonts');
      fs.mkdirSync(fontsOut, { recursive: true });
      for (const f of fs.readdirSync(fontsSrc)) fs.copyFileSync(path.join(fontsSrc, f), path.join(fontsOut, f));
    }
  }

  const templateHtml = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const html = renderHtml(templateHtml, config);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');

  return dir;
}

function firstPresetConfig(templateId) {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')).presets;
  return JSON.parse(JSON.stringify(presets[0].config));
}

function schemaOf(templateId) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
}

/** Merges every addable pageSections entry's `seed` into `config` (shallow — each seed's top-level keys, e.g. "faq", are new). */
function applySeeds(config, schema) {
  for (const sec of schema.pageSections) {
    if (ADDABLE_IDS.includes(sec.id)) {
      assert.equal(sec.addable, true, `pageSections["${sec.id}"] must be addable:true`);
      assert.equal(typeof sec.description, 'string', `pageSections["${sec.id}"] must have a description`);
      assert.ok(sec.description.trim().length > 0, `pageSections["${sec.id}"].description must be non-empty`);
      assert.ok(sec.seed && typeof sec.seed === 'object', `pageSections["${sec.id}"] must have a seed patch`);
      Object.assign(config, sec.seed);
    }
  }
  return config;
}

async function measureOverflow(page, width) {
  await page.setViewportSize({ width, height: 900 });
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test('fixture sanity: all three templates declare faq/hours/location as addable, with description + seed', () => {
  for (const templateId of TEMPLATES) {
    const schema = schemaOf(templateId);
    const ids = new Set(schema.pageSections.map((s) => s.id));
    for (const id of ADDABLE_IDS) {
      assert.ok(ids.has(id), `${templateId}: schema.pageSections must declare "${id}"`);
    }
  }
});

test('causal RED: PARENT_SHA template.html has no faq/hours/location markup even with the new seed applied', { concurrency: false }, async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const cleanup = [];
  try {
    for (const templateId of TEMPLATES) {
      const schema = schemaOf(templateId);
      const config = applySeeds(firstPresetConfig(templateId), schema);
      const dir = buildSite(templateId, config, { useOldTemplate: true });
      cleanup.push(dir);
      const page = await browser.newPage();
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      for (const id of ADDABLE_IDS) {
        const el = await page.$('#' + id);
        assert.equal(el, null, `${templateId} RED: PARENT_SHA template must NOT already have "#${id}" — is this template not actually new to T-1B?`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('hidden by default: no seed applied → no faq/hours/location markup on the default preset', { concurrency: false }, async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const cleanup = [];
  try {
    for (const templateId of TEMPLATES) {
      const config = firstPresetConfig(templateId);
      const dir = buildSite(templateId, config);
      cleanup.push(dir);
      const page = await browser.newPage();
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      for (const id of ADDABLE_IDS) {
        const el = await page.$('#' + id);
        assert.equal(el, null, `${templateId}: "#${id}" must be absent from the default (unseeded) preset`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('GREEN: seeded faq/hours/location render correctly at 390 and 1440, no horizontal overflow', { concurrency: false }, async (t) => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const cleanup = [];
  try {
    for (const templateId of TEMPLATES) {
      await t.test(templateId, async () => {
        const schema = schemaOf(templateId);
        const config = applySeeds(firstPresetConfig(templateId), schema);
        const dir = buildSite(templateId, config);
        cleanup.push(dir);

        for (const width of [390, 1440]) {
          const page = await browser.newPage();
          await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
          await page.setViewportSize({ width, height: 900 });
          // Let the fade-in-section IntersectionObserver settle and the
          // client-side Maps-link builder (initLocationMapsLink) run.
          await page.waitForTimeout(150);

          // 1) All three sections are present and visible.
          for (const id of ADDABLE_IDS) {
            const box = await page.locator('#' + id).boundingBox();
            assert.ok(box && box.width > 0 && box.height > 0,
              `${templateId} @${width}px: "#${id}" must render with non-zero size once seeded`);
          }

          // 2) FAQ: every item is an open-by-default <details> (VISION §4.3
          //    last bullet — <details> hiding important content default open).
          const faqCount = await page.locator('#faq details').count();
          assert.equal(faqCount, config.faq.items.length, `${templateId} @${width}px: FAQ item count must match seed`);
          const openCount = await page.locator('#faq details[open]').count();
          assert.equal(openCount, faqCount, `${templateId} @${width}px: every FAQ <details> must be open by default`);

          // 3) Program: one row per seeded day.
          const hoursCount = await page.locator('#hours li').count();
          assert.equal(hoursCount, config.hours.items.length, `${templateId} @${width}px: Program row count must match seed`);

          // 4) Unde ne găsești: address text shown + Google Maps link built
          //    client-side (no iframe, no external script — see script.js).
          const addressText = (await page.locator('[data-location-address]').innerText()).trim();
          assert.equal(addressText, config.location.address, `${templateId} @${width}px: address text must match seed`);
          const mapsHref = await page.locator('[data-location-maps-link]').getAttribute('href');
          const expected = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(config.location.address);
          assert.equal(mapsHref, expected, `${templateId} @${width}px: Google Maps link must be built from the address`);
          const iframeCount = await page.locator('#location iframe').count();
          assert.equal(iframeCount, 0, `${templateId} @${width}px: "Unde ne găsești" must not embed an iframe`);

          // 5) No horizontal overflow at this width.
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          assert.ok(scrollWidth <= clientWidth + 1,
            `${templateId} @${width}px: horizontal overflow (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`);

          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
  }
});
