'use strict';
/**
 * bot/test/audit27-u-05-visitor-timezone.test.js — PLAN-AUDIT-2026-09-27,
 * task U-05 (PLAN-UX-2026-09-27.md §4, "Fus orar local al vizitatorului în
 * widget-ul de rezervare").
 *
 * RED (pre-fix, calendar-native lens finding): the public booking widget's
 * `formatDayLabel()` appended the raw IANA zone id straight onto the day
 * label ("Luni, 12 octombrie · Europe/Bucharest") for every visitor, and
 * every slot button showed only the business's own clock time — a visitor
 * booking from a different timezone had no indication their local time
 * differed, and no way to see it without doing the math themselves.
 *
 * GREEN (this task): when the visitor's browser timezone reads a different
 * UTC offset than the business's, on the selected day, the widget shows one
 * clear RO note above the time grid ("Orele sunt afișate în ora
 * României...") and each slot button gains a second, smaller line with the
 * visitor's own local time. When the offsets match — including same-offset
 * zones with different IANA names, e.g. Europe/Bucharest vs
 * Europe/Chisinau — neither appears, so a Romanian/Moldovan visitor (the
 * product's actual audience, VISION.md) never sees clutter for a
 * difference that isn't really there. No API change: the business timezone
 * still comes from GET /api/calendar-native/services, as before.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path), a real bot/server.js instance, and a browser context with
 * an explicit `timezoneId` per Playwright's own timezone-emulation API —
 * not a source-only check — because the defect only exists at the
 * intersection of the browser's Intl.* results and the widget's DOM.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-05-visitor-timezone.test.js
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
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

// --- 0. Source-anchored guard: the old raw-IANA-suffix bug cannot come back. ---
const widgetJs = fs.readFileSync(
  path.join(ROOT, 'bot/calendar-native/widget/public-booking-widget.js'),
  'utf8'
);
const widgetCss = fs.readFileSync(
  path.join(ROOT, 'bot/calendar-native/widget/public-booking-widget.css'),
  'utf8'
);

test('U-05 source: day label never appends the raw IANA zone id', () => {
  assert.doesNotMatch(
    widgetJs,
    /MONTH_RO\[parts\[1\] - 1\][\s\S]{0,40}tz \? ' · ' \+ tz/,
    'formatDayLabel() must not suffix the technical IANA id onto the visitor-facing day label'
  );
});

test('U-05 source: visitor-timezone note + per-slot local time exist and are DST-aware', () => {
  assert.match(widgetJs, /visitorTimeDiffers/, 'must compare offsets, not just tz-name strings');
  assert.match(widgetJs, /hnb__tz-note/);
  assert.match(widgetJs, /hnb__slot-local/);
  assert.match(widgetJs, /detectVisitorTimezone/);
  assert.match(widgetCss, /\.hnb__tz-note/);
  assert.match(widgetCss, /\.hnb__slot-local/);
});

// --- 1. Live behavioral check: a real browser context per business/visitor timezone pair. ---
const engine = require(path.join(ROOT, 'bot/calendar-native/engine'));
const { openCalendarDb } = require(path.join(ROOT, 'bot/calendar-native/db'));
const publicApi = require(path.join(ROOT, 'bot/calendar-native/public-api'));

const TENANT = { customerId: 'cust_u05_tz', siteId: 'site_u05_tz' };

let browser;
let server;
let db;
let BASE;

test.before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u05-'));
  process.env.SERVER_SECRET = 'audit27-u05-' + crypto.randomBytes(8).toString('hex');
  process.env.NODE_ENV = 'test';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  db = openCalendarDb({ dataDir: process.env.DATA_DIR });
  engine.ensureSettings(db, TENANT.customerId, TENANT.siteId, {
    timezone: 'Europe/Bucharest',
    default_buffer_minutes: 0,
    slot_interval_minutes: 30,
  });
  engine.upsertService(db, TENANT.customerId, TENANT.siteId, {
    id: 'svc_u05', name: 'Consultație', duration_minutes: 30,
  });
  // Open all 7 ISO weekdays round the clock so "today" (real server clock,
  // whatever day this suite happens to run) always has free slots — the
  // widget derives "today" from the real clock, not a test-injected nowMs.
  engine.setWeeklyAvailability(db, TENANT.customerId, TENANT.siteId,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: 0, end_minute: 24 * 60 })));
  publicApi.resetDbHandle();

  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  BASE = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  try { db.close(); } catch (_) {}
  publicApi.resetDbHandle();
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

/** Mounts the widget for TENANT in a fresh context with the given visitor timezoneId. */
async function openWidget(timezoneId) {
  const context = await browser.newContext({ timezoneId, viewport: { width: 480, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const html = '<!doctype html><html lang="ro"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="/calendar-native/widget/public-booking-widget.css"></head>' +
    '<body><div id="hnb-root" data-hidook-cal-native ' +
    'data-customer-id="' + TENANT.customerId + '" data-site-id="' + TENANT.siteId + '" ' +
    'data-api-base=""></div>' +
    '<script src="/calendar-native/widget/public-booking-widget.js"></script>' +
    '</body></html>';
  // Navigate to a real page on the server's own origin FIRST (setContent()
  // keeps the frame's current origin rather than resetting it) so the
  // widget's fetches below are same-origin — no CORS involved, exactly like
  // a real published site loading its own booking widget.
  await page.goto(BASE + '/calendar-native/widget/');
  await page.setContent(html, { waitUntil: 'load' });
  await page.locator('.hnb__slot').first().waitFor({ state: 'visible', timeout: 20000 });
  return { context, page };
}

async function screenshot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-u05-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

test('U-05: visitor in a different-offset timezone sees the note + per-slot local time', async () => {
  // America/New_York never shares an offset with Europe/Bucharest (5-7h apart year-round).
  const { context, page } = await openWidget('America/New_York');
  try {
    await screenshot(page, 'ny-visitor-slot-pane-loaded');

    const note = page.locator('.hnb__tz-note');
    await note.waitFor({ state: 'visible', timeout: 20000 });
    const noteText = (await note.textContent()) || '';
    assert.match(noteText, /ora României/, 'note must name the business timezone in RO');
    assert.match(noteText, /Europe\/Bucharest/, 'note must also carry the IANA id for precision');

    const localSpans = page.locator('.hnb__slot-local');
    const count = await localSpans.count();
    assert.ok(count > 0, 'at least one slot must show the visitor local time line');
    const firstLocalText = (await localSpans.first().textContent()) || '';
    assert.match(firstLocalText, /ora ta/i);

    const firstBizTime = (await page.locator('.hnb__slot-time').first().textContent()) || '';
    assert.notStrictEqual(
      firstBizTime.trim(),
      firstLocalText.replace(/ora ta/i, '').trim(),
      'visitor local time must differ from the business time for a 5-7h-apart timezone'
    );
  } finally {
    await context.close();
  }
});

test('U-05: visitor in the business\'s own timezone sees no note and no per-slot local time', async () => {
  const { context, page } = await openWidget('Europe/Bucharest');
  try {
    await screenshot(page, 'bucharest-visitor-slot-pane-loaded');
    assert.strictEqual(await page.locator('.hnb__tz-note').count(), 0, 'same-timezone visitor must not see the note');
    assert.strictEqual(await page.locator('.hnb__slot-local').count(), 0, 'same-timezone visitor must not see a second time line');
  } finally {
    await context.close();
  }
});

test('U-05: same UTC offset, different IANA name (Chișinău) — no needless note', async () => {
  // Europe/Chisinau has followed the same DST rules as Europe/Bucharest for
  // years — a real scenario for this product's Romanian/Moldovan audience.
  // Offset-based comparison (not name comparison) must recognize this.
  const { context, page } = await openWidget('Europe/Chisinau');
  try {
    await screenshot(page, 'chisinau-visitor-slot-pane-loaded');
    assert.strictEqual(await page.locator('.hnb__tz-note').count(), 0, 'same-offset visitor must not see the note despite a different IANA name');
    assert.strictEqual(await page.locator('.hnb__slot-local').count(), 0);
  } finally {
    await context.close();
  }
});
