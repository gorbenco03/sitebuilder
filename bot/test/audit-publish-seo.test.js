'use strict';
/**
 * bot/test/audit-publish-seo.test.js — oracle for the technical-SEO and
 * publish-robustness audit findings landed by this branch:
 *
 *   F5      (static-renderer-export) — no published site ever had a
 *           <link rel="canonical">/<meta property="og:url">.
 *   F6      (static-renderer-export / product-strategy PS-09) — no live site
 *           or exported ZIP ever included robots.txt/sitemap.xml.
 *   prof-06 (template-professionals) — LocalBusiness JSON-LD was never built
 *           on the web-builder publish path (Telegram-only before this fix).
 *   DI-05   (deploy-infra) — Cloudflare/Vercel/Netlify/Revolut/Stripe fetch
 *           calls had no timeout, so a hung provider blocked a
 *           publish/checkout/domain-lookup forever.
 *   BE-06   (backend-api-security) — invoice.payment_failed was not handled
 *           at all; nothing recorded the failure or told anyone.
 *   PC-04   (payments) — checkout/billing failures echoed raw English/Stripe
 *           text to the browser in a 100%-Romanian product.
 *
 * Every assertion below was re-verified against TODAY's main (post storage
 * round-3 rewrite), not carried over blindly from the original branch this
 * was ported from.
 *
 * Two constraints this file was originally written under have since been
 * lifted by the integrator, and the checks at the bottom now cover both:
 *   - paymentFailedAt/paymentFailedCount were missing from the site-field
 *     allowlist (bot/registry-shared.js#SITE_EXTRA_FIELDS), so updateSite()
 *     accepted the dunning patch and silently dropped it. They are on the
 *     allowlist now, so the record is durable on the site AND in the ledger.
 *   - bot/web.js did not route invoice.payment_failed at all, so a real
 *     Stripe webhook reached nothing. It is wired now, and the dispatch path
 *     is asserted rather than only the handler being called directly.
 *
 * Run: node bot/test/audit-publish-seo.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seo-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'audit-seo-secret-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0'; // patched after listen
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.CLOUDFLARE_ACCOUNT_ID;
delete process.env.REVOLUT_SECRET_KEY;
delete process.env.DEPLOY_PROVIDER;
delete process.env.BRAND_DOMAIN;

const pricing      = require('../pricing.js');
const registry      = require('../registry.js');
const ledger        = require('../ledger.js');
const webpublish     = require('../webpublish.js');
const siteExport     = require('../site-export.js');
const { onStripeEvent } = require('../web.js');
const { startServer }   = require('../server.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

// Config shape confirmed against templates/{professionals,portfolio,...}/presets.json:
// business.name/metaDescription, contact.phone/instagram.url/facebook.url,
// footer.address (plain text) — common across all 5 templates.
function fullConfig(name) {
    return {
        business: {
            name,
            title: `${name} | Test`,
            metaDescription: `${name} — descriere de test pentru audit.`,
            lang: 'ro',
        },
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
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: (slugPrefix || 'seo') + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_seo_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    const config = fullConfig(name || 'Audit SEO Cafe');
    registry.saveVersion(site.id, config);
    webpublish.savePendingDraft(order.id, {
        config,
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });
    const subscriptionId = 'sub_test_seo_' + crypto.randomBytes(5).toString('hex');
    const customerId = 'cus_test_seo_' + crypto.randomBytes(5).toString('hex');
    return { user, site, sessionId, order, subscriptionId, customerId, config };
}

async function publishViaTrialWebhook({ sessionId, site, order, user, subscriptionId, customerId }) {
    await onStripeEvent({
        id: 'evt_seo_paid_' + crypto.randomUUID().slice(0, 10),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'no_payment_required',
                customer: customerId,
                subscription: subscriptionId,
                metadata: {
                    platform: 'web',
                    orderId: order.id,
                    siteId: site.id,
                    kind: 'publish',
                    userId: user.id,
                    billing_contract: 'first_then_renewal',
                    first_period_cents: String(pricing.PRICE_CENTS),
                    renewal_cents: String(pricing.RENEWAL_CENTS),
                },
            },
        },
    });
}

/** Minimal mock for global.fetch that hangs until the request's AbortSignal
 * fires, then rejects with the signal's abort reason — exactly like real
 * fetch/undici does for AbortSignal.timeout(). Used to prove DI-05's fix
 * actually bounds the wait instead of hanging forever. */
