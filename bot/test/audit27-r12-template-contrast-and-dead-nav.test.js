'use strict';
/**
 * bot/test/audit27-r12-template-contrast-and-dead-nav.test.js
 *
 * Oracle for R-12 (PLAN-AUDIT-2026-09-27.md §4), covering three findings from
 * 04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json:
 *
 *   - theme-typography#1: on "Servicii profesionale", --ink follows
 *     theme.primaryDark (an accent-derived colour), so a light/pastel accent
 *     makes body/heading text near-invisible on the page's own paper
 *     (measured 1.33:1 — repro values taken verbatim from the audit's own
 *     theme-typography/contrast-dump.json and vars-dump.json).
 *   - theme-typography#2: on all 5 templates, a plausible medium/dark
 *     "Fundal pagină" (theme.cream) sinks the fixed default ink text under
 *     the WCAG AA 4.5:1 floor (measured 1.50-2.15:1 on #274B8C paper).
 *   - sections-structure#1: hiding a removable page section (via
 *     config.sections, OR via a template's own content-driven @if guard)
 *     leaves a nav link/hero CTA pointing at an anchor id that no longer
 *     exists anywhere in the published page.
 *
 * Contrast is computed the same way the shipped pre-paint scripts do
 * (WCAG relative luminance), read from the REAL rendered page's resolved
 * CSS custom properties post-JS (not the raw config colour), in a real
 * Chromium page loaded from a build() output — the exact pipeline that
 * serves /live/<slug>/ (see wave7-sections-render-order.test.js's own
 * "build() ... covers publish + ZIP export path" precedent for treating
 * build()'s index.html as equivalent to the published page for a
 * render-pipeline oracle).
 *
 * Fails on the pre-R-12 code: professionals' --ink stayed accent-derived,
 * the other 4 templates' --ink/--color-text never looked at --paper at all,
 * and reorderSections()/@if guards never touched a nav link that named a
 * section they didn't structurally contain.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r12-template-contrast-and-dead-nav.test.js
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const { build } = require(path.join(ROOT, 'build.js'));

const TEMPLATES = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

// The ink/body-text custom property each template's paper-vs-text pair is
// measured on. desserdirina never had a generic --ink var (it uses
// --color-text/--color-text-light) — see the audit's own vars-dump.json
// ("ink": "" for desserdirina), which is why R-12 added the pair here too.
const INK_VARS = {
  'product-menu': ['--ink'],
  'local-service': ['--ink'],
  portfolio: ['--ink'],
  professionals: ['--ink'],
  desserdirina: ['--color-text', '--color-text-light'],
};

function loadPreset(id) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', id, 'presets.json'), 'utf8'));
  return JSON.parse(JSON.stringify(raw.presets[0].config));
}
function loadSchema(id) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', id, 'schema.json'), 'utf8'));
}

/** Writes template.html + config.json + styles.css into a fresh tmp dir and
 * runs the real build() pipeline (publish + ZIP export both call this), then
 * returns the file:// URL of the resulting index.html. */
function buildSite(id, cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r12-' + id + '-'));
  fs.writeFileSync(path.join(dir, 'template.html'), fs.readFileSync(path.join(ROOT, 'templates', id, 'template.html'), 'utf8'), 'utf8');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg), 'utf8');
  fs.copyFileSync(path.join(ROOT, 'templates', id, 'styles.css'), path.join(dir, 'styles.css'));
  build(dir);
  return 'file://' + path.join(dir, 'index.html');
}

function relLum([r, g, b]) {
  const f = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function contrastRatio(c1, c2) {
  const l1 = relLum(c1), l2 = relLum(c2);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
/** '#rrggbb' or 'rgb(r, g, b)' -> [r,g,b]. Custom properties read back from
 * getComputedStyle come out as the literal hex the pre-paint script wrote. */
function toRgb(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const rgb = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/i.exec(color.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

async function readRootVars(page, names) {
  return page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    names.forEach((n) => { out[n] = cs.getPropertyValue(n).trim(); });
    return out;
  }, names);
}

/** Every in-page anchor (href="#id") must resolve to a real element id
 * somewhere in the document — sections-structure#1's exact contract. */
async function danglingAnchors(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href^="#"]'))
      .map((a) => a.getAttribute('href'))
      .filter((href) => href.length > 1 && !document.getElementById(href.slice(1)));
  });
}

