'use strict';
/**
 * bot/test/wave8-owner-ui-dunning-banner-reachable-e2e.test.js
 *
 * Extra find from the Wave 8 reachability sweep (not one of the two named
 * features, but the exact same defect): bot/webpublish.js#getDunningState's
 * own doc comment says paymentFailedAt/paymentFailedCount/
 * stripeSubscriptionStatus are "already returned verbatim by GET /api/sites"
 * specifically so the dashboard can render them — and
 * bot/test/wave7-payments-dunning.test.js's docblock names the exact same
 * gap ("what a site card should show ... see HANDOFF-payments.md"). Neither
 * file exists: builder/app.js never rendered anything for a declined
 * renewal charge. An owner whose card gets declined got a Telegram message
 * to the ADMIN and a silent site takedown once retries were exhausted —
 * nothing in their own dashboard ever told them.
 *
 * This is a light oracle (no Stripe/webhook simulation): publish a real site,
 * then set the exact fields GET /api/sites already passes through verbatim
 * directly on the registry record (the same fields a real
 * invoice.payment_failed webhook would set — see
 * bot/webpublish.js#handleStripeInvoicePaymentFailed), reload the dashboard,
 * and check the card.
 *
 * Card lookup matches on the random hex run-id alone, not the full hyphenated
 * slug: the visible site-card NAME renders with U+2011 (non-breaking hyphen,
 * so a slug never soft-wraps mid-word) in place of '-', so a plain-hyphen
 * substring only happens to appear elsewhere on the card (the live-site URL
 * text) when site.url is set — which it deliberately is NOT once the
 * 'critical' dunning state below unpublishes the site. The hex run-id has no
 * hyphens either way, so it matches the card in both states.
 *
 * RED BEFORE this fix: builder/app.js had no computeDunningBanner, no
 * ".dunning-banner" anywhere, and no "Actualizează cardul" button — a
 * card in this state showed no primary action at all (see
 * 04-QA-Evidence/Wave8-owner-ui/dunning-red-before.log).
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-owner-ui-dunning-banner-reachable-e2e.test.js
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

test('a warning (past_due) and a critical (unpaid) dunning state each show up on the dashboard card', async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-owner-ui-dunning-'));
    process.env.SERVER_SECRET = 'wave8-owner-ui-dunning-secret';
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

    const runHex = crypto.randomBytes(4).toString('hex');
    const runSlug = 'wave8-owner-ui-dun-' + runHex;

    try {
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.locator('#hb-cookie-accept').click().catch(() => {});
        await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);
        // Details drawer auto-opens on a fresh design and its overlay covers
        // the topbar publish button — close it first, same as a real owner
        // would (and the same step the Wave 8 calendar oracle already takes).
        await page.locator('#btn-close-drawer').click().catch(() => {});

        const ownerEmail = 'wave8-owner-ui-dunning@example.com';

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

        await page.locator('#btn-success-close').click().catch(() => {});
        await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});

        // Same fields a real invoice.payment_failed webhook writes
        // (bot/webpublish.js#handleStripeInvoicePaymentFailed) — set directly
        // on the registry record, the exact way GET /api/sites passes them
        // through to the dashboard.
        const registry = require(path.join(ROOT, 'bot/registry.js'));
        registry.updateSite(site.id, {
            paymentFailedAt: new Date().toISOString(),
            paymentFailedCount: 2,
            stripeSubscriptionStatus: 'past_due',
        });

        // =====================================================================
        // Warning: card declined, site still live — RED BEFORE: no banner, no
        // "Actualizează cardul" button anywhere on this card.
        // =====================================================================
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#nav-dashboard').click().catch(async () => {
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
        });
        await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
        let card = page.locator('.site-card', { hasText: runHex });
        await card.waitFor({ state: 'visible', timeout: 15000 });

        const warningBanner = card.locator('.dunning-banner--warning');
        await warningBanner.waitFor({ state: 'visible', timeout: 15000 });
        assert.match(await warningBanner.innerText(), /Card refuzat la încercarea 2/, 'must show the real attempt count from the record');
        await card.locator('button', { hasText: 'Actualizează cardul' }).waitFor({ state: 'visible' });
        // Still live -> Anulează must ALSO still be offered alongside it.
        await card.locator('button', { hasText: 'Anulează' }).waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(EVIDENCE, 'dunning-01-warning.png') });

        // =====================================================================
        // Critical: Stripe gave up, site unpublished — the card previously had
        // NO primary action at all in this state.
        // =====================================================================
        registry.updateSite(site.id, {
            stripeSubscriptionStatus: 'unpaid',
            status: 'unpublished',
            url: null,
        });
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#nav-dashboard').click().catch(async () => {
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
        });
        await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
        card = page.locator('.site-card', { hasText: runHex });
        await card.waitFor({ state: 'visible', timeout: 15000 });

        const criticalBanner = card.locator('.dunning-banner--critical');
        await criticalBanner.waitFor({ state: 'visible', timeout: 15000 });
        assert.match(await criticalBanner.innerText(), /Site-ul a fost oprit/, 'the critical banner must say the site is down');
        await card.locator('button', { hasText: 'Actualizează cardul' }).waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(EVIDENCE, 'dunning-02-critical.png') });

        console.log('PASS wave8-owner-ui-dunning-banner-reachable-e2e: a declined renewal charge is now visible to the owner, not just the admin');
    } finally {
        await browser.close();
        await new Promise((r) => server.close(r));
    }
});
