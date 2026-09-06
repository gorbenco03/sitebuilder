// Export the professionals template (ZIP), unzip it, serve with a PLAIN static
// server (no Hidook API routes at all -- true self-hosted scenario), then
// drive it with Playwright as a real visitor: gallery, WhatsApp, appointment
// form, legal pages, robots.txt/sitemap.xml.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-acf23fc9e0fab5e11';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-visitor-'));
process.env.DATA_DIR = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
process.env.PUBLIC_URL = 'http://127.0.0.1:9999'; // as if already published w/ PUBLIC_URL set
process.env.SERVER_SECRET = 'exp-' + crypto.randomBytes(6).toString('hex');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DEPLOY_PROVIDER;
delete process.env.BRAND_DOMAIN;

const siteExport = require(path.join(ROOT, 'bot/site-export.js'));

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(raw.presets[0].config));
cfg.seo = cfg.seo || {};
// Simulate: this config was already published live (has a real canonical) before export
cfg.seo.canonical = 'http://127.0.0.1:9999/live/prof-export-test/';

const built = siteExport.buildStaticSiteTree({ templateId: 'professionals', config: cfg, images: [], siteDir: path.join(tmpDir, 'export-src') });
console.log('Exported to', built.siteDir);
console.log('Files:', fs.readdirSync(built.siteDir).join(', '));

// Serve with a truly minimal static server -- NO API routes exist.
const staticServer = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(built.siteDir, p);
  if (!full.startsWith(built.siteDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(full).slice(1);
  const types = { html: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json', xml: 'application/xml', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
const port = staticServer.address().port;
const base = `http://127.0.0.1:${port}`;
console.log('Static server (NO Hidook backend at all):', base);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const netFails = [];
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) netFails.push(r.status() + ' ' + r.url()); });

await page.goto(base + '/', { waitUntil: 'networkidle' });
console.log('\n=== page title ===', await page.title());

// robots.txt / sitemap.xml as served by the plain static host
const robotsRes = await page.goto(base + '/robots.txt');
console.log('\n--- robots.txt (self-hosted, static server) ---');
console.log(await robotsRes.text());
const sitemapRes = await page.goto(base + '/sitemap.xml');
console.log('--- sitemap.xml (self-hosted, static server) ---');
console.log(await sitemapRes.text());

await page.goto(base + '/', { waitUntil: 'networkidle' });
const html = await page.content();
const canon = (html.match(/<link rel=["']canonical["'][^>]*>/i) || ['NONE'])[0];
const ogUrl = (html.match(/<meta property=["']og:url["'][^>]*>/i) || ['NONE'])[0];
const ogImg = (html.match(/<meta property=["']og:image["'][^>]*>/i) || ['NONE'])[0];
console.log('\ncanonical:', canon);
console.log('og:url:   ', ogUrl);
console.log('og:image: ', ogImg);

// Appointment form flow — critical check for finding #11
console.log('\n=== Appointment form (self-hosted, no backend) ===');
await page.goto(base + '/', { waitUntil: 'networkidle' });
// Scroll to find appointment section
const apptHeading = await page.$('text=/programare|appointment/i');
if (apptHeading) await apptHeading.scrollIntoViewIfNeeded();
// Try to find and fill the form fields generically
const nameInput = await page.$('#pr-appt-name, input[name="visitorName"], input[name="name"]');
const emailInput = await page.$('#pr-appt-email, input[name="visitorEmail"], input[type="email"]');
if (nameInput && emailInput) {
  await nameInput.fill('Visitor Test');
  await emailInput.fill('visitor@example.com');
  const phoneInput = await page.$('#pr-appt-phone, input[name="visitorPhone"], input[type="tel"]');
  if (phoneInput) await phoneInput.fill('0721000000');
  // pick a date/time slot if present
  const slotBtn = await page.$('[data-slot], .pr-slot, button[data-time]');
  if (slotBtn) await slotBtn.click();
  const submitBtn = await page.$('#pr-appt-submit, button[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForTimeout(1500);
    const bodyText = await page.innerText('body');
    const sawHonestFailure = /nu a fost trimisă|nu a putut fi înregistrată|eroare/i.test(bodyText);
    const sawFakeSuccess = /cererea a fost trimisă|confirmat|am primit cererea/i.test(bodyText) && !sawHonestFailure;
    console.log('Saw honest failure message:', sawHonestFailure);
    console.log('Saw (possibly fake) success message:', sawFakeSuccess);
    console.log('Network requests during submit attempt (4xx/5xx):', netFails.filter(f => f.includes('/api/')));
  } else {
    console.log('COULD NOT FIND submit button -- selectors need adjustment');
  }
} else {
  console.log('COULD NOT FIND name/email inputs -- selectors need adjustment. Dumping form HTML snippet.');
  const formHtml = await page.evaluate(() => {
    const f = document.querySelector('form');
    return f ? f.outerHTML.slice(0, 2000) : 'NO FORM FOUND';
  });
  console.log(formHtml);
}

console.log('\nConsole errors:', consoleErrors.length, consoleErrors.slice(0,10));
console.log('Failed network requests (non-api):', netFails.filter(f => !f.includes('/api/')));

await browser.close();
await new Promise((r) => staticServer.close(r));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
