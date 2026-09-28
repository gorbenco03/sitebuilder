'use strict';
/**
 * bot/test/audit27-s-2b-portfolio-professionals-sections.test.js
 *
 * Oracle for task S-2B (PLAN-UX-2026-09-27.md §5.2 section library), scoped
 * to templates/portfolio and templates/professionals, covering audit
 * findings sections-structure#2 (no testimonials list on any template) and
 * sections-structure#4 (no generic contact form besides WhatsApp/tel links)
 * from 04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json.
 *
 * Verifies, against the real renderHtml()/build() pipeline and a real
 * Chromium page (Playwright):
 *   - an optional "Recenzii" (testimonials) list section on BOTH templates:
 *     absent from the rendered page when config has no items, present with
 *     quote/name/role when items are configured;
 *   - an optional "Echipa" (team) section on professionals ONLY: absent
 *     when empty, present with name/role/bio/photo when configured;
 *   - a general "Scrie-ne" contact form on both templates, honouring the
 *     data-site-messages-api contract: POSTs JSON {slug, name, contact,
 *     message, website} to `${api}/api/site-messages`; shows a Romanian
 *     thank-you on success; falls back to an honest failure panel with
 *     real tel:/wa.me contact links when the attribute is empty (static
 *     export) or the request fails;
 *   - the professionals appointment-request form is untouched by this
 *     change (still present, still separate from the new general form).
 *
 * None of this markup/behaviour exists before S-2B, so every check below
 * fails against the pre-S-2B templates (no #testimonials/#team ids, no
 * #pf-msg-form/#pr-msg-form, no data-site-messages-api contract at all) and
 * passes against the S-2B templates.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-s-2b-portfolio-professionals-sections.test.js
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

function loadPreset(tid, idx = 0) {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8')).presets;
  return JSON.parse(JSON.stringify(presets[idx].config));
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

/** Serves a static dir with NO /api/* route — the exact shape of a
 * self-hosted static export with no Hidook backend behind it. */
function serveStatic(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(dir, urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found: ' + urlPath);
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Serves the site AND a mock /api/site-messages that behaves per `mode`:
 * 'ok' -> 200 {ok:true}; 'fail' -> 500 {ok:false,error:'...'}. Records every
 * POST body it receives on `received`. */
function serveWithMessagesApi(dir, mode, received) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/api/site-messages' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (e) { /* ignore */ }
          received.push(parsed);
          res.writeHead(mode === 'ok' ? 200 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mode === 'ok' ? { ok: true } : { ok: false, error: 'boom' }));
        });
        return;
      }
      let filePath = path.join(dir, urlPath === '/' ? '/index.html' : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Renders `tid` with `config`, writes index.html/styles.css/script.js into
 * a fresh tmp dir, and returns that dir's path. */
function renderToTmpDir(tid, config) {
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s2b-' + tid + '-'));
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  fs.copyFileSync(path.join(ROOT, 'templates', tid, 'styles.css'), path.join(dir, 'styles.css'));
  fs.copyFileSync(path.join(ROOT, 'templates', tid, 'script.js'), path.join(dir, 'script.js'));
  return { dir, html };
}

const TESTIMONIAL_ITEMS = [
  { quote: 'Cea mai buna experienta, recomand cu incredere.', name: 'Ioana M.', role: 'Clienta' },
  { quote: 'Profesionisti de la primul contact pana la final.', name: 'Andrei P.', role: '' },
];

const TEAM_MEMBERS = [
  { name: 'Maria Ionescu', role: 'Fondatoare', bio: 'Peste 10 ani de experienta in domeniu.', photo: '' },
  { name: 'Radu Georgescu', role: 'Specialist', bio: '', photo: '' },
];

for (const tid of ['portfolio', 'professionals']) {
  test(`${tid}: testimonials section is absent when config has no items`, () => {
    const config = loadPreset(tid, 0);
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);
    assert.doesNotMatch(html, /id="testimonials"/, 'testimonials section must be hidden when no reviews are configured');
  });

  test(`${tid}: testimonials section renders configured quotes, names and roles`, () => {
    const config = loadPreset(tid, 0);
    config.testimonials = { title: 'Ce spun clientii', items: TESTIMONIAL_ITEMS };
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);
    assert.match(html, /id="testimonials"/, 'testimonials section must render when items are configured');
    for (const item of TESTIMONIAL_ITEMS) {
      assert.ok(html.includes(item.quote), `rendered page must include the quote: ${item.quote}`);
      assert.ok(html.includes(item.name), `rendered page must include the reviewer name: ${item.name}`);
    }
  });

  test(`${tid}: general "Scrie-ne" contact form carries the exact data-site-messages-api contract`, () => {
    const config = loadPreset(tid, 0);
    const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
    const html = renderHtml(templateHtml, config);
    assert.match(html, /data-site-messages-api="([^"]*)"[^>]*data-site-slug="([^"]*)"|data-site-slug="([^"]*)"[^>]*data-site-messages-api="([^"]*)"/, 'form must carry both data-site-messages-api and data-site-slug attributes');
  });
}

