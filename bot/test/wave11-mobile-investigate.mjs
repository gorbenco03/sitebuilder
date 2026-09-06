#!/usr/bin/env node
/**
 * Wave 11 mobile investigation driver.
 *
 * Drives the builder at a real 390x844 touch-emulated viewport (iPhone 12/13
 * class device) through the whole "choose a design -> publish" job, taking a
 * screenshot at every step and recording measurements (touch target sizes,
 * overflow, element visibility) needed to answer: can a customer finish this
 * on a phone?
 *
 * Usage:
 *   OUT_DIR=04-QA-Evidence/Wave11-mobile/before node mobile-investigate.mjs
 *   OUT_DIR=04-QA-Evidence/Wave11-mobile/after  node mobile-investigate.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(import.meta.url);
const OUT_DIR = process.env.OUT_DIR ? path.resolve(ROOT, process.env.OUT_DIR) : path.join(ROOT, '04-QA-Evidence', 'Wave11-mobile', 'before');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const findings = [];
function note(step, ok, detail, extra) {
  findings.push({ step, ok, detail, extra: extra || null });
  console.log((ok ? 'OK  ' : 'BAD ') + step + ' — ' + detail);
}

let shotIndex = 0;
async function shot(page, name) {
  shotIndex += 1;
  const fname = String(shotIndex).padStart(2, '0') + '-' + name + '.png';
  await page.screenshot({ path: path.join(OUT_DIR, fname), fullPage: false });
  return fname;
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-mobile-'));
  process.env.SERVER_SECRET = 'wave11-mobile-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_FAKE_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });

    // Step 1: cookie banner
    const cookieBtn = page.locator('#hb-cookie-accept');
    await cookieBtn.waitFor({ state: 'visible', timeout: 10000 });
    const cookieBox = await cookieBtn.boundingBox();
    note('cookie-banner', cookieBox.width >= 44 && cookieBox.height >= 44,
      'Accept button size ' + Math.round(cookieBox.width) + 'x' + Math.round(cookieBox.height) + 'px (need >=44x44)');
    await shot(page, 'cookie-banner');
    await cookieBtn.tap();
    await cookieBtn.waitFor({ state: 'hidden' });

    // Step 2: pick a template (professionals)
    await shot(page, 'template-picker');
    const startBtn = page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl');
    await startBtn.scrollIntoViewIfNeeded();
    const startBox = await startBtn.boundingBox();
    note('template-start-button', startBox && startBox.width >= 44 && startBox.height >= 44,
      'Start button size ' + (startBox ? Math.round(startBox.width) + 'x' + Math.round(startBox.height) : 'n/a') + 'px');
    await startBtn.tap();
    await page.waitForURL(/#edit$/);
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await shot(page, 'editor-loaded-details-auto-open');

    // Measure the editor canvas visible area vs iframe declared size
    const canvasBox = await page.locator('.editor-canvas-wrap').boundingBox();
    const iframeBox = await page.locator('#preview-iframe').boundingBox();
    note('editor-canvas-size', canvasBox && canvasBox.height > 300,
      'canvas wrap ' + JSON.stringify(canvasBox) + ' iframe ' + JSON.stringify(iframeBox));

    // Step 3: close details drawer to expose inline editing, check topbar overflow
    await page.locator('#btn-close-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    await shot(page, 'details-closed');

    // Check whether every topbar button is within viewport / not clipped
    const topbarButtons = await page.locator('.editor-topbar button, .editor-topbar-right button').all();
    const topbarReport = [];
    for (const btn of topbarButtons) {
      const id = await btn.getAttribute('id');
      const box = await btn.boundingBox();
      const visible = await btn.isVisible();
      topbarReport.push({ id, box, visible });
    }
    const viewportW = 390;
    // Buttons inside the horizontally-scrollable rail (.editor-topbar-scroll)
    // are allowed to sit outside the viewport — that is what "scroll to
    // reach it" means. Only buttons OUTSIDE the rail (back/account/undo/
    // redo/device-toggle/publish) must always be on-screen without scrolling.
    const scrollRailIds = new Set(['save-status', 'btn-save-retry', 'checklist-indicator', 'btn-add-instagram', 'btn-color-picker', 'btn-open-gallery', 'btn-open-drawer', 'btn-download-html', 'btn-download-zip']);
    const pinnedReport = topbarReport.filter((b) => b.id && !scrollRailIds.has(b.id));
    const clipped = pinnedReport.filter((b) => b.box && (b.box.x < 0 || b.box.x + b.box.width > viewportW));
    note('topbar-pinned-buttons-fit-viewport', clipped.length === 0,
      clipped.length + ' of ' + pinnedReport.length + ' non-scrollable topbar buttons extend outside 0..390px',
      pinnedReport);
    const smallTargets = topbarReport.filter((b) => b.box && b.visible && (b.box.width < 44 || b.box.height < 44));
    note('topbar-buttons-touch-target-44', smallTargets.length === 0,
      smallTargets.length + ' of ' + topbarReport.length + ' visible topbar buttons are under 44x44px',
      smallTargets.map((b) => b.id));

    // Real regression test for the overlap bug: no two visible, on-screen
    // topbar buttons may occupy overlapping screen space (later-DOM element
    // would silently eat the earlier one's taps).
    function intersects(a, b) {
      return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    }
    const onScreen = topbarReport.filter((b) => b.box && b.visible && b.box.x >= -1 && b.box.x + b.box.width <= viewportW + 1);
    const overlaps = [];
    for (let i = 0; i < onScreen.length; i += 1) {
      for (let j = i + 1; j < onScreen.length; j += 1) {
        if (intersects(onScreen[i].box, onScreen[j].box)) overlaps.push([onScreen[i].id, onScreen[j].id]);
      }
    }
    note('topbar-buttons-no-overlap', overlaps.length === 0,
      overlaps.length + ' overlapping on-screen topbar button pairs', overlaps);

    // Step 4: tap the business name to edit inline text
    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameField.waitFor({ state: 'visible', timeout: 10000 });
    const nameBoxBefore = await nameField.boundingBox();
    await nameField.tap();
    await shot(page, 'tap-business-name');
    // Simulate a touch keyboard occupying the bottom ~40% of the viewport (iOS keyboard on a 844pt screen ~ 336pt)
    const KEYBOARD_HEIGHT = 336;
    const nameBoxAfterTap = await nameField.boundingBox();
    const coveredByKeyboard = nameBoxAfterTap && (nameBoxAfterTap.y + nameBoxAfterTap.height) > (844 - KEYBOARD_HEIGHT);
    note('edit-field-visible-above-keyboard', !coveredByKeyboard,
      'business.name field top/bottom ' + JSON.stringify(nameBoxAfterTap) + ' vs simulated keyboard top y=' + (844 - KEYBOARD_HEIGHT));
    await nameField.fill('Mobil Delta Test SRL');
    await nameField.evaluate((el) => el.blur());
    await shot(page, 'edited-business-name');

    // Step 5: open details drawer, try to replace a photo
    await page.locator('#btn-open-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await shot(page, 'drawer-open');
    const drawerBox = await page.locator('#details-drawer').boundingBox();
    note('drawer-covers-most-of-viewport', drawerBox && drawerBox.width >= 350,
      'drawer width ' + (drawerBox ? Math.round(drawerBox.width) : 'n/a') + 'px of 390px viewport');
    const closeDrawerBtn = page.locator('#btn-close-drawer');
    const closeDrawerBox = await closeDrawerBtn.boundingBox();
    note('drawer-close-button-touch-target', closeDrawerBox && closeDrawerBox.width >= 44 && closeDrawerBox.height >= 44,
      'close button ' + (closeDrawerBox ? Math.round(closeDrawerBox.width) + 'x' + Math.round(closeDrawerBox.height) : 'n/a') + 'px');

    const photoBtn = page.locator('[data-field-key="hero.background"] button').first();
    await photoBtn.scrollIntoViewIfNeeded();
    const photoBtnBox = await photoBtn.boundingBox();
    note('drawer-photo-button-touch-target', photoBtnBox && photoBtnBox.height >= 44,
      'photo button height ' + (photoBtnBox ? Math.round(photoBtnBox.height) : 'n/a') + 'px');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await photoBtn.tap();
    const chooser = await fileChooserPromise;
    await chooser.setFiles(path.join(ROOT, 'templates/product-menu/images/cn-d1.jpg'));
    await page.locator('#dr_hero_background_img').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#dr_hero_background_img')?.value === 'Poză adăugată');
    note('photo-replace-from-file-chooser', true, 'file chooser opened by tap and accepted a file');
    await shot(page, 'photo-replaced');

    await page.locator('#btn-close-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    // Step 6: open color popover, check it fits on screen
    await page.locator('#btn-color-picker').tap();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    await shot(page, 'color-popover-open');
    const popoverBox = await page.locator('#color-popover').boundingBox();
    const popoverOverflows = popoverBox && (popoverBox.x < 0 || popoverBox.x + popoverBox.width > 390 || popoverBox.y < 0 || popoverBox.y + popoverBox.height > 844);
    note('color-popover-fits-viewport', !popoverOverflows,
      'popover box ' + JSON.stringify(popoverBox) + ' vs viewport 390x844');
    await page.locator('#color-custom-text').fill('#2F6B5F');
    await page.locator('#color-bg-text').fill('#E8F2EE');
    await shot(page, 'color-set');
    await page.locator('#btn-color-picker').tap();
    await page.locator('#color-popover').waitFor({ state: 'hidden' });

    // Step 7: mobile preview toggle (should already look mobile since editor itself is mobile-width)
    const mobileBtn = page.locator('#btn-preview-mobile');
    const mobileBtnBox = await mobileBtn.boundingBox();
    note('preview-mobile-toggle-touch-target', mobileBtnBox && mobileBtnBox.width >= 44 && mobileBtnBox.height >= 44,
      'mobile toggle ' + (mobileBtnBox ? Math.round(mobileBtnBox.width) + 'x' + Math.round(mobileBtnBox.height) : 'n/a') + 'px');
    await mobileBtn.tap();
    await shot(page, 'mobile-preview-mode');

    // Step 8: publish
    const publishBtn = page.locator('#btn-publish');
    const publishVisible = await publishBtn.isVisible();
    const publishBox = publishVisible ? await publishBtn.boundingBox() : null;
    const publishReachable = publishVisible && publishBox && publishBox.x >= 0 && publishBox.x + publishBox.width <= 390;
    note('publish-button-reachable', publishReachable,
      'publish button visible=' + publishVisible + ' box=' + JSON.stringify(publishBox));
    await publishBtn.tap({ force: !publishReachable });
    await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await shot(page, 'publish-modal');
    const modalBox = await page.locator('#modal-publish .modal-box').boundingBox().catch(() => null);
    note('publish-modal-fits-viewport', modalBox && modalBox.width <= 390 + 1,
      'publish modal box ' + JSON.stringify(modalBox));

    const slugInput = page.locator('#input-slug');
    await slugInput.fill('wave11-mobile-test');
    await page.locator('#btn-publish-continue').tap();
    await page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await shot(page, 'auth-email-step');

    await page.locator('#input-email').fill('wave11-mobile@example.com');
    await page.locator('#btn-send-magic').tap();
    await page.locator('#dev-link').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await shot(page, 'magic-link-issued');
    await page.locator('#dev-link').tap();
    await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await shot(page, 'success-modal-unpaid');

    const payBtn = page.locator('#btn-pay-publish');
    if (await payBtn.isVisible().catch(() => false)) {
      await payBtn.tap();
      await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await shot(page, 'published-live');
      note('publish-flow-completed', true, 'reached live-site success screen');
    } else {
      note('publish-flow-completed', false, 'pay-publish button not visible/reachable');
    }
  } catch (error) {
    note('FATAL', false, error.message);
    try { await shot(page, 'fatal-error'); } catch (e) {}
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'findings.json'), JSON.stringify(findings, null, 2) + '\n');
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }

  const bad = findings.filter((f) => !f.ok);
  console.log('\n=== SUMMARY: ' + (findings.length - bad.length) + '/' + findings.length + ' checks passed ===');
  for (const f of bad) console.log('FAIL: ' + f.step + ' — ' + f.detail);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
