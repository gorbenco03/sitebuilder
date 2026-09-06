'use strict';
/**
 * QR-01 regression oracle: each published template must open its real WhatsApp
 * modal and render a QR which macOS Vision decodes to the exact wa.me URL.
 *
 * Run: node bot/test/qr-01-whatsapp-qr-valid.test.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_IDS = ['desserdirina', 'local-service', 'portfolio', 'product-menu', 'professionals'];
const QR_TEXT = 'https://wa.me/40712345678?text=Salut%2C%20vreau%20o%20rezervare';
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

function loadPlaywright() {
  for (const candidate of [path.join(ROOT, 'node_modules/playwright'), PW_PATH]) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error('playwright not found');
}

function copyTemplate(id, dest) {
  fs.cpSync(path.join(ROOT, 'templates', id), dest, { recursive: true });
  const presets = JSON.parse(fs.readFileSync(path.join(dest, 'presets.json'), 'utf8')).presets;
  assert.ok(Array.isArray(presets) && presets[0] && presets[0].config, id + ': first preset config');
  const config = JSON.parse(JSON.stringify(presets[0].config));
  config.contact = Object.assign({}, config.contact, { whatsapp: '40712345678', waHref: QR_TEXT });
  fs.writeFileSync(path.join(dest, 'config.json'), JSON.stringify(config, null, 2));
  execFileSync('node', [path.join(ROOT, 'build.js'), dest], { stdio: 'pipe' });
}

function startStaticServer(root) {
  const server = http.createServer((req, res) => {
    const raw = new URL(req.url, 'http://localhost').pathname;
    const safe = path.normalize(decodeURIComponent(raw)).replace(/^([/\\])+/, '');
    let file = path.join(root, safe || 'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function writeVisionDecoder(dir) {
  const decoder = path.join(dir, 'decode-qr.swift');
  fs.writeFileSync(decoder, `import Foundation
import Vision
import AppKit
for imagePath in CommandLine.arguments.dropFirst() {
  guard let image = NSImage(contentsOfFile: imagePath), let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let cg = rep.cgImage else { fputs("load-fail \\(imagePath)\\n", stderr); exit(3) }
  let request = VNDetectBarcodesRequest()
  request.symbologies = [.QR]
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request]) } catch { fputs("vision-fail \\(error)\\n", stderr); exit(4) }
  guard let payload = request.results?.compactMap({ $0.payloadStringValue }).first else { fputs("no-qr \\(imagePath)\\n", stderr); exit(5) }
  print(payload)
}
`);
  return decoder;
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-qr-01-'));
  const shots = [];
  const server = await startStaticServer(tmp);
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined });
    for (const id of TEMPLATE_IDS) {
      const site = path.join(tmp, id);
      copyTemplate(id, site);
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(30000);
      await page.goto(base + '/' + id + '/', { waitUntil: 'networkidle' });
      const link = page.locator('a[href*="wa.me"]').first();
      await link.waitFor({ state: 'visible' });
      await link.evaluate((node, url) => { node.href = url; }, QR_TEXT);
      await link.click();
      const image = page.locator('#wa-qr:not([hidden]) #wa-qr-img');
      await image.waitFor({ state: 'visible' });
      const shot = path.join(tmp, id + '-wa-qr-open.png');
      await image.screenshot({ path: shot });
      assert.ok(fs.statSync(shot).size > 1000, id + ': modal QR screenshot must contain pixels');
      shots.push(shot);
      await page.close();
    }
    const decoder = writeVisionDecoder(tmp);
    const decoded = spawnSync('swift', [decoder, ...shots], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    assert.strictEqual(decoded.status, 0, 'Vision QR decode failed: ' + String(decoded.stderr || '').trim());
    const values = String(decoded.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    assert.strictEqual(values.length, TEMPLATE_IDS.length, 'Vision must decode one QR per template');
    values.forEach((value, index) => assert.strictEqual(value, QR_TEXT, TEMPLATE_IDS[index] + ': decoded WhatsApp URL'));
    console.log('PASS QR-01: Vision decoded the real WhatsApp modal QR in all five templates');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