test('professionals: team section is absent when config has no members', () => {
  const config = loadPreset('professionals', 0);
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  assert.doesNotMatch(html, /id="team"/, 'team section must be hidden when no members are configured');
});

test('professionals: team section renders name, role, bio and photo when configured', () => {
  const config = loadPreset('professionals', 0);
  config.team = { title: 'Echipa noastra', members: TEAM_MEMBERS.map((m) => ({ ...m, photo: 'https://example.test/team/maria.jpg' })) };
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  assert.match(html, /id="team"/, 'team section must render when members are configured');
  assert.ok(html.includes('Maria Ionescu'));
  assert.ok(html.includes('Fondatoare'));
  assert.ok(html.includes('Peste 10 ani de experienta in domeniu.'));
  assert.ok(html.includes('https://example.test/team/maria.jpg'), 'configured photo URL must appear in the rendered <img>');
});

test('portfolio: has no generic contact form besides "Scrie-ne" (no other <form> pre-existed)', () => {
  const config = loadPreset('portfolio', 0);
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', 'portfolio', 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  const formCount = (html.match(/<form\b/g) || []).length;
  assert.strictEqual(formCount, 1, 'portfolio should have exactly one <form> (the new general contact form)');
});

test('professionals: appointment-request form is untouched and stays separate from the new general form', () => {
  const config = loadPreset('professionals', 0);
  const templateHtml = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
  const html = renderHtml(templateHtml, config);
  assert.match(html, /id="pr-appt-form"/, 'appointment form must still exist');
  assert.match(html, /id="pr-msg-form"/, 'a separate general contact form must also exist');
  const formCount = (html.match(/<form\b/g) || []).length;
  assert.strictEqual(formCount, 2, 'professionals should have exactly two <form>s: appointment + general contact');
});

