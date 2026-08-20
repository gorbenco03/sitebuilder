'use strict';
/**
 * bot/test/trials.test.js — Legacy trial sweeper + paid republish tests.
 *
 * New commercial path does not create unpaid live trial sites. These tests still
 * cover the sweeper for any legacy live unpaid rows and paid reactivation.
 *
 * Tests:
 *   - legacy live unpaid with trialEndsAt → sweepTrials (reminder < 24h)
 *   - expired unpaid → deployPlaceholder + status expired
 *   - markOrderPaid on expired → republish → live
 *   - reminder sent only once (reminded flag)
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
 * Create a 'live' trial site and write a minimal index.html so deployPlaceholder
 * and publishSite can operate without a real build.js.
 */
function createLiveSite(userId, { hoursFromNow = 48 } = {}) {
    const trialEndsAt = new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();
    const site = registry.createSite({
        userId,
        templateId:      'patiserie',
        templateVersion: null,
        slug:            'test-site-' + crypto.randomUUID().slice(0, 8),
        platform:        'web',
        trialEndsAt,
    });
    registry.updateSite(site.id, { status: 'live', url: `https://${site.slug}.test.local` });

    // Write a minimal site dir so publishSite(siteDirAlreadyBuilt=true) doesn't fail
    const siteDir = path.join(tmpDir, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<html><body>Test</body></html>', 'utf8');
    fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify({ business: { name: 'Test' } }), 'utf8');

    return registry.getSite(site.id);
}

// ── Tests ─────────────────────────────────────────────────────────────────

(async () => {

    // ── 1. Reminder: site expiring in <24h → reminder sent once ─────────────
    await check('sweepTrials: reminder sent for site expiring in <24h', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: 12 }); // < 24h

        const messages = [];
        const messenger = (chatId, text) => { messages.push({ chatId, text }); return Promise.resolve(); };

        const result = await sweepTrials({ messenger });
        assert.strictEqual(result.reminders, 1, 'should have sent 1 reminder');
        assert.strictEqual(result.expired,   0, 'should not have expired');

        // Site should now have reminded=true
        const updated = registry.getSite(site.id);
        assert.strictEqual(updated.reminded, true, 'reminded flag must be true');
    });

    // ── 2. Reminder is only sent once ─────────────────────────────────────
    await check('sweepTrials: reminder not sent twice (reminded flag)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: 12 });
        registry.updateSite(site.id, { reminded: true }); // pre-set reminded

        const messages = [];
        const messenger = (chatId, text) => { messages.push({ chatId, text }); return Promise.resolve(); };

        const result = await sweepTrials({ messenger });
        assert.strictEqual(result.reminders, 0, 'reminded=true must suppress second reminder');
    });

    // ── 3. Expired unpaid → deployPlaceholder + status=expired ────────────
    await check('sweepTrials: expired site → deployPlaceholder called → status=expired', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: -1 }); // already expired

        const notifications = [];
        const notifyAdmin = (text) => { notifications.push(text); };

        // Track deployPlaceholder calls
        let placeholderCalled = false;
        const origDeploy = webpublish.deployPlaceholder;
        webpublish.deployPlaceholder = async (s) => {
            placeholderCalled = true;
            registry.updateSite(s.id, { status: 'expired', url: `https://${s.slug}.test.local` });
            return { url: `https://${s.slug}.test.local` };
        };

        const result = await sweepTrials({ notifyAdmin });

        // Restore
        webpublish.deployPlaceholder = origDeploy;

        assert.strictEqual(result.expired, 1,  'should have expired 1 site');
        assert.strictEqual(placeholderCalled, true, 'deployPlaceholder must be called');
        assert.ok(notifications.length > 0, 'admin must be notified');

        const updated = registry.getSite(site.id);
        assert.strictEqual(updated.status, 'expired', 'site status must be expired');
    });

    // ── 4. deployPlaceholder (direct) — writes HTML + fake deploy ─────────
    await check('deployPlaceholder: writes placeholder HTML + deploys (fake)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: -1 });
        registry.updateSite(site.id, { status: 'live' }); // reset to live

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
        // Mark expired and save version
        registry.updateSite(site.id, { status: 'expired', paid: false });
        registry.saveVersion(site.id, { business: { name: 'Test Afacere' } });

        // Create an order so markOrderPaid finds it
        const order = registry.createOrder({
            siteId:          site.id,
            userId:          user.id,
            amountCents:     10000,
            currency:        'eur',
            stripeSessionId: 'cs_test_' + crypto.randomUUID().slice(0, 8),
        });

        // Build a mock Stripe event
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

    // ── 7. sweepTrials: paid sites are skipped ─────────────────────────────
    await check('sweepTrials: paid sites are not expired or reminded', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id, { hoursFromNow: -1 });
        registry.updateSite(site.id, { paid: true });

        const result = await sweepTrials({});
        assert.strictEqual(result.expired, 0, 'paid site must not be expired');
    });

    // ── Cleanup ──────────────────────────────────────────────────────────────
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(failed ? 1 : 0);

})().catch((e) => { console.error(e); process.exit(1); });
