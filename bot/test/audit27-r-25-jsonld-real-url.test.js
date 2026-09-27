'use strict';
/**
 * bot/test/audit27-r-25-jsonld-real-url.test.js — oracle for R-25
 * (PLAN-AUDIT-2026-09-27.md, finding tpl-portfolio-pro-desserd#1 / TPL-01).
 *
 * templates/portfolio/presets.json and templates/local-service/presets.json
 * shipped a hardcoded, never-resolving "https://<slug>.example" domain baked
 * into seo.jsonLd (both templates) and seo.canonical (local-service only).
 * bot/webpublish.js only fills seo.canonical/seo.jsonLd when they are ABSENT
 * (`if (!cfgCopy.seo.canonical …)` / `if (!cfgCopy.seo.jsonLd …)`), so a
 * preset that already carries a value — even a fake one — is never
 * corrected. Every visitor of a published site made from these presets
 * (without further edits) got a real <link rel="canonical"> and/or
 * JSON-LD "url" pointing at a domain that will never resolve
 * (.example is IANA-reserved for documentation, RFC 2606).
 *
 * Fix (this task's owned files only — the two templates' presets.json; the
 * publish pipeline in bot/webpublish.js is out of scope per task
 * instructions, see openIssues in the task report): the fake .example
 * value is removed from the presets entirely rather than replaced, so the
 * existing "fill when absent" guards in webpublish.js do their job:
 *   - local-service's canonical is now correctly derived at publish time.
 *   - jsonLd's url key is omitted (buildLocalBusinessJsonLd never sets a
 *     url field either), which matches the owner's instruction that the
 *     field be "the real published address, or omitted when unknown".
 *
 * This must fail against the presets as committed before this task (fake
 * .example values present) and pass after the fix.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-25-jsonld-real-url.test.js
 */

const assert  = require('assert');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');
const test    = require('node:test');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r25-jsonld-test-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'r25-test-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BRAND_DOMAIN;
delete process.env.DEPLOY_PROVIDER;

const pricing    = require('../pricing.js');
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
const { onStripeEvent } = require('../web.js');
const { startServer }   = require('../server.js');

const REPO_ROOT = path.join(__dirname, '..', '..');

// ── Part 1: the presets themselves must never ship the placeholder domain ──
test('R-25: templates/portfolio and templates/local-service presets carry no .example URL', () => {
    for (const tpl of ['portfolio', 'local-service']) {
        const presetsPath = path.join(REPO_ROOT, 'templates', tpl, 'presets.json');
        const raw = fs.readFileSync(presetsPath, 'utf8');
        assert.ok(
            !raw.includes('.example'),
            `templates/${tpl}/presets.json must not ship a fake ".example" domain (IANA-reserved, never resolves), found in: ${presetsPath}`
        );
        // Must still be valid JSON with parseable seo.jsonLd strings — the
        // fix must not have corrupted the escaped JSON-LD strings.
        const data = JSON.parse(raw);
        for (const preset of data.presets) {
            const seo = preset.config && preset.config.seo;
            if (seo && seo.jsonLd) {
                const ld = JSON.parse(seo.jsonLd); // throws if malformed
                assert.ok(!('url' in ld) || !String(ld.url).includes('.example'), 'jsonLd.url must not be a fake .example domain');
            }
            if (seo && seo.canonical) {
                assert.ok(!String(seo.canonical).includes('.example'), 'seo.canonical must not be a fake .example domain');
            }
        }
    }
});

// ── Part 2: publishing the real, unedited preset must not leak the fake
//    domain onto the live page (canonical link or JSON-LD) ──
test('R-25: publishing the unedited portfolio/local-service presets never ships a .example URL on the live page', async (t) => {
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_URL = base;

    t.after(async () => {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    });

    for (const templateId of ['portfolio', 'local-service']) {
        await t.test(`template: ${templateId}`, async () => {
            const presetsPath = path.join(REPO_ROOT, 'templates', templateId, 'presets.json');
            const { presets } = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
            const config = JSON.parse(JSON.stringify(presets[0].config)); // real, unedited shipped preset

            const user = registry.getOrCreateUserByEmail(`r25-${crypto.randomUUID()}@ex.com`);
            const site = registry.createSite({
                userId: user.id,
                templateId,
                templateVersion: 1,
                slug: 'r25-' + templateId + '-' + crypto.randomUUID().slice(0, 8),
                platform: 'web',
            });
            const sessionId = 'cs_test_r25_' + crypto.randomBytes(6).toString('hex');
            const order = registry.createOrder({
                siteId: site.id,
                userId: user.id,
                amountCents: pricing.PRICE_CENTS,
                currency: 'eur',
                stripeSessionId: sessionId,
                kind: 'publish',
            });
            registry.saveVersion(site.id, config);
            webpublish.savePendingDraft(order.id, {
                config,
                images: [],
                siteId: site.id,
                savedAt: new Date().toISOString(),
            });
            const subscriptionId = 'sub_test_r25_' + crypto.randomBytes(5).toString('hex');
            const customerId = 'cus_test_r25_' + crypto.randomBytes(5).toString('hex');

            await onStripeEvent({
                id: 'evt_r25_paid_' + crypto.randomUUID().slice(0, 10),
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

            const liveSite = registry.getSite(site.id);
            assert.ok(liveSite.status === 'live' || liveSite.status === 'active', 'site must publish: ' + liveSite.status);

            const liveRes = await fetch(`${base}/live/${liveSite.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveRes.status, 200, 'live page must 200');
            const html = await liveRes.text();

            assert.ok(!html.includes('.example'), `live page for ${templateId} must never ship a .example URL`);

            const canonicalMatch = /<link rel="canonical" href="([^"]*)">/i.exec(html);
            if (canonicalMatch) {
                assert.ok(
                    canonicalMatch[1].startsWith(`${base}/live/${liveSite.slug}/`),
                    `canonical must be rooted at this site's own real live origin, got ${canonicalMatch[1]}`
                );
            }

            const ldMatch = /<script type="application\/ld\+json">([^<]*)<\/script>/i.exec(html);
            if (ldMatch) {
                const ld = JSON.parse(ldMatch[1]); // must not throw
                if ('url' in ld) {
                    assert.ok(
                        String(ld.url).startsWith(`${base}/live/${liveSite.slug}/`),
                        `jsonLd.url, if present, must be the real published address, got ${ld.url}`
                    );
                }
            }
        });
    }
});
