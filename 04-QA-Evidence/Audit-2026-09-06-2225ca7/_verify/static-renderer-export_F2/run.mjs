// Verify F2: self-hosted export of templates/professionals shows fake success
// for the appointment form, without any network request to /api/appointments.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const ROOT = '/Users/Work/Desktop/sitebuilder';
const require = createRequire(import.meta.url);
const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/_verify/static-renderer-export_F2';

const { exportSiteHtml } = require(path.join(ROOT, 'bot', 'site-export.js'));
const presets = require(path.join(ROOT, 'templates', 'professionals', 'presets.json')).presets;
const config = JSON.parse(JSON.stringify(presets[0].config || presets[0]));

const { html } = exportSiteHtml({ templateId: 'professionals', config, images: [], slug: 'cabinet-ionescu' });
fs.writeFileSync(path.join(EVDIR, 'exported.html'), html);
console.log('Exported HTML length:', html.length);
console.log('Contains /api/appointments literal in script:', html.includes('/api/appointments'));
console.log('Contains detectLiveSlug body:', html.includes('detectLiveSlug'));

// Serve the exported HTML from a PLAIN static http server rooted at "/",
// i.e. NOT under /live/<slug>/ — exactly what a self-hosted deployment looks like
// (own domain root, own subpath, whatever — never Hidook's /live/ prefix).
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const staticBase = 'http://127.0.0.1:' + server.address().port;
console.log('Static export served at:', staticBase, '(root path "/", no /live/ prefix)');

const b = await newBrowser({ width: 1280, height: 1400 });
const { page } = b;

const apiCalls = [];
page.on('request', (req) => {
  if (req.url().includes('/api/appointments')) apiCalls.push(req.url());
});

await page.goto(staticBase + '/', { waitUntil: 'networkidle' });
console.log('page.location.pathname after load:', await page.evaluate(() => location.pathname));
console.log('page.location.origin after load:', await page.evaluate(() => location.origin));

// Scroll to the appointment form
await page.evaluate(() => {
  const el = document.querySelector('[data-pr-appt]');
  if (el) el.scrollIntoView({ block: 'center' });
});
await page.screenshot({ path: path.join(EVDIR, '01-static-export-appointment-area.png') });

// Fill the form
await page.fill('#pr-name', 'Ana Test');
await page.fill('#pr-email', 'ana@example.com');

// Ensure a date+slot got auto-populated by initAppointment(); if not, log state
const dateVal = await page.$eval('#pr-appt-date', (el) => el.value).catch(() => null);
const slotVal = await page.$eval('#pr-appt-slot', (el) => el.value).catch(() => null);
console.log('Auto-selected date:', dateVal, 'slot:', slotVal);

await page.screenshot({ path: path.join(EVDIR, '02-static-export-form-filled.png') });

await page.click('#pr-appt-submit');
await page.waitForTimeout(800);

await page.screenshot({ path: path.join(EVDIR, '03-static-export-appointment-submitted.png') });

const doneVisible = await page.$eval('#pr-appt-done', (el) => !el.hidden).catch(() => false);
const doneBody = await page.$eval('#pr-appt-done-body', (el) => el.textContent).catch(() => null);
const doneConfirm = await page.$eval('#pr-appt-done-confirm', (el) => el.textContent).catch(() => null);
const doneTitle = await page.$eval('.pr-appt-done__title', (el) => el.textContent).catch(() => null);

console.log('--- RESULT ---');
console.log('Success panel visible:', doneVisible);
console.log('Success title:', doneTitle);
console.log('Success body line:', doneBody);
console.log('Success confirm line:', doneConfirm);
console.log('Network requests to /api/appointments:', apiCalls.length, apiCalls);

const sessionReq = await page.evaluate(() => {
  try { return sessionStorage.getItem('pr-appt-requests'); } catch (e) { return 'ERR:' + e.message; }
});
console.log('sessionStorage pr-appt-requests:', sessionReq);

fs.writeFileSync(path.join(EVDIR, 'result.json'), JSON.stringify({
  staticBase,
  pathname: await page.evaluate(() => location.pathname),
  apiCallsToAppointments: apiCalls,
  doneVisible, doneTitle, doneBody, doneConfirm,
  sessionStorage: sessionReq,
}, null, 2));

await b.close();
server.close();
console.log('DONE');