for (const tid of ['portfolio', 'professionals']) {
  const formId = tid === 'portfolio' ? 'pf-msg-form' : 'pr-msg-form';
  const doneId = tid === 'portfolio' ? 'pf-msg-done' : 'pr-msg-done';
  const failId = tid === 'portfolio' ? 'pf-msg-fail' : 'pr-msg-fail';
  const submitId = tid === 'portfolio' ? 'pf-msg-submit' : 'pr-msg-submit';
  const nameId = tid === 'portfolio' ? 'pf-msg-name' : 'pr-msg-name';
  const contactId = tid === 'portfolio' ? 'pf-msg-contact' : 'pr-msg-contact';
  const msgId = tid === 'portfolio' ? 'pf-msg-message' : 'pr-msg-message';

  test(`${tid}: static export (empty api attribute) never fakes success and shows real fallback contacts`, async () => {
    const config = loadPreset(tid, 0);
    assert.ok(config.contact && (config.contact.phone || config.contact.waHref), 'preset must carry a real contact for the fallback CTA');
    const { dir } = renderToTmpDir(tid, config);
    const server = await serveStatic(dir);
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const apiRequests = [];
      page.on('request', (req) => { if (req.url().includes('/api/site-messages')) apiRequests.push(req.url()); });
      await page.goto(base + '/');
      await page.locator('#' + formId).scrollIntoViewIfNeeded();
      await page.fill('#' + nameId, 'Ana Popescu');
      await page.fill('#' + contactId, 'ana@example.test');
      await page.fill('#' + msgId, 'Salut, as vrea mai multe detalii.');
      await page.click('#' + submitId);
      await page.waitForTimeout(500);

      assert.strictEqual(apiRequests.length, 0, 'static export with no api base must never attempt a network call');
      assert.strictEqual(await page.locator('#' + doneId).isVisible(), false, 'fake success must never be shown without an api base');
      const fail = page.locator('#' + failId);
      assert.strictEqual(await fail.isVisible(), true, 'an honest fallback panel must be shown instead');
      assert.strictEqual(await page.locator('#' + formId).isVisible(), true, 'the form itself must remain visible so the visitor can retry');
    } finally {
      await browser.close();
      server.close();
    }
  });

  test(`${tid}: a real api base that succeeds shows the Romanian thank-you`, async () => {
    const config = loadPreset(tid, 0);
    const { dir, html } = renderToTmpDir(tid, config);
    const received = [];
    const server = await serveWithMessagesApi(dir, 'ok', received);
    const base = 'http://127.0.0.1:' + server.address().port;
    // Simulate what S-2C fills in at publish time: rewrite the empty
    // data-site-messages-api/data-site-slug attributes to point at our mock.
    const patched = html
      .replace(new RegExp('id="' + formId + '"([^>]*)data-site-messages-api=""'), 'id="' + formId + '"$1data-site-messages-api="' + base + '"')
      .replace(new RegExp('data-site-slug=""'), 'data-site-slug="test-slug"');
    fs.writeFileSync(path.join(dir, 'index.html'), patched, 'utf8');

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(base + '/');
      await page.locator('#' + formId).scrollIntoViewIfNeeded();
      await page.fill('#' + nameId, 'Ana Popescu');
      await page.fill('#' + contactId, 'ana@example.test');
      await page.fill('#' + msgId, 'Salut, as vrea mai multe detalii.');
      await page.click('#' + submitId);
      await page.waitForTimeout(500);

      assert.strictEqual(received.length, 1, 'exactly one POST must reach /api/site-messages');
      assert.deepStrictEqual(Object.keys(received[0]).sort(), ['contact', 'message', 'name', 'slug', 'website'].sort(), 'payload must be exactly {slug, name, contact, message, website}');
      assert.strictEqual(received[0].slug, 'test-slug');
      assert.strictEqual(received[0].name, 'Ana Popescu');
      assert.strictEqual(received[0].contact, 'ana@example.test');
      assert.strictEqual(received[0].message, 'Salut, as vrea mai multe detalii.');
      assert.strictEqual(received[0].website, '', 'honeypot field must be empty for a real visitor');

      const done = page.locator('#' + doneId);
      assert.strictEqual(await done.isVisible(), true, 'success panel must be shown after a real 200 ok');
      const text = await done.innerText();
      assert.ok(/mulțumim/i.test(text), 'success message must be in Romanian ("Mulțumim…"), got: ' + JSON.stringify(text));
      assert.strictEqual(await page.locator('#' + failId).isVisible(), false);
    } finally {
      await browser.close();
      server.close();
    }
  });

  test(`${tid}: a real api base that fails shows the honest fallback, never fake success`, async () => {
    const config = loadPreset(tid, 0);
    const { dir, html } = renderToTmpDir(tid, config);
    const received = [];
    const server = await serveWithMessagesApi(dir, 'fail', received);
    const base = 'http://127.0.0.1:' + server.address().port;
    const patched = html
      .replace(new RegExp('id="' + formId + '"([^>]*)data-site-messages-api=""'), 'id="' + formId + '"$1data-site-messages-api="' + base + '"')
      .replace(new RegExp('data-site-slug=""'), 'data-site-slug="test-slug"');
    fs.writeFileSync(path.join(dir, 'index.html'), patched, 'utf8');

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(base + '/');
      await page.locator('#' + formId).scrollIntoViewIfNeeded();
      await page.fill('#' + nameId, 'Ana Popescu');
      await page.fill('#' + contactId, 'ana@example.test');
      await page.fill('#' + msgId, 'Salut, as vrea mai multe detalii.');
      await page.click('#' + submitId);
      await page.waitForTimeout(500);

      assert.strictEqual(received.length, 1, 'the request must really be attempted');
      assert.strictEqual(await page.locator('#' + doneId).isVisible(), false, 'fake success must never be shown on a real server failure');
      const fail = page.locator('#' + failId);
      assert.strictEqual(await fail.isVisible(), true);
      const failLinks = await fail.locator('a[href^="tel:"], a[href*="wa.me"], a[href^="mailto:"]').count();
      assert.ok(failLinks >= 1, 'fallback panel must offer at least one real direct-contact link (tel:/wa.me/mailto:)');
      assert.strictEqual(await page.locator('#' + formId).isVisible(), true, 'the form must remain visible/usable so the visitor can retry');
    } finally {
      await browser.close();
      server.close();
    }
  });
}
