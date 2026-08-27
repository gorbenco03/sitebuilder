'use strict';
/**
 * bot/test/trials.test.js — Paid republish + placeholder no-op (no trials module).
 *
 * S29: bot/trials.js removed; no sweepTrials import. Remaining coverage:
 * S27 deployPlaceholder no-op, paid reactivation / publishSite.
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
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

// ── Load real modules (no trials.js — S29) ────────────────────────────────
const registry   = require('../registry.js');
const webpublish = require('../webpublish.js');

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
 * Create a 'live' unpaid site with a minimal site dir so
 * deployPlaceholder / publishSite can operate without a real build.js.
 */
function createLiveSite(userId) {
    const site = registry.createSite({
        userId,
        templateId:      'product-menu',
        templateVersion: null,
        slug:            'test-site-' + crypto.randomUUID().slice(0, 8),
        platform:        'web',
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

    // ── 1. deployPlaceholder (direct) — documented no-op (S27) ────────────
    await check('deployPlaceholder: no-op (no deploy, status stays live)', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id);
        registry.updateSite(site.id, { status: 'live' });

        const fresh = registry.getSite(site.id);
        const beforeUrl = fresh.url;
        const siteDir = path.join(tmpDir, 'sites', fresh.projectName);
        const beforeHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');

        const result = await webpublish.deployPlaceholder(fresh);

        assert.ok(result == null || !result.url, 'no-op must not return a deploy url');
        const updated = registry.getSite(fresh.id);
        assert.strictEqual(updated.status, 'live', 'status must remain live (no expired placeholder)');
        assert.strictEqual(updated.url, beforeUrl, 'url must be unchanged');
        const afterHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
        assert.strictEqual(afterHtml, beforeHtml, 'must not overwrite index.html');
    });

    // ── 2. markOrderPaid on expired site → republish → live ───────────────
    await check('handleStripePaid on expired site → republish → status=live', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id);
        registry.updateSite(site.id, { status: 'expired', paid: false });
        registry.saveVersion(site.id, { business: { name: 'Test Afacere' } });

        const order = registry.createOrder({
            siteId:          site.id,
            userId:          user.id,
            amountCents: 9900,
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

    // ── 3. publishSite with siteDirAlreadyBuilt=true ───────────────────────
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
