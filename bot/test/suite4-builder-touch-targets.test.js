'use strict';
/**
 * bot/test/suite4-builder-touch-targets.test.js
 *
 * Suite 4 QA (m16): at 390x844, every visible `button`, `a`, `input` and
 * `select` in the builder — landing and a dashboard site card — must be at
 * least 44px tall. (Form editor removed 2026-10-28: the editor canvas, its
 * preview-iframe overlay controls and the details drawer no longer exist, so
 * those screens are no longer measured; the findings below about them are kept
 * as history. The site is seeded through the API, bot/test/lib/dash-seed.js.) The one permitted exception is WCAG 2.5.8's
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
const { signInPage, publishLive } = require('./lib/dash-seed.js');

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
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const dataDir = process.env.DATA_DIR;

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

    // ---- dashboard (site card, live URL link) ----
    // A paid/live blocks site seeded through the API, so the card renders the
    // full action row (Editează, Istoric, Domeniu, Facturi, Mesaje, Descarcă
    // ZIP, Anulează, Șterge) and the live URL link.
    const slug = 'suite4-touch-' + Date.now().toString(36);
    await signInPage(page, base, 'suite4-touch@example.com');
    await publishLive(page, base, { slug, pack: 'restaurant', name: 'Restaurant Touch' });
    await page.reload({ waitUntil: 'domcontentloaded' });
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

  assert.strictEqual(screensMeasured, 2, 'every screen must have been measured');
  assert.deepStrictEqual(failures, [], 'touch-target failures at 390px:\n' + failures.join('\n'));
});
