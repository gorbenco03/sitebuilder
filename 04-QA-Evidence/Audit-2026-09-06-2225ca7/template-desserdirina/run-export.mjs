#!/usr/bin/env node
// Focused follow-up: reach a paid/live desserdirina site fast, then verify HTML+ZIP export.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/template-desserdirina';
// NOTE: makeEvidence always writes <dir>/oracle-log.json — use a subfolder so this follow-up
// does not clobber the main run's oracle-log.json (24 entries) sitting directly in EVDIR.
const ev = makeEvidence(path.join(EVDIR, 'export-followup'), 'template-desserdirina-export-followup');
const BIZNAME = 'Șt. Țăndărică & Fiii';

async function main() {
  const srv = await bootServer();
  const b = await newBrowser({ width: 1440, height: 1000 });
  const { page } = b;
  try {
    await page.goto(srv.base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click();
    await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    const nameEl = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameEl.waitFor({ state: 'visible' });
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await nameEl.click(); await nameEl.fill(BIZNAME); await nameEl.blur();
    await ev.shot(page, 'reach-edited-draft', { action: 'quick edit business.name for export follow-up', detail: BIZNAME });

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const runSlug = 'audit-desserdirina-export-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(runSlug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit-desserdirina-export@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    ev.note('reached paid/live: ' + liveHref);
    await ev.shot(page, 'reached-paid-live', { action: 'publish+auth+test-pay', detail: 'href=' + liveHref });

    // Close the success dialog and give the SPA a moment to settle (currentUser/session
    // rehydrate after the real navigation the pay button performs) before downloading —
    // matches how a real user would proceed (close "you're live", then use the topbar).
    const closeBtn = page.locator('#btn-success-close');
    if (await closeBtn.count()) { await closeBtn.click().catch(() => {}); await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {}); }
    await page.waitForTimeout(1000);
    await ev.shot(page, 'settled-after-close', { action: 'close success modal, wait 1s for SPA to settle', detail: 'about to try downloads' });

    // export HTML — Promise.all pattern avoids an orphaned waitForEvent promise on failure
    let htmlDl;
    try {
      [htmlDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }),
        page.locator('#btn-download-html').click(),
      ]);
    } catch (e) {
      const toastText = await page.locator('#toast').textContent().catch(() => null);
      ev.note('first #btn-download-html click produced no download; toast=' + JSON.stringify(toastText) + '; retrying once after extra settle');
      await page.waitForTimeout(1500);
      [htmlDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.locator('#btn-download-html').click(),
      ]);
    }
    const htmlPath = path.join(EVDIR, 'export.html');
    await htmlDl.saveAs(htmlPath);
    ev.note('export HTML saved: ' + htmlPath + ' size=' + fs.statSync(htmlPath).size + ' bytes name=' + htmlDl.suggestedFilename());
    await ev.shot(page, 'export-html-downloaded', { action: 'click #btn-download-html', detail: 'saved ' + htmlDl.suggestedFilename() });

    const [zipDl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.locator('#btn-download-zip').click(),
    ]);
    const zipPath = path.join(EVDIR, 'export.zip');
    await zipDl.saveAs(zipPath);
    ev.note('export ZIP saved: ' + zipPath + ' size=' + fs.statSync(zipPath).size + ' bytes name=' + zipDl.suggestedFilename());
    await ev.shot(page, 'export-zip-downloaded', { action: 'click #btn-download-zip', detail: 'saved ' + zipDl.suggestedFilename() });

    const unzipDir = path.join(EVDIR, 'export-zip-unpacked');
    fs.rmSync(unzipDir, { recursive: true, force: true });
    fs.mkdirSync(unzipDir, { recursive: true });
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', unzipDir]);
    const files = fs.readdirSync(unzipDir);
    ev.note('ZIP unpacked top-level: ' + JSON.stringify(files));
    const hasIndex = fs.existsSync(path.join(unzipDir, 'index.html'));
    const hasPrivacy = fs.existsSync(path.join(unzipDir, 'privacy.html'));
    const hasTerms = fs.existsSync(path.join(unzipDir, 'terms.html'));
    const hasCookies = fs.existsSync(path.join(unzipDir, 'cookies.html'));
    const hasImages = fs.existsSync(path.join(unzipDir, 'images'));
    ev.note('ZIP contents: index=' + hasIndex + ' privacy=' + hasPrivacy + ' terms=' + hasTerms + ' cookies=' + hasCookies + ' images/=' + hasImages);
    if (!hasIndex) ev.defect('critical', 'ZIP exportat nu contine index.html', JSON.stringify(files), null);
    if (!hasPrivacy || !hasTerms || !hasCookies) ev.defect('high', 'ZIP exportat nu contine toate paginile legale', 'privacy=' + hasPrivacy + ' terms=' + hasTerms + ' cookies=' + hasCookies, null);

    const mimeMap = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
    const staticServer = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(unzipDir, p);
      if (!fp.startsWith(unzipDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(fp);
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
    const staticPort = staticServer.address().port;
    const zipPage = await b.context.newPage();
    await zipPage.goto('http://127.0.0.1:' + staticPort + '/', { waitUntil: 'networkidle' });
    await zipPage.screenshot({ path: path.join(EVDIR, 'export-zip-standalone-served.png'), fullPage: true });
    ev.log.entries.push({ index: ev.log.entries.length, step: 'export-zip-standalone-served', action: 'serve unzipped export statically + goto', selector: null, screenshot: 'export-zip-standalone-served.png', sha256: null, timestamp: new Date().toISOString(), url: 'http://127.0.0.1:' + staticPort + '/', contentCheck: { ok: true, detail: 'served on ephemeral port ' + staticPort } });
    fs.writeFileSync(path.join(EVDIR, 'oracle-log-export-followup.json'), JSON.stringify(ev.log, null, 2));
    const zipHtml = await zipPage.content();
    if (!zipHtml.includes(BIZNAME)) ev.defect('high', 'ZIP standalone servit nu contine numele editat', 'BIZNAME lipseste', 'export-zip-standalone-served.png');
    else ev.note('ZIP standalone servit conține BIZNAME corect');
    await zipPage.close();
    await new Promise((resolve) => staticServer.close(resolve));

    // also check export.html standalone content for sanity
    const exportHtmlContent = fs.readFileSync(htmlPath, 'utf8');
    ev.note('export.html contains BIZNAME: ' + exportHtmlContent.includes(BIZNAME) + ', contains hidook attribution: ' + (/hidook\.tech/.test(exportHtmlContent) && /hidook\.agency/.test(exportHtmlContent)));
  } catch (err) {
    ev.defect('critical', 'Exceptie in run-export.mjs', String(err && err.stack || err), null);
    console.error(err);
  } finally {
    ev.finish();
    await b.close();
    await srv.close();
  }
}

main();
