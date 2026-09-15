'use strict';
/**
 * bot/test/suite12-demo-highlight-consistent.test.js — PLAN-FEEDBACK-2026-09-14
 * Suite B (owner report, screenshots, salon template, in the editor).
 *
 * Owner report: "in very many places on all templates some texts appear
 * highlighted and others do not; I don't know the cause — either make them
 * uniform or something." Examples given: the kicker and the "Atelier Ivoire
 * este un studio mic..." paragraph carry an amber underline/wash, but the
 * heading "Povestea noastră" sitting right between them does not; on other
 * templates phone numbers are highlighted, some addresses and labels are not.
 *
 * VERIFIED CAUSE: builder/edit-overlay.js's .hb-demo-text marker (painted from
 * builder/app.js's computeDemoTextPaths()) was driven by a single hand-kept
 * Set of ~10 dot-paths (IDENTITY_FIELD_KEYS) shared verbatim across all five
 * templates. The idea — flag a field that still equals the template's own
 * demo value — is correct; the set itself was incomplete (never covered list
 * items: team bios, service names/prices, menu dishes, credentials, …) and
 * had no visible explanation anywhere in the editor chrome.
 *
 * FIX (this wave):
 *   - Classification moved into schema.json, as data next to each field:
 *     `"identity": true` on a scalar field, `"identityItemKeys"` /
 *     `"identityNestedListKeys"` on a `type:"list"` field — see
 *     builder/app.js's isIdentityField() doc comment for the full rationale,
 *     and each templates/<id>/schema.json diff for the per-field calls.
 *   - builder/app.js's computeDemoTextPaths() walks all three shapes into a
 *     flat set of data-hb-edit paths (scalar keys AND per-item/per-nested-item
 *     paths like "services.0.label" / "menu.ro.0.items.2").
 *   - A compact legend (#demo-legend in builder/index.html, next to the
 *     checklist pill) explains the highlight, shown only while at least one
 *     field carries it (app.js's syncDemoLegend()).
 *   - Each .hb-demo-text field carries a hover/focus tooltip with the same
 *     explanation (builder/edit-overlay.js's markDemoTextPaths(), plus an
 *     aria-describedby-linked off-screen node for assistive tech).
 *
 * This suite independently reconstructs the expected marked-path set for each
 * template's default preset straight from schema.json + presets.json (NOT by
 * re-invoking computeDemoTextPaths() itself — that would only prove the
 * function agrees with itself) and compares it against what the live canvas
 * actually paints .hb-demo-text on.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-demo-highlight-consistent.test.js
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
    path.join(ROOT, 'node_modules', 'playwright'),
    '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s12-demo-highlight-'));
process.env.SERVER_SECRET = 's12-demo-highlight-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { renderHtml, build } = require(path.join(ROOT, 'build.js'));

const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Suite12-demo-highlight');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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

function loadSchema(templateId) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
}
function loadDefaultPreset(templateId) {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8'));
  return presets.presets[0].config;
}
function allFields(schema) {
  const out = [];
  (schema.sections || []).forEach((s) => (s.fields || []).forEach((f) => out.push(f)));
  return out;
}
function getPath(obj, p) {
  return p.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Independent re-implementation of builder/app.js's computeDemoTextPaths(),
 * written straight from the schema.json contract (identity /
 * identityItemKeys / identityNestedListKeys) — deliberately NOT a call into
 * app.js's own function, so this test can actually catch a mismatch between
 * what the schema declares and what the running app paints.
 *
 * This only ever runs against the FRESH, untouched default preset (the
 * browser test below never edits anything before reading the marked set) —
 * draft.config starts as a deep copy of that exact same preset object, so
 * "does the current value still equal the preset's own value" reduces to
 * "is the preset's own value a non-empty string" here. A real edit making a
 * field diverge from its demo value is covered separately below (the
 * "editing... drops its mark" test).
 */
function expectedDemoPaths(schema, preset) {
  const out = [];
  allFields(schema).forEach((f) => {
    if (f.type === 'list') {
      const list = getPath(preset, f.key);
      if (!Array.isArray(list)) return;
      const itemKeys = Array.isArray(f.identityItemKeys) ? f.identityItemKeys : [];
      const nestedKeys = Array.isArray(f.identityNestedListKeys) ? f.identityNestedListKeys : [];
      list.forEach((item, i) => {
        itemKeys.forEach((k) => {
          const val = k === '.' ? item : item && item[k];
          if (isNonEmptyString(val)) out.push(k === '.' ? `${f.key}.${i}` : `${f.key}.${i}.${k}`);
        });
        nestedKeys.forEach((nk) => {
          const nested = item && item[nk];
          if (!Array.isArray(nested)) return;
          nested.forEach((v, j) => { if (isNonEmptyString(v)) out.push(`${f.key}.${i}.${nk}.${j}`); });
        });
      });
      return;
    }
    if (f.identity !== true) return;
    const val = getPath(preset, f.key);
    if (isNonEmptyString(val)) out.push(f.key);
  });
  return out;
}

