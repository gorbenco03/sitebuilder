// Verify PM-01: "Galeria foto (lightbox) e complet nestilizata" — template product-menu.
// Publishes a real product-menu site through the isolated app flow, opens the LIVE
// page, clicks a gallery photo, and inspects the resulting DOM/CSS + screenshots.
import path from 'node:path';
import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const evDir = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/template-product-menu_PM-01';

async function run() {
  const srv = await bootServer();
  const ev = makeEvidence(evDir, 'verify-PM-01');
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;

  await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await ev.shot(page, 'catalog-loaded', { action: 'goto /app/' });

  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
  await page.locator('#screen-edit').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  await ev.shot(page, 'editor-opened-product-menu', { action: 'click .btn-start-tpl[product-menu]' });

  // Details drawer opens automatically; close it so it doesn't block #btn-publish.
  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.locator('#drawer-overlay').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  // Publish through the full test-pay flow to get a real /live/<slug>/ URL.
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  const slug = 'verify-pm01-' + Date.now().toString(36);
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill('verify-pm01@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
  await page.locator('#btn-pay-publish').click();
  await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({
    state: 'visible', timeout: 25000,
  });
  await page.locator('#success-url-link').waitFor({ state: 'visible', timeout: 5000 });
  const liveHref = await page.locator('#success-url-link').getAttribute('href');
  ev.note('live URL: ' + liveHref);
  await ev.shot(page, 'publish-success', { action: 'publish flow complete', detail: liveHref });

  // Visit the LIVE page directly (this is what a real visitor sees).
  const liveUrl = liveHref.startsWith('http') ? liveHref : srv.base + liveHref;
  await page.goto(liveUrl, { waitUntil: 'networkidle' });
  await ev.shot(page, 'live-page-loaded', { action: 'goto live url', detail: liveUrl });

  // Find a gallery photo (.collage-photo img) and scroll to it.
  const photo = page.locator('.collage-photo').first();
  const photoCount = await page.locator('.collage-photo').count();
  ev.note('collage-photo count on live page: ' + photoCount);
  if (photoCount === 0) {
    ev.defect('info', 'Nu s-a găsit .collage-photo pe pagina live (posibil galeria nu e populată în preset-ul implicit)', 'photoCount=0');
  } else {
    await photo.scrollIntoViewIfNeeded();
    await ev.shot(page, 'gallery-scrolled-into-view', { action: 'scrollIntoView .collage-photo' });

    // Record footer position + doc height BEFORE click.
    const before = await page.evaluate(() => {
      const foot = document.querySelector('.pm-foot, footer');
      return {
        docHeight: document.documentElement.scrollHeight,
        footTop: foot ? foot.getBoundingClientRect().top + window.scrollY : null,
      };
    });

    await photo.click();
    await page.waitForTimeout(400); // allow any transition
    await ev.shot(page, 'after-click-gallery-photo', { action: 'click .collage-photo', fullPage: true, detail: 'click first gallery photo to open lightbox' });

    const after = await page.evaluate(() => {
      const lb = document.querySelector('.lightbox');
      const foot = document.querySelector('.pm-foot, footer');
      const cs = lb ? getComputedStyle(lb) : null;
      return {
        lightboxExists: !!lb,
        lightboxHidden: lb ? lb.hasAttribute('hidden') : null,
        computed: cs ? {
          position: cs.position, display: cs.display, zIndex: cs.zIndex,
          background: cs.backgroundColor, width: cs.width, height: cs.height,
        } : null,
        rect: lb ? lb.getBoundingClientRect().toJSON() : null,
        docHeight: document.documentElement.scrollHeight,
        footTop: foot ? foot.getBoundingClientRect().top + window.scrollY : null,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    ev.note('BEFORE click: ' + JSON.stringify(before));
    ev.note('AFTER click (.lightbox state): ' + JSON.stringify(after));

    const looksBroken = after.lightboxExists && !after.lightboxHidden &&
      (after.computed.position === 'static') && (after.docHeight > before.docHeight + 200);

    if (looksBroken) {
      ev.defect('critical-candidate', 'CONFIRMAT: .lightbox se deschide fara CSS (position:static), documentul se alungeste, footer-ul se muta jos.',
        JSON.stringify(after), 'after-click-gallery-photo.png');
    } else if (after.lightboxExists && !after.lightboxHidden && after.computed.position === 'fixed') {
      ev.note('REFUTAT: .lightbox are position:fixed la runtime (posibil stil global injectat de builder/engine).');
    } else {
      ev.note('Rezultat ambiguu — vezi detalii computed style de mai sus.');
    }
  }

  ev.finish();
  await b.close();
  await srv.close();
  console.log('DONE. liveUrl=', liveUrl);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
