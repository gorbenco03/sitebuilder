'use strict';
/**
 * bot/test/audit27-s-2a-optional-sections.test.js
 *
 * Oracle for task S-2A (PLAN-UX-2026-09-27.md §5.2 "Bibliotecă minimă de
 * secțiuni opționale") on product-menu, local-service and desserdirina:
 *
 *   1. An optional "Recenzii" (testimonials) section — hidden on the
 *      published page when `config.testimonials` is empty/absent, shown
 *      with the owner's quotes when it is filled.
 *   2. A contact-form section (none of these three templates had a lead
 *      form before this task) that POSTs JSON to
 *      `${apiBase}/api/site-messages` (apiBase read from the form's own
 *      `data-site-messages-api` attribute, `slug` from `data-site-slug` —
 *      both filled at publish time by a separate task, S-2C) and falls
 *      back to WhatsApp/email when that attribute is empty (a static
 *      export/download, or a site published before S-2C ships).
 *
 * Builds a real static site tree per template (the same pipeline publish
 * and ZIP export both use — see wave7-sections-e2e-all-templates.test.js's
 * own precedent for treating this as equivalent to the published page) and
 * drives real Chromium against it. The network layer is mocked with
 * Playwright's own `page.route`, never a stub of the app's code.
 *
 * Fails on the pre-task template.html (no #testimonials/#contact-form
 * section at all) and passes once each template ships both, content-gated
 * and API-driven exactly as described above.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-s-2a-optional-sections.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const siteExport = require(path.join(ROOT, 'bot', 'site-export.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TEMPLATES = ['product-menu', 'local-service', 'desserdirina'];

function firstPresetConfig(templateId) {
  const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, templateId, 'presets.json'), 'utf8')).presets;
  return JSON.parse(JSON.stringify(presets[0].config));
}

// Build a real static site tree (same pipeline as publish/ZIP export) and
// return the absolute path to the written index.html.
function buildSite(templateId, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `audit27-s2a-${templateId}-`));
  siteExport.buildStaticSiteTree({ templateId, config, images: [], siteDir: dir });
  return path.join(dir, 'index.html');
}

for (const templateId of TEMPLATES) {
  test(`[${templateId}] testimonials section is absent when config.testimonials is empty`, async () => {
    const config = firstPresetConfig(templateId);
    delete config.testimonials;
    delete config.testimonialsTitle;
    const indexPath = buildSite(templateId, config);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('file://' + indexPath, { waitUntil: 'load' });
      const el = await page.$('#testimonials');
      assert.equal(el, null, `${templateId}: #testimonials must not render when the owner never added any review`);
    } finally {
      await browser.close();
    }
  });

  test(`[${templateId}] testimonials section renders the owner's quotes when filled`, async () => {
    const config = firstPresetConfig(templateId);
    config.testimonialsTitle = 'Ce spun clienții noștri';
    config.testimonials = [
      { quote: 'Servicii impecabile, recomand cu încredere.', name: 'Ana Popescu', role: 'Client fidel' },
      { quote: 'Profesionalism de la prima interacțiune.', name: 'Mihai Ionescu', role: '' },
    ];
    const indexPath = buildSite(templateId, config);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('file://' + indexPath, { waitUntil: 'load' });
      const el = await page.$('#testimonials');
      assert.notEqual(el, null, `${templateId}: #testimonials must render once the owner filled at least one quote`);
      const text = (await page.locator('#testimonials').innerText()).replace(/\s+/g, ' ');
      assert.ok(text.includes('Ce spun clienții noștri'), `${templateId}: testimonials title missing — got "${text}"`);
      assert.ok(text.includes('Servicii impecabile'), `${templateId}: first quote missing — got "${text}"`);
      assert.ok(text.includes('Ana Popescu'), `${templateId}: first name missing — got "${text}"`);
      assert.ok(text.includes('Client fidel'), `${templateId}: optional role missing — got "${text}"`);
      assert.ok(text.includes('Mihai Ionescu'), `${templateId}: second name missing — got "${text}"`);
    } finally {
      await browser.close();
    }
  });

  test(`[${templateId}] contact-form section exists with name/contact/message + honeypot, no data-site-messages-api yet`, async () => {
    const config = firstPresetConfig(templateId);
    const indexPath = buildSite(templateId, config);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('file://' + indexPath, { waitUntil: 'load' });
      const form = page.locator('#contact-form form');
      await form.waitFor({ state: 'attached' });
      assert.notEqual(await page.$('#contact-form input[name="name"]'), null, `${templateId}: missing name field`);
      assert.notEqual(await page.$('#contact-form input[name="contact"]'), null, `${templateId}: missing phone/email field`);
      assert.notEqual(await page.$('#contact-form textarea[name="message"]'), null, `${templateId}: missing message field`);
      const hp = page.locator('#contact-form input[name="website"]');
      await hp.waitFor({ state: 'attached' });
      assert.equal(await hp.getAttribute('tabindex'), '-1', `${templateId}: honeypot must be unreachable by Tab`);
      const hpBox = await hp.boundingBox();
      // Off-screen (not display:none — a real honeypot must still be
      // fillable by a bot, just invisible/unreachable to a real visitor).
      assert.ok(hpBox && hpBox.x < 0, `${templateId}: honeypot must be visually hidden off-screen`);
      const apiBase = await page.locator('#contact-form form').getAttribute('data-site-messages-api');
      assert.equal(apiBase, '', `${templateId}: with no siteMessages config, data-site-messages-api must render empty, not raw {{…}}`);
    } finally {
      await browser.close();
    }
  });

  test(`[${templateId}] contact form POSTs {slug,name,contact,message,website} to apiBase and shows a Romanian thank-you`, async () => {
    const config = firstPresetConfig(templateId);
    config.siteMessages = { apiBase: 'https://api.example.test', slug: 'brutaria-ana' };
    const indexPath = buildSite(templateId, config);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let captured = null;
      await page.route('**/api/site-messages', async (route) => {
        captured = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });
      await page.goto('file://' + indexPath, { waitUntil: 'load' });
      assert.equal(
        await page.locator('#contact-form form').getAttribute('data-site-messages-api'),
        'https://api.example.test',
        `${templateId}: data-site-messages-api did not carry the configured apiBase`
      );
      await page.fill('#contact-form input[name="name"]', 'Ana Popescu');
      await page.fill('#contact-form input[name="contact"]', '0721234567');
      await page.fill('#contact-form textarea[name="message"]', 'Aș vrea o ofertă, vă rog.');
      await page.click('#contact-form button[type="submit"]');
      await page.waitForFunction(() => {
        const el = document.querySelector('#contact-form [data-cf-status]');
        return el && !el.hidden && el.textContent.trim().length > 0;
      }, { timeout: 5000 });

      assert.ok(captured, `${templateId}: the form never actually POSTed to /api/site-messages`);
      assert.deepEqual(captured, {
        slug: 'brutaria-ana',
        name: 'Ana Popescu',
        contact: '0721234567',
        message: 'Aș vrea o ofertă, vă rog.',
        website: '',
      }, `${templateId}: POST body shape mismatch — got ${JSON.stringify(captured)}`);

      const statusText = await page.locator('#contact-form [data-cf-status]').innerText();
      assert.match(statusText, /mul[țt]um/i, `${templateId}: no Romanian thank-you after a successful POST — got "${statusText}"`);
    } finally {
      await browser.close();
    }
  });

  test(`[${templateId}] contact form falls back to WhatsApp when data-site-messages-api is empty`, async () => {
    const config = firstPresetConfig(templateId);
    delete config.siteMessages; // static export / not-yet-published — apiBase stays ""
    config.contact = Object.assign({}, config.contact, { whatsapp: '40721234567' });
    const indexPath = buildSite(templateId, config);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let calledSiteMessages = false;
      await page.route('**/api/site-messages', async (route) => {
        calledSiteMessages = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });
      await page.goto('file://' + indexPath, { waitUntil: 'load' });
      await page.fill('#contact-form input[name="name"]', 'Ana Popescu');
      await page.fill('#contact-form input[name="contact"]', '0721234567');
      await page.fill('#contact-form textarea[name="message"]', 'Aș vrea o ofertă, vă rog.');

      const popupPromise = page.waitForEvent('popup', { timeout: 5000 });
      await page.click('#contact-form button[type="submit"]');
      const popup = await popupPromise;
      // wa.me redirects to api.whatsapp.com/send/?phone=…&text=… — assert on
      // the phone number + pre-filled message surviving that hop, not the
      // exact host, which real WhatsApp already changed once before.
      const popupUrl = popup.url();
      assert.ok(popupUrl.includes('40721234567'),
        `${templateId}: expected the WhatsApp popup to carry the phone number, got "${popupUrl}"`);
      assert.ok(/text=.*Ana(%20|\+)Popescu/.test(popupUrl) || popupUrl.includes(encodeURIComponent('Ana Popescu')),
        `${templateId}: expected the WhatsApp popup to carry the pre-filled message, got "${popupUrl}"`);
      await popup.close();
      assert.equal(calledSiteMessages, false, `${templateId}: must not call /api/site-messages when data-site-messages-api is empty`);
    } finally {
      await browser.close();
    }
  });

  test(`[${templateId}] contact form falls back to email when apiBase is empty and no WhatsApp number is set`, async () => {
    const config = firstPresetConfig(templateId);
    delete config.siteMessages;
    config.contact = Object.assign({}, config.contact, { whatsapp: '', email: 'contact@exemplu.ro' });
    const indexPath = buildSite(templateId, config);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('file://' + indexPath, { waitUntil: 'load' });
      assert.equal(
        await page.locator('#contact-form form').getAttribute('data-mail-to'),
        'contact@exemplu.ro',
        `${templateId}: data-mail-to did not carry contact.email`
      );
      await page.fill('#contact-form input[name="name"]', 'Ana Popescu');
      await page.fill('#contact-form input[name="contact"]', '0721234567');
      await page.fill('#contact-form textarea[name="message"]', 'Aș vrea o ofertă, vă rog.');
      await page.click('#contact-form button[type="submit"]');
      await page.waitForFunction(() => {
        const el = document.querySelector('#contact-form [data-cf-status]');
        return el && !el.hidden && el.textContent.trim().length > 0;
      }, { timeout: 5000 });
      const statusText = await page.locator('#contact-form [data-cf-status]').innerText();
      assert.match(statusText, /email/i, `${templateId}: no clear Romanian note about the email fallback — got "${statusText}"`);
    } finally {
      await browser.close();
    }
  });
}
