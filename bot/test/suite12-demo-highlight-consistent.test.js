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
 * UPDATE 2026-10-28: the form editor (the .hb-demo-text canvas marks, #demo-legend,
 * the tooltip, the edit-overlay/app.js code that painted them) was removed, so
 * the checks of those editor surfaces are gone. The one guarantee that reaches
 * customers stays: the published/exported HTML never carries any demo-highlight
 * signalling.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-demo-highlight-consistent.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml, build } = require(path.join(ROOT, 'build.js'));

const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

test('published/exported HTML never carries any demo-highlight signalling (editor-only change)', () => {
  for (const templateId of TEMPLATE_IDS) {
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', templateId, 'template.html'), 'utf8');
    const demoConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8')).presets[0].config;

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
    fs.rmSync(siteDir, { recursive: true, force: true });
  }
});
