'use strict';
/**
 * bot/test/audit27-r-07-editor-fixes.test.js
 *
 * Audit 2026-09-27, task R-07 ("Corecții editor (app.js)"). Form editor removed
 * 2026-10-28: the Playwright business.name re-render race, the WhatsApp number
 * normalizer, the pending-publish resume banner, the dark-background ink
 * warning and the Detalii drawer keys all lived only in the deleted editor and
 * were dropped. What survives is the dashboard half:
 *
 *   - owner-dashboard#4: a canceled-but-still-hosted site (status==='unpublished')
 *     gets its own "Reactivează site-ul" button posting to the same /checkout
 *     route as "Adaugă un card".
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-07-editor-fixes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS_PATH = path.join(ROOT, 'builder', 'app.js');

test("owner-dashboard#4: a canceled site with valid hosting gets a 'Reactivează site-ul' button", () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const buildSiteCard = app.match(/function buildSiteCard\(site\) \{[\s\S]*?\n\}\n\n\/\*\*/);
  assert.ok(buildSiteCard, 'locate buildSiteCard');
  const src = buildSiteCard[0];

  // buildSiteCard has TWO `site.status === 'unpublished'` checks — one in
  // the badge/label section, one in the actions section (the one this task
  // added) — so anchor on the unique new button identifier instead of a
  // branch-boundary regex that could latch onto the wrong one.
  const reactivateSite = src.match(/else if \(site\.status === 'unpublished'\) \{[\s\S]{0,700}reactivateBtn[\s\S]{0,700}\n  \}/);
  assert.ok(reactivateSite, "locate the status==='unpublished' branch that declares reactivateBtn");
  assert.match(reactivateSite[0], /Reactivează site-ul/, "the unpublished branch must offer 'Reactivează site-ul'");
  assert.match(reactivateSite[0], /\/checkout/, 'reactivation must POST to the same .../checkout route as "Adaugă un card"');
});
