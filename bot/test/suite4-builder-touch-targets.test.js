'use strict';
/**
 * bot/test/suite4-builder-touch-targets.test.js
 *
 * Suite 4 QA (m16): at 390x844, every visible `button`, `a`, `input` and
 * `select` in the builder — landing, editor canvas (including the list
 * add/remove controls injected into the preview iframe by
 * builder/edit-overlay.js), the details drawer, and a dashboard site card —
 * must be at least 44px tall. The one permitted exception is WCAG 2.5.8's
 * own: a link sitting inline inside a run of prose, whose height is set by
 * that text's line-height rather than by any button-like styling of its
 * own — forcing THAT to a box would break the sentence around it, not fix
 * an interactive element.
 *
 * What this found on 2026-09-12, measured (not eyeballed):
 *   - .hb-secrow__btn (the section list's "Elimină"/"Adaugă"/reorder
 *     buttons, in the drawer's "Secțiuni pagină" panel): 64x30px.
 *   - .hb-add-btn ("+ Adaugă" on a repeatable list, injected into the
 *     PREVIEW IFRAME by edit-overlay.js — not the parent document, so a
 *     scan of the top-level page alone would silently miss it): 91x34px.
 *   - .field-input for #dr_contact_phone (drawer, "Contact și locație"):
 *     40px — 4px under the floor, and the SAME shared class every other
 *     drawer text/tel/email field uses, so the fix (min-height on the
 *     shared rule) also raises whichever of those happened to sit right at
 *     the old ~40px mark.
 *   - .site-live-link (the site's live URL on a dashboard card): 19px —
 *     a bare text line with no padding, not a link inline in a sentence
 *     (it sits next to a status badge in a compact metadata row, not in a
 *     paragraph of prose), so the 2.5.8 inline exception does not apply.
 *
 * Deliberately narrower than bot/test/waveC-builder-own-accessibility.test.js
 * (which enforces WCAG 2.5.8's own 24px AA floor plus contrast, across a
 * different screen set) and bot/test/waveB-touch-targets.test.js (which
 * measures the PUBLISHED sites this product generates, not the builder
 * that generates them). This file's 44px bar and screen set — landing,
 * canvas, drawer, dashboard, and the preview iframe's own overlay
 * controls — is the one the Suite 4 QA plan asked for; it does not
 * duplicate either of the other two.
 *
 * Scope decision on the preview iframe: it holds TWO different kinds of
 * elements — edit-overlay.js's own injected editing affordances
 * (.hb-add-btn, .hb-remove-btn, .hb-img-btn, .hb-bg-btn — genuinely part of
 * the BUILDER's touch surface, and where m16's "+ Adaugă" finding lives),
 * and the TEMPLATE's own rendered nav/footer/content, identical to what a
 * published site serves. The iframe scan below is scoped to the injected
 * overlay classes only, on purpose: the template's own elements are
 * covered by bot/test/waveB-touch-targets.test.js, which deliberately does
 * NOT hold footer/nav links to a 44px floor ("Footer legal links are
 * deliberately not in tier 2" — that file's header comment) and is Suite
 * 7's territory (template consistency), not Suite 4's. Holding the same
 * elements to a stricter, undocumented 44px rule here would silently
 * contradict that existing decision instead of extending it.
 *
 * Run: node --experimental-sqlite --test bot/test/suite4-builder-touch-targets.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PW_CANDIDATES = [
  path.join(ROOT, 'node_modules', 'playwright'),
  '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
  '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
];
let chromium;
for (const cand of PW_CANDIDATES) {
  try { ({ chromium } = require(cand)); break; } catch (_) {}
}
if (!chromium) throw new Error('playwright not found; install or link node_modules/playwright');

const VIEWPORT = { width: 390, height: 844 };
const MIN_TARGET = 44;

// Runs inside the target document (main page OR the preview iframe) via
// evaluate() — must be a pure, self-contained function. `selector` is
// 'button, a, input, select' on the main page, and just the edit-overlay's
// own injected-control classes inside the preview iframe (see the scope
// decision in the header comment above).
function scanFn({ MIN, selector }) {
  const out = [];
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height >= MIN - 0.5) continue;
    // WCAG 2.5.8 "Inline" exception: a link inside a run of prose, sized by
    // that text's line-height, not styled as a standalone control.
    const p = el.closest('p');
    const own = (el.textContent || '').trim();
    const inline = el.tagName === 'A' && !!p && (p.textContent || '').trim().length > own.length + 2;
    if (inline) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 40),
      id: el.id || '',
      text: (el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return out;
}

const MAIN_SELECTOR = 'button, a, input, select';
// edit-overlay.js's own injected editing affordances (list add/remove,
// image/background replace) — NOT the template's own nav/content, which
// the iframe also contains. See the scope decision in the header comment.
const OVERLAY_SELECTOR = '.hb-add-btn, .hb-remove-btn, .hb-img-btn, .hb-bg-btn';

async function scan(target, where, failures, selector = MAIN_SELECTOR) {
  const rows = await target.evaluate(scanFn, { MIN: MIN_TARGET, selector });
  for (const r of rows) {
    failures.push(`${where}: ${r.tag}${r.id ? '#' + r.id : ''}.${r.cls} "${r.text}" is ${r.w}x${r.h}px, under the ${MIN_TARGET}px height floor`);
  }
  return rows.length;
}

test('suite4 builder touch targets: every button/a/input/select is >=44px tall at 390px', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite4-touch-'));
  process.env.SERVER_SECRET = 'suite4-touch-' + crypto.randomBytes(8).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_TOKEN;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const registry = require(path.join(ROOT, 'bot', 'registry.js'));
  const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const dataDir = process.env.DATA_DIR;

  // A paid/live site so the dashboard renders a real card with its live
  // URL link — seeded directly (this oracle isn't testing the publish
  // FLOW, just the rendered card), same pattern as delete-site-oracle.mjs's
  // mobile pass.
  const email = 'suite4-touch@example.com';
  const user = registry.getOrCreateUserByEmail(email);
  const slug = 'suite4-touch-' + Date.now().toString(36);
  const site = registry.createSite({ userId: user.id, templateId: 'professionals', templateVersion: 1, slug, platform: 'web' });
  registry.updateSite(site.id, { paid: true, status: 'active' });
  const siteDir = path.join(dataDir, 'sites', site.projectName);
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>' + slug + '</h1>');
  await webpublish.publishSite({ site: registry.getSite(site.id), config: {}, images: [], siteDirAlreadyBuilt: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const failures = [];
  let screensMeasured = 0;

  try {
    // ---- landing ----
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    await scan(page, 'landing', failures);
    screensMeasured++;

    // ---- editor canvas (professionals — has a "services" list with
    // .hb-add-btn, and a "Secțiuni pagină" panel in its drawer) ----
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
    await page.waitForTimeout(1000);

    const drawer = page.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
        await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
      });
      await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    }
    await scan(page, 'editor canvas (topbar)', failures);
    screensMeasured++;

    const iframeEl = await page.locator('#preview-iframe').elementHandle();
    const frame = await iframeEl.contentFrame();
    assert.ok(frame, 'preview iframe must expose a contentFrame to scan its list add/remove buttons');
    await scan(frame, 'editor canvas (preview iframe)', failures, OVERLAY_SELECTOR);
    screensMeasured++;

    // ---- details drawer (phone field + sections panel) ----
    await page.locator('#btn-open-drawer').click({ timeout: 8000 }).catch(() => {});
    await drawer.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(500);
    const controlsInDrawer = await page.evaluate(() =>
      document.querySelectorAll('#details-drawer button, #details-drawer a, #details-drawer input, #details-drawer select').length);
    assert.ok(controlsInDrawer > 3, 'details drawer did not render its fields — this screen would pass by measuring nothing');
    await scan(page, 'details drawer', failures);
    screensMeasured++;

    // ---- dashboard (site card, live URL link) ----
    // Sign in as the seeded user (magic link + dev-link, same pattern as
    // bot/test/delete-site-oracle.mjs's mobile pass) — #dashboard renders
    // nothing but an auth prompt otherwise.
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.waitForTimeout(400);
    const authBtn = page.locator('#btn-dashboard-auth');
    if (await authBtn.isVisible().catch(() => false)) await authBtn.click();
    const emailInput = page.locator('#input-email');
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(email);
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.waitForTimeout(700);
    const card = page.locator('.site-card', { hasText: slug.replace(/-/g, '‑') }).first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    await scan(page, 'dashboard', failures);
    screensMeasured++;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.strictEqual(screensMeasured, 5, 'every screen must have been measured');
  assert.deepStrictEqual(failures, [], 'touch-target failures at 390px:\n' + failures.join('\n'));
});
