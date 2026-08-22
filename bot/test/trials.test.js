'use strict';
/**
 * bot/test/trials.test.js — Trial module contract + paid republish tests.
 *
 * S25: sweepTrials is a documented no-op (pay-before-publish; no unpaid live trial).
 * Paid reactivation and deployPlaceholder (direct) remain covered here.
 *
 * Tests:
 *   - sweepTrials never expires, reminds, or notifies (no-op counts)
 *   - sweepTrials never calls deployPlaceholder / sets reminded / status expired
 *   - markOrderPaid on expired → republish → live
 *   - deployPlaceholder (direct) still works for callers that need it
 *   - publishSite with siteDirAlreadyBuilt=true
 *
 * Uses HIDOOK_FAKE_DEPLOY=1 for offline operation.
 *
 * Run: node bot/test/trials.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Isolated environment ──────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trials-test-'));
process.env.DATA_DIR           = tmpDir;
process.env.HIDOOK_FAKE_DEPLOY = '1';
process.env.TRIAL_DAYS        = '3';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

// ── Load real modules ──────────────────────────────────────────────────────
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');
const { sweepTrials } = require('../trials.js');

// ── Test harness ────────────────────────────────────────────────────────────
let failed = false;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function createTestUser() {
    return registry.getOrCreateUserByEmail(`test-${crypto.randomUUID()}@example.com`);
}

/**
 * Create a 'live' unpaid site with trialEndsAt and a minimal site dir so
 * deployPlaceholder / publishSite can operate without a real build.js.
 */
function createLiveSite(userId, { hoursFromNow = 48 } = {}) {
    const trialEndsAt = new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();
    const site = registry.createSite({
        userId,
        templateId:      'product-menu',
        templateVersion: null,
        slug:            'test-site-' + crypto.randomUUID().slice(0, 8),
        platform:        'web',
        trialEndsAt,
    });
    registry.updateSite(site.id, { status: 'live', url: `https://${site.slug}.test.local` });

    const siteDir = path.join(tmpDir, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<html><body>Test</body></html>', 'utf8');
    fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify({ business: { name: 'Test' } }), 'utf8');

    return registry.getSite(site.id);
}

// ── Tests ─────────────────────────────────────────────────────────────────

