'use strict';
/**
 * Flow 3 browser evidence — builder legal + cookie banner + unzipped export static serve.
 * Local only. Writes under 04-QA-Evidence/Flow3/
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { chromium } = require('/Users/Work/.hermes/hermes-agent/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence', 'Flow3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow3-ev-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'flow3-ev-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.NODE_ENV = 'test';

const registry = require('../bot/registry.js');
const auth = require('../bot/auth.js');
const { startServer } = require('../bot/server.js');
const { exportSiteZip } = require('../bot/site-export.js');

function unzipStore(zipBuf, destDir) {
  const zlib = require('zlib');
  fs.mkdirSync(destDir, { recursive: true });
  let o = 0;
  const files = [];
  while (o + 4 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(o);
    if (sig === 0x04034b50) {
      const method = zipBuf.readUInt16LE(o + 8);
      const compSize = zipBuf.readUInt32LE(o + 18);
      const uncompSize = zipBuf.readUInt32LE(o + 22);
      const nameLen = zipBuf.readUInt16LE(o + 26);
      const extraLen = zipBuf.readUInt16LE(o + 28);
      const name = zipBuf.slice(o + 30, o + 30 + nameLen).toString('utf8');
      const dataStart = o + 30 + nameLen + extraLen;
      const compressed = zipBuf.slice(dataStart, dataStart + compSize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) data = zlib.inflateRawSync(compressed);
      else throw new Error('unsupported method ' + method);
      const out = path.join(destDir, name);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, data);
      files.push(name);
      o = dataStart + compSize;
      continue;
    }
    break;
  }
  return files;
}

function staticServe(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(dir, p.replace(/^\//, ''));
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const ct =
        ext === '.html' ? 'text/html; charset=utf-8' :
        ext === '.css' ? 'text/css' :
        ext === '.js' ? 'application/javascript' :
        ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.webp' ? 'image/webp' :
        'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const server = startServer({ port: 0 });
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;
  process.env.PUBLIC_URL = BASE;

  const preset = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8')
  );
  const cfg = JSON.parse(JSON.stringify(preset.presets[0]));
  cfg.business = cfg.business || {};
  cfg.business.name = 'Flow3 Evidence Brutărie';
  cfg.business.title = 'Flow3 Evidence Brutărie';

  const user = registry.getOrCreateUserByEmail('flow3-ev@example.com');
  const cookie = 'hb_session=' + auth.signSession(user.id);
  const site = registry.createSite({
    userId: user.id,
    templateId: 'product-menu',
    templateVersion: 1,
    slug: 'flow3-ev-' + crypto.randomUUID().slice(0, 6),
    platform: 'web',
  });
  registry.saveVersion(site.id, cfg);

  // Export ZIP and unzip
  const { zip, files } = exportSiteZip({
    templateId: 'product-menu',
    config: cfg,
    slug: 'flow3-evidence',
  });
  const exportDir = path.join(OUT, 'unzipped-export');
  fs.rmSync(exportDir, { recursive: true, force: true });
  const names = unzipStore(zip, exportDir);
  fs.writeFileSync(
    path.join(OUT, 'export-manifest.txt'),
    names.join('\n') + '\n\nzipBytes=' + zip.length + '\nfilesFromApi=' + (files || []).join(',') + '\n'
  );
  fs.writeFileSync(path.join(OUT, 'flow3-evidence.zip'), zip);

  const staticSrv = await staticServe(exportDir);
  const staticPort = staticSrv.address().port;
  const STATIC = `http://127.0.0.1:${staticPort}`;

  const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(brave) ? brave : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // clear consent so banner shows
  await context.addInitScript(() => {
    try { localStorage.removeItem('hb-cookie-consent'); } catch (e) {}
  });
  const page = await context.newPage();

  // 1) Builder landing — cookie banner + footer legal
  await page.goto(BASE + '/app/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const bannerVisible = await page.locator('#hb-cookie-banner:not([hidden])').count();
  await page.screenshot({ path: path.join(OUT, '01-builder-cookie-banner.png'), fullPage: false });
  // Accept banner
  if (bannerVisible) {
    await page.locator('#hb-cookie-accept').click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-builder-footer-legal.png'), fullPage: false });

  // 2) Builder privacy page
  await page.goto(BASE + '/app/privacy.html', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, '03-builder-privacy.png'), fullPage: false });

  // 3) Unzipped static index + cookie banner
  const page2 = await context.newPage();
  await page2.goto(STATIC + '/index.html', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(600);
  const exportBanner = await page2.locator('#hb-cookie-banner').count();
  const bannerShown = await page2.evaluate(() => {
    const el = document.getElementById('hb-cookie-banner');
    return el && !el.hidden;
  });
  await page2.screenshot({ path: path.join(OUT, '04-export-index-cookie-banner.png'), fullPage: false });
  await page2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: path.join(OUT, '05-export-footer-legal.png'), fullPage: false });

  // 4) Export privacy page
  await page2.goto(STATIC + '/privacy.html', { waitUntil: 'networkidle' });
  await page2.screenshot({ path: path.join(OUT, '06-export-privacy.png'), fullPage: false });
  await page2.goto(STATIC + '/terms.html', { waitUntil: 'networkidle' });
  await page2.screenshot({ path: path.join(OUT, '07-export-terms.png'), fullPage: false });
  await page2.goto(STATIC + '/cookies.html', { waitUntil: 'networkidle' });
  await page2.screenshot({ path: path.join(OUT, '08-export-cookies.png'), fullPage: false });

  // Dismiss export banner path
  await page2.goto(STATIC + '/index.html', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(400);
  const accept = page2.locator('#hb-cookie-accept');
  if (await accept.count()) {
    await accept.click().catch(() => {});
    await page2.waitForTimeout(300);
  }
  await page2.screenshot({ path: path.join(OUT, '09-export-after-accept.png'), fullPage: false });

  const notes = [
    '# Flow 3 browser evidence',
    '',
    `- Builder base: ${BASE}`,
    `- Static export serve: ${STATIC}`,
    `- Builder cookie banner visible initially: ${bannerVisible > 0}`,
    `- Export cookie banner element: ${exportBanner}, shown: ${bannerShown}`,
    `- Business name: ${cfg.business.name}`,
    `- Export files: ${names.length}`,
    `- ZIP path: 04-QA-Evidence/Flow3/flow3-evidence.zip`,
    `- Unzipped: 04-QA-Evidence/Flow3/unzipped-export/`,
    '',
    'QA should open:',
    `1. ${BASE}/app/ — cookie banner + footer Terms/Privacy/Cookies`,
    `2. ${BASE}/app/privacy.html (and terms/cookies)`,
    `3. Unzip flow3-evidence.zip and \`python3 -m http.server\` in unzipped-export/`,
    '4. Confirm privacy/terms/cookies + banner + badge with no Hidook runtime',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), notes);

  await browser.close();
  await new Promise((r) => staticSrv.close(() => r()));
  await new Promise((r) => server.close(() => r()));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  console.log('Flow3 evidence written to', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
