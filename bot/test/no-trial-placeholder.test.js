'use strict';
/**
 * bot/test/no-trial-placeholder.test.js — S27: no expired-trial placeholder deploy.
 *
 * Pay-before-publish: deployPlaceholder must not write HTML, deploy, create
 * checkout, set status expired, or persist reactivateSessionId. /sterge must
 * not replace live URLs with a trial-expired page.
 *
 * Run: node bot/test/no-trial-placeholder.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-trial-placeholder-'));
process.env.DATA_DIR = tmpDir;
process.env.HIDOOK_FAKE_DEPLOY = '1';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const registry = require('../registry.js');
const webpublish = require('../webpublish.js');

const webpublishPath = path.join(__dirname, '..', 'webpublish.js');
const flowPath = path.join(__dirname, '..', 'flow.js');
const webpublishSrc = fs.readFileSync(webpublishPath, 'utf8');
const flowSrc = fs.readFileSync(flowPath, 'utf8');

let failed = false;
function check(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.then(
                () => console.log('PASS', name),
                (e) => {
                    failed = true;
                    console.error('FAIL', name, '-', e.message);
                }
            );
        }
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

function createTestUser() {
    return registry.getOrCreateUserByEmail(`s27-${crypto.randomUUID()}@example.com`);
}

function createLiveSite(userId) {
    const site = registry.createSite({
        userId,
        templateId: 'product-menu',
        templateVersion: null,
        slug: 's27-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    registry.updateSite(site.id, { status: 'live', url: `https://${site.slug}.test.local` });
    const siteDir = path.join(tmpDir, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<html><body>Live content</body></html>', 'utf8');
    fs.writeFileSync(
        path.join(siteDir, 'config.json'),
        JSON.stringify({ business: { name: 'S27 Biz' } }),
        'utf8'
    );
    return registry.getSite(site.id);
}

// ── Source invariants ──────────────────────────────────────────────────────

check('webpublish.js must not embed trial-expired customer title copy', () => {
    assert.ok(
        !/Perioad[ăa]\s+de\s+prob[ăa]\s+expirat[ăa]/i.test(webpublishSrc),
        'must not contain "Perioadă de probă expirată"'
    );
});

check('webpublish.js must not embed "Perioada de acces a expirat" copy', () => {
    assert.ok(
        !/Perioada\s+de\s+acces\s+a\s+expirat/i.test(webpublishSrc),
        'must not contain "Perioada de acces a expirat"'
    );
});

check('flow.js /sterge must not call deployPlaceholder', () => {
    // handleSterge body must not invoke webpublish.deployPlaceholder
    const start = flowSrc.indexOf('async function handleSterge');
    assert.ok(start >= 0, 'handleSterge not found');
    const nextFn = flowSrc.indexOf('\nasync function ', start + 1);
    const body = flowSrc.slice(start, nextFn > 0 ? nextFn : undefined);
    assert.ok(
        !/\.deployPlaceholder\s*\(/.test(body),
        'handleSterge must not call deployPlaceholder'
    );
});

// ── Runtime: deployPlaceholder is a no-op ──────────────────────────────────

(async () => {
    await check('deployPlaceholder does not mutate disk, registry, or deploy', async () => {
        const user = createTestUser();
        const site = createLiveSite(user.id);
        const siteDir = path.join(tmpDir, 'sites', site.projectName);
        const beforeHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
        const before = registry.getSite(site.id);
        const beforeStatus = before.status;
        const beforeUrl = before.url;
        const beforeReact = before.reactivateSessionId;

        const result = await webpublish.deployPlaceholder(site);

        // No deploy URL / no success payload that implies a live placeholder
        if (result != null && typeof result === 'object') {
            assert.ok(
                !result.url,
                'no-op deployPlaceholder must not return a deploy url'
            );
        }

        const afterHtml = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
        assert.strictEqual(afterHtml, beforeHtml, 'must not overwrite site index.html');
        assert.ok(
            !/Perioad[ăa]\s+de\s+prob|Perioada\s+de\s+acces/i.test(afterHtml),
            'site HTML must not become trial-expired placeholder'
        );

        const after = registry.getSite(site.id);
        assert.strictEqual(after.status, beforeStatus, 'status must be unchanged');
        assert.notStrictEqual(after.status, 'expired', 'must not set status expired');
        assert.strictEqual(after.url, beforeUrl, 'url must be unchanged');
        assert.strictEqual(
            after.reactivateSessionId,
            beforeReact,
            'must not persist reactivateSessionId'
        );
        assert.ok(
            !Object.prototype.hasOwnProperty.call(after, 'reactivateSessionId') ||
                after.reactivateSessionId === beforeReact,
            'reactivateSessionId must not be newly set'
        );
    });

    await check('deployPlaceholder must not create checkout or call payments', async () => {
        // Even if Stripe were configured, no-op must not touch payments.
        // Structural: deployPlaceholder body must not call createCheckout / updateSite expired.
        const start = webpublishSrc.indexOf('async function deployPlaceholder');
        assert.ok(start >= 0, 'deployPlaceholder must still be defined (exported no-op)');
        const nextFn = webpublishSrc.indexOf('\nasync function ', start + 1);
        const nextSync = webpublishSrc.indexOf('\nfunction ', start + 1);
        let end = webpublishSrc.length;
        if (nextFn > 0) end = Math.min(end, nextFn);
        if (nextSync > 0) end = Math.min(end, nextSync);
        const body = webpublishSrc.slice(start, end);

        assert.ok(!/createCheckout/.test(body), 'deployPlaceholder must not createCheckout');
        assert.ok(
            !/status:\s*['"]expired['"]/.test(body),
            'deployPlaceholder must not set status expired'
        );
        assert.ok(
            !/reactivateSessionId/.test(body),
            'deployPlaceholder must not persist reactivateSessionId'
        );
        assert.ok(
            !/writeFileSync|writeFile\b/.test(body),
            'deployPlaceholder must not write files'
        );
        assert.ok(
            !/\b_deploy\s*\(/.test(body),
            'deployPlaceholder must not call _deploy'
        );
        assert.ok(
            !/Perioad[ăa]\s+de\s+prob|Perioada\s+de\s+acces/i.test(body),
            'deployPlaceholder body must not embed trial-expired HTML copy'
        );
    });

    if (failed) {
        console.error('\nno-trial-placeholder: FAILED');
        process.exit(1);
    }
    console.log('\nno-trial-placeholder: OK');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
