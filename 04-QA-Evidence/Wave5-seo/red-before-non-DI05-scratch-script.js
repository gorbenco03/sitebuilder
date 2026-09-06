'use strict';
/**
 * Scratch evidence script — exercises the non-DI-05 assertions from
 * bot/test/audit-publish-seo.test.js (F5/F6/prof-06/BE-06/PC-04) against the
 * reverted (pre-fix) source tree, without the DI-05 checks that hang forever
 * pre-fix (already proven separately by observing an 8s+ hang with zero
 * output). Not part of the committed suite — evidence only.
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seo-red-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'audit-seo-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = 'test';
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.DEPLOY_PROVIDER;
delete process.env.BRAND_DOMAIN;

const pricing      = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/pricing.js');
const registry      = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/registry.js');
const ledger        = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/ledger.js');
const webpublish     = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/webpublish.js');
const siteExport     = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/site-export.js');
const { onStripeEvent } = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/web.js');
const { startServer }   = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/server.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
    }
}

function fullConfig(name) {
    return {
        business: { name, title: `${name} | Test`, metaDescription: `${name} — descriere de test pentru audit.`, lang: 'ro' },
        hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Sună acum' },
        contact: {
            phone: '+40721234567',
            instagram: { url: 'https://www.instagram.com/' + name.toLowerCase().replace(/\s+/g, '') },
            facebook: { url: 'https://www.facebook.com/' + name.toLowerCase().replace(/\s+/g, '') },
        },
        footer: { address: 'Strada Test 1, București' },
    };
}

function seedLiveSiteConfig(slugPrefix, name) {
    const user = registry.getOrCreateUserByEmail(`seo-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({ userId: user.id, templateId: 'product-menu', templateVersion: 1, slug: (slugPrefix || 'seo') + '-' + crypto.randomUUID().slice(0, 8), platform: 'web' });
    const sessionId = 'cs_test_seo_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({ siteId: site.id, userId: user.id, amountCents: pricing.PRICE_CENTS, currency: 'eur', stripeSessionId: sessionId, kind: 'publish' });
    const config = fullConfig(name || 'Audit SEO Cafe');
    registry.saveVersion(site.id, config);
    webpublish.savePendingDraft(order.id, { config, images: [], siteId: site.id, savedAt: new Date().toISOString() });
    const subscriptionId = 'sub_test_seo_' + crypto.randomBytes(5).toString('hex');
    const customerId = 'cus_test_seo_' + crypto.randomBytes(5).toString('hex');
    return { user, site, sessionId, order, subscriptionId, customerId, config };
}

async function publishViaTrialWebhook({ sessionId, site, order, user, subscriptionId, customerId }) {
    await onStripeEvent({
        id: 'evt_seo_paid_' + crypto.randomUUID().slice(0, 10),
        type: 'checkout.session.completed',
        data: { object: { id: sessionId, payment_status: 'no_payment_required', customer: customerId, subscription: subscriptionId,
            metadata: { platform: 'web', orderId: order.id, siteId: site.id, kind: 'publish', userId: user.id, billing_contract: 'first_then_renewal', first_period_cents: String(pricing.PRICE_CENTS), renewal_cents: String(pricing.RENEWAL_CENTS) } } },
    });
}

(async () => {
    await check('PC-04: payments.RO_ERRORS / toClientMessageRo are exported', () => {
        const payments = require('/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a00389bd20c264957/bot/payments.js');
        assert.ok(payments.RO_ERRORS, 'RO_ERRORS must be exported');
    });

    await check('F6 (ZIP): exported site tree includes robots.txt and sitemap.xml', () => {
        const config = fullConfig('Export SEO Test');
        const built = siteExport.buildStaticSiteTree({ templateId: 'product-menu', config, images: [] });
        try {
            assert.ok(fs.existsSync(path.join(built.siteDir, 'robots.txt')), 'robots.txt must exist in export tree');
            assert.ok(fs.existsSync(path.join(built.siteDir, 'sitemap.xml')), 'sitemap.xml must exist in export tree');
        } finally { built.cleanup(); }
    });

    await check('F6 (ZIP): exportSiteZip() file list includes robots.txt and sitemap.xml', () => {
        const config = fullConfig('Export SEO Zip Test');
        const result = siteExport.exportSiteZip({ templateId: 'product-menu', config, images: [] });
        assert.ok(result.files.includes('robots.txt'), 'ZIP file list must include robots.txt');
        assert.ok(result.files.includes('sitemap.xml'), 'ZIP file list must include sitemap.xml');
    });

    await check('F5 (ZIP): a never-published export still gets an absolute canonical + og:url', () => {
        const config = fullConfig('Export Canonical Test');
        const built = siteExport.buildStaticSiteTree({ templateId: 'product-menu', config, images: [] });
        try {
            const html = fs.readFileSync(path.join(built.siteDir, 'index.html'), 'utf8');
            const canonicalMatch = /<link rel="canonical" href="([^"]*)">/i.exec(html);
            assert.ok(canonicalMatch, 'canonical link must be present even for a never-published export');
        } finally { built.cleanup(); }
    });

    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => { if (server.listening) return resolve(); server.once('listening', resolve); server.once('error', reject); });
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_URL = base;

    try {
        await check('F5: canonical + og:url are present and absolute on the live page', async () => {
            const seeded = seedLiveSiteConfig('f5', 'Canonical Cafe');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            const liveRes = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            const html = await liveRes.text();
            const canonicalMatch = /<link rel="canonical" href="([^"]*)">/i.exec(html);
            assert.ok(canonicalMatch, 'canonical link must be present');
        });

        await check('prof-06: LocalBusiness JSON-LD is present', async () => {
            const seeded = seedLiveSiteConfig('p6', 'JsonLd Bakery');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            const liveRes = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            const html = await liveRes.text();
            const ldMatch = /<script type="application\/ld\+json">([^<]*)<\/script>/i.exec(html);
            assert.ok(ldMatch, 'ld+json script tag must be present');
        });

        await check('F6 (live): robots.txt and sitemap.xml are served 200', async () => {
            const seeded = seedLiveSiteConfig('f6live', 'Sitemap Studio');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            const robotsRes = await fetch(`${base}/live/${site.slug}/robots.txt`);
            assert.strictEqual(robotsRes.status, 200, 'robots.txt must 200 on the live site');
        });

        await check('BE-06: handleStripeInvoicePaymentFailed exists and records to the ledger', async () => {
            const seeded = seedLiveSiteConfig('be06', 'Dunning Deli');
            await publishViaTrialWebhook(seeded);
            assert.strictEqual(typeof webpublish.handleStripeInvoicePaymentFailed, 'function', 'handler must exist');
            const invoiceId = 'in_be06_' + crypto.randomUUID().slice(0, 8);
            const notified = [];
            const event = { id: 'evt_be06_' + crypto.randomUUID().slice(0, 10), type: 'invoice.payment_failed', data: { object: { id: invoiceId, subscription: seeded.subscriptionId, attempt_count: 1 } } };
            const updated = await webpublish.handleStripeInvoicePaymentFailed(event, (t) => notified.push(t));
            assert.ok(updated, 'handler must resolve the site');
            assert.strictEqual(notified.length, 1, 'owner must be notified exactly once');
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log(failed ? `\n${failed} FAILED` : '\nAll passed.');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('FATAL', e.message);
    process.exit(1);
});
