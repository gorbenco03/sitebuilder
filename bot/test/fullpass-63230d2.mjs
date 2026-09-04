#!/usr/bin/env node
/**
 * Binding full-pass stranger oracle for SHA lineage 63230d2.
 *
 * One continuous Playwright walk of isolated /app/. Every interaction is
 * followed immediately by a deterministically named screenshot. Defects are
 * logged; the walk does not stop to patch. Tests-green is not a pass.
 *
 *   HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 node bot/test/fullpass-63230d2.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);
// Resolve Playwright from sibling worktree or Hermes agent install (worktrees often lack node_modules).
const pwCandidates = [
  path.join(ROOT, 'node_modules/playwright'),
  path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
];
let chromium;
for (const cand of pwCandidates) {
  try {
    ({ chromium } = require(cand));
    break;
  } catch (_) {}
}
if (!chromium) {
  throw new Error('playwright not found; install or link node_modules/playwright');
}

const SYSTEMS = Object.freeze([
  'professionals',
  'local-service',
  'portfolio',
  'product-menu',
  'desserdirina',
]);

const FACTORY_RES = [
  /\bBook now\b/i,
  /\bClick here\b/i,
  /\bGet started\b/i,
  /\bLorem ipsum\b/i,
  /\bWhitfield\b/i,
  /\bNorthline\b/i,
  /\bRidgeline\b/i,
  /\bConstTop\b/i,
  /\bDESSERD\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\[object Object\]/,
  /\bundefined\b/,
  /\bNew section\b/i,
  /\bNew item\b/i,
  /Remake comercial al sample/i,
  /sample-ului de brut/i,
  /Imagine pentru partajare/i,
  /\bog:image\b/i,
  /\bogImage\b/,
];

const ENGLISH_CHROME_RES = [
  /\bDownload HTML\b/,
  /\bDownload ZIP\b/,
  /\bPublish\b/,
  /\bDetails\b/,
  /\bLogout\b/,
  /\bLoading\.\.\./,
  /\bSign in\b/,
  /\bConnecting Instagram/,
  /\bThat address is already taken/,
];

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function scanFactory(text, extra = []) {
  const hits = [];
  const hay = String(text || '');
  for (const re of [...FACTORY_RES, ...ENGLISH_CHROME_RES, ...extra]) {
    const m = hay.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

async function run() {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fullpass-63230d2-'));
  process.env.SERVER_SECRET = 'fullpass-' + crypto.randomBytes(12).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.VERCEL_TOKEN;
  delete process.env.NETLIFY_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;

  const evidenceDir = path.join(ROOT, '04-QA-Evidence', 'FullPass-63230d2');
  const logPath = path.join(evidenceDir, 'oracle-log.json');
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const name of fs.readdirSync(evidenceDir)) {
    if (/\.(png|json|md)$/.test(name) && name !== 'oracle-log.json') {
      fs.rmSync(path.join(evidenceDir, name), { force: true });
    }
  }

  const log = {
    oracle: 'fullpass-63230d2',
    version: 1,
    gitHead: null,
    boot: {
      HIDOOK_TEST_PAY: '1',
      HIDOOK_ISOLATED_DEPLOY: '1',
      PUBLIC_URL: null,
      HIDOOK_FAKE_DEPLOY: null,
      liveStripeKeys: false,
    },
    startedAt: new Date().toISOString(),
    entries: [],
    defects: [],
    verified: false,
  };
  try {
    log.gitHead = require('child_process')
      .execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim();
  } catch (_) {}

  const writeLog = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
  writeLog();

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
  const registry = require(path.join(ROOT, 'bot', 'registry.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (/google-analytics|googletagmanager|facebook\.net|hotjar|doubleclick/i.test(url)) {
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  async function shot(stepName, extra = {}) {
    const index = log.entries.length;
    const screenshot = String(index + 1).padStart(2, '0') + '-' + slugify(stepName) + '.png';
    const screenshotPath = path.join(evidenceDir, screenshot);
    const target = extra.page || page;
    await target.screenshot({ path: screenshotPath, fullPage: !!extra.fullPage });
    const entry = {
      index,
      step: stepName,
      action: extra.action || 'screenshot-after-action',
      selector: extra.selector || null,
      screenshot,
      screenshotSha256: sha256File(screenshotPath),
      timestamp: new Date().toISOString(),
      url: target.url(),
      contentCheck: { ok: extra.ok !== false, detail: extra.detail || 'captured' },
    };
    log.entries.push(entry);
    writeLog();
    console.log('STEP', entry.screenshot, stepName);
    return entry;
  }

  function defect(severity, title, detail, screenshot) {
    const item = {
      severity,
      title,
      detail,
      screenshot: screenshot || (log.entries[log.entries.length - 1]?.screenshot || null),
      timestamp: new Date().toISOString(),
    };
    log.defects.push(item);
    writeLog();
    console.log('DEFECT', severity, title);
  }

  async function visibleChromeText() {
    return page.evaluate(() => {
      const root = document.body;
      if (!root) return '';
      return root.innerText || '';
    });
  }

  async function iframeText() {
    const frame = page.frameLocator('#preview-iframe');
    try {
      return await frame.locator('body').innerText({ timeout: 4000 });
    } catch {
      return '';
    }
  }

  function noteFactory(surface, text, screenshot) {
    const hits = scanFactory(text);
    if (hits.length) {
      defect('high', 'Factory/English leftover on ' + surface, 'Visible: ' + hits.join(', '), screenshot);
    }
  }

  async function closeDrawer() {
    const drawer = page.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
        await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
      });
      await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      await page.locator('#drawer-overlay').waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    }
  }

  async function acceptPreviewCookie() {
    const frame = page.frameLocator('#preview-iframe');
    const btn = frame.locator('#hb-cookie-accept, .hb-cookie-banner button').first();
    if (await btn.count()) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  async function openDrawer() {
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) return;
    await page.locator('#btn-open-drawer').click({ timeout: 4000 });
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 4000 });
  }

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-banner').waitFor({ state: 'visible' });
    await shot('landing-cookie-banner', {
      action: 'open /app/',
      selector: '#hb-cookie-banner',
      detail: 'cookie banner visible on first load',
    });
    const cookieText = await page.locator('#hb-cookie-banner').innerText();
    if (!/cookie/i.test(cookieText) && !/stocare esențială/i.test(cookieText)) {
      defect('high', 'Cookie banner copy missing', cookieText.slice(0, 240));
    }
    noteFactory('cookie-banner', cookieText);

    await page.locator('#hb-cookie-accept').click();
    await page.locator('#hb-cookie-banner').waitFor({ state: 'hidden' });
    await shot('accepted-cookie-landing', {
      action: 'click',
      selector: '#hb-cookie-accept',
      detail: 'banner dismissed; catalog landing',
    });

    const landingText = await visibleChromeText();
    noteFactory('landing-chrome', landingText);
    if (!/trialul de 7 zile/i.test(landingText)) {
      defect('high', 'Landing missing 7-day trial model', landingText.slice(0, 300));
    }
    if (/99 USD|one-time|100\$|30 dacă/i.test(landingText)) {
      defect('critical', 'Landing still shows stale commercial model', landingText.slice(0, 300));
    }
    const cards = page.locator('.template-card[data-template-id]');
    const cardCount = await cards.count();
    if (cardCount < 5) {
      defect('critical', 'Catalog does not show 5 systems', 'count=' + cardCount);
    }
    const ids = [];
    for (let i = 0; i < cardCount; i++) {
      ids.push(await cards.nth(i).getAttribute('data-template-id'));
    }
    for (const system of SYSTEMS) {
      if (!ids.includes(system)) defect('critical', 'Missing catalog system ' + system, 'ids=' + ids.join(','));
    }

    for (const filter of ['all', 'product-menu', 'portfolio', 'local-service', 'professionals', 'desserdirina']) {
      const chip = page.locator('.catalog-chip[data-filter="' + filter + '"]');
      await chip.click();
      await page.waitForTimeout(250);
      await shot('catalog-filter-' + filter, {
        action: 'click',
        selector: '.catalog-chip[data-filter="' + filter + '"]',
        detail: 'chip ' + filter,
      });
    }
    await page.locator('.catalog-chip[data-filter="all"]').click();

    for (const legal of [
      { slug: 'terms', href: '/app/terms.html', expect: /Termeni/i },
      { slug: 'privacy', href: '/app/privacy.html', expect: /Confidențialitate/i },
      { slug: 'cookies', href: '/app/cookies.html', expect: /Cookie/i },
    ]) {
      await page.goto(base + legal.href, { waitUntil: 'networkidle' });
      const body = await page.locator('body').innerText();
      await shot('legal-' + legal.slug, {
        action: 'open',
        selector: legal.href,
        detail: page.url(),
        fullPage: true,
      });
      if (!legal.expect.test(body)) {
        defect('high', 'Legal page ' + legal.slug + ' missing Romanian title', body.slice(0, 240));
      }
      noteFactory('legal-' + legal.slug, body);
      if (/lorem|placeholder|TODO|Coming soon/i.test(body)) {
        defect('high', 'Legal page ' + legal.slug + ' looks unfinished', body.slice(0, 240));
      }
    }

    await page.goto(base + '/app/', { waitUntil: 'networkidle' });

    let firstSystem = true;
    for (const system of SYSTEMS) {
      try {
      if (!firstSystem) {
        await closeDrawer();
        const back = page.locator('#btn-back-templates');
        if (await back.isVisible().catch(() => false)) {
          await back.click({ timeout: 5000 }).catch(async () => {
            await page.goto(base + '/app/#templates', { waitUntil: 'networkidle' });
          });
          await page.waitForTimeout(600);
        } else {
          await page.goto(base + '/app/#templates', { waitUntil: 'networkidle' });
        }
        await page.locator('.template-card[data-template-id="' + system + '"] .btn-start-tpl').waitFor({ state: 'visible' });
      }
      firstSystem = false;

      const startSel = '.template-card[data-template-id="' + system + '"] .btn-start-tpl';
      await page.locator(startSel).click();
      await page.waitForURL(/#edit$/, { timeout: 25000 });
      await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
      await page.waitForTimeout(900);

      const drawerVisible = await page.locator('#details-drawer').isVisible().catch(() => false);
      await shot(system + '-details-auto-open', {
        action: 'click',
        selector: startSel,
        detail: 'drawerVisible=' + drawerVisible,
        ok: drawerVisible,
      });
      if (!drawerVisible) {
        defect('critical', 'Details did not auto-open for ' + system, 'drawer hidden after Start');
      }

      const drawerText = drawerVisible ? await page.locator('#details-drawer').innerText() : '';
      noteFactory(system + '-details-drawer', drawerText);
      if (/Imagine pentru partajare|og:image|ogImage/i.test(drawerText)) {
        defect('critical', 'og:image still in customer Details UI (' + system + ')', drawerText.slice(0, 240));
      }

      const seed = await iframeText();
      noteFactory(system + '-seed', seed);
      if (!seed || seed.trim().length < 40) {
        defect('high', 'Editor canvas empty/unreadable for ' + system, 'seedLen=' + (seed || '').length);
      }
      if (!/hidook/i.test(seed) && !/hidook/i.test(await page.content())) {
        // attribution may live in iframe HTML not innerText
        const html = await page.frameLocator('#preview-iframe').locator('html').innerHTML().catch(() => '');
        if (!/hidook\.tech/i.test(html)) {
          defect('high', 'Missing hidook attribution in ' + system + ' preview', 'no hidook.tech');
        }
      }

      const chrome = await visibleChromeText();
      noteFactory(system + '-editor-chrome', chrome);
      const topbarClip = await page.evaluate(() => {
        const right = document.querySelector('.editor-topbar-right');
        const labels = Array.from(document.querySelectorAll('.editor-topbar-right .btn-topbar-label, .editor-topbar-right .btn-publish-top span')).map((el) => {
          const r = el.getBoundingClientRect();
          const parent = el.parentElement.getBoundingClientRect();
          return { text: el.textContent.trim(), clipped: r.right > parent.right + 1 || r.width + 2 < el.scrollWidth };
        });
        return {
          overflow: right ? right.scrollWidth > right.clientWidth + 2 : false,
          labels,
        };
      });
      if (topbarClip.overflow || (topbarClip.labels || []).some((l) => l.clipped)) {
        defect('high', 'Editor topbar clips controls on ' + system, JSON.stringify(topbarClip));
      }

      await closeDrawer();
      await acceptPreviewCookie();

      for (const ctrl of ['#btn-preview-desktop', '#btn-preview-mobile', '#btn-color-picker']) {
        const loc = page.locator(ctrl);
        if (await loc.count()) {
          await loc.click({ timeout: 4000 }).catch((err) => {
            defect('high', 'Dead control ' + ctrl + ' on ' + system, String(err.message || err).split('\n')[0]);
          });
          await page.waitForTimeout(250);
        }
      }
      await shot(system + '-pressed-editor-chrome', {
        action: 'click-loop',
        selector: '#btn-preview-desktop,#btn-preview-mobile,#btn-color-picker',
        detail: 'pressed device/color after closing Details',
      });
      const colorOpen = await page.locator('#color-popover').isVisible().catch(() => false);
      if (colorOpen) {
        await page.locator('#btn-color-picker').click().catch(() => {});
      }

      if (system === 'professionals') {
        await openDrawer();
        const booking = page.locator('#dr_appointment_bookingUrl');
        if (!(await booking.count())) {
          defect('critical', 'Cal.com booking field missing in Details', 'no #dr_appointment_bookingUrl');
          await shot('professionals-calcom-field-missing', { action: 'inspect', selector: '#details-drawer' });
        } else {
          await booking.fill('https://cal.com/hidook-fullpass/consultatie');
          await booking.blur();
          await page.waitForTimeout(1500);
          await closeDrawer();
          await page.waitForTimeout(800);
          const bookingLink = page.frameLocator('#preview-iframe').locator('a.pr-booking-link, a[href*="cal.com/hidook-fullpass"]').first();
          const hasLink = await bookingLink.count();
          await shot('professionals-calcom-filled', {
            action: 'fill+close-drawer',
            selector: '#dr_appointment_bookingUrl',
            detail: 'bookingLinkCount=' + hasLink,
            ok: hasLink > 0,
          });
          if (!hasLink) {
            defect('high', 'Cal.com URL did not render booking link in preview', 'no a.pr-booking-link after drawer close');
          }
          const formStill = await page.frameLocator('#preview-iframe').locator('form, button:has-text("Trimite")').count();
          if (!hasLink && formStill) {
            defect('high', 'Local request form still showing after Cal.com URL', 'form count=' + formStill);
          }
          await openDrawer();
          await booking.fill('');
          await booking.blur();
          await page.waitForTimeout(800);
          await closeDrawer();
          await page.waitForTimeout(800);
          const leaked = await page.frameLocator('#preview-iframe').locator('a[href*="cal.com/hidook-fullpass"]').count();
          await shot('professionals-calcom-cleared', {
            action: 'fill-empty+close-drawer',
            selector: '#dr_appointment_bookingUrl',
            detail: 'leakedCalLinks=' + leaked,
            ok: leaked === 0,
          });
          if (leaked) {
            defect('critical', 'Cleared Cal.com still leaks in preview', 'href still present');
          }
        }
      }

      if (system === 'local-service' || system === 'product-menu' || system === 'portfolio') {
        await closeDrawer();
        await acceptPreviewCookie();
        const addBtn = page.frameLocator('#preview-iframe').locator('.hb-add-btn').first();
        if (await addBtn.count()) {
          await addBtn.click({ timeout: 4000 }).catch((err) => {
            defect('medium', 'Add-item control failed on ' + system, String(err.message || err).split('\n')[0]);
          });
          await page.waitForTimeout(900);
          await shot(system + '-add-item', {
            action: 'click',
            selector: '#preview-iframe .hb-add-btn',
            detail: 'added repeatable item',
          });
          const afterAdd = await iframeText();
          if (/\bNew (item|section)\b/i.test(afterAdd)) {
            defect('high', 'New list item uses English factory copy on ' + system, 'New item/section visible');
          }
        } else {
          await shot(system + '-add-item-absent', {
            action: 'inspect',
            selector: '.hb-add-btn',
            detail: 'no add button in preview overlay',
            ok: false,
          });
          defect('medium', 'No + Adaugă control visible on ' + system, 'overlay add button missing');
        }
      }

      await closeDrawer();
      await acceptPreviewCookie();
      const waSelectors = '.whatsapp-float, #wa-fab, a.whatsapp-float, .ls-dock__wa';
      const waCandidates = page.frameLocator('#preview-iframe').locator(waSelectors);
      let waVisible = null;
      const waCount = await waCandidates.count();
      for (let i = 0; i < waCount; i++) {
        const candidate = waCandidates.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          waVisible = candidate;
          break;
        }
      }

      if (waVisible) {
        await waVisible.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(500);
        const qr = page.frameLocator('#preview-iframe').locator('#wa-qr, .wa-qr');
        const qrVisible = await qr.first().isVisible().catch(() => false);
        await shot(system + '-whatsapp-qr', {
          action: 'click',
          selector: waSelectors,
          detail: 'qrVisible=' + qrVisible,
        });
        if (qrVisible) {
          const codeBox = await page.frameLocator('#preview-iframe').locator('.wa-qr__code').first().boundingBox().catch(() => null);
          const imgBox = await page.frameLocator('#preview-iframe').locator('#wa-qr-img, .wa-qr__code img').first().boundingBox().catch(() => null);
          const box = codeBox && imgBox
            ? {
                imgCenterOffsetX: Math.abs((imgBox.x + imgBox.width / 2) - (codeBox.x + codeBox.width / 2)),
                imgCenterOffsetY: Math.abs((imgBox.y + imgBox.height / 2) - (codeBox.y + codeBox.height / 2)),
              }
            : null;
          if (box && box.imgCenterOffsetX > 12) {
            defect('medium', 'WhatsApp QR not horizontally centered (' + system + ')', JSON.stringify(box));
          }
          if (box && box.imgCenterOffsetY > 16) {
            defect('medium', 'WhatsApp QR not vertically centered (' + system + ')', JSON.stringify(box));
          }
          await page.frameLocator('#preview-iframe').locator('[data-wa-close], .wa-qr__close').first().click().catch(() => {});
        } else {
          defect('medium', 'WhatsApp QR panel did not open on ' + system, 'click float had no dialog');
        }
      } else {
        defect('medium', 'WhatsApp control missing on ' + system + ' seed', 'no visible .whatsapp-float/#wa-fab/a.whatsapp-float/.ls-dock__wa');
        await shot(system + '-whatsapp-missing', { action: 'inspect', selector: waSelectors, ok: false });
      }
      } catch (systemErr) {
        defect('high', 'Walk error on ' + system, String(systemErr.message || systemErr).split('\n')[0]);
        await shot(system + '-walk-error', { action: 'error', detail: String(systemErr.message || systemErr), ok: false }).catch(() => {});
        await closeDrawer().catch(() => {});
        await page.goto(base + '/app/#templates', { waitUntil: 'networkidle' }).catch(() => {});
      }
    }

    // Stay on last editor for unpaid export + IG + publish.
    await closeDrawer();
    await page.locator('#btn-download-html').click();
    await page.waitForTimeout(700);
    const toast1 = await page.locator('#toast').innerText().catch(() => '');
    await shot('unpaid-export-html', {
      action: 'click',
      selector: '#btn-download-html',
      detail: toast1 || '(no toast)',
    });
    if (!/trial|abonament|Intră în cont|Activează/i.test(toast1)) {
      defect('critical', 'Unpaid HTML export did not show Romanian gate', 'toast=' + toast1);
    }

    await page.locator('#btn-download-zip').click();
    await page.waitForTimeout(700);
    const toast2 = await page.locator('#toast').innerText().catch(() => '');
    await shot('unpaid-export-zip', {
      action: 'click',
      selector: '#btn-download-zip',
      detail: toast2 || '(no toast)',
    });
    if (!/trial|abonament|Autentifică/i.test(toast2)) {
      defect('critical', 'Unpaid ZIP export did not show Romanian gate', 'toast=' + toast2);
    }

    await page.locator('#btn-add-instagram').click();
    await page.locator('#modal-instagram').waitFor({ state: 'visible' });
    await shot('instagram-modal-closed-connect', {
      action: 'click',
      selector: '#btn-add-instagram',
      detail: 'Instagram modal',
    });
    const igText = await page.locator('#modal-instagram').innerText();
    noteFactory('instagram-modal', igText);
    const connectDisabled = await page.locator('#btn-ig-connect').isDisabled().catch(() => true);
    if (!connectDisabled && (await page.locator('#ig-connect-panel').isVisible().catch(() => false))) {
      defect('high', 'Instagram connect enabled before terms', 'btn-ig-connect not disabled');
    }

    // Unhappy: send magic with empty/invalid email if auth panel is shown.
    if (await page.locator('#ig-auth-panel').isVisible().catch(() => false)) {
      await page.locator('#btn-ig-send-magic').click();
      await page.waitForTimeout(400);
      await shot('instagram-empty-email-unhappy', {
        action: 'click',
        selector: '#btn-ig-send-magic',
        detail: 'empty email submit',
      });
    }

    await page.locator('#btn-close-instagram').click();
    await page.locator('#modal-instagram').waitFor({ state: 'hidden' });

    // Publish + test pay on current draft.
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await shot('open-publish', { action: 'click', selector: '#btn-publish', detail: 'publish dialog' });

    const slug = 'fullpass-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await shot('publish-address', { action: 'fill+click', selector: '#input-slug,#btn-publish-continue', detail: slug });

    await page.locator('#input-email').fill('fullpass@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await shot('send-magic-link', { action: 'fill+click', selector: '#input-email,#btn-send-magic', detail: 'dev magic link' });

    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await shot('authenticated-unpaid-cta', {
      action: 'click',
      selector: '#dev-link',
      detail: 'card CTA before test pay',
    });

    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({
      state: 'visible',
      timeout: 25000,
    });
    await shot('trial-success-live', {
      action: 'click',
      selector: '#btn-pay-publish',
      detail: 'HIDOOK_TEST_PAY live',
    });

    const toastBox = await page.evaluate(() => {
      const toast = document.getElementById('toast');
      const nav = document.querySelector('.header-nav, #editor-topbar, .editor-topbar');
      if (!toast || !nav) return { toastDisplay: toast && toast.style.display };
      const t = toast.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      const overlap = !(t.bottom < n.top || t.top > n.bottom || t.right < n.left || t.left > n.right);
      return {
        toastDisplay: toast.style.display,
        toastText: toast.innerText,
        toast: { top: t.top, bottom: t.bottom, height: t.height },
        nav: { top: n.top, bottom: n.bottom, height: n.height },
        overlap,
      };
    });
    if (toastBox && toastBox.overlap) {
      defect('high', 'Trial-success toast clips nav/topbar', JSON.stringify(toastBox));
    }

    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    await page.locator('#btn-success-close').click();
    await page.waitForTimeout(700);
    const canvasVisible = await page.locator('#preview-iframe').isVisible().catch(() => false);
    const canvasText = canvasVisible ? await iframeText() : '';
    await shot('return-to-editor-canvas', {
      action: 'click',
      selector: '#btn-success-close',
      detail: 'canvasVisible=' + canvasVisible + ' textLen=' + canvasText.length,
      ok: canvasVisible && canvasText.trim().length > 20,
    });
    if (!canvasVisible || canvasText.trim().length < 20) {
      defect('critical', 'Return-to-editor canvas not visible', 'iframe hidden or empty');
    }

    // Paid export after trial.
    const downloadHtml = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await page.locator('#btn-download-html').click();
    const htmlDl = await downloadHtml;
    await page.waitForTimeout(400);
    await shot('paid-export-html', {
      action: 'click',
      selector: '#btn-download-html',
      detail: htmlDl ? htmlDl.suggestedFilename() : 'no-download',
      ok: !!htmlDl,
    });
    if (!htmlDl) defect('high', 'Paid/trial HTML export did not download', 'no download event');

    const downloadZip = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await page.locator('#btn-download-zip').click();
    const zipDl = await downloadZip;
    await page.waitForTimeout(400);
    await shot('paid-export-zip', {
      action: 'click',
      selector: '#btn-download-zip',
      detail: zipDl ? zipDl.suggestedFilename() : 'no-download',
      ok: !!zipDl,
    });
    if (!zipDl) defect('high', 'Paid/trial ZIP export did not download', 'no download event');

    // Live site og:image + seed + legal footer.
    if (liveHref) {
      const livePage = await context.newPage();
      await livePage.goto(new URL(liveHref, base).href, { waitUntil: 'networkidle' });
      const liveHtml = await livePage.content();
      const liveText = await livePage.locator('body').innerText();
      await livePage.screenshot({
        path: path.join(evidenceDir, String(log.entries.length + 1).padStart(2, '0') + '-live-site.png'),
        fullPage: false,
      });
      const liveShot = String(log.entries.length + 1).padStart(2, '0') + '-live-site.png';
      log.entries.push({
        index: log.entries.length,
        step: 'live-site',
        action: 'open',
        selector: liveHref,
        screenshot: liveShot,
        screenshotSha256: sha256File(path.join(evidenceDir, liveShot)),
        timestamp: new Date().toISOString(),
        url: livePage.url(),
        contentCheck: { ok: true, detail: 'live HTML fetched' },
      });
      writeLog();
      if (!/property=["']og:image["']/i.test(liveHtml) && !/name=["']og:image["']/i.test(liveHtml)) {
        defect('high', 'Live site missing og:image meta', 'no og:image tag', liveShot);
      }
      if (/content=["']\s*["']/.test((liveHtml.match(/og:image[^>]*>/i) || [''])[0])) {
        defect('high', 'Live og:image meta is empty', (liveHtml.match(/og:image[^>]*>/i) || [''])[0], liveShot);
      }
      noteFactory('live-site', liveText);
      if (!/hidook\.tech/i.test(liveHtml)) {
        defect('high', 'Live site missing hidook attribution', 'no hidook.tech', liveShot);
      }
      const liveLegal = livePage.locator('a[href*="privacy"], a[href*="terms"], a[href*="cookies"]');
      if ((await liveLegal.count()) < 2) {
        defect('medium', 'Live site missing legal links', 'count=' + (await liveLegal.count()), liveShot);
      }
      await livePage.close();
    } else {
      defect('critical', 'No live URL after test pay', 'missing #success-url-link href');
    }

    // past_due allowlist: Stripe past_due must NOT export.
    let patched = 0;
    try {
      const db = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, '.registry.json'), 'utf8'));
      for (const site of Object.values(db.sites || {})) {
        if (site && site.paid && site.id) {
          registry.updateSite(site.id, { stripeSubscriptionStatus: 'past_due' });
          patched++;
        }
      }
    } catch (err) {
      defect('medium', 'Could not patch past_due entitlement for export probe', String(err.message || err));
    }
    const pastDueToastWait = page.waitForTimeout(800);
    await page.locator('#btn-download-html').click();
    await pastDueToastWait;
    const toastPastDue = await page.locator('#toast').innerText().catch(() => '');
    await shot('past-due-export-html', {
      action: 'click',
      selector: '#btn-download-html',
      detail: 'patchedSites=' + patched + ' toast=' + toastPastDue,
    });
    if (patched && !/trial|abonament|Activează/i.test(toastPastDue)) {
      defect('critical', 'past_due still allowed HTML export (allowlist leak)', 'toast=' + toastPastDue);
    }

    // Details auto-open across a second design after dismiss.
    await page.locator('#btn-back-templates').click().catch(() => {});
    await page.waitForTimeout(500);
    const other = SYSTEMS.find((id) => id !== 'desserdirina') || 'professionals';
    await page.locator('.template-card[data-template-id="' + other + '"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.waitForTimeout(800);
    const reopen = await page.locator('#details-drawer').isVisible().catch(() => false);
    await shot('details-reopen-on-new-design', {
      action: 'click',
      selector: '.template-card[data-template-id="' + other + '"] .btn-start-tpl',
      detail: 'drawerVisible=' + reopen + ' system=' + other,
      ok: reopen,
    });
    if (!reopen) {
      defect('critical', 'Details did not auto-open after switching design', 'from desserdirina to ' + other);
    }

    log.verified = true;
    log.completedAt = new Date().toISOString();
    log.liveHref = liveHref || null;
    writeLog();
  } catch (error) {
    log.failure = { message: error.message, stack: error.stack, timestamp: new Date().toISOString() };
    try {
      await shot('walk-aborted', { action: 'error', detail: error.message, ok: false });
    } catch (_) {}
    writeLog();
    console.error(error);
  } finally {
    const lines = [
      '# Full-pass inventory — 63230d2',
      '',
      'Oracle: `bot/test/fullpass-63230d2.mjs`',
      'HEAD: ' + (log.gitHead || '(unknown)'),
      'Started: ' + log.startedAt,
      'Completed: ' + (log.completedAt || log.failure?.timestamp || ''),
      'Steps captured: ' + log.entries.length,
      'Mechanical defects: ' + log.defects.length,
      log.failure ? 'Walk aborted: ' + log.failure.message : 'Walk finished.',
      '',
      '## Defects',
      '',
    ];
    if (!log.defects.length) lines.push('_None recorded by the binding oracle._', '');
    for (const d of log.defects) {
      lines.push('- **' + d.severity + '** ' + d.title);
      lines.push('  - ' + d.detail);
      if (d.screenshot) lines.push('  - screenshot: `04-QA-Evidence/FullPass-63230d2/' + d.screenshot + '`');
    }
    lines.push('', '## Steps', '');
    for (const e of log.entries) {
      lines.push('- `' + e.screenshot + '` — ' + e.step + ' (' + e.action + ')');
    }
    fs.writeFileSync(path.join(evidenceDir, 'INVENTORY.md'), lines.join('\n') + '\n');
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }

  if (log.failure) process.exitCode = 2;
  console.log('FULLPASS defects=' + log.defects.length + ' steps=' + log.entries.length);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
