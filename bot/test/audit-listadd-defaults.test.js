/**
 * Oracle: a newly added list item is never a blank card.
 *
 * onListAdd() used to seed object itemShapes with '' for every field. Two real
 * customer-visible consequences followed:
 *   1. templates that guard a field with `<!-- @if title -->` rendered NO node
 *      for the new item, so the inline editor had nothing to attach to and the
 *      item could be neither edited nor removed (portfolio gallery categories);
 *   2. templates that render the field unconditionally showed an empty card,
 *      which could be published to the customer's live site.
 * The bilingual restaurant menu additionally seeded the literals 'New section'
 * and 'New item', which the product full-pass oracle rejects as factory text.
 *
 * This test asserts the outcome a customer sees, not the presence of code.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

const BANNED = [/\bNew section\b/i, /\bNew item\b/i, /\bLorem ipsum\b/i, /\bundefined\b/];

test('new list items get real Romanian text and stay editable', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'listadd-'));
  process.env.SERVER_SECRET = 'listadd-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);

  const cases = [
    { id: 'portfolio', list: 'categories', label: 'categorii de galerie' },
    { id: 'product-menu', list: 'services', label: 'specialități' },
  ];

  try {
    for (const c of cases) {
      await page.goto(base + '/app/', { waitUntil: 'networkidle' });
      await page.locator('#hb-cookie-accept').click().catch(() => {});
      await page.locator(`.template-card[data-template-id="${c.id}"] .btn-start-tpl`).click();
      await page.waitForURL(/#edit$/);
      await page.locator('#preview-iframe').waitFor({ state: 'visible' });
      await page.waitForTimeout(1800);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(500);
      }

      const frame = page.frameLocator('#preview-iframe');
      const addBtn = frame.locator(`.hb-add-btn[data-hb-list="${c.list}"]`).first();
      const anyAdd = (await addBtn.count()) ? addBtn : frame.locator('.hb-add-btn').first();
      await anyAdd.scrollIntoViewIfNeeded();

      const beforeItems = await frame.locator(`[data-hb-edit^="${c.list}."]`).count();
      await anyAdd.click({ force: true });
      await page.waitForTimeout(1800);
      const afterItems = await frame.locator(`[data-hb-edit^="${c.list}."]`).count();

      assert.ok(
        afterItems > beforeItems,
        `${c.id}/${c.list}: after "+ Adaugă" the new item must render inline-editable nodes so it can be edited and removed (before ${beforeItems}, after ${afterItems})`
      );

      const texts = await frame.locator(`[data-hb-edit^="${c.list}."]`).allInnerTexts();
      const fresh = texts.slice(beforeItems).map(t => t.trim()).filter(Boolean);
      assert.ok(fresh.length > 0, `${c.id}/${c.list}: the new item must carry visible text, got ${JSON.stringify(texts.slice(beforeItems))}`);
      for (const t of fresh) {
        for (const re of BANNED) {
          assert.ok(!re.test(t), `${c.id}/${c.list}: factory text "${t}" must not be seeded`);
        }
      }
      console.log(`PASS ${c.id}/${c.list} (${c.label}) → ${JSON.stringify(fresh)}`);
    }
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }

  // Secondary, after the behavioural proof: the banned factory literals the
  // product full-pass oracle rejects must not be seeded by the editor either.
  const appSrc = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');
  const seedStart = appSrc.indexOf('function onListAdd');
  const seedRegion = appSrc.slice(seedStart, seedStart + 2600);
  for (const re of [/'New section'/, /'New item'/]) {
    assert.ok(!re.test(seedRegion), 'onListAdd must not seed the banned literal ' + re);
  }
});
