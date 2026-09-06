import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const DIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/template-portfolio_PORT-01';

const srv = await bootServer();
const ev = makeEvidence(DIR, 'verify-PORT-01');
const b = await newBrowser({ width: 1440, height: 1000 });

try {
  await b.page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
  // accept cookie banner if present
  const cookieBtn = b.page.locator('#hb-cookie-accept');
  if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cookieBtn.click();
  }
  await ev.shot(b.page, 'catalog-open', { action: 'goto /app/' });

  // pick portfolio template ("Salon")
  const startBtn = b.page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl');
  await startBtn.click();
  await b.page.waitForSelector('#screen-edit', { timeout: 15000 });
  await b.page.waitForTimeout(1500); // let scatter animation settle
  await ev.shot(b.page, 'editor-opened-portfolio', { action: 'click .btn-start-tpl[data-template-id=portfolio]' });

  // Details drawer opens automatically on template start; close it so its overlay
  // doesn't block clicks on the topbar (#btn-publish).
  const closeDrawer = b.page.locator('#btn-close-drawer');
  if (await closeDrawer.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeDrawer.click({ timeout: 4000 }).catch(async () => {
      await closeDrawer.click({ force: true }).catch(() => {});
    });
    await b.page.waitForTimeout(300);
  }

  // NOTE: the builder edit iframe has its own inline-edit overlay intercepting clicks
  // on content elements, which is NOT representative of the real published site's JS.
  // The original claim was tested on the LIVE published site, so we must publish through
  // the real flow (slug -> email -> dev-link -> test-pay) and test the actual /live/<slug>/ page.
  const slugVal = 'verify-port01-' + Date.now();
  await b.page.locator('#btn-publish').click();
  await b.page.locator('#input-slug').fill(slugVal);
  await b.page.locator('#btn-publish-continue').click();
  await b.page.locator('#form-auth-email').waitFor({ state: 'visible', timeout: 10000 });
  await ev.shot(b.page, 'publish-slug-entered', { action: 'fill+click', selector: '#input-slug,#btn-publish-continue', detail: slugVal });

  await b.page.locator('#input-email').fill('verify-port01@example.com');
  await b.page.locator('#btn-send-magic').click();
  await b.page.locator('#dev-link').waitFor({ state: 'visible', timeout: 10000 });
  await ev.shot(b.page, 'magic-link-sent', { action: 'fill+click', selector: '#input-email,#btn-send-magic' });

  await b.page.locator('#dev-link').click();
  await b.page.locator('#btn-pay-publish').waitFor({ state: 'visible', timeout: 10000 });
  await ev.shot(b.page, 'auth-verified-pay-visible', { action: 'click', selector: '#dev-link' });

  await b.page.locator('#btn-pay-publish').click();
  await b.page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ timeout: 20000 });
  await ev.shot(b.page, 'publish-success-modal', { action: 'click', selector: '#btn-pay-publish' });

  const liveHref = await b.page.locator('#success-url-link').getAttribute('href');
  ev.note('live URL from #success-url-link: ' + liveHref);
  console.log('LIVE_HREF', liveHref);

  const liveUrl = liveHref.startsWith('http') ? liveHref : (srv.base + liveHref);
  await b.page.goto(liveUrl, { waitUntil: 'networkidle' });
  await ev.shot(b.page, 'live-site-loaded', { action: 'goto', detail: liveUrl });

  // scroll live page to gallery section then click a collage photo (real published DOM, top-level document)
  const firstPhoto = b.page.locator('.collage-photo').first();
  await firstPhoto.waitFor({ state: 'visible', timeout: 10000 });
  await firstPhoto.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await b.page.waitForTimeout(1000); // let scatter animation settle
  await ev.shot(b.page, 'live-scrolled-to-gallery', { action: 'scrollIntoView .collage-photo' });

  await firstPhoto.click({ force: true });
  await b.page.waitForTimeout(500);
  await ev.shot(b.page, 'live-after-click-photo-viewport', { action: 'click .collage-photo', selector: '.collage-photo', detail: 'expect nothing visible if defect real', fullPage: false });

  // Inspect the lightbox element's actual computed style + geometry — direct top-level document now, no iframe/frameLocator needed
  const lbLocator = b.page.locator('.lightbox');
  const lbCount = await lbLocator.count();
  let info = { found: lbCount > 0 };
  if (lbCount > 0) {
    info = await lbLocator.first().evaluate((lb) => {
      const doc = lb.ownerDocument;
      const cs = doc.defaultView.getComputedStyle(lb);
      const rect = lb.getBoundingClientRect();
      return {
        found: true,
        hiddenAttr: lb.hasAttribute('hidden'),
        display: cs.display,
        position: cs.position,
        background: cs.backgroundColor,
        zIndex: cs.zIndex,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        bodyScrollHeight: doc.body.scrollHeight,
        outerHTMLSnippet: lb.outerHTML.slice(0, 300),
      };
    });
  }
  console.log('LIGHTBOX_INFO', JSON.stringify(info, null, 2));
  ev.note('lightbox computed style/geometry after click: ' + JSON.stringify(info));

  // scroll the iframe doc down to where the lightbox actually sits, per the rect found
  if (lbCount > 0) {
    await lbLocator.first().evaluate((lb, topTarget) => {
      lb.ownerDocument.defaultView.scrollTo(0, Math.max(0, topTarget - 100));
    }, (info.rect && info.rect.top) || 0);
  }
  await b.page.waitForTimeout(300);
  await ev.shot(b.page, 'scrolled-to-lightbox-actual-position', { action: 'scrollTo lightbox rect.top', detail: 'shows raw unstyled image if defect real' });

  // Also fetch the actual styles.css served on the live page and grep for "lightbox"
  const cssResp = await b.page.evaluate(async () => {
    const link = document.querySelector('link[rel="stylesheet"][href*="styles"]');
    if (!link) return { found: false };
    const url = new URL(link.getAttribute('href'), document.baseURI).href;
    const res = await fetch(url);
    const text = await res.text();
    return { found: true, url, len: text.length, lightboxMatches: (text.match(/lightbox/gi) || []).length };
  });
  console.log('CSS_CHECK', JSON.stringify(cssResp));
  ev.note('served styles.css lightbox rule count (live page): ' + JSON.stringify(cssResp));

  if (!info.found) {
    ev.defect('info', 'Nu s-a găsit elementul .lightbox pe pagina live', 'Verificare inconcludentă', null);
  } else if (info.hiddenAttr) {
    ev.note('.lightbox tot are atributul hidden dupa click pe pagina live -> nu se deschide vizual.');
  } else if (info.display === 'block' && info.position === 'static') {
    ev.defect('high', 'Lightbox needen confirmat prin verificare independentă pe pagina live', JSON.stringify(info), null);
  } else {
    ev.note('Lightbox pare stilizat corect: display=' + info.display + ' position=' + info.position);
  }

} catch (e) {
  console.error('ERROR', e);
  ev.note('EROARE in timpul verificarii: ' + (e && e.message));
} finally {
  ev.finish();
  await b.close();
  await srv.close();
}