(async () => {

    // ── 1. No-op: near-expiry unpaid live site is left alone ────────────────
    await check('sweepTrials: no-op for site expiring in <24h (no reminder)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: 12 });

        const messages = [];
        const adminMsgs = [];
        const messenger = (chatId, text) => { messages.push({ chatId, text }); return Promise.resolve(); };
        const notifyAdmin = (text) => { adminMsgs.push(text); };

        let placeholderCalled = false;
        const origDeploy = webpublish.deployPlaceholder;
        webpublish.deployPlaceholder = async (s) => {
            placeholderCalled = true;
            return origDeploy(s);
        };

        const result = await sweepTrials({ messenger, notifyAdmin });
        webpublish.deployPlaceholder = origDeploy;

        assert.deepStrictEqual(result, { reminders: 0, expired: 0 },
            'sweepTrials must return zero counts (no-op)');
        assert.strictEqual(placeholderCalled, false, 'must not call deployPlaceholder');
        assert.strictEqual(messages.length, 0, 'must not message owner');
        assert.strictEqual(adminMsgs.length, 0, 'must not notify admin');

        const updated = registry.getSite(site.id);
        assert.notStrictEqual(updated.reminded, true, 'must not set reminded');
        assert.strictEqual(updated.status, 'live', 'status must remain live');
    });

    // ── 2. No-op: already-expired unpaid live site is left alone ────────────
    await check('sweepTrials: no-op for expired unpaid live site (no expire/placeholder)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: -1 });

        const messages = [];
        const adminMsgs = [];
        const messenger = (chatId, text) => { messages.push({ chatId, text }); return Promise.resolve(); };
        const notifyAdmin = (text) => { adminMsgs.push(text); };

        let placeholderCalled = false;
        const origDeploy = webpublish.deployPlaceholder;
        webpublish.deployPlaceholder = async (s) => {
            placeholderCalled = true;
            registry.updateSite(s.id, { status: 'expired', url: `https://${s.slug}.test.local` });
            return { url: `https://${s.slug}.test.local` };
        };

        const result = await sweepTrials({ messenger, notifyAdmin });
        webpublish.deployPlaceholder = origDeploy;

        assert.deepStrictEqual(result, { reminders: 0, expired: 0 },
            'sweepTrials must return zero counts (no-op)');
        assert.strictEqual(placeholderCalled, false, 'deployPlaceholder must not be called');
        assert.strictEqual(messages.length, 0, 'must not message owner');
        assert.strictEqual(adminMsgs.length, 0, 'must not notify admin');

        const updated = registry.getSite(site.id);
        assert.strictEqual(updated.status, 'live', 'site status must stay live (sweeper no-op)');
        assert.notStrictEqual(updated.reminded, true, 'must not set reminded');
    });

    // ── 3. No-op: paid sites still yield zeros (harmless) ───────────────────
    await check('sweepTrials: paid sites yield zero counts', async () => {
        const user = createTestUser();
        createLiveSite(user.id, { hoursFromNow: -1 });
        // create another and mark paid
        const site = createLiveSite(user.id, { hoursFromNow: -1 });
        registry.updateSite(site.id, { paid: true });

        const result = await sweepTrials({});
        assert.deepStrictEqual(result, { reminders: 0, expired: 0 });
    });

    // ── 4. deployPlaceholder (direct) — writes HTML + fake deploy ─────────
    await check('deployPlaceholder: writes placeholder HTML + deploys (fake)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: -1 });
        registry.updateSite(site.id, { status: 'live' });

        const fresh = registry.getSite(site.id);
        const result = await webpublish.deployPlaceholder(fresh);

        assert.ok(result.url, 'deployPlaceholder must return a url');
        assert.ok(result.url.includes(fresh.projectName) || result.url.includes(fresh.slug),
            'url must reference the site');

        const updated = registry.getSite(fresh.id);
        assert.strictEqual(updated.status, 'expired', 'site status must be expired after placeholder');
    });

    // ── 5. markOrderPaid on expired site → republish → live ───────────────
    await check('handleStripePaid on expired site → republish → status=live', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: -1 });
        registry.updateSite(site.id, { status: 'expired', paid: false });
        registry.saveVersion(site.id, { business: { name: 'Test Afacere' } });

        const order = registry.createOrder({
            siteId:          site.id,
            userId:          user.id,
            amountCents:     10000,
            currency:        'eur',
            stripeSessionId: 'cs_test_' + crypto.randomUUID().slice(0, 8),
        });

        const event = {
            type: 'checkout.session.completed',
            data: {
                object: {
                    id:             order.stripeSessionId,
                    payment_status: 'paid',
                    metadata:       { siteId: site.id, platform: 'web', orderId: order.id },
                },
            },
        };

        await webpublish.handleStripePaid(event, { notifyAdmin: () => {} });

        const updated = registry.getSite(site.id);
        assert.strictEqual(updated.paid, true, 'site must be marked paid');
        assert.ok(updated.status === 'live' || updated.status === 'needs-retry',
            `unexpected status after reactivation: ${updated.status}`);
        if (updated.status === 'live') {
            assert.ok(updated.url, 'live site must have a url');
        }
    });

    // ── 6. publishSite with siteDirAlreadyBuilt=true ───────────────────────
    await check('publishSite(siteDirAlreadyBuilt=true) skips build and deploys (fake)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id);

        const freshSite = registry.getSite(site.id);
        const result = await webpublish.publishSite({
            site:   { ...freshSite, paid: false },
            config: {},
            images: [],
            siteDirAlreadyBuilt: true,
        });

        assert.ok(result.url, 'publishSite must return url');
        assert.ok(result.url.endsWith('.test.local') || result.url.includes(freshSite.projectName),
            'fake deploy url must reference the project');
    });

    // ── Cleanup ──────────────────────────────────────────────────────────────
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(failed ? 1 : 0);

})().catch((e) => { console.error(e); process.exit(1); });