test('theme-typography contrast + sections-structure dead-nav (R-12)', async (t) => {
  const browser = await chromium.launch();
  try {
    await t.test('theme-typography#1: professionals --ink clears 4.5:1 even when it follows a light/pastel accent', async () => {
      const preset = loadPreset('professionals');
      // Repro values verbatim from theme-typography/contrast-dump.json +
      // vars-dump.json (theme.primaryDark is what builder/app.js's
      // deriveColors() would compute from theme.primary — reused here
      // rather than re-derived, since app.js is out of scope for R-12).
      const cases = [
        { primary: '#1F8A3B', primaryDark: '#115a25', cream: '#274B8C', label: 'caseA_greenOnBlue' },
        { primary: '#F6E9C6', primaryDark: '#f1d68e', cream: '#FBF7EE', label: 'caseB_pastelOnNearWhite' },
      ];
      for (const c of cases) {
        const cfg = JSON.parse(JSON.stringify(preset));
        cfg.theme = Object.assign({}, cfg.theme, { primary: c.primary, primaryDark: c.primaryDark, cream: c.cream });
        const url = buildSite('professionals', cfg);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'load' });
        const vars = await readRootVars(page, ['--ink', '--paper']);
        await page.close();
        const ink = toRgb(vars['--ink']), paper = toRgb(vars['--paper']);
        assert.ok(ink && paper, `${c.label}: --ink/--paper must resolve to a real colour`);
        const ratio = contrastRatio(ink, paper);
        assert.ok(ratio >= 4.5, `${c.label}: professionals --ink vs --paper must be >=4.5:1, got ${ratio.toFixed(2)}:1`);
      }
    });

    await t.test('theme-typography#2: every template\'s body text clears 4.5:1 against a plausible medium/dark "Fundal pagină"', async () => {
      for (const id of TEMPLATES) {
        const preset = loadPreset(id);
        const cfg = JSON.parse(JSON.stringify(preset));
        cfg.theme = Object.assign({}, cfg.theme, { primary: '#1F8A3B', primaryLight: '#5fbf7d', primaryDark: '#0f4d1e', cream: '#274B8C' });
        const url = buildSite(id, cfg);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'load' });
        const vars = await readRootVars(page, [...INK_VARS[id], '--paper']);
        await page.close();
        const paper = toRgb(vars['--paper']);
        assert.ok(paper, `${id}: --paper must resolve to a real colour`);
        for (const inkVar of INK_VARS[id]) {
          const ink = toRgb(vars[inkVar]);
          assert.ok(ink, `${id}: ${inkVar} must resolve to a real colour`);
          const ratio = contrastRatio(ink, paper);
          assert.ok(ratio >= 4.5, `${id}: ${inkVar} vs --paper on a dark custom "Fundal pagină" must be >=4.5:1, got ${ratio.toFixed(2)}:1`);
        }
      }
    });

    await t.test('theme-typography: default demo palette is left visually untouched (no override fires when already safe)', async () => {
      for (const id of TEMPLATES) {
        const cfg = loadPreset(id);
        const url = buildSite(id, cfg);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'load' });
        const vars = await readRootVars(page, [...INK_VARS[id], '--paper']);
        await page.close();
        const paper = toRgb(vars['--paper']);
        for (const inkVar of INK_VARS[id]) {
          const ink = toRgb(vars[inkVar]);
          const ratio = contrastRatio(ink, paper);
          assert.ok(ratio >= 4.5, `${id}: shipped default palette must already clear 4.5:1 (sanity), got ${ratio.toFixed(2)}:1`);
        }
      }
    });

    await t.test('sections-structure#1: hiding any removable page section leaves no dangling nav/CTA anchor (portfolio, professionals)', async () => {
      for (const id of ['portfolio', 'professionals']) {
        const schema = loadSchema(id);
        const removable = schema.pageSections.filter((s) => s.removable !== false).map((s) => s.id);
        assert.ok(removable.length > 0, `${id}: fixture sanity, expected at least one removable section`);
        for (const targetId of removable) {
          const cfg = loadPreset(id);
          cfg.sections = schema.pageSections.map((s) => ({ id: s.id, removed: s.id === targetId }));
          const url = buildSite(id, cfg);
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: 'load' });
          const dangling = await danglingAnchors(page);
          await page.close();
          assert.deepEqual(dangling, [], `${id}: hiding "${targetId}" via Secțiuni pagină left dangling anchor(s): ${dangling.join(', ')}`);
        }
      }
    });

    await t.test('sections-structure#1: professionals FAQ nav link disappears when emptied by content alone (no Secțiuni-panel click)', async () => {
      const cfg = loadPreset('professionals');
      cfg.faq = { items: [] };
      const url = buildSite('professionals', cfg);
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'load' });
      const hasFaqSection = await page.evaluate(() => !!document.getElementById('faq'));
      const dangling = await danglingAnchors(page);
      await page.close();
      assert.equal(hasFaqSection, false, 'fixture sanity: emptied faq.items must drop the #faq section (existing @if behaviour)');
      assert.deepEqual(dangling, [], `professionals: emptying faq.items left dangling anchor(s): ${dangling.join(', ')}`);
    });

    await t.test('sections-structure#1: no template\'s default preset ships a dangling in-page anchor', async () => {
      for (const id of TEMPLATES) {
        const cfg = loadPreset(id);
        const url = buildSite(id, cfg);
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'load' });
        const dangling = await danglingAnchors(page);
        await page.close();
        assert.deepEqual(dangling, [], `${id}: default preset has dangling anchor(s): ${dangling.join(', ')}`);
      }
    });
  } finally {
    await browser.close();
  }
});
