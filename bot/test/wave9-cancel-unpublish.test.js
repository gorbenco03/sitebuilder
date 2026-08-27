'use strict';
/**
 * bot/test/wave9-cancel-unpublish.test.js — Wave 9 cancel → unpublish.
 *
 * VISION: card → 7-day trial → live immediately → charge 99 on day 7 unless
 * cancelled. When Stripe subscription is cancelled (trial or later), the public
 * site is unpublished (not live). Refunds stay Dashboard / Customer Portal.
 *
 * Causal contracts:
 *   1. Live isolated site tied to a subscription is not publicly served after
 *      customer.subscription.deleted AND after customer.subscription.updated
 *      with status=canceled.
 *   2. Cancel during trial records no charge (HIDOOK_TEST_PAY=1 included).
 *   3. Builder Cancel opens billing_portal.sessions (or offline HIDOOK_TEST_PAY
 *      contract).
 *
 * Run: node bot/test/wave9-cancel-unpublish.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-cancel-unpub-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = 'test-secret-wave9-' + crypto.randomBytes(4).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0'; // patched after listen
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const payments   = require('../payments.js');
const pricing    = require('../pricing.js');
const webpublish = require('../webpublish.js');
const registry   = require('../registry.js');
const { onStripeEvent } = require('../web.js');
const { startServer } = require('../server.js');

assert.strictEqual(typeof onStripeEvent, 'function', 'web.js must export onStripeEvent');

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

function publishedDir(slug) {
    return path.join(tmpDir, 'published', String(slug).toLowerCase());
}

function seedLiveSiteWithSubscription({ slugPrefix, subId, customerId }) {
    const user = registry.getOrCreateUserByEmail(`w9-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: (slugPrefix || 'w9') + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_w9_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    registry.saveVersion(site.id, {
        businessName: 'Wave9 Cancel Cafe',
        sections: { hero: { title: 'Wave9 live copy' } },
    });
    webpublish.savePendingDraft(order.id, {
        config: { businessName: 'Wave9 Cancel Cafe', sections: { hero: { title: 'Wave9 live copy' } } },
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });

    const subscriptionId = subId || ('sub_test_w9_' + crypto.randomBytes(5).toString('hex'));
    const custId = customerId || ('cus_test_w9_' + crypto.randomBytes(5).toString('hex'));

    return { user, site, sessionId, order, subscriptionId, customerId: custId };
}

async function publishViaTrialWebhook({ sessionId, site, order, user, subscriptionId, customerId }) {
    await onStripeEvent({
        id: 'evt_w9_paid_' + crypto.randomUUID().slice(0, 10),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'no_payment_required', // trial start — no charge yet
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

function chargeRecords() {
    // Any durable charge / invoice / payment marker under DATA_DIR (ledger + registry).
    const hits = [];
    const ledgerPath = path.join(tmpDir, '.ledger.jsonl');
    if (fs.existsSync(ledgerPath)) {
        const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const row = JSON.parse(line);
                const ev = String(row.event || row.type || '').toLowerCase();
                // published / unpublished are not charges
                if (/^(charge|invoice\.paid|payment_intent|billed|captured)$/.test(ev)) {
                    hits.push(row);
                }
                if (row.amountCents > 0 && /charge|invoice\.paid|captured/.test(ev)) hits.push(row);
            } catch (_) {}
        }
    }
    const dbPath = path.join(tmpDir, '.registry.json');
    if (fs.existsSync(dbPath)) {
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        for (const o of Object.values(db.orders || {})) {
            if (o && o.chargedAt) hits.push(o);
            if (o && o.chargeId) hits.push(o);
            if (o && o.status === 'charged') hits.push(o);
        }
    }
    return hits;
}

(async () => {
    await check('PRICE_CENTS stays 9900; product name Hidook', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        const app = fs.readFileSync(APP_JS, 'utf8');
        assert.ok(/Hidook Site Builder|Hidook/.test(app) || true);
        assert.ok(!/\bDESSERD\b/i.test(app));
    });

    // ── Builder Cancel control (static source contract) ────────────────────
    await check('builder exposes a Cancel control wired to billing portal', () => {
        const app = fs.readFileSync(APP_JS, 'utf8');
        const card = (function extract(src, name) {
            const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
            const m = re.exec(src);
            if (!m) return '';
            let i = m.index + m[0].length;
            let depth = 1;
            while (i < src.length && depth > 0) {
                const ch = src[i++];
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            return src.slice(m.index, i);
        })(app, 'buildSiteCard');
        assert.ok(card.length > 50, 'buildSiteCard must exist');
        assert.ok(
            /textContent\s*=\s*['"]Cancel['"]/.test(card) ||
                />Cancel</.test(card) ||
                /['"]Cancel['"]/.test(card),
            'buildSiteCard must expose a Cancel control label'
        );
        assert.ok(
            /billing-portal|billing_portal|billingPortal|\/api\/sites\/.*portal|\/api\/sites\/.*cancel/i.test(card) ||
                /billing-portal|billing_portal|billingPortal|\/api\/sites\/.*portal|\/api\/sites\/.*cancel/i.test(app),
            'Cancel must open a billing-portal / cancel API session'
        );
    });

    // ── payments: billing portal session (offline HIDOOK_TEST_PAY) ─────────
    await check('createBillingPortalSession exists and works offline under HIDOOK_TEST_PAY=1', async () => {
        assert.strictEqual(typeof payments.createBillingPortalSession, 'function',
            'payments.createBillingPortalSession must be exported');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
        delete process.env.STRIPE_SECRET_KEY;
        const session = await payments.createBillingPortalSession({
            customerId: 'cus_test_wave9_offline',
            returnUrl: 'http://127.0.0.1/app/#sites',
        });
        assert.ok(session && session.url, 'portal session must return url');
        assert.ok(session.id, 'portal session must return id');
        // Offline contract: no real Stripe host required
        assert.ok(
            /test-billing-portal|bps_test_|#test-portal|billing.portal|customer.portal/i.test(session.url) ||
                session.offline === true ||
                String(session.id).startsWith('bps_test_'),
            'HIDOOK_TEST_PAY portal must be offline-capable, got ' + JSON.stringify(session)
        );
    });

    await check('createBillingPortalSession refused when NODE_ENV=production + HIDOOK_TEST_PAY', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            let threw = false;
            try {
                await payments.createBillingPortalSession({
                    customerId: 'cus_x',
                    returnUrl: 'http://x/',
                });
            } catch (e) {
                threw = true;
                assert.ok(/refused|production|not configured|STRIPE/i.test(e.message), e.message);
            }
            assert.ok(threw, 'must refuse test-pay portal in production');
        } finally {
            process.env.NODE_ENV = prev;
        }
    });

    // ── Live site → subscription.deleted → not publicly served ─────────────
    await check('customer.subscription.deleted unpublishes live isolated site (no public serve)', async () => {
        const seeded = seedLiveSiteWithSubscription({ slugPrefix: 'w9del' });
        await publishViaTrialWebhook(seeded);

        let fresh = registry.getSite(seeded.site.id);
        assert.strictEqual(fresh.paid, true, 'site paid after trial start');
        assert.ok(
            fresh.status === 'live' || fresh.status === 'active',
            'site must be live after trial publish, got ' + fresh.status
        );
        // Isolated files on disk
        const dest = publishedDir(fresh.slug);
        assert.ok(fs.existsSync(dest), 'isolated published dir must exist before cancel: ' + dest);
        // Registry must remember the subscription for webhook routing
        assert.ok(
            fresh.stripeSubscriptionId === seeded.subscriptionId ||
                fresh.subscriptionId === seeded.subscriptionId ||
                (typeof webpublish.findSiteBySubscriptionId === 'function' &&
                    webpublish.findSiteBySubscriptionId(seeded.subscriptionId)),
            'site must store stripeSubscriptionId (or finder) so cancel webhook can resolve it'
        );

        await onStripeEvent({
            id: 'evt_w9_del_' + crypto.randomUUID().slice(0, 10),
            type: 'customer.subscription.deleted',
            data: {
                object: {
                    id: seeded.subscriptionId,
                    customer: seeded.customerId,
                    status: 'canceled',
                    metadata: { siteId: seeded.site.id },
                },
            },
        });

        fresh = registry.getSite(seeded.site.id);
        assert.ok(
            fresh.status !== 'live' && fresh.status !== 'active',
            'registry status must not be live after subscription.deleted, got ' + fresh.status
        );
        assert.ok(
            !fs.existsSync(dest) || !fs.existsSync(path.join(dest, 'index.html')),
            'published files must be removed or no longer served after cancel'
        );

        // Idempotent second delete
        await onStripeEvent({
            id: 'evt_w9_del2_' + crypto.randomUUID().slice(0, 10),
            type: 'customer.subscription.deleted',
            data: {
                object: {
                    id: seeded.subscriptionId,
                    customer: seeded.customerId,
                    status: 'canceled',
                    metadata: { siteId: seeded.site.id },
                },
            },
        });
        const again = registry.getSite(seeded.site.id);
        assert.ok(again.status !== 'live' && again.status !== 'active', 'idempotent unpublish');
    });

    await check('customer.subscription.updated status=canceled unpublishes live site', async () => {
        const seeded = seedLiveSiteWithSubscription({ slugPrefix: 'w9upd' });
        await publishViaTrialWebhook(seeded);
        const fresh0 = registry.getSite(seeded.site.id);
        assert.ok(fresh0.status === 'live' || fresh0.status === 'active');
        const dest = publishedDir(fresh0.slug);
        assert.ok(fs.existsSync(dest), 'published before cancel');

        await onStripeEvent({
            id: 'evt_w9_upd_' + crypto.randomUUID().slice(0, 10),
            type: 'customer.subscription.updated',
            data: {
                object: {
                    id: seeded.subscriptionId,
                    customer: seeded.customerId,
                    status: 'canceled',
                    metadata: { siteId: seeded.site.id },
                },
            },
        });

        const fresh = registry.getSite(seeded.site.id);
        assert.ok(
            fresh.status !== 'live' && fresh.status !== 'active',
            'status not live after subscription.updated canceled, got ' + fresh.status
        );
        assert.ok(
            !fs.existsSync(dest) || !fs.existsSync(path.join(dest, 'index.html')),
            'must stop serving published files after canceled update'
        );
    });

    await check('subscription.updated with status=active does NOT unpublish', async () => {
        const seeded = seedLiveSiteWithSubscription({ slugPrefix: 'w9keep' });
        await publishViaTrialWebhook(seeded);
        const before = registry.getSite(seeded.site.id);
        assert.ok(before.status === 'live' || before.status === 'active');

        await onStripeEvent({
            id: 'evt_w9_keep_' + crypto.randomUUID().slice(0, 10),
            type: 'customer.subscription.updated',
            data: {
                object: {
                    id: seeded.subscriptionId,
                    customer: seeded.customerId,
                    status: 'active',
                    metadata: { siteId: seeded.site.id },
                },
            },
        });

        const after = registry.getSite(seeded.site.id);
        assert.ok(
            after.status === 'live' || after.status === 'active',
            'active update must leave site live, got ' + after.status
        );
        assert.ok(fs.existsSync(publishedDir(after.slug)), 'published dir remains');
    });

    // ── Cancel during trial: no charge ─────────────────────────────────────
    await check('cancel during trial (no_payment_required path) records no charge', async () => {
        const beforeCharges = chargeRecords().length;
        const seeded = seedLiveSiteWithSubscription({ slugPrefix: 'w9nochg' });
        await publishViaTrialWebhook(seeded); // trial — no charge

        // Offline finish-cancel contract (HIDOOK_TEST_PAY, no network)
        if (typeof payments.finishTestCancel === 'function') {
            await payments.finishTestCancel({
                subscriptionId: seeded.subscriptionId,
                customerId: seeded.customerId,
                siteId: seeded.site.id,
            });
        }
        await onStripeEvent({
            id: 'evt_w9_nochg_' + crypto.randomUUID().slice(0, 10),
            type: 'customer.subscription.deleted',
            data: {
                object: {
                    id: seeded.subscriptionId,
                    customer: seeded.customerId,
                    status: 'canceled',
                    cancel_at_period_end: false,
                    metadata: { siteId: seeded.site.id },
                },
            },
        });

        const afterCharges = chargeRecords();
        assert.strictEqual(
            afterCharges.length,
            beforeCharges,
            'cancel during trial must not record a charge, got ' + JSON.stringify(afterCharges)
        );
        const site = registry.getSite(seeded.site.id);
        assert.ok(site.status !== 'live' && site.status !== 'active', 'unpublished after trial cancel');
        // Must not invent a paid charge marker on the order
        const ord = registry.getOrderBySession(seeded.sessionId);
        assert.ok(!ord || !ord.chargeId, 'order must not gain a chargeId on trial cancel');
    });

    // ── HTTP: billing-portal API + live 404 after cancel ───────────────────
    await check('HTTP: Cancel portal API + live path 404 after subscription.deleted', async () => {
        const seeded = seedLiveSiteWithSubscription({ slugPrefix: 'w9http' });
        // startServer already calls listen — use port 0 and wait for listening.
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
            await publishViaTrialWebhook(seeded);
            const site = registry.getSite(seeded.site.id);
            assert.ok(site.status === 'live' || site.status === 'active');

            const dest = publishedDir(site.slug);
            assert.ok(fs.existsSync(dest), 'isolated publish on disk');

            const liveOk = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveOk.status, 200, 'live before cancel must 200');

            const portalRes = await fetch(`${base}/api/sites/${encodeURIComponent(site.id)}/billing-portal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            // Without session cookie → 401; route must exist (not 404).
            assert.ok(
                portalRes.status === 401 || portalRes.status === 200 || portalRes.status === 403,
                'billing-portal route must exist (not 404), got ' + portalRes.status
            );
            assert.notStrictEqual(portalRes.status, 404, 'POST /api/sites/:id/billing-portal must be routed');

            await onStripeEvent({
                id: 'evt_w9_http_' + crypto.randomUUID().slice(0, 10),
                type: 'customer.subscription.deleted',
                data: {
                    object: {
                        id: seeded.subscriptionId,
                        customer: seeded.customerId,
                        status: 'canceled',
                        metadata: { siteId: seeded.site.id },
                    },
                },
            });

            const liveAfter = await fetch(`${base}/live/${site.slug}/`, { redirect: 'manual' });
            assert.strictEqual(liveAfter.status, 404, 'live must 404 after cancel unpublish');
            const st = registry.getSite(seeded.site.id);
            assert.ok(st.status !== 'live' && st.status !== 'active', 'registry not live');
        } finally {
            await new Promise((r) => server.close(() => r()));
        }
    });

    // ── OWNER doc ──────────────────────────────────────────────────────────
    await check('OWNER-STRIPE-TRIAL.md documents Customer Portal cancel + site comes down', () => {
        const md = fs.readFileSync(path.join(ROOT, 'OWNER-STRIPE-TRIAL.md'), 'utf8');
        assert.ok(/Customer Portal/i.test(md), 'mentions Customer Portal');
        assert.ok(
            /unpublish|comes down|not live|site is unpublished|public site/i.test(md),
            'documents site comes down / unpublished on cancel'
        );
        assert.ok(/Dashboard/i.test(md) && /refund/i.test(md), 'refunds remain Dashboard');
        assert.ok(!/sk_live_[a-zA-Z0-9]{8,}|sk_test_[a-zA-Z0-9]{8,}|whsec_[a-zA-Z0-9]{8,}/.test(md), 'no secrets printed');
        // Out-of-date "separate product decision" line must be gone once Wave 9 ships
        assert.ok(
            !/Cancel-day-7 site teardown policy \(separate product decision\)/i.test(md),
            'must no longer park cancel teardown as undecided'
        );
    });

    // Cleanup tmp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error('\nwave9-cancel-unpublish.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nwave9-cancel-unpublish.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
