import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const dir = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/template-local-service_LS-01';
const srv = await bootServer();
const ev = makeEvidence(dir, 'verify-LS-01-whatsapp-qr');
const b = await newBrowser({ width: 1440, height: 1000 });

await b.page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
try { await b.page.click('#hb-cookie-accept', { timeout: 3000 }); } catch (_) {}
await b.page.click('.template-card[data-template-id="local-service"] .btn-start-tpl');
await b.page.waitForSelector('#screen-edit', { state: 'visible', timeout: 15000 });
await ev.shot(b.page, 'editor-open-local-service', { action: 'click .btn-start-tpl[local-service]' });

// Find the WhatsApp field(s) in the drawer and fill phone + message.
// Try to open drawer if not open.
try { await b.page.click('#btn-open-drawer', { timeout: 2000 }); } catch (_) {}
await b.page.waitForSelector('#details-drawer', { state: 'visible', timeout: 8000 }).catch(() => {});

// Search the drawer for whatsapp-related fields.
const drawerHtml = await b.page.evaluate(() => document.querySelector('#drawer-body')?.innerHTML || '');
console.log('drawer contains "whatsapp"?', /whatsapp/i.test(drawerHtml));

// Try common field key patterns.
const candidates = await b.page.$$eval('[data-field-key]', els => els.map(e => e.getAttribute('data-field-key')));
console.log('field keys sample:', candidates.filter(k => /whats|phone|contact/i.test(k || '')));

await ev.shot(b.page, 'drawer-open', { action: 'inspect drawer field keys' });

// Fill a WhatsApp phone field if present.
const waPhoneKey = candidates.find(k => /whatsapp.*phone|phone.*whatsapp|whatsapp\.phone|contact\.whatsapp/i.test(k || ''));
console.log('waPhoneKey', waPhoneKey);

if (waPhoneKey) {
  const input = await b.page.$(`[data-field-key="${waPhoneKey}"] input, [data-field-key="${waPhoneKey}"] textarea`);
  if (input) { await input.fill('40712345678'); }
}
const waMsgKey = candidates.find(k => /whatsapp.*message|message.*whatsapp|whatsapp\.message|whatsapp\.text/i.test(k || ''));
console.log('waMsgKey', waMsgKey);
if (waMsgKey) {
  const input = await b.page.$(`[data-field-key="${waMsgKey}"] input, [data-field-key="${waMsgKey}"] textarea`);
  if (input) { await input.fill('Bună, aș dori o programare pentru instalație electrică!'); }
}

await b.page.waitForTimeout(500);
await ev.shot(b.page, 'after-fill-whatsapp-fields', { action: 'fill whatsapp phone+message in drawer' });

// Close the drawer so it doesn't intercept clicks on the iframe underneath.
try { await b.page.click('#btn-close-drawer', { timeout: 3000 }); } catch (_) {}
await b.page.waitForTimeout(300);

// Now find a wa.me link inside the preview iframe and click it (desktop should open #wa-qr modal).
const frame = b.page.frame({ name: undefined, url: /.*/ }) || b.page.frames().find(f => f !== b.page.mainFrame());
let waLinkFound = false;
for (const f of b.page.frames()) {
  const href = await f.$$eval('a[href*="wa.me"]', els => els.map(e => e.getAttribute('href'))).catch(() => []);
  if (href.length) { console.log('frame', f.url(), 'wa.me links:', href); waLinkFound = true; }
}

// Click via iframe locator on preview
const previewFrame = await b.page.$('#preview-iframe');
let clicked = false;
if (previewFrame) {
  const cf = await previewFrame.contentFrame();
  if (cf) {
    const link = await cf.$('a[href*="wa.me"]');
    if (link) {
      await link.click();
      clicked = true;
    } else {
      console.log('no wa.me link found inside preview iframe');
    }
  }
}
console.log('clicked wa.me link inside iframe?', clicked);
await b.page.waitForTimeout(500);
await ev.shot(b.page, 'clicked-wa-me-link', { action: 'click a[href*=wa.me] inside preview iframe' });

// The modal #wa-qr lives inside the iframe (template's own script.js). Extract its SVG data URI src.
let svgMarkup = null;
if (previewFrame) {
  const cf = await previewFrame.contentFrame();
  if (cf) {
    const modalVisible = await cf.$eval('#wa-qr', el => getComputedStyle(el).display !== 'none' && el.offsetParent !== null).catch(() => false);
    console.log('modal #wa-qr visible in iframe?', modalVisible);
    const imgSrc = await cf.$eval('#wa-qr-img', img => img.getAttribute('src')).catch(() => null);
    if (imgSrc && imgSrc.startsWith('data:image/svg+xml')) {
      const encoded = imgSrc.split(',').slice(1).join(',');
      svgMarkup = decodeURIComponent(encoded);
    }
    console.log('imgSrc present?', !!imgSrc, 'len', imgSrc ? imgSrc.length : 0);
  }
}

if (svgMarkup) {
  const fs = await import('node:fs');
  fs.writeFileSync(dir + '/wa-qr-live-raw.svg', svgMarkup);
  console.log('Saved live SVG, length', svgMarkup.length);

  // Parse rects into a grid to inspect the finder pattern corner.
  const rectRe = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  let m; const rects = [];
  while ((m = rectRe.exec(svgMarkup))) rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
  console.log('rect count', rects.length);
  if (rects.length) {
    const cell = rects[0].w;
    const size = Math.round(240 / cell); // known size=240 passed to generateQRSVG
    console.log('inferred cell size', cell, 'inferred grid size', size);
    const grid = Array.from({ length: size }, () => new Array(size).fill(0));
    for (const r of rects) {
      const c = Math.round(r.x / cell), rr = Math.round(r.y / cell);
      if (grid[rr]) grid[rr][c] = 1;
    }
    let out = 'Top-left 9x9 of LIVE rendered QR (from actual app DOM):\n';
    for (let r = 0; r < 9 && r < size; r++) {
      let row = '';
      for (let c = 0; c < 9 && c < size; c++) row += grid[r][c] ? '#' : ' ';
      out += row + '\n';
    }
    console.log(out);
    fs.writeFileSync(dir + '/live-grid-corner.txt', out);
  }
} else {
  console.log('Could not extract live SVG markup — modal or image not found as expected.');
}

await ev.finish();
await b.close();
await srv.close();
console.log('DONE');