async function startTemplate(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('#btn-close-drawer').click().catch(() => {});
}

/** Unique data-hb-edit paths of every element carrying `.hb-demo-text`
 * (a field can render in more than one place — e.g. business.name in the nav
 * AND the hero — so this dedupes: the SET of marked paths is what matters,
 * not how many DOM nodes happen to share one). */
async function actualDemoPaths(page) {
  const frame = page.frameLocator('#preview-iframe');
  const raw = await frame.locator('.hb-demo-text[data-hb-edit]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-hb-edit'))
  );
  return Array.from(new Set(raw));
}

/** Unique data-hb-edit paths of every EDITABLE TEXT field the template
 * actually renders on the canvas, marked or not — e.g. contact.phone is
 * identity content, but this template only ever uses it inside a `tel:`
 * href, never as visible text, so it has no [data-hb-edit] span to mark at
 * all. Used to narrow expectedDemoPaths() down to paths that could possibly
 * appear as .hb-demo-text, so the test only asserts on fields the canvas
 * actually has a rendered element for. */
async function allRenderedTextPaths(page) {
  const frame = page.frameLocator('#preview-iframe');
  const raw = await frame.locator('[data-hb-edit][data-hb-kind="text"]').evaluateAll(
    (els) => els.map((el) => el.getAttribute('data-hb-edit'))
  );
  return new Set(raw);
}

for (const templateId of TEMPLATE_IDS) {
  test(`${templateId}: marked set on the default preset equals the schema classification`, async () => {
    const schema = loadSchema(templateId);
    const preset = loadDefaultPreset(templateId);
    const schemaExpected = expectedDemoPaths(schema, preset).sort();
    assert.ok(schemaExpected.length > 0, 'sanity: this template must have at least one identity field for the test to mean anything');

    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    try {
      await startTemplate(page, templateId);
      const actual = (await actualDemoPaths(page)).sort();
      const rendered = await allRenderedTextPaths(page);

      // Some identity fields (contact.phone, social URLs, …) are only ever
      // bound to a non-text attribute (a tel:/wa.me/https: href) on a given
      // template — no [data-hb-edit] text span exists for them at all, so
      // they can never carry .hb-demo-text. Narrowing to fields the canvas
      // actually rendered as text keeps the test honest about what CAN show
      // on screen, while still catching every field that DOES render as text.
      const expected = schemaExpected.filter((p) => rendered.has(p)).sort();
      const identityButNeverRendered = schemaExpected.filter((p) => !rendered.has(p));

      assert.deepStrictEqual(
        actual, expected,
        `${templateId}: .hb-demo-text paths must exactly match the schema's identity classification (restricted to fields actually rendered as text).\n` +
        `  missing (schema says identity + rendered, canvas didn't mark): ${JSON.stringify(expected.filter((p) => !actual.includes(p)))}\n` +
        `  extra   (canvas marked, schema doesn't classify):              ${JSON.stringify(actual.filter((p) => !expected.includes(p)))}\n` +
        `  (identity fields never rendered as text on this template, so skipped: ${JSON.stringify(identityButNeverRendered)})`
      );

      // The legend must be visible: a fresh draft has untouched identity content.
      const legendHidden = await page.locator('#demo-legend').evaluate((el) => el.hidden);
      assert.strictEqual(legendHidden, false, `${templateId}: #demo-legend must be visible while identity fields are still at their demo value`);

      fs.writeFileSync(
        path.join(EVIDENCE_DIR, `${templateId}-marked-paths.json`),
        JSON.stringify({ expected, actual }, null, 2)
      );
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `${templateId}-fresh-draft.png`) });
    } finally {
      await page.close();
    }
  });
}

test('professionals: a structural section-title field is never marked, even though its neighbours are', async () => {
  // The owner's own example: the kicker + about paragraph are marked, the
  // section heading right between them is not. "credentials.title" (a
  // section title, "Titlu secțiune credențiale") sits in the SAME section as
  // "credentials.lead" (identity: true) and "credentials.items" (identity
  // list) — same neighbourhood, deliberately different treatment.
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(20000);
  try {
    await startTemplate(page, 'professionals');
    const frame = page.frameLocator('#preview-iframe');

    const titleEl = frame.locator('[data-hb-edit="credentials.title"]').first();
    await assert.doesNotReject(
      titleEl.evaluate((el) => { if (el.classList.contains('hb-demo-text')) throw new Error('structural title marked'); }),
      'credentials.title (a section title) must never carry .hb-demo-text'
    );

    const leadEl = frame.locator('[data-hb-edit="credentials.lead"]').first();
    await assert.doesNotReject(
      leadEl.evaluate((el) => { if (!el.classList.contains('hb-demo-text')) throw new Error('identity lead not marked'); }),
      'credentials.lead (identity content, still at its demo value) must carry .hb-demo-text'
    );

    // The hover/focus tooltip: the marked field carries the explanation via
    // aria-describedby (assistive tech) and a data-hb-demo-tip attribute the
    // CSS ::after reads (sighted hover/focus) — never on the unmarked title.
    const leadDescribedBy = await leadEl.getAttribute('aria-describedby');
    assert.ok(leadDescribedBy, 'a marked field must carry aria-describedby pointing at the explanation');
    const tipText = await frame.locator('#' + leadDescribedBy).innerText();
    assert.match(tipText, /exemplu/i, 'the linked description must explain this is example content');
    const titleDescribedBy = await titleEl.getAttribute('aria-describedby');
    assert.notStrictEqual(titleDescribedBy, leadDescribedBy, 'an unmarked structural field must not carry the demo-content description');
  } finally {
    await page.close();
  }
});

