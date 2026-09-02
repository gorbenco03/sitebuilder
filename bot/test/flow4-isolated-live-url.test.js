'use strict';
/**
 * bot/test/flow4-isolated-live-url.test.js — Flow 4 remake R2 oracle (chrome leaks).
 *
 * Parent e32ea2a already ships isolated /live without PUBLIC_URL, but the opened
 * product still lies after a valid test card:
 *   - showSuccessScreen treats only http… as live → relative /live/<slug>/ shows
 *     «Adaugă un card ca să fii live» while cabinet is Activ
 *   - billing-portal returnUrl falls back to http://127.0.0.1/app/ (no port)
 *   - builder legal HTML still ships English «studio shipping placeholder»
 *
 * Contracts (R1 held + R2 chrome):
 *   1. Isolated deploy without PUBLIC_URL returns fetchable /live/<slug>/
 *   2. Valid test-card trial → status live/active (cabinet Activ + Anulează)
 *   3. Cancel during trial unpublishes; /live not public; no first-charge invention
 *   4. Republish without PUBLIC_URL must not surface PUBLIC_URL factory error
 *   5. Live chrome accepts relative /live/<slug>/ as live (no pay-again CTA)
 *   6. Billing-portal return/portal URL on isolated loopback includes listening port
 *   7. Legal HTML has no «studio shipping placeholder»
 *   8. No HIDOOK_FAKE_DEPLOY. Pricing unchanged 99/29. Production refusal intact.
 *
 * Causal RED on base e32ea2a… ; GREEN on HEAD after fix.
 * Run: node bot/test/flow4-isolated-live-url.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = 'e32ea2a52af4fe43363c09538de82a6243bea2ad';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow4-isolated-live-url-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'flow4-iso-live-' + crypto.randomBytes(6).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
// Critical: no PUBLIC_URL — this is the bug surface
delete process.env.PUBLIC_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.BRAND_DOMAIN;

const payments = require('../payments.js');
const pricing = require('../pricing.js');
const webpublish = require('../webpublish.js');
const registry = require('../registry.js');
const auth = require('../auth.js');
const { onStripeEvent } = require('../web.js');
const { startServer, requestPublicOrigin } = require('../server.js');

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

function baseBlob(rel) {
    try {
        return execFileSync('git', ['-C', ROOT, 'show', BASE_SHA + ':' + rel], {
            encoding: 'utf8',
            maxBuffer: 8 * 1024 * 1024,
        });
    } catch {
        return null;
    }
}

function headRead(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function publishedDir(slug) {
    return path.join(tmpDir, 'published', String(slug).toLowerCase());
}

function loadPreset() {
    const raw = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8')
    );
    const cfg = JSON.parse(JSON.stringify(raw.presets[0].config));
    cfg.business = cfg.business || {};
    cfg.business.name = 'IsoLive Cafe ' + crypto.randomBytes(2).toString('hex');
    cfg.business.title = cfg.business.name;
    return cfg;
}

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar)
            .map(([k, v]) => k + '=' + v)
            .join('; ');
        if (cookieStr) headers.Cookie = cookieStr;
        const res = await fetch(base + urlPath, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : res.headers.get('set-cookie')
              ? [res.headers.get('set-cookie')]
              : [];
        for (const sc of setCookie) {
            if (!sc) continue;
            const first = sc.split(';')[0];
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            const k = first.slice(0, eq).trim();
            const v = first.slice(eq + 1).trim();
            if (k) jar[k] = v;
        }
        return res;
    }
    doFetch.jar = jar;
    return doFetch;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForStatus(base, urlPath, wantStatus, { timeoutMs = 15000, intervalMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
        const res = await fetch(base + urlPath, { redirect: 'manual' });
        last = res.status;
        if (res.status === wantStatus) return res;
        await sleep(intervalMs);
    }
    throw new Error('timeout waiting for ' + urlPath + ' → ' + wantStatus + ' (last ' + last + ')');
}

(async () => {
    // ── Causal RED on required parent (chrome leaks after isolated live URL) ─
    await check('causal RED: parent ' + BASE_SHA.slice(0, 7) + ' success chrome only accepts http live URL', () => {
        const app = baseBlob('builder/app.js') || '';
        assert.ok(app.length > 100, 'base app.js readable');
        // Parent showSuccessScreen: isLive = url.indexOf('http') === 0
        assert.ok(
            /indexOf\(['\"]http['\"]\)\s*===\s*0/.test(app) ||
                /String\(url\)\.indexOf\(['\"]http['\"]\)\s*===\s*0/.test(app),
            'parent must still gate live chrome on indexOf(http)===0'
        );
        assert.ok(
            !/function\s+isLiveSiteUrl\s*\(/.test(app),
            'parent must not yet have isLiveSiteUrl helper'
        );
    });

    await check('causal RED: parent billing portal falls back to host-only 127.0.0.1 without port', () => {
        const src = baseBlob('bot/server.js') || '';
        assert.ok(src.length > 100, 'base server.js readable');
        assert.ok(
            /http:\/\/127\.0\.0\.1\/app\/#sites/.test(src),
            'parent must hardcode http://127.0.0.1/app/#sites fallback'
        );
        assert.ok(
            !/function\s+requestPublicOrigin\s*\(/.test(src),
            'parent must not yet have requestPublicOrigin'
        );
    });

    await check('causal RED: parent legal HTML still has studio shipping placeholder', () => {
        const terms = baseBlob('builder/terms.html') || '';
        const privacy = baseBlob('builder/privacy.html') || '';
        const cookies = baseBlob('builder/cookies.html') || '';
        const blob = terms + '\n' + privacy + '\n' + cookies;
        assert.ok(
            /studio shipping placeholder/i.test(blob),
            'parent legal pages must still contain studio shipping placeholder'
        );
        assert.ok(
            /not legal advice/i.test(blob),
            'parent legal pages must still contain not legal advice'
        );
    });

    await check('HEAD: live chrome accepts relative /live/<slug>/ as live', () => {
        const app = headRead('builder/app.js');
        assert.ok(/function\s+isLiveSiteUrl\s*\(/.test(app), 'isLiveSiteUrl helper present');
        assert.ok(
            /isLiveSiteUrl\s*\(\s*url\s*\)/.test(app) || /const isLive = isLiveSiteUrl\(url\)/.test(app),
            'showSuccessScreen uses isLiveSiteUrl'
        );
        // Must treat /live/… as live
        assert.ok(
            /\/live\//.test(app) && /isLiveSiteUrl/.test(app),
            'isLiveSiteUrl must recognize /live/'
        );
        // Must not keep the old http-only gate as the sole live check in showSuccessScreen
        const showSrc = (app.match(/function\s+showSuccessScreen\s*\([\s\S]*?\n\}/) || [''])[0];
        assert.ok(showSrc.length > 50, 'showSuccessScreen extractable');
        assert.ok(
            !/indexOf\(['\"]http['\"]\)\s*===\s*0/.test(showSrc),
            'showSuccessScreen must not rely only on indexOf(http)===0'
        );
        assert.ok(
            /Site-ul tău e live — trial de 7 zile început/.test(showSrc),
            'live title line present'
        );
        assert.ok(/function\s+absoluteSiteUrl\s*\(/.test(app), 'absoluteSiteUrl for cabinet/success href');
        assert.ok(
            /toLocaleDateString\(['\"]ro-RO['\"]/.test(app),
            'Romanian date locale ro-RO in cabinet chrome'
        );
    });

    await check('HEAD: billing-portal return/portal URL includes request Host port', () => {
        const src = headRead('bot/server.js');
        assert.ok(/function\s+requestPublicOrigin\s*\(/.test(src), 'requestPublicOrigin present');
        assert.ok(
            /requestPublicOrigin\s*\(\s*req\s*\)/.test(src),
            'handleSiteBillingPortal uses requestPublicOrigin(req)'
        );
        // Host header must drive origin when PUBLIC_URL empty
        assert.ok(
            /headers\[.host.\]|headers\.host|x-forwarded-host/.test(src),
            'origin built from request Host'
        );
        // Unit: empty PUBLIC_URL + Host with port
        delete process.env.PUBLIC_URL;
        const origin = requestPublicOrigin({
            headers: { host: '127.0.0.1:56350' },
        });
        assert.strictEqual(
            origin,
            'http://127.0.0.1:56350',
            'requestPublicOrigin must preserve port, got ' + origin
        );
        const originXf = requestPublicOrigin({
            headers: {
                host: 'internal:1',
                'x-forwarded-host': '127.0.0.1:9999',
                'x-forwarded-proto': 'http',
            },
        });
        assert.strictEqual(originXf, 'http://127.0.0.1:9999', 'x-forwarded-host wins with port');
    });

    await check('HEAD: legal HTML has no studio shipping placeholder', () => {
        const terms = headRead('builder/terms.html');
        const privacy = headRead('builder/privacy.html');
        const cookies = headRead('builder/cookies.html');
        const blob = terms + '\n' + privacy + '\n' + cookies;
        assert.ok(!/studio shipping placeholder/i.test(blob), 'no studio shipping placeholder');
        assert.ok(!/not legal advice/i.test(blob), 'no English not legal advice');
        assert.ok(/lang=["']ro["']/.test(terms), 'terms lang=ro');
        assert.ok(/Termeni/.test(terms), 'terms Romanian title');
        assert.ok(/Confidențialitate|Confiden/.test(privacy), 'privacy Romanian');
        assert.ok(/Cookie-uri/.test(cookies), 'cookies Romanian');
        assert.ok(/text juridic provizoriu/i.test(blob), 'RO unfinished customer legal framing');
    });

    await check('HEAD: no PUBLIC_URL throw in _isolatedDeploy; relative /live fallback', () => {
        const src = headRead('bot/webpublish.js');
        assert.ok(
            !/throw new Error\(['"]PUBLIC_URL is required for isolated deploy['"]\)/.test(src),
            'HEAD must not throw PUBLIC_URL is required for isolated deploy'
        );
        assert.ok(
            /\/live\/\$\{safe\}\//.test(src) || /\/live\/' \+/.test(src) || /`\/live\//.test(src),
            'HEAD must emit /live/<slug>/ path'
        );
        assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);
        assert.strictEqual(process.env.PUBLIC_URL, undefined);
        assert.strictEqual(process.env.HIDOOK_ISOLATED_DEPLOY, '1');
        assert.strictEqual(process.env.HIDOOK_TEST_PAY, '1');
    });

    await check('pricing unchanged 9900 / 2900', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    await check('HIDOOK_ISOLATED_DEPLOY refused when NODE_ENV=production', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            let threw = false;
            try {
                await webpublish.publishSite({
                    site: {
                        id: 'x-prod-refuse',
                        projectName: 'prod-refuse-iso',
                        slug: 'prod-refuse-iso',
                        userId: 'u',
                        templateId: 'product-menu',
                        paid: true,
                    },
                    config: loadPreset(),
                    images: [],
                });
            } catch (e) {
                threw = true;
                assert.ok(
                    /refused|production|HIDOOK_ISOLATED/i.test(e.message) ||
                        /token|deploy|provider|Furnizor/i.test(e.message),
                    'expected production refusal: ' + e.message
                );
            }
            assert.ok(threw, 'isolated deploy must not succeed in production');
        } finally {
            if (prev === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = prev;
        }
    });

    // Direct unit: isolated deploy without PUBLIC_URL
    await check('unit: publishSite isolated without PUBLIC_URL → /live/<slug>/ + files', async () => {
        assert.strictEqual(process.env.PUBLIC_URL, undefined);
        delete process.env.PUBLIC_URL;
        const slug = 'iso-unit-' + crypto.randomBytes(3).toString('hex');
        const user = registry.getOrCreateUserByEmail('iso-unit-' + crypto.randomUUID().slice(0, 8) + '@ex.com');
        const site = registry.createSite({
            userId: user.id,
            templateId: 'product-menu',
            projectName: slug,
            slug,
            status: 'draft',
            paid: true,
        });
        const cfg = loadPreset();
        const biz = cfg.business.name;
        let result;
        try {
            result = await webpublish.publishSite({
                site,
                config: cfg,
                images: [],
            });
        } catch (e) {
            assert.fail('must not throw without PUBLIC_URL, got: ' + e.message);
        }
        assert.ok(result && result.url, 'deploy result url');
        assert.ok(
            !/PUBLIC_URL is required/i.test(String(result.url)),
            'url must not be the error string'
        );
        assert.ok(
            String(result.url).includes('/live/' + slug),
            'url must include /live/<slug>/, got ' + result.url
        );
        assert.ok(
            result.url === '/live/' + slug + '/' ||
                result.url.endsWith('/live/' + slug + '/') ||
                result.url.includes('/live/' + slug + '/'),
            'relative or absolute live path, got ' + result.url
        );
        assert.ok(fs.existsSync(path.join(publishedDir(slug), 'index.html')), 'published files on disk');
        const updated = registry.getSite(site.id);
        // publishSite may or may not set status — check files + url at minimum
        if (updated && updated.url) {
            assert.ok(String(updated.url).includes('/live/' + slug));
        }
        // Keep site for nothing further
        void biz;
    });

    // ── HTTP E2E without PUBLIC_URL ─────────────────────────────────────────
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    // Deliberately do NOT set PUBLIC_URL — isolated boot without it
    delete process.env.PUBLIC_URL;
    assert.strictEqual(process.env.PUBLIC_URL, undefined, 'E2E must run without PUBLIC_URL');
    assert.strictEqual(process.env.HIDOOK_FAKE_DEPLOY, undefined);

    const cfg = loadPreset();
    const bizName = cfg.business.name;
    const user = registry.getOrCreateUserByEmail('iso-e2e-' + crypto.randomUUID().slice(0, 8) + '@ex.com');
    const sessionCookie = 'hb_session=' + auth.signSession(user.id);
    const client = makeClient(base);
    client.jar.hb_session = auth.signSession(user.id);

    await check('E2E no-PUBLIC_URL: unpaid draft → /live 404; paymentUrl test-checkout', async () => {
        const res = await client('/api/publish', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
                'CF-IPCountry': 'RO',
            },
            body: JSON.stringify({
                templateId: 'product-menu',
                slug: 'iso4-' + crypto.randomUUID().slice(0, 8),
                config: cfg,
                images: [],
            }),
        });
        assert.strictEqual(res.status, 200, await res.clone().text());
        const body = await res.json();
        assert.ok(body.site && body.site.id, 'site id');
        assert.strictEqual(body.site.paid, false, 'unpaid before checkout');
        assert.ok(body.paymentUrl, 'paymentUrl');
        assert.ok(
            /#test-checkout=cs_test_/.test(body.paymentUrl),
            'offline test checkout hash, got ' + body.paymentUrl
        );
        global.__iso4 = {
            siteId: body.site.id,
            slug: body.site.slug,
            paymentUrl: body.paymentUrl,
            sessionId: String(body.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/)[1],
        };
        const liveUnpaid = await fetch(base + '/live/' + body.site.slug + '/', {
            headers: { Accept: 'text/html' },
            redirect: 'manual',
        });
        assert.strictEqual(liveUnpaid.status, 404, 'unpaid must not be live');
    });

    await check('E2E no-PUBLIC_URL: test-pay complete → live/active + fetchable /live + Activ/Anulează gates', async () => {
        const { siteId, slug, sessionId } = global.__iso4;
        const complete = await client('/api/test-pay/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
            },
            body: JSON.stringify({ sessionId }),
        });
        const completeText = await complete.clone().text();
        assert.ok(
            complete.status === 200 || complete.status === 201,
            'test-pay complete status ' + complete.status + ' ' + completeText
        );
        assert.ok(
            !/PUBLIC_URL is required for isolated deploy/i.test(completeText),
            'complete must not surface PUBLIC_URL factory error'
        );
        let doneBody = {};
        try {
            doneBody = JSON.parse(completeText);
        } catch (_) {
            doneBody = await complete.json().catch(() => ({}));
        }

        const site = registry.getSite(siteId);
        assert.ok(
            site.paid === true,
            'site paid after test checkout, got ' + JSON.stringify({ paid: site.paid, status: site.status })
        );
        assert.ok(
            site.status === 'live' || site.status === 'active',
            'status live/active immediately (cabinet Activ + Anulează), got ' + site.status
        );
        // Cabinet gates from builder/app.js:
        // badge Activ: site.paid && (status === 'live' || status === 'active')
        // Anulează: same
        assert.ok(site.paid && (site.status === 'live' || site.status === 'active'), 'Activ+Anulează gate');

        assert.ok(site.url, 'site.url set');
        assert.ok(
            String(site.url).includes('/live/' + slug),
            'site.url is /live/<slug>/ path, got ' + site.url
        );
        assert.ok(
            !/PUBLIC_URL is required/i.test(String(site.url)),
            'url must not be error toast source'
        );
        assert.ok(fs.existsSync(path.join(publishedDir(slug), 'index.html')), 'isolated publish files');

        await waitForStatus(base, '/live/' + slug + '/', 200);
        const liveUrl = site.url.startsWith('http') ? site.url : base + site.url;
        const live = await fetch(liveUrl, {
            headers: { Accept: 'text/html' },
            redirect: 'manual',
        });
        assert.strictEqual(live.status, 200, 'live must 200 after trial start without PUBLIC_URL');
        const html = await live.text();
        assert.ok(html.includes(bizName) || html.length > 200, 'live HTML serves site content');

        if (doneBody.site) {
            assert.ok(
                !/PUBLIC_URL is required/i.test(JSON.stringify(doneBody)),
                'response body free of PUBLIC_URL error'
            );
        }
    });

    await check('E2E no-PUBLIC_URL: paid republish succeeds without PUBLIC_URL toast', async () => {
        const { siteId, slug } = global.__iso4;
        const cfg2 = loadPreset();
        cfg2.business.name = bizName + ' V2';
        cfg2.business.title = cfg2.business.name;
        const rep = await client('/api/publish', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
            },
            body: JSON.stringify({
                siteId,
                templateId: 'product-menu',
                config: cfg2,
                images: [],
            }),
        });
        const repText = await rep.clone().text();
        assert.strictEqual(rep.status, 200, 'republish status: ' + repText);
        assert.ok(
            !/PUBLIC_URL is required for isolated deploy/i.test(repText),
            'republish must not toast PUBLIC_URL is required for isolated deploy'
        );
        const repBody = JSON.parse(repText);
        assert.ok(repBody.site && repBody.site.paid === true, 'still paid');
        assert.ok(
            repBody.site.status === 'live' || repBody.site.status === 'active',
            'still live after republish, got ' + (repBody.site && repBody.site.status)
        );
        assert.ok(
            !/PUBLIC_URL is required/i.test(String(repBody.error || '') + String(repBody.message || '')),
            'no PUBLIC_URL error fields'
        );

        const deadline = Date.now() + 10000;
        let html2 = '';
        while (Date.now() < deadline) {
            const live2 = await fetch(base + '/live/' + slug + '/');
            assert.strictEqual(live2.status, 200);
            html2 = await live2.text();
            if (html2.includes(cfg2.business.name)) break;
            await sleep(50);
        }
        assert.ok(html2.includes(cfg2.business.name), 'republish must show v2 name without PUBLIC_URL');
    });

    await check('E2E no-PUBLIC_URL: cancel trial portalUrl includes isolated port; unpublishes', async () => {
        const { siteId, slug } = global.__iso4;
        let site = registry.getSite(siteId);
        if (!site.stripeSubscriptionId) {
            registry.updateSite(siteId, {
                stripeSubscriptionId: 'sub_test_iso4_' + crypto.randomBytes(4).toString('hex'),
                stripeCustomerId: site.stripeCustomerId || ('cus_test_iso4_' + siteId.slice(0, 8)),
            });
            site = registry.getSite(siteId);
        }

        const portal = await client('/api/sites/' + encodeURIComponent(siteId) + '/billing-portal', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: sessionCookie,
            },
            body: '{}',
        });
        assert.strictEqual(portal.status, 200, await portal.clone().text());
        const portalBody = await portal.json();
        const portalUrl = String(portalBody.portalUrl || portalBody.url || '');
        assert.ok(portalUrl, 'portal url');
        assert.ok(
            portalBody.offline === true || /test-billing-portal|bps_test_/i.test(portalUrl),
            'offline test portal without live Stripe'
        );
        // Critical R2: portal return must keep listening port (not http://127.0.0.1/app/ bare)
        assert.ok(
            portalUrl.includes('127.0.0.1:' + addr.port) || portalUrl.includes('localhost:' + addr.port),
            'portalUrl must include isolated listening port ' + addr.port + ', got ' + portalUrl
        );
        assert.ok(
            !/^https?:\/\/127\.0\.0\.1\/app\//.test(portalUrl.replace(/#.*$/, '')),
            'portalUrl must not be host-only 127.0.0.1 without port'
        );

        site = registry.getSite(siteId);
        assert.ok(
            site.status !== 'live' && site.status !== 'active',
            'registry not live after cancel, got ' + site.status
        );
        // Draft/unpublished product state
        assert.ok(
            /unpublish|draft|cancel/i.test(String(site.status)) || site.status === 'unpublished',
            'cabinet Draft/unpublished, got ' + site.status
        );
        assert.ok(
            !fs.existsSync(path.join(publishedDir(slug), 'index.html')),
            'published index removed after cancel'
        );

        const liveAfter = await fetch(base + '/live/' + slug + '/', {
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            redirect: 'manual',
        });
        assert.strictEqual(liveAfter.status, 404, 'live must 404 after cancel');
        const body = await liveAfter.text();
        assert.ok(!/^\s*\{/.test(body.trim()), 'must not be raw JSON');
        assert.ok(
            /nu mai este public|nu mai este disponibil|anulat|nepublicat|Site-ul nu mai|Pagină negăsită/i.test(
                body
            ),
            'Romanian unpublished/locked state, got: ' + body.slice(0, 280)
        );
        assert.ok(!body.includes(bizName), 'must not serve stale live business HTML after cancel');

        // No first-charge invention while unpublished (test-pay offline: no ledger charge event required)
        // Ensure pricing contract still 99 then 29 and site is not presenting a charged line via status
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
        assert.ok(
            site.status !== 'live' && site.status !== 'active',
            'no live charge presentation while unpublished'
        );
    });

    await check('cabinet chrome source: Activ + Anulează gates on paid live/active', () => {
        const app = headRead('builder/app.js');
        assert.ok(
            /badgeLabel\s*=\s*['"]Activ['"]/.test(app) || /['"]Activ['"]/.test(app),
            'cabinet Activ label present'
        );
        assert.ok(
            /Anulează|Anuleaz\\u0103|Anuleaz\u0103/.test(app),
            'cabinet Anulează present'
        );
        assert.ok(
            /site\.paid\s*&&\s*\(.*status\s*===\s*['"]live['"]|status\s*===\s*['"]active['"]/.test(app) ||
                /site\.paid && \(site\.status === 'live' \|\| site\.status === 'active'\)/.test(app),
            'Activ/Anulează gated on paid + live/active'
        );
    });

    await new Promise((r) => server.close(() => r()));
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}

    if (failed) {
        console.error('\nflow4-isolated-live-url.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nflow4-isolated-live-url.test.js: all passed');
})().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
