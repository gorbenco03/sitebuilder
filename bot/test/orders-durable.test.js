'use strict';
/**
 * bot/test/orders-durable.test.js — S5 durable orders / webhook idempotency /
 * edit-latest publish / yearly renewal.
 *
 * Invariants:
 *   1. Checkout attaches Stripe session to the existing pending order (no second createOrder).
 *   2. markOrderPaid / handleStripePaid: first paid vs already-paid (no re-publish on retry).
 *   3. First 100 payment sets site.paid + site.paidUntil (~now+12 months).
 *   4. Renewal (kind=renewal, 2900) extends paidUntil; no second 100 fee.
 *   5. After pay, publish uses newest of (pending draft vs last saveVersion) by time.
 *
 * Run: node bot/test/orders-durable.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-durable-'));
process.env.DATA_DIR           = tmpDir;
process.env.HIDOOK_FAKE_DEPLOY = '1';
process.env.SERVER_SECRET      = 'test-secret-orders-durable';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
const pricing    = require('../pricing.js');

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

function userSite() {
    const user = registry.getOrCreateUserByEmail(`od-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'od-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    return { user, site };
}

function stripeEvent(sessionId, metadata, eventId) {
    return {
        id: eventId || ('evt_' + crypto.randomUUID().slice(0, 12)),
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'paid',
                metadata: metadata || {},
            },
        },
    };
}

/** Count publishSite invocations while running fn. */
async function withPublishCounter(fn) {
    const orig = webpublish.publishSite;
    let count = 0;
    let lastArgs = null;
    webpublish.publishSite = async (args) => {
        count++;
        lastArgs = args;
        return orig.call(webpublish, args);
    };
    try {
        const out = await fn();
        return { count, lastArgs, out };
    } finally {
        webpublish.publishSite = orig;
    }
}