test('portfolio: editing a marked field on the canvas drops its mark immediately, without touching an unrelated one', async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(20000);
  try {
    await startTemplate(page, 'portfolio');
    const frame = page.frameLocator('#preview-iframe');

    const taglineEl = frame.locator('[data-hb-edit="business.tagline"]').first();
    const aboutEl = frame.locator('[data-hb-edit="business.about"]').first();
    assert.strictEqual(await taglineEl.evaluate((el) => el.classList.contains('hb-demo-text')), true);
    assert.strictEqual(await aboutEl.evaluate((el) => el.classList.contains('hb-demo-text')), true);

    await taglineEl.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Salonul meu preferat din cartier');
    await page.waitForTimeout(50);

    assert.strictEqual(
      await taglineEl.evaluate((el) => el.classList.contains('hb-demo-text')), false,
      'editing business.tagline must drop its own mark at once'
    );
    assert.strictEqual(
      await aboutEl.evaluate((el) => el.classList.contains('hb-demo-text')), true,
      'editing business.tagline must not drop the unrelated business.about mark'
    );

    await taglineEl.evaluate((el) => el.blur());
    await page.waitForTimeout(600);

    // The legend must still show — business.about (among others) is still demo.
    const legendHidden = await page.locator('#demo-legend').evaluate((el) => el.hidden);
    assert.strictEqual(legendHidden, false, 'the legend must stay visible while other identity fields are still at their demo value');
  } finally {
    await page.close();
  }
});

test('the legend hides the instant nothing is marked, and reappears the instant something is', async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(20000);
  try {
    await startTemplate(page, 'local-service');
    const legendHiddenBefore = await page.locator('#demo-legend').evaluate((el) => el.hidden);
    assert.strictEqual(legendHiddenBefore, false, 'sanity: a fresh draft must show the legend');

    // Exercise the real wiring (syncDemoLegend()) against a forced empty/
    // non-empty computeDemoTextPaths() result, rather than editing every
    // single identity field on the template to empty the set for real.
    const hiddenWhenEmpty = await page.evaluate(() => {
      const orig = window.computeDemoTextPaths;
      window.computeDemoTextPaths = () => [];
      window.syncDemoLegend();
      const hidden = document.getElementById('demo-legend').hidden;
      window.computeDemoTextPaths = orig;
      return hidden;
    });
    assert.strictEqual(hiddenWhenEmpty, true, '#demo-legend must hide the moment nothing is marked');

    const shownAgain = await page.evaluate(() => {
      window.syncDemoLegend();
      return document.getElementById('demo-legend').hidden;
    });
    assert.strictEqual(shownAgain, false, '#demo-legend must reappear once real marks exist again');
  } finally {
    await page.close();
  }
});

test('published/exported HTML never carries any demo-highlight signalling (editor-only change)', () => {
  for (const templateId of TEMPLATE_IDS) {
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
    const heavySrc = fs.readFileSync(path.join(ROOT, 'builder', 'generated', 'templates', `${templateId}.js`), 'utf8');
    const m = heavySrc.match(/HIDOOK_TEMPLATE_HEAVY\["[^"]+"\]\s*=\s*(\{[\s\S]*\});?\s*$/);
    assert.ok(m, `${templateId}: could not locate heavy bundle payload`);
    const heavy = JSON.parse(m[1]);
    const demoConfig = heavy.presets[0].config;

    const exportedHtml = renderHtml(templateHtml, demoConfig); // no opts — exactly export/publish's own call
    // 'data-hb-edit="' (with the opening quote — the exact way build.js ever
    // emits it) rather than the bare substring: some templates' own
    // developer doc comments reference "[data-hb-edit]" in prose (bracket
    // form, no attribute value), which would otherwise be a false positive.
    const forbidden = ['hb-demo-text', 'hb-demo-photo', 'data-hb-edit="', 'hb-demo-tip', 'demo-legend', 'hidookOverlayMounted'];
    for (const marker of forbidden) {
      assert.ok(
        !exportedHtml.includes(marker),
        `${templateId}: export/publish render must never contain "${marker}"`
      );
    }

    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), `s12-build-clean-${templateId}-`));
    fs.writeFileSync(path.join(siteDir, 'template.html'), templateHtml, 'utf8');
    fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(demoConfig), 'utf8');
    build(siteDir);
    const builtHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
    for (const marker of forbidden) {
      assert.ok(
        !builtHtml.includes(marker),
        `${templateId}: build.js's own build() output must never contain "${marker}"`
      );
    }
  }
});
