#!/usr/bin/env node
/**
 * Binding stranger visual walk at HEAD 3099ebb / product 5508863.
 * Screenshot filenames are the action just performed.
 * Does not patch product code.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, '04-QA-Evidence/Advocate-5508863');
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const SYSTEMS = ['professionals', 'local-service', 'portfolio', 'product-menu', 'desserdirina'];
const FACTORY = [
  /\bBook now\b/i, /\bClick here\b/i, /\bGet started\b/i, /\bLorem ipsum\b/i,
  /\bWhitfield\b/i, /\bNorthline\b/i, /\bRidgeline\b/i, /\bConstTop\b/i,
  /\bDESSERD\b/, /\bTODO\b/, /\bFIXME\b/, /\[object Object\]/,
  /\bNew section\b/i, /\bNew item\b/i, /Placeholder juridic/i,
  /\bDownload HTML\b/, /\bDownload ZIP\b/, /\bPublish\b/, /\bLogout\b/,
  /\bSign in\b/, /Imagine pentru partajare/i, /\bog:image\b/i,
];

fs.mkdirSync(OUT, { recursive: true });
for (const name of fs.readdirSync(OUT)) {
  if (/\.(png|json)$/.test(name)) fs.rmSync(path.join(OUT, name), { force: true });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advocate-5508863-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'advocate-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.PUBLIC_URL;

execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
  cwd: ROOT,
  stdio: ['ignore', 'ignore', 'pipe'],
});

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) {}
  }
  throw new Error('playwright not found');
}

function boxesHit(a, b, pad = 2) {
  if (!a || !b) return false;
  return !(
    a.x + a.width - pad <= b.x ||
    b.x + b.width - pad <= a.x ||
    a.y + a.height - pad <= b.y ||
    b.y + b.height - pad <= a.y
  );
}

const log = {
  gitHead: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  entries: [],
  defects: [],
  namedFixes: {},
};

function defect(severity, title, detail, screenshot) {
  const item = { severity, title, detail, screenshot: screenshot || log.entries.at(-1)?.screenshot || null };
  log.defects.push(item);
  console.log('DEFECT', severity, title, detail);
}

function scan(text, surface, screenshot) {
  const hay = String(text || '');
  for (const re of FACTORY) {
    const m = hay.match(re);
    if (m) defect('high', 'Factory/English leftover on ' + surface, m[0], screenshot);
  }
}

async function main() {
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = 'http://127.0.0.1:' + server.address().port;
  log.base = base;
  fs.writeFileSync(path.join(OUT, 'server.json'), JSON.stringify({ base, dataDir: tmpDir }, null, 2));

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  let n = 0;
  async function shot(step, extra = {}) {
    n += 1;
    const file = String(n).padStart(2, '0') + '-' + step + '.png';
    const target = extra.page || page;
    await target.screenshot({ path: path.join(OUT, file), fullPage: !!extra.fullPage });
    const entry = { step, action: extra.action || step, screenshot: file, url: target.url(), detail: extra.detail || '' };
    log.entries.push(entry);
    console.log('SHOT', file, extra.detail || '');
    fs.writeFileSync(path.join(OUT, 'oracle-log.json'), JSON.stringify(log, null, 2));
    return file;
  }

  async function shotIframe(step) {
    n += 1;
    const file = String(n).padStart(2, '0') + '-' + step + '.png';
    const iframe = page.locator('#preview-iframe');
    await iframe.screenshot({ path: path.join(OUT, file) });
    const entry = { step, action: step, screenshot: file, url: page.url(), detail: 'iframe-only' };
    log.entries.push(entry);
    console.log('SHOT', file, 'iframe-only');
    fs.writeFileSync(path.join(OUT, 'oracle-log.json'), JSON.stringify(log, null, 2));
    return file;
  }

  async function closeDrawer() {
    const drawer = page.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
      await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    }
  }

  async function acceptPreviewCookie() {
    const frame = page.frameLocator('#preview-iframe');
    const btn = frame.locator('#hb-cookie-accept, .hb-cookie-banner button').first();
    if (await btn.count()) await btn.click({ timeout: 2500 }).catch(() => {});
  }

  async function measure390(system) {
    const handle = await page.$('#preview-iframe');
    const child = handle && await handle.contentFrame();
    if (!child) return { missing: true };
    return child.evaluate((systemId) => {
      const vh = window.innerHeight || 844;
      const vw = window.innerWidth || 390;
      function boxOf(el) {
        if (!el) return null;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) return null;
        if (r.bottom < -2 || r.top > vh + 2) return null;
        return {
          x: +r.x.toFixed(1), y: +r.y.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1),
          text: String(el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        };
      }
      const cookie = boxOf(document.getElementById('hb-cookie-banner') || document.querySelector('.hb-cookie-banner'));
      const waNodes = [];
      for (const el of document.querySelectorAll('.whatsapp-float, a.whatsapp-float, .ls-dock__wa, a.ls-dock__wa, [aria-label*="WhatsApp" i]')) {
        const b = boxOf(el);
        if (!b) continue;
        const cls = String(el.className || '');
        if (cls.includes('ls-dock') && !cls.includes('ls-dock__wa') && el.matches('.ls-dock')) continue;
        waNodes.push({ tag: el.tagName, cls, aria: el.getAttribute('aria-label') || '', href: el.getAttribute('href') || '', box: b });
      }
      const waDedup = [];
      for (const w of waNodes) {
        const overlapExisting = waDedup.some((o) => {
          const a = o.box; const b = w.box;
          const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
          const x2 = Math.min(a.x + a.width, b.x + b.width);
          const y2 = Math.min(a.y + a.height, b.y + b.height);
          return x2 - x1 > 8 && y2 - y1 > 8;
        });
        if (!overlapExisting) waDedup.push(w);
      }
      const stripItems = Array.from(document.querySelectorAll('.pr-strip__item')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: String(el.innerText || '').replace(/\s+/g, ' ').trim(),
          clientW: el.clientWidth, scrollW: el.scrollWidth,
          clippedX: el.scrollWidth > el.clientWidth + 1,
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      });
      const hintEl = document.querySelector('.pf-hint, .scroll-hint, .scroll-hint__label');
      const hint = hintEl ? {
        text: String(hintEl.innerText || '').replace(/\s+/g, ' ').trim(),
        clientW: hintEl.clientWidth, scrollW: hintEl.scrollWidth,
        clippedX: hintEl.scrollWidth > hintEl.clientWidth + 1,
        box: boxOf(hintEl),
      } : null;
      const dock = boxOf(document.querySelector('.ls-dock, .call-dock, #call-dock, .hb-call-dock'));
      return {
        systemId, vw, vh, cookie, dock,
        waCount: waDedup.length, waAffordances: waDedup,
        stripItems, hint,
        rowText: String((document.querySelector('.pr-strip, .pr-strip__row') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
      };
    }, system);
  }

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-banner').waitFor({ state: 'visible' });
    const cookieText = await page.locator('#hb-cookie-banner').innerText();
    const title0 = await page.title();
    const landingBody = await page.locator('body').innerText();
    await shot('open-app-cookie-banner', { action: 'open /app/', detail: 'title=' + title0 });
    scan(cookieText, 'landing-cookie');
    scan(landingBody, 'landing-chrome');
    if (!/trialul de 7 zile|7 zile/i.test(landingBody)) {
      defect('high', 'Landing missing 7-day trial model', landingBody.slice(0, 300));
    }
    if (/99 USD|one-time|100\$|30 dacă/i.test(landingBody)) {
      defect('critical', 'Landing still shows stale commercial model', landingBody.slice(0, 300));
    }

    await page.locator('#hb-cookie-accept').click();
    await shot('click-cookie-accept-landing', { action: 'click #hb-cookie-accept' });

    for (const legal of [
      { slug: 'terms', href: '/app/terms.html', expectTitle: /Termeni/i },
      { slug: 'privacy', href: '/app/privacy.html', expectTitle: /Confidențialitate/i },
      { slug: 'cookies', href: '/app/cookies.html', expectTitle: /Cookie/i },
    ]) {
      await page.goto(base + legal.href, { waitUntil: 'networkidle' });
      const t = await page.title();
      const body = await page.locator('body').innerText();
      const f = await shot('open-legal-' + legal.slug, { action: 'open ' + legal.href, detail: 'title=' + t, fullPage: true });
      if (!legal.expectTitle.test(t)) defect('high', 'Legal tab title not Romanian (' + legal.slug + ')', t, f);
      if (/Terms of (Use|Service)|Privacy Policy|Cookie Policy/i.test(t) && !/Termeni|Confidențialitate|Cookie-uri/i.test(t)) {
        defect('high', 'Legal tab title still English (' + legal.slug + ')', t, f);
      }
      scan(body, 'legal-' + legal.slug, f);
      if (/lorem|placeholder juridic|TODO|Coming soon/i.test(body)) {
        defect('high', 'Legal page unfinished', body.slice(0, 200), f);
      }
    }

    await page.goto(base + '/app/', { waitUntil: 'networkidle' });

    for (const system of SYSTEMS) {
      if (system !== SYSTEMS[0]) {
        await closeDrawer();
        const back = page.locator('#btn-back-templates');
        if (await back.isVisible().catch(() => false)) {
          await back.click({ timeout: 5000 }).catch(async () => {
            await page.goto(base + '/app/#templates', { waitUntil: 'networkidle' });
          });
        } else {
          await page.goto(base + '/app/#templates', { waitUntil: 'networkidle' });
        }
        await page.locator('.template-card[data-template-id="' + system + '"] .btn-start-tpl').waitFor({ state: 'visible' });
      }
      await page.locator('.template-card[data-template-id="' + system + '"] .btn-start-tpl').click();
      await page.waitForURL(/#edit$/, { timeout: 25000 });
      await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
      await page.waitForTimeout(900);
      const drawerOn = await page.locator('#details-drawer').isVisible().catch(() => false);
      const f1 = await shot('start-' + system + '-details-auto-open', {
        action: 'click start ' + system,
        detail: 'drawer=' + drawerOn,
      });
      if (!drawerOn) defect('critical', 'Details did not auto-open ' + system, '', f1);
      const drawerText = drawerOn ? await page.locator('#details-drawer').innerText() : '';
      scan(drawerText, system + '-drawer', f1);
      if (/Imagine pentru partajare|og:image|ogImage/i.test(drawerText)) {
        defect('critical', 'og:image still in customer Details UI (' + system + ')', drawerText.slice(0, 240), f1);
      }

      if (system === 'professionals') {
        const booking = page.locator('#dr_appointment_bookingUrl');
        if (!(await booking.count())) {
          defect('critical', 'Cal.com booking field missing in Details', 'no #dr_appointment_bookingUrl', f1);
        } else {
          await booking.fill('https://cal.com/hidook-fullpass/consultatie');
          await booking.blur();
          await page.waitForTimeout(800);
          await shot('fill-calcom-professionals', { action: 'fill #dr_appointment_bookingUrl' });
          await booking.fill('');
          await booking.blur();
        }
      }

      await closeDrawer();
      await page.waitForTimeout(300);
      const f2 = await shot('close-drawer-' + system + '-desktop-preview', {
        action: 'close details desktop',
      });
      const seed = await page.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      scan(seed, system + '-seed-desktop', f2);
      if (!seed || seed.trim().length < 40) {
        defect('high', 'Editor canvas empty/unreadable for ' + system, 'seedLen=' + (seed || '').length, f2);
      }

      const mobileBtn = page.locator('#btn-preview-mobile');
      if (await mobileBtn.isVisible().catch(() => false)) {
        await mobileBtn.click();
        await page.waitForTimeout(700);
      }
      const f3 = await shot('click-mobile-preview-390-' + system, {
        action: 'click #btn-preview-mobile',
      });
      const f3i = await shotIframe('iframe-390-' + system + '-cookie-default');
      const seedM = await page.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      scan(seedM, system + '-seed-mobile', f3);

      const metrics = await measure390(system);
      log.namedFixes[system] = metrics;
      fs.writeFileSync(path.join(OUT, 'named-fixes.json'), JSON.stringify(log.namedFixes, null, 2));

      if (system === 'professionals') {
        const cabinetItem = (metrics.stripItems || []).find((i) => /cabinet/i.test(i.text));
        if (!cabinetItem) {
          defect('high', 'Professionals strip missing cabinet item at 390', JSON.stringify(metrics), f3i);
        } else if (cabinetItem.clippedX) {
          defect('high', 'Professionals credibility strip still clips cabinet at 390', JSON.stringify(cabinetItem), f3i);
        }
        for (const wa of metrics.waAffordances || []) {
          if (cabinetItem && boxesHit(wa.box, cabinetItem.box, 2)) {
            defect('high', 'Professionals FAB overlaps credibility strip at 390', JSON.stringify({ wa, cabinetItem }), f3i);
          }
        }
        if (metrics.cookie && cabinetItem && boxesHit(metrics.cookie, cabinetItem.box, 2)) {
          defect('high', 'Professionals cookie overlaps credibility strip at 390', JSON.stringify({ cookie: metrics.cookie, cabinetItem }), f3i);
        }
      }

      if (system === 'portfolio') {
        if (!metrics.hint) {
          defect('high', 'Portfolio EXPLOREAZĂ label missing at 390', JSON.stringify(metrics), f3i);
        } else {
          if (metrics.hint.clippedX) {
            defect('high', 'Portfolio EXPLOREAZĂ still clipped at 390', JSON.stringify(metrics.hint), f3i);
          }
          for (const wa of metrics.waAffordances || []) {
            if (metrics.hint.box && boxesHit(wa.box, metrics.hint.box, 2)) {
              defect('high', 'Portfolio cookie/FAB still overlaps EXPLOREAZĂ at 390', JSON.stringify({ wa, hint: metrics.hint }), f3i);
            }
          }
          if (metrics.cookie && metrics.hint.box && boxesHit(metrics.cookie, metrics.hint.box, 2)) {
            defect('high', 'Portfolio cookie overlaps EXPLOREAZĂ at 390', JSON.stringify({ cookie: metrics.cookie, hint: metrics.hint }), f3i);
          }
          for (const wa of metrics.waAffordances || []) {
            if (metrics.cookie && boxesHit(metrics.cookie, wa.box, 2)) {
              defect('high', 'Portfolio cookie still overlaps WhatsApp FAB at 390', JSON.stringify({ cookie: metrics.cookie, wa }), f3i);
            }
          }
        }
      }

      if (system === 'local-service') {
        if (metrics.waCount !== 1) {
          defect('high', 'Local-service duplicate WhatsApp controls at 390', 'waCount=' + metrics.waCount + ' ' + JSON.stringify(metrics.waAffordances), f3i);
        }
        for (const wa of metrics.waAffordances || []) {
          if (metrics.cookie && boxesHit(metrics.cookie, wa.box, 2)) {
            defect('high', 'Local-service cookie overlaps WhatsApp at 390', JSON.stringify({ cookie: metrics.cookie, wa }), f3i);
          }
        }
        if (metrics.cookie && metrics.dock && boxesHit(metrics.cookie, metrics.dock, 2)) {
          defect('high', 'Local-service cookie overlaps call dock at 390', JSON.stringify({ cookie: metrics.cookie, dock: metrics.dock }), f3i);
        }
      }

      // WhatsApp QR on this system at 390 with cookie dismissed so FAB is clickable.
      await acceptPreviewCookie();
      await page.waitForTimeout(250);
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
        await page.waitForTimeout(400);
        const qr = page.frameLocator('#preview-iframe').locator('#wa-qr, .wa-qr');
        const qrVisible = await qr.first().isVisible().catch(() => false);
        await shotIframe('click-whatsapp-qr-390-' + system);
        if (!qrVisible) {
          defect('medium', 'WhatsApp QR panel did not open on ' + system, 'click visible WA had no dialog');
        } else {
          await page.frameLocator('#preview-iframe').locator('[data-wa-close], .wa-qr__close').first().click().catch(() => {});
        }
      } else {
        defect('medium', 'WhatsApp control missing on ' + system + ' seed at 390', 'no visible WA');
        await shotIframe('whatsapp-missing-390-' + system);
      }

      await page.locator('#btn-preview-desktop').click().catch(() => {});
      await page.waitForTimeout(250);
    }

    await closeDrawer();
    await page.locator('#btn-download-html').click();
    await page.waitForTimeout(600);
    const toast1 = await page.locator('#toast').innerText().catch(() => '');
    await shot('click-unpaid-export-html', { action: 'click #btn-download-html', detail: toast1 });
    if (!/trial|abonament|Intră în cont|Activează/i.test(toast1)) {
      defect('critical', 'Unpaid HTML export did not show Romanian gate', 'toast=' + toast1);
    }

    await page.locator('#btn-add-instagram').click();
    await page.locator('#modal-instagram').waitFor({ state: 'visible' });
    const igText = await page.locator('#modal-instagram').innerText();
    await shot('click-instagram-modal', { action: 'click #btn-add-instagram' });
    scan(igText, 'instagram-modal');
    if (await page.locator('#ig-auth-panel').isVisible().catch(() => false)) {
      await page.locator('#btn-ig-send-magic').click();
      await page.waitForTimeout(400);
      await shot('click-ig-empty-email', { action: 'click #btn-ig-send-magic empty' });
    }
    await page.locator('#btn-close-instagram').click().catch(() => {});

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const pubText = await page.locator('#modal-publish').innerText();
    await shot('click-publish', { action: 'click #btn-publish', detail: pubText.slice(0, 200) });
    scan(pubText, 'publish-modal');
    if (!/7 zile/i.test(pubText)) defect('high', 'Publish modal missing 7-day trial', pubText.slice(0, 240));

    const slug = 'adv550-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await shot('fill-publish-slug', { action: 'fill slug + continue', detail: slug });
    await page.locator('#input-email').fill('advocate@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await shot('click-send-magic', { action: 'send magic' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await shot('click-dev-magic-unpaid-cta', { action: 'click dev link' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ timeout: 25000 });
    await shot('click-test-pay-success', { action: 'click #btn-pay-publish' });

    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    log.liveHref = liveHref;
    if (liveHref) {
      const live = await context.newPage();
      await live.goto(new URL(liveHref, base).href, { waitUntil: 'networkidle' });
      await shot('open-live-site-desktop', { page: live, action: 'open live', detail: live.url() });
      await live.setViewportSize({ width: 390, height: 844 });
      await live.waitForTimeout(400);
      await shot('open-live-site-390', { page: live, action: 'resize live 390', detail: live.url() });
      const liveText = await live.locator('body').innerText();
      scan(liveText, 'live-site');
      const liveHtml = await live.content();
      if (!/hidook\.tech/i.test(liveHtml)) {
        defect('high', 'Live site missing hidook attribution', 'no hidook.tech');
      }
      await live.close();
    } else {
      defect('critical', 'No live URL after test pay', 'missing #success-url-link href');
    }

    await page.locator('#btn-success-close').click();
    await page.waitForTimeout(600);
    await shot('click-return-to-editor', { action: 'click #btn-success-close' });

    const downloadHtml = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await page.locator('#btn-download-html').click();
    const htmlDl = await downloadHtml;
    await shot('click-paid-export-html', { action: 'click #btn-download-html', detail: htmlDl ? htmlDl.suggestedFilename() : 'no-download' });
    if (!htmlDl) defect('high', 'Paid/trial HTML export did not download', 'no download event');

    const myProjects = page.locator('a:has-text("Proiectele mele"), button:has-text("Proiectele mele")');
    if (await myProjects.first().isVisible().catch(() => false)) {
      await myProjects.first().click();
      await page.waitForTimeout(700);
      await shot('click-proiectele-mele', { action: 'open projects' });
    } else {
      await page.goto(base + '/app/#projects', { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(700);
      await shot('open-hash-projects', { action: 'goto #projects' });
    }
    const cancelBtn = page.locator('button:has-text("Anulează")').first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      page.once('dialog', (d) => d.accept().catch(() => {}));
      await cancelBtn.click();
      await page.waitForTimeout(900);
      await shot('click-anuleaza', { action: 'click Anulează' });
    } else {
      await shot('cancel-button-missing', { action: 'inspect Anulează', detail: 'not visible' });
      defect('high', 'Anulează not reachable after trial', 'no cancel button');
    }

    log.completedAt = new Date().toISOString();
  } catch (err) {
    log.failure = { message: err.message, stack: err.stack };
    await shot('walk-aborted', { action: 'error', detail: err.message }).catch(() => {});
    console.error(err);
  } finally {
    fs.writeFileSync(path.join(OUT, 'oracle-log.json'), JSON.stringify(log, null, 2) + '\n');
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('ADVOCATE-WALK defects=' + log.defects.length + ' steps=' + log.entries.length);
  if (log.failure) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exit(1); });
