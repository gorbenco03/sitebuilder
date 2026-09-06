'use strict';
/**
 * bot/test/wave8-owner-ui-invoices-reachable-e2e.test.js
 *
 * Reachability oracle for the invoice/billing history endpoint. GET
 * /api/sites/:id/invoices returns the full ledger-backed payment history
 * (newest first, kind/amount/currency/timestamp, plus a hosted invoice URL
 * and PDF link for a real Stripe charge) — fully built, fully tested at the
 * API layer, and never rendered anywhere. This drives the REAL browser
 * through the "Proiectele mele" dashboard — where an owner already goes to
 * manage a site they pay for — to see it.
 *
 * RED BEFORE this branch: builder/app.js had no "Facturi" button anywhere
 * and no modal-invoices markup in builder/index.html — this test's first
 * UI-specific step (finding that button on the dashboard card) times out.
 * Proven by re-running this exact file against the pre-wave-8 copies of
 * builder/app.js, builder/app.css and builder/index.html (git-checkout'd
 * from the parent commit, no git stash involved) — see
 * 04-QA-Evidence/Wave8-owner-ui/invoices-red-before.log.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-owner-ui-invoices-reachable-e2e.test.js
 * Evidence: 04-QA-Evidence/Wave8-owner-ui/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave8-owner-ui');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('a site that has been paid for shows its invoice in the dashboard "Facturi" panel', async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-owner-ui-invoices-'));
    process.env.SERVER_SECRET = 'wave8-owner-ui-invoices-secret';
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'CALENDAR_PUBLIC_BASE_URL']) {
        delete process.env[k];
    }

    require(path.join(ROOT, 'scripts/build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot/server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);

    try {
        // =====================================================================
        // 1. Publish a real site — this IS the first charge (kind: 'publish'),
        //    which webpublish.js#handleStripePaid appends to the ledger.
        // =====================================================================
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.locator('#hb-cookie-accept').click().catch(() => {});
        await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);

        const runSlug = 'wave8-owner-ui-inv-' + crypto.randomBytes(4).toString('hex');
        const ownerEmail = 'wave8-owner-ui-invoices@example.com';

        await page.locator('#btn-publish').click();
        await page.locator('#modal-publish').waitFor({ state: 'visible' });
        await page.locator('#input-slug').fill(runSlug);
        await page.locator('#btn-publish-continue').click();
        await page.locator('#form-auth-email').waitFor({ state: 'visible' });

        await page.locator('#input-email').fill(ownerEmail);
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        await page.locator('#modal-success').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').click();
        await page
            .locator('#modal-success-title')
            .filter({ hasText: 'Site-ul tău e live' })
            .waitFor({ state: 'visible', timeout: 20000 });

        const mySites = await page.evaluate(() => fetch('/api/sites', { credentials: 'include' }).then(r => r.json()));
        const site = (mySites.sites || []).find((s) => s.slug === runSlug);
        assert.ok(site, 'the just-published site must show up in /api/sites');

        // Ground truth straight from the ledger this wave does not touch —
        // the UI must show exactly this, not invent or drop anything.
        const webpublish = require(path.join(ROOT, 'bot/webpublish.js'));
        const ledgerInvoices = webpublish.getInvoiceHistory(site);
        assert.equal(ledgerInvoices.length, 1, 'sanity: publishing once must record exactly one invoice in the ledger');
        assert.equal(ledgerInvoices[0].kind, 'publish');
        assert.ok(ledgerInvoices[0].amountCents > 0, 'sanity: the recorded invoice must carry a real charged amount');

        await page.locator('#btn-success-close').click().catch(() => {});
        await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});

        // =====================================================================
        // 2. Reach the dashboard exactly where an owner would look, and open
        //    the "Facturi" panel — RED BEFORE this wave: this button/panel did
        //    not exist anywhere in the product.
        // =====================================================================
        await page.locator('#nav-dashboard').click().catch(async () => {
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
        });
        await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
        const card = page.locator('.site-card', { hasText: runSlug });
        await card.waitFor({ state: 'visible' });

        const invoicesBtn = card.locator('button', { hasText: 'Facturi' });
        await invoicesBtn.waitFor({ state: 'visible', timeout: 15000 });
        await invoicesBtn.click();

        await page.locator('#modal-invoices').waitFor({ state: 'visible' });
        const items = page.locator('.invoice-item');
        await items.first().waitFor({ state: 'visible', timeout: 15000 });
        assert.equal(await items.count(), 1, 'exactly the one real invoice from the ledger must render, no more, no less');

        const kindText = await items.first().locator('.invoice-kind').innerText();
        assert.match(kindText, /publicare/i, 'the first-year charge must be labelled in Romanian: ' + kindText);

        const amountText = await items.first().locator('.invoice-amount').innerText();
        assert.notEqual(amountText.trim(), '—', 'a real charged invoice must show a real amount, not the empty placeholder');
        assert.match(amountText, /\d/, 'the amount must contain the actual charged number: ' + amountText);

        const dateText = await items.first().locator('.invoice-date').innerText();
        assert.ok(dateText.trim().length > 0, 'the invoice must show a date');

        await page.screenshot({ path: path.join(EVIDENCE, 'invoices-01-list.png') });

        console.log('PASS wave8-owner-ui-invoices-reachable-e2e: a paid site\'s real invoice is visible from the dashboard UI');
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
});