function installHangingFetch() {
    const orig = global.fetch;
    global.fetch = (_url, opts) => new Promise((_resolve, reject) => {
        const signal = opts && opts.signal;
        if (!signal) return; // never resolves — would only happen if a timeout signal was dropped
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason));
    });
    return () => { global.fetch = orig; };
}

(async () => {
    // DI-05's checks below await a promise that only settles when an
    // AbortSignal.timeout() fires — that internal timer is intentionally
    // unref'd (Node does not keep the process alive just for a timeout
    // signal), so it must run while something else keeps the event loop
    // alive. A ref'd keep-alive interval does that without depending on
    // check ordering elsewhere in this file.
    const keepAlive = setInterval(() => {}, 1000);

    // ── DI-05: provider fetch calls now bound the wait instead of hanging ──
    await check('DI-05: Cloudflare API call times out (bounded) instead of hanging forever', async () => {
        process.env.CLOUDFLARE_API_TOKEN = 'test-token';
        process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
        process.env.CLOUDFLARE_API_TIMEOUT_MS = '80';
        const restore = installHangingFetch();
        try {
            // The timeout constant is read from the env var once at module
            // load (same pattern as the existing WRANGLER_TIMEOUT_MS) —
            // webpublish.js already required this module before this test set
            // the override, so bust the require cache to pick it up fresh.
            delete require.cache[require.resolve('../deploy-cloudflare.js')];
            const cfDeploy = require('../deploy-cloudflare.js');
            const started = Date.now();
            await assert.rejects(
                () => cfDeploy.ensureProject('audit-seo-timeout-project'),
                (e) => {
                    assert.ok(/timed out after 80ms/.test(e.message), 'got: ' + e.message);
                    return true;
                }
            );
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
        } finally {
            restore();
            delete process.env.CLOUDFLARE_API_TOKEN;
            delete process.env.CLOUDFLARE_ACCOUNT_ID;
            delete process.env.CLOUDFLARE_API_TIMEOUT_MS;
        }
    });

    await check('DI-05: Vercel deploy API call times out (bounded) instead of hanging forever', async () => {
        process.env.VERCEL_TOKEN = 'test-token';
        process.env.VERCEL_API_TIMEOUT_MS = '80';
        const restore = installHangingFetch();
        try {
            delete require.cache[require.resolve('../deploy-vercel.js')];
            const deployVercel = require('../deploy-vercel.js');
            const started = Date.now();
            await assert.rejects(
                () => deployVercel.disablePublicProtection('prj_audit_seo_timeout'),
                (e) => {
                    assert.ok(/timed out after 80ms/.test(e.message), 'got: ' + e.message);
                    return true;
                }
            );
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
        } finally {
            restore();
            delete process.env.VERCEL_TOKEN;
            delete process.env.VERCEL_API_TIMEOUT_MS;
        }
    });

    await check('DI-05: Vercel domains (domains.js) API call times out (bounded) instead of hanging forever', async () => {
        process.env.VERCEL_TOKEN = 'test-token';
        process.env.VERCEL_API_TIMEOUT_MS = '80';
        const restore = installHangingFetch();
        try {
            delete require.cache[require.resolve('../domains.js')];
            const domains = require('../domains.js');
            const started = Date.now();
            await assert.rejects(
                () => domains.checkDomain('audit-seo-timeout.com'),
                (e) => {
                    assert.ok(/timed out after 80ms/.test(e.message), 'got: ' + e.message);
                    return true;
                }
            );
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
        } finally {
            restore();
            delete process.env.VERCEL_TOKEN;
            delete process.env.VERCEL_API_TIMEOUT_MS;
        }
    });

    await check('DI-05: Netlify API call times out (bounded) instead of hanging forever', async () => {
        process.env.NETLIFY_API_TIMEOUT_MS = '80';
        const restore = installHangingFetch();
        const netlifySiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-seo-netlify-'));
        fs.writeFileSync(path.join(netlifySiteDir, 'index.html'), '<html></html>', 'utf8');
        try {
            delete require.cache[require.resolve('../deploy.js')];
            const deployNetlify = require('../deploy.js');
            const started = Date.now();
            await assert.rejects(
                () => deployNetlify.deployToNetlify(netlifySiteDir, 'test-token'),
                (e) => {
                    assert.ok(/timed out after 80ms/.test(e.message), 'got: ' + e.message);
                    return true;
                }
            );
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
        } finally {
            restore();
            fs.rmSync(netlifySiteDir, { recursive: true, force: true });
            delete process.env.NETLIFY_API_TIMEOUT_MS;
        }
    });

    await check('DI-05: Revolut API call times out (bounded) instead of hanging forever', async () => {
        process.env.REVOLUT_SECRET_KEY = 'test-key';
        process.env.REVOLUT_API_TIMEOUT_MS = '80';
        const restore = installHangingFetch();
        try {
            delete require.cache[require.resolve('../revolut.js')];
            const revolut = require('../revolut.js');
            const started = Date.now();
            await assert.rejects(
                () => revolut.getCheckoutStatus('ord_audit_seo_timeout'),
                (e) => {
                    assert.ok(/timed out after 80ms/.test(e.message), 'got: ' + e.message);
                    return true;
                }
            );
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
        } finally {
            restore();
            delete process.env.REVOLUT_SECRET_KEY;
            delete process.env.REVOLUT_API_TIMEOUT_MS;
        }
    });

    await check('DI-05: Stripe API call times out (bounded) instead of hanging forever', async () => {
        const savedKey = process.env.STRIPE_SECRET_KEY;
        const savedTestPay = process.env.HIDOOK_TEST_PAY;
        process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
        delete process.env.HIDOOK_TEST_PAY; // force the real stripeRequest() path, not the offline stub
        process.env.STRIPE_API_TIMEOUT_MS = '80';
        const restore = installHangingFetch();
        try {
            // Same require-cache-busting reason as the Cloudflare check above.
            delete require.cache[require.resolve('../payments.js')];
            const payments = require('../payments.js');
            const started = Date.now();
            await assert.rejects(
                () => payments.createCheckout({
                    amountCents: 9900,
                    productName: 'Audit timeout test',
                    successUrl: 'http://127.0.0.1/app/#paid',
                    cancelUrl: 'http://127.0.0.1/app/#cancelled',
                }),
                (e) => {
                    assert.ok(/timed out after 80ms/.test(e.message), 'got: ' + e.message);
                    return true;
                }
            );
            assert.ok(Date.now() - started < 2000, 'must fail fast, not hang');
        } finally {
            restore();
            process.env.STRIPE_SECRET_KEY = savedKey;
            process.env.HIDOOK_TEST_PAY = savedTestPay;
            delete process.env.STRIPE_API_TIMEOUT_MS;
        }
    });

    clearInterval(keepAlive);

    // ── PC-04: reusable Romanian client-safe error text ─────────────────────
    await check('PC-04: payments.RO_ERRORS / toClientMessageRo are Romanian, generic, and never echo raw provider text', () => {
        const payments = require('../payments.js');
        assert.ok(payments.RO_ERRORS && typeof payments.RO_ERRORS === 'object', 'RO_ERRORS must be exported');
        for (const key of ['NOT_CONFIGURED', 'CHECKOUT_FAILED', 'BILLING_FAILED', 'NO_CUSTOMER_YET']) {
            const msg = payments.RO_ERRORS[key];
            assert.ok(msg && typeof msg === 'string', `RO_ERRORS.${key} must be a non-empty string`);
            assert.ok(/[ăâîșț]/i.test(msg), `RO_ERRORS.${key} must carry Romanian diacritics: "${msg}"`);
        }
        const stripeErr = new Error('card_declined: Your card was declined.');
        assert.strictEqual(payments.toClientMessageRo(stripeErr, 'checkout'), payments.RO_ERRORS.CHECKOUT_FAILED);
        assert.strictEqual(payments.toClientMessageRo(stripeErr, 'billing'), payments.RO_ERRORS.BILLING_FAILED);
        assert.ok(!payments.toClientMessageRo(stripeErr, 'checkout').includes('card_declined'), 'must never leak the raw provider message');
    });

    // ── F6: robots.txt + sitemap.xml exist in the offline ZIP export ───────
    await check('F6 (ZIP): exported site tree includes robots.txt and sitemap.xml', () => {
        const config = fullConfig('Export SEO Test');
        const built = siteExport.buildStaticSiteTree({ templateId: 'product-menu', config, images: [] });
        try {
            const robotsPath = path.join(built.siteDir, 'robots.txt');
            const sitemapPath = path.join(built.siteDir, 'sitemap.xml');
            assert.ok(fs.existsSync(robotsPath), 'robots.txt must exist in export tree');
            assert.ok(fs.existsSync(sitemapPath), 'sitemap.xml must exist in export tree');
            const robots = fs.readFileSync(robotsPath, 'utf8');
            const sitemap = fs.readFileSync(sitemapPath, 'utf8');
            assert.match(robots, /Allow:\s*\//, 'robots.txt must Allow: /');
            assert.match(sitemap, /<urlset[^>]*sitemaps\.org/, 'sitemap.xml must be a valid sitemap document');
            assert.match(sitemap, /<loc>[^<]+<\/loc>/, 'sitemap.xml must have at least one <loc> (single-page site → single entry)');
        } finally {
            built.cleanup();
        }
    });

    await check('F6 (ZIP): exportSiteZip() file list includes robots.txt and sitemap.xml', () => {
        const config = fullConfig('Export SEO Zip Test');
        const result = siteExport.exportSiteZip({ templateId: 'product-menu', config, images: [] });
        assert.ok(result.files.includes('robots.txt'), 'ZIP file list must include robots.txt');
        assert.ok(result.files.includes('sitemap.xml'), 'ZIP file list must include sitemap.xml');
    });

    // ── F5 (ZIP): canonical + og:url are present (absolute placeholder when
    // this config was never published through Hidook — corrected for real
    // once it is, since buildStaticSiteTree() reuses seo.canonical's origin) ─
    await check('F5 (ZIP): a never-published export still gets an absolute canonical + og:url', () => {
        const config = fullConfig('Export Canonical Test');
        const built = siteExport.buildStaticSiteTree({ templateId: 'product-menu', config, images: [] });
        try {
            const html = fs.readFileSync(path.join(built.siteDir, 'index.html'), 'utf8');
            const canonicalMatch = /<link rel="canonical" href="([^"]*)">/i.exec(html);
            const ogUrlMatch = /<meta property="og:url" content="([^"]*)">/i.exec(html);
            assert.ok(canonicalMatch, 'canonical link must be present even for a never-published export');
            assert.ok(ogUrlMatch, 'og:url meta must be present even for a never-published export');
            assert.ok(/^https?:\/\//i.test(canonicalMatch[1]), 'canonical must be absolute, got ' + canonicalMatch[1]);
            assert.strictEqual(canonicalMatch[1], ogUrlMatch[1], 'canonical and og:url must match');
        } finally {
            built.cleanup();
        }
    });

    await check('F5 (ZIP): re-exporting an already-published config reuses its real origin, not the placeholder', () => {
        const config = fullConfig('Export Republish Test');
        config.seo = { canonical: 'https://already-live.example.com/' };
        const built = siteExport.buildStaticSiteTree({ templateId: 'product-menu', config, images: [] });
        try {
            const html = fs.readFileSync(path.join(built.siteDir, 'index.html'), 'utf8');
            assert.match(html, /<link rel="canonical" href="https:\/\/already-live\.example\.com\/">/);
            const sitemap = fs.readFileSync(path.join(built.siteDir, 'sitemap.xml'), 'utf8');
            assert.match(sitemap, /<loc>https:\/\/already-live\.example\.com\/<\/loc>/, 'sitemap must be rooted at the real published origin, not re-placeholdered');
        } finally {
            built.cleanup();
        }
    });

    // ── Server: full publish via isolated deploy, then F5/F6/prof-06/BE-06 over HTTP ─
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_URL = base;

    try {
        await check('F5: canonical + og:url are present and absolute on the live page', async () => {
            const seeded = seedLiveSiteConfig('f5', 'Canonical Cafe');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            assert.ok(site.status === 'live' || site.status === 'active', 'must be live: ' + site.status);

            const liveRes = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 200, 'live page must 200');
            const html = await liveRes.text();

            const canonicalMatch = /<link rel="canonical" href="([^"]*)">/i.exec(html);
            const ogUrlMatch = /<meta property="og:url" content="([^"]*)">/i.exec(html);
            assert.ok(canonicalMatch, 'canonical link must be present');
            assert.ok(ogUrlMatch, 'og:url meta must be present');
            assert.ok(/^https?:\/\//i.test(canonicalMatch[1]), 'canonical must be absolute, got ' + canonicalMatch[1]);
            assert.strictEqual(canonicalMatch[1], ogUrlMatch[1], 'canonical and og:url must match');
            assert.ok(
                canonicalMatch[1].startsWith(`${base}/live/${site.slug}/`),
                "must be rooted at this site's own live origin, got " + canonicalMatch[1]
            );
            assert.ok(!canonicalMatch[1].includes('pending-deploy'), 'placeholder origin must never leak to a live page');

            const ogImageMatch = /<meta property="og:image" content="([^"]*)">/i.exec(html);
            assert.ok(ogImageMatch, 'og:image meta must be present');
            assert.ok(/^https?:\/\//i.test(ogImageMatch[1]), 'og:image must be absolute, got ' + ogImageMatch[1]);
        });

        await check('prof-06: LocalBusiness JSON-LD is present, valid JSON, and reflects the business', async () => {
            const seeded = seedLiveSiteConfig('p6', 'JsonLd Bakery');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            assert.ok(site.status === 'live' || site.status === 'active');

            const liveRes = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            const html = await liveRes.text();
            const ldMatch = /<script type="application\/ld\+json">([^<]*)<\/script>/i.exec(html);
            assert.ok(ldMatch, 'ld+json script tag must be present');
            const ld = JSON.parse(ldMatch[1]); // must not throw — valid JSON
            assert.strictEqual(ld['@type'], 'LocalBusiness');
            assert.strictEqual(ld.name, 'JsonLd Bakery');
            assert.strictEqual(ld.telephone, '+40721234567');
            assert.ok(Array.isArray(ld.sameAs) && ld.sameAs.some((u) => u.includes('instagram.com')), 'sameAs must include Instagram');
        });

        await check('F6 (live): robots.txt and sitemap.xml are served 200 with correct content', async () => {
            const seeded = seedLiveSiteConfig('f6live', 'Sitemap Studio');
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            assert.ok(site.status === 'live' || site.status === 'active');

            const robotsRes = await fetch(`${base}/live/${site.slug}/robots.txt`);
            assert.strictEqual(robotsRes.status, 200, 'robots.txt must 200 on the live site');
            const robotsText = await robotsRes.text();
            assert.match(robotsText, /Allow:\s*\//);

            const sitemapRes = await fetch(`${base}/live/${site.slug}/sitemap.xml`);
            assert.strictEqual(sitemapRes.status, 200, 'sitemap.xml must 200 on the live site');
            const sitemapText = await sitemapRes.text();
            assert.match(sitemapText, /<urlset[^>]*sitemaps\.org/);
            // Single-page product-menu template → single sitemap entry, rooted at this site's own origin.
            const locMatch = /<loc>([^<]+)<\/loc>/.exec(sitemapText);
            assert.ok(locMatch, 'sitemap must have at least one <loc>');
            assert.ok(locMatch[1].startsWith(`${base}/live/${site.slug}/`), 'sitemap <loc> must be rooted at the live origin, got ' + locMatch[1]);
        });

        // ── BE-06: invoice.payment_failed is recorded and does not unpublish ──
        await check('BE-06: invoice.payment_failed is recorded in the ledger, site stays live, owner is notified in Romanian', async () => {
            const seeded = seedLiveSiteConfig('be06', 'Dunning Deli');
            await publishViaTrialWebhook(seeded);
            const before = registry.getSite(seeded.site.id);
            assert.ok(before.status === 'live' || before.status === 'active');

            const notified = [];
            const invoiceId = 'in_be06_' + crypto.randomUUID().slice(0, 8);
            const event = {
                id: 'evt_be06_' + crypto.randomUUID().slice(0, 10),
                type: 'invoice.payment_failed',
                data: {
                    object: {
                        id: invoiceId,
                        subscription: seeded.subscriptionId,
                        attempt_count: 1,
                    },
                },
            };
            const updated = await webpublish.handleStripeInvoicePaymentFailed(event, (text) => notified.push(text));
            assert.ok(updated, 'handler must resolve the site');
            assert.strictEqual(updated.id, seeded.site.id);
            assert.strictEqual(notified.length, 1, 'owner must be notified exactly once');
            assert.match(notified[0], /Plată eșuată/, 'notification must be in Romanian');
            assert.ok(/[ăâîșț]/i.test(notified[0]), 'notification must carry Romanian diacritics');

            // Durable record lives in the ledger AND, since the allowlist fix,
            // on the site record itself (asserted separately below).
            const ledgerEntries = ledger.read().filter((r) => r.event === 'payment_failed' && r.invoiceId === invoiceId);
            assert.strictEqual(ledgerEntries.length, 1, 'exactly one ledger entry for this invoice');
            assert.strictEqual(ledgerEntries[0].siteId, seeded.site.id);
            assert.strictEqual(ledgerEntries[0].attemptCount, 1);

            // Must not unpublish — past_due/dunning stays live by design.
            const liveRes = await fetch(`${base}/live/${before.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 200, 'invoice.payment_failed must NOT unpublish the site');

            // Idempotent: replaying the same event id must not double-notify or double-log.
            const again = await webpublish.handleStripeInvoicePaymentFailed(event, (text) => notified.push(text));
            assert.strictEqual(again.id, seeded.site.id);
            assert.strictEqual(notified.length, 1, 'duplicate event must not notify again');
            const ledgerAfterDup = ledger.read().filter((r) => r.event === 'payment_failed' && r.invoiceId === invoiceId);
            assert.strictEqual(ledgerAfterDup.length, 1, 'duplicate event must not append a second ledger entry');
        });

        await check('BE-06: an unknown subscription id is ignored, not thrown', async () => {
            const result = await webpublish.handleStripeInvoicePaymentFailed({
                id: 'evt_be06_unknown',
                type: 'invoice.payment_failed',
                data: { object: { id: 'in_unknown', subscription: 'sub_does_not_exist', attempt_count: 1 } },
            }, () => { throw new Error('must not notify for an unknown site'); });
            assert.strictEqual(result, null);
        });

        await check('BE-06: the dunning record persists on the site, not only in the ledger', async () => {
            const seeded = seedLiveSiteConfig('dun1', 'Dunning Persist');
            await publishViaTrialWebhook(seeded);
            const invoiceId = 'in_persist_' + crypto.randomUUID().slice(0, 8);
            await webpublish.handleStripeInvoicePaymentFailed({
                id: 'evt_persist_' + crypto.randomUUID().slice(0, 10),
                type: 'invoice.payment_failed',
                data: { object: { id: invoiceId, subscription: seeded.subscriptionId, attempt_count: 2 } },
            }, () => {});

            // Before the allowlist fix in bot/registry-shared.js, updateSite()
            // accepted this patch and dropped it, so both reads were undefined
            // and a failed invoice was invisible to /admin without scanning the
            // whole ledger.
            const after = registry.getSite(seeded.site.id);
            assert.ok(after.paymentFailedAt, 'paymentFailedAt must survive updateSite()');
            assert.strictEqual(after.paymentFailedCount, 2, 'attempt count must survive updateSite()');
        });

        await check('BE-06: a real webhook reaches the handler through onStripeEvent', async () => {
            const seeded = seedLiveSiteConfig('dun2', 'Dunning Dispatch');
            await publishViaTrialWebhook(seeded);
            const invoiceId = 'in_dispatch_' + crypto.randomUUID().slice(0, 8);

            // Exercises the dispatch path, not the handler directly: before the
            // wiring in bot/web.js, this event fell through to handleStripePaid
            // and nothing recorded the failure.
            await onStripeEvent({
                id: 'evt_dispatch_' + crypto.randomUUID().slice(0, 10),
                type: 'invoice.payment_failed',
                data: { object: { id: invoiceId, subscription: seeded.subscriptionId, attempt_count: 1 } },
            });

            const entries = ledger.read().filter((r) => r.event === 'payment_failed' && r.invoiceId === invoiceId);
            assert.strictEqual(entries.length, 1, 'onStripeEvent must route invoice.payment_failed');
            assert.strictEqual(entries[0].siteId, seeded.site.id);

            // Still live: dunning is not termination.
            const site = registry.getSite(seeded.site.id);
            assert.ok(site.status === 'live' || site.status === 'active', 'dunning must not unpublish');
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
    }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log(failed ? `\n${failed} FAILED` : '\nAll passed.');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
