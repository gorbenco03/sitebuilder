'use strict';
/**
 * bot/test/wave7-sections-e2e-all-templates.test.js
 *
 * Wave 7's page-sections feature (config.sections — reorder/hide the
 * top-level <section id="…"> blocks a template renders, engine in
 * build.js#reorderSections) shipped for templates/professionals only. This
 * wave gave local-service, product-menu, desserdirina and portfolio the
 * same `id` attributes + schema.pageSections metadata (see FINDINGS for the
 * per-template rationale — two of the four needed a real template.html
 * restructure to get "about" and "contact" onto independent top-level
 * sections).
 *
 * Every other oracle for this feature works at the STRING level (regex over
 * the rendered HTML). This one is the first to actually load the built page
 * in a real browser and read the DOM — the thing a site owner's visitor
 * sees — because a passing string match doesn't prove the markup is well
 * formed, doesn't catch a duplicate id silently confusing the browser's own
 * #anchor navigation, and doesn't prove a template's structure doesn't
 * secretly defeat the feature (see the desserdirina case below).
 *
 * For each of the four templates this wave touched, it proves:
 *   1. A causal RED: built from the template.html as it existed at the
 *      parent commit (git HEAD, before this wave), the same config.sections
 *      request does nothing — no ids to reorder by, so the DOM order and
 *      section count are untouched.
 *   2. GREEN: built from the current template.html, reordering actually
 *      reorders the DOM and removing a removable section actually removes
 *      it from the DOM.
 *   3. "about"/"contact" survive a `removed: true` request regardless (the
 *      server-side guardrail — NON_REMOVABLE_SECTION_IDS — applies whether
 *      the request came from the builder UI or a hand-edited config.json).
 *
 * desserdirina gets an extra, narrower assertion instead of pretending the
 * feature is uniformly solved: its "about"/"contact"/"gallery" trio reorders
 * fine (proved with the rest), but reordering is a documented no-op the
 * moment its Instagram section is also present, because a structural
 * `</div>` from the (deliberately full-bleed) Instagram band sits between
 * "gallery" and "instagram" — reorderSections() bails on ANY non-whitespace
 * gap across the whole span, not just at that one boundary. See FINDINGS.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-e2e-all-templates.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');

function oldTemplateHtml(templateId) {
  return execFileSync('git', ['-C', ROOT, 'show', `HEAD:templates/${templateId}/template.html`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function schemaOf(templateId) {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'schema.json'), 'utf8'));
}

function firstPresetConfig(templateId) {
  const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'presets.json'), 'utf8')).presets;
  return JSON.parse(JSON.stringify(presets[0].config));
}

// Build a real static site tree for `templateId` + `config`, using
// `templateHtmlOverride` instead of the on-disk template.html when given
// (the RED path — proving the OLD template.html ignores config.sections).
// Returns the absolute path to the written index.html.
function buildSite(templateId, config, templateHtmlOverride) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wave7-e2e-${templateId}-`));
  siteExport.buildStaticSiteTree({ templateId, config, images: [], siteDir: dir });
  if (templateHtmlOverride) {
    // Re-render index.html from the override template, reusing the images/
    // styles.css/etc. buildStaticSiteTree already copied alongside it.
    const html = renderHtml(templateHtmlOverride, JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')));
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  }
  return path.join(dir, 'index.html');
}

// DOM order (not source order) of every element in `ids` that actually
// exists on the page, read via the real browser.
async function domOrderOf(page, ids) {
  return page.evaluate((wantedIds) => {
    return Array.from(document.querySelectorAll('[id]'))
      .map((el) => el.id)
      .filter((id) => wantedIds.includes(id));
  }, ids);
}

const TEMPLATES_TO_PROVE = ['local-service', 'product-menu', 'desserdirina', 'portfolio'];

test('page-sections reorder/remove works end-to-end (real DOM) on every newly-wired template', { concurrency: false }, async (t) => {
  const browser = await chromium.launch({ headless: true });
  const cleanupDirs = [];
  try {
    for (const templateId of TEMPLATES_TO_PROVE) {
      await t.test(templateId, async () => {
        const schema = schemaOf(templateId);
        const ids = schema.pageSections.map((s) => s.id);
        const removableId = schema.pageSections.find((s) => s.removable && s.id !== 'about' && s.id !== 'contact').id;
        assert.ok(removableId, `${templateId}: fixture sanity — need at least one removable, non-about/contact section`);

        const baseConfig = firstPresetConfig(templateId);
        // Force Instagram "connected" (S111 gate — build.js normalizeInstagramForPublic
        // drops the public Instagram section unless embedUrl looks like a real
        // partner embed) so its section actually renders and is exercised here
        // too — EXCEPT for desserdirina, whose Instagram section sits behind the
        // one structural gap this wave didn't fix (see the dedicated test below);
        // forcing it on here would make THIS test assert on that known limitation
        // instead of on the about/contact/gallery reordering that does work.
        if (templateId !== 'desserdirina') {
          baseConfig.instagram = Object.assign({}, baseConfig.instagram, {
            handle: 'test', url: 'https://instagram.com/test', embedUrl: 'https://embedsocial.com/abc123',
          });
        }
        const effectiveIds = templateId === 'desserdirina' ? ids.filter((id) => id !== 'instagram') : ids;
        // Reversed order, with one removable section marked removed.
        const reversed = [...effectiveIds].reverse();
        const reorderConfig = Object.assign({}, baseConfig, {
          sections: reversed.map((id) => ({ id, removed: id === removableId })),
        });
        const expectedOrder = reversed.filter((id) => id !== removableId);

        // --- RED: old template.html (git HEAD, pre-wave) ignores config.sections ---
        const redOld = oldTemplateHtml(templateId);
        const redPath = buildSite(templateId, reorderConfig, redOld);
        cleanupDirs.push(path.dirname(redPath));
        const redPage = await browser.newPage();
        await redPage.goto('file://' + redPath, { waitUntil: 'load' });
        const redOrder = await domOrderOf(redPage, effectiveIds);
        await redPage.close();
        // The old template has no matching <section id> for these ids at all
        // (or, for portfolio, only "booking" — which isn't even in `ids`
        // post-rename), so reorderSections() finds nothing to do: DOM order
        // is untouched and the "removed" section is still present.
        assert.notDeepEqual(redOrder, expectedOrder,
          `${templateId} RED: expected the OLD template.html to NOT already honour config.sections (got reordered output — is this template not actually new to the feature?)`);

        // --- GREEN: current template.html actually reorders + removes ---
        const greenPath = buildSite(templateId, reorderConfig);
        cleanupDirs.push(path.dirname(greenPath));
        const greenPage = await browser.newPage();
        await greenPage.goto('file://' + greenPath, { waitUntil: 'load' });
        const greenOrder = await domOrderOf(greenPage, effectiveIds);
        assert.deepEqual(greenOrder, expectedOrder,
          `${templateId} GREEN: DOM order after reorder+remove should be ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(greenOrder)}`);
        const removedEl = await greenPage.$('#' + removableId);
        assert.equal(removedEl, null, `${templateId}: removed section "#${removableId}" must not exist in the DOM`);
        await greenPage.close();

        // --- guardrail: about/contact survive even when the config asks to remove them ---
        const guardConfig = Object.assign({}, baseConfig, {
          sections: ids.map((id) => ({ id, removed: true })),
        });
        const guardPath = buildSite(templateId, guardConfig);
        cleanupDirs.push(path.dirname(guardPath));
        const guardPage = await browser.newPage();
        await guardPage.goto('file://' + guardPath, { waitUntil: 'load' });
        const aboutEl = await guardPage.$('#about');
        const contactEl = await guardPage.$('#contact');
        assert.notEqual(aboutEl, null, `${templateId}: "#about" must survive removed:true (NON_REMOVABLE_SECTION_IDS)`);
        assert.notEqual(contactEl, null, `${templateId}: "#contact" must survive removed:true (NON_REMOVABLE_SECTION_IDS)`);
        await guardPage.close();
      });
    }
  } finally {
    await browser.close();
    for (const d of cleanupDirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('desserdirina: reordering is a documented no-op once Instagram is connected (structural gap, not fixed)', async () => {
  const templateId = 'desserdirina';
  const schema = schemaOf(templateId);
  const ids = schema.pageSections.map((s) => s.id); // about, contact, gallery, instagram

  const baseConfig = firstPresetConfig(templateId);
  // Force Instagram "connected" (S111 gate — see build.js normalizeInstagramForPublic):
  // a bare handle with no real embed/partner URL is treated as not connected
  // and the section is dropped, which would hide this exact limitation.
  baseConfig.instagram = Object.assign({}, baseConfig.instagram, {
    handle: 'test', url: 'https://instagram.com/test', embedUrl: 'https://embedsocial.com/abc123',
  });

  const reversed = [...ids].reverse();
  const config = Object.assign({}, baseConfig, {
    sections: reversed.map((id) => ({ id, removed: false })),
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-e2e-desserdirina-ig-'));
  try {
    siteExport.buildStaticSiteTree({ templateId, config, images: [], siteDir: dir });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
      const order = await domOrderOf(page, ids);
      // Original document order, NOT the requested reversal: proves the
      // gallery/instagram gap really does make reorderSections() bail on
      // this template the moment Instagram renders, exactly as documented.
      assert.deepEqual(order, ['about', 'contact', 'gallery', 'instagram'],
        `desserdirina+Instagram: expected the documented no-op (original order), got ${JSON.stringify(order)} — ` +
        `if this now passes, the gallery/instagram gap was fixed and this test (and FINDINGS) should be updated`);
      await page.close();
    } finally {
      await browser.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