(async () => {
    // ── Source contract: no second createOrder for checkout attach ─────────
    await check('server checkout attaches session (no second createOrder for same attempt)', () => {
        const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        assert.ok(
            /attachStripeSession\s*\(/.test(serverSrc),
            'server.js must call attachStripeSession after Stripe checkout creation'
        );
        // Two createOrder calls in a row with stripeSessionId: checkout.id is the bug pattern
        const doubleCreate = /createOrder\s*\(\s*\{[^}]*stripeSessionId:\s*['"]pending['"][\s\S]{0,800}?createOrder\s*\(\s*\{[^}]*stripeSessionId:\s*checkout\.id/;
        assert.ok(
            !doubleCreate.test(serverSrc),
            'server.js must not createOrder twice (pending then checkout.id) for one checkout attempt'
        );
    });

    await check('registry.attachStripeSession updates pending order in place', () => {
        assert.strictEqual(typeof registry.attachStripeSession, 'function', 'attachStripeSession must exist');
        const { user, site } = userSite();
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: 'pending',
        });
        const sessionId = 'cs_attach_' + crypto.randomUUID().slice(0, 8);
        const updated = registry.attachStripeSession(order.id, sessionId);
        assert.ok(updated, 'attach must return order');
        assert.strictEqual(updated.id, order.id, 'same order id');
        assert.strictEqual(updated.stripeSessionId, sessionId);
        assert.strictEqual(updated.status, 'pending');

        const bySession = registry.getOrderBySession(sessionId);
        assert.ok(bySession, 'findable by real session id');
        assert.strictEqual(bySession.id, order.id);

        // No orphan second row for same attach
        const dbPath = path.join(tmpDir, '.registry.json');
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const rows = Object.values(db.orders || {}).filter(
            (o) => o.siteId === site.id && o.userId === user.id
        );
        assert.strictEqual(rows.length, 1, 'exactly one order row after attach');
    });

    // ── markOrderPaid: first paid vs already paid ──────────────────────────
    await check('markOrderPaid returns order only on first transition to paid', () => {
        const { user, site } = userSite();
        const sessionId = 'cs_paid_' + crypto.randomUUID().slice(0, 8);
        registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
        });
        const first = registry.markOrderPaid(sessionId);
        assert.ok(first, 'first mark returns order');
        assert.strictEqual(first.status, 'paid');
        assert.ok(first.paidAt);

        const second = registry.markOrderPaid(sessionId);
        assert.strictEqual(
            second,
            null,
            'already-paid must return null so handleStripePaid does not re-enter publish'
        );
    });

    // ── handleStripePaid idempotency (session + event) ─────────────────────
    await check('handleStripePaid is idempotent: second delivery does not re-publish', async () => {
        const { user, site } = userSite();
        const sessionId = 'cs_idem_' + crypto.randomUUID().slice(0, 8);
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
            kind: 'publish',
        });
        registry.saveVersion(site.id, { business: { name: 'Idem Biz' } });
        webpublish.savePendingDraft(order.id, {
            config: { business: { name: 'Idem Biz' } },
            images: [],
            siteId: site.id,
            savedAt: new Date().toISOString(),
        });

        const event = stripeEvent(sessionId, {
            platform: 'web',
            siteId: site.id,
            orderId: order.id,
            kind: 'publish',
        }, 'evt_idem_1');

        const { count: c1 } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
        });
        assert.ok(c1 >= 1, 'first delivery should publish at least once');

        const afterFirst = registry.getSite(site.id);
        assert.strictEqual(afterFirst.paid, true);
        assert.ok(afterFirst.paidUntil, 'paidUntil set on first payment');

        const { count: c2 } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });
            // Same session, new event id (Stripe retry shape)
            await webpublish.handleStripePaid(
                stripeEvent(sessionId, event.data.object.metadata, 'evt_idem_2'),
                { notifyAdmin: () => {} }
            );
        });
        assert.strictEqual(c2, 0, 'retries must not call publishSite again');

        const afterRetry = registry.getSite(site.id);
        assert.strictEqual(afterRetry.paidUntil, afterFirst.paidUntil, 'retries must not stack hosting years');
    });

    // ── First payment paidUntil ~ +12 months ───────────────────────────────
    await check('first successful publish payment sets paidUntil ≈ now+12 months', async () => {
        const { user, site } = userSite();
        const sessionId = 'cs_until_' + crypto.randomUUID().slice(0, 8);
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'usd',
            stripeSessionId: sessionId,
            kind: 'publish',
        });
        registry.saveVersion(site.id, { business: { name: 'Until Co' } });
        webpublish.savePendingDraft(order.id, {
            config: { business: { name: 'Until Co' } },
            images: [],
            siteId: site.id,
            savedAt: new Date().toISOString(),
        });

        const before = Date.now();
        await webpublish.handleStripePaid(
            stripeEvent(sessionId, {
                platform: 'web',
                siteId: site.id,
                orderId: order.id,
                kind: 'publish',
            }),
            { notifyAdmin: () => {} }
        );
        const after = Date.now();
        const s = registry.getSite(site.id);
        assert.strictEqual(s.paid, true);
        assert.ok(s.paidUntil, 'paidUntil required');
        const until = Date.parse(s.paidUntil);
        assert.ok(Number.isFinite(until), 'paidUntil must be ISO date');
        const min = before + 360 * 24 * 3600 * 1000; // allow ~5 day slack under 365
        const max = after + 370 * 24 * 3600 * 1000;
        assert.ok(until >= min && until <= max, `paidUntil out of range: ${s.paidUntil}`);
    });

    // ── Renewal ────────────────────────────────────────────────────────────
    await check('renewal checkout contract: kind renewal + RENEWAL_CENTS; extends paidUntil', async () => {
        const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        assert.ok(
            /['"]renewal['"]/.test(serverSrc),
            'server.js must support renewal order kind in checkout metadata or createOrder'
        );
        assert.ok(
            /renewalCents|RENEWAL_CENTS/.test(serverSrc),
            'server.js renewal path must use pricing renewal amount'
        );

        const { user, site } = userSite();
        const baseUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        registry.updateSite(site.id, { paid: true, paidUntil: baseUntil, status: 'live', url: 'https://x.test' });

        const sessionId = 'cs_ren_' + crypto.randomUUID().slice(0, 8);
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.RENEWAL_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
            kind: 'renewal',
        });
        assert.strictEqual(order.kind, 'renewal');
        assert.strictEqual(order.amountCents, pricing.RENEWAL_CENTS);

        const { count } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(
                stripeEvent(sessionId, {
                    platform: 'web',
                    siteId: site.id,
                    orderId: order.id,
                    kind: 'renewal',
                }),
                { notifyAdmin: () => {} }
            );
        });

        const s = registry.getSite(site.id);
        assert.strictEqual(s.paid, true);
        const extended = Date.parse(s.paidUntil);
        const base = Date.parse(baseUntil);
        // +12 months from previous paidUntil (not from now, when still in window)
        const min = base + 360 * 24 * 3600 * 1000;
        const max = base + 370 * 24 * 3600 * 1000;
        assert.ok(extended >= min && extended <= max, `renewal paidUntil ${s.paidUntil} vs base ${baseUntil}`);

        // Renewal must not force a full first-publish deploy when already live with no draft
        // (0 or 1 ok if reactivate path; must not require amount 100)
        assert.ok(count <= 1, 'renewal should not spam publishes');
        const paidOrder = registry.getOrderBySession(sessionId);
        assert.strictEqual(paidOrder.status, 'paid');
        assert.strictEqual(paidOrder.amountCents, pricing.RENEWAL_CENTS);
    });

    await check('paid site is not blocked from renewal (checkout no longer hard-409 on paid)', () => {
        const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        // Old bug: if (site.paid) return 409 ... deja plătit — blocks renewal
        const hardBlock = /if\s*\(\s*site\.paid\s*\)\s*return\s+sendJson\(\s*res\s*,\s*409/;
        assert.ok(
            !hardBlock.test(serverSrc),
            'handleSiteCheckout must not 409 all paid sites (renewal needs checkout)'
        );
    });

    // ── Edit-latest: newer version beats stale pending draft ───────────────
    await check('handleStripePaid publishes latest version when newer than pending draft', async () => {
        const { user, site } = userSite();
        const sessionId = 'cs_latest_' + crypto.randomUUID().slice(0, 8);
        const order = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: sessionId,
            kind: 'publish',
        });

        const oldIso = new Date(Date.now() - 60_000).toISOString();
        webpublish.savePendingDraft(order.id, {
            config: { business: { name: 'STALE_DRAFT' } },
            images: [],
            siteId: site.id,
            savedAt: oldIso,
        });
        // Touch file mtime to old if implementation uses fs times
        const draftFile = path.join(tmpDir, `_pending-${order.id}.json`);
        const oldMs = Date.now() - 60_000;
        try { fs.utimesSync(draftFile, new Date(oldMs), new Date(oldMs)); } catch (_) {}

        // Newer saved version (after draft)
        registry.saveVersion(site.id, { business: { name: 'LATEST_VERSION' } });

        const { lastArgs } = await withPublishCounter(async () => {
            await webpublish.handleStripePaid(
                stripeEvent(sessionId, {
                    platform: 'web',
                    siteId: site.id,
                    orderId: order.id,
                    kind: 'publish',
                }),
                { notifyAdmin: () => {} }
            );
        });

        assert.ok(lastArgs && lastArgs.config, 'publishSite must be called with config');
        const name = lastArgs.config.business && lastArgs.config.business.name;
        assert.strictEqual(
            name,
            'LATEST_VERSION',
            'must publish latest saveVersion, not stale pending draft'
        );
    });

    // ── createOrder accepts kind ───────────────────────────────────────────
    await check('createOrder stores kind (publish default / renewal)', () => {
        const { user, site } = userSite();
        const a = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.PRICE_CENTS,
            currency: 'eur',
            stripeSessionId: 'cs_k1_' + crypto.randomUUID().slice(0, 6),
        });
        assert.ok(a.kind === 'publish' || a.kind == null || a.kind === 'publish',
            'default kind should be publish (or explicit)');
        const b = registry.createOrder({
            siteId: site.id,
            userId: user.id,
            amountCents: pricing.RENEWAL_CENTS,
            currency: 'eur',
            stripeSessionId: 'cs_k2_' + crypto.randomUUID().slice(0, 6),
            kind: 'renewal',
        });
        assert.strictEqual(b.kind, 'renewal');
    });

    console.log(failed ? `\n${failed} failed` : '\nall passed');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
