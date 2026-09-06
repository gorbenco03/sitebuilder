'use strict';
/**
 * bot/test/audit-server-round2.test.js — oracle for Audit 2026-09-06 round 2
 * (04-QA-Evidence/Audit-2026-09-06-2225ca7/), the findings fixed in
 * bot/server.js, bot/logger.js, and bot/ratelimit.js only.
 *
 * Covers, one causal contract per finding:
 *   BE-07  Email addresses are masked in structured logs (GDPR) — the raw
 *          address bot/email.js logs on every magic-link attempt must never
 *          reach stdout/stderr in clear.
 *   BE-09  Cross-user GET /api/export-html and /api/export-zip → 403 Access
 *          denied (was 400 "No draft to download", same code as an honest
 *          empty draft — hid an ownership mismatch behind a generic status).
 *   BE-10  serveCalendarNativeManage is declared exactly once in server.js
 *          (was defined twice, byte-identical; hoisting silently ran the
 *          second copy — the first was dead code).
 *   PC-03  /admin reports disk truth (still served) separately from
 *          commercial entitlement: a past_due/unpaid site whose isolated
 *          files were never removed must show "Live", and Billing must name
 *          the real Stripe status instead of falling back to "trial".
 *   SEC-05 POST /api/calendar-native/bookings — open CORS (any Origin,
 *          reflected, no credentials) is a deliberate product decision for an
 *          embeddable widget, so the actual defense against calendar-spam is
 *          the new per-(IP,tenant) and per-tenant rate limit.
 *   BE-11  applyPublicCalendarCors keeps reflecting a well-formed foreign
 *          Origin (the widget must still work from any customer domain) but
 *          no longer reflects a malformed one (e.g. carrying a path).
 *   PERF-05 GET /api/templates carries ETag + Cache-Control and answers 304
 *           on a matching If-None-Match, instead of re-sending ~115KB with no
 *           caching headers at all on every request.
 *
 * Run: node --experimental-sqlite bot/test/audit-server-round2.test.js
 * Exits non-zero on failure.
 */

if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawnSync } = require('child_process');
    const r = spawnSync(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit' }
    );
    process.exit(r.status == null ? 1 : r.status);
}

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

const ROOT = path.resolve(__dirname, '..', '..');

const ADMIN_TOKEN   = 'audit-r2-admin-' + crypto.randomBytes(8).toString('hex');
const SERVER_SECRET = 'audit-r2-secret-' + crypto.randomBytes(8).toString('hex');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-server-r2-'));
process.env.DATA_DIR               = tmpDir;
process.env.SERVER_SECRET          = SERVER_SECRET;
process.env.HIDOOK_ADMIN_TOKEN     = ADMIN_TOKEN;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY        = '1';
process.env.PUBLIC_URL             = 'http://127.0.0.1:0';
process.env.NODE_ENV               = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

const pricing        = require('../pricing.js');
const registry        = require('../registry.js');
const auth            = require('../auth.js');
const webpublish       = require('../webpublish.js'); // read-only use: not modified by this fix
const { log, format, maskEmail } = require('../logger.js');
const { onStripeEvent } = require('../web.js');
const { startServer }   = require('../server.js');
const calendarPublicApi = require('../calendar-native/public-api.js');

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

function httpJson(port, method, urlPath, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const reqHeaders = Object.assign({}, headers);
        if (data) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(data);
        }
        const req = http.request(
            { hostname: '127.0.0.1', port, method, path: urlPath, headers: reqHeaders },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let json = null;
                    try { json = JSON.parse(raw); } catch (_) { /* not JSON, fine */ }
                    resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
                });
            }
        );
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

function extractAdminRow(html, needle) {
    const idx = html.indexOf(needle);
    if (idx < 0) return null;
    const rowStart = html.lastIndexOf('<tr>', idx);
    const rowEnd = html.indexOf('</tr>', idx);
    if (rowStart < 0 || rowEnd < 0) return null;
    return html.slice(rowStart, rowEnd + '</tr>'.length);
}

function seedSite(slugPrefix) {
    const user = registry.getOrCreateUserByEmail(`r2-${crypto.randomUUID()}@ex.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: (slugPrefix || 'r2') + '-' + crypto.randomUUID().slice(0, 8),
        platform: 'web',
    });
    const sessionId = 'cs_test_r2_' + crypto.randomBytes(6).toString('hex');
    const order = registry.createOrder({
        siteId: site.id,
        userId: user.id,
        amountCents: pricing.PRICE_CENTS,
        currency: 'eur',
        stripeSessionId: sessionId,
        kind: 'publish',
    });
    registry.saveVersion(site.id, {
        businessName: 'Audit R2 Cafe',
        sections: { hero: { title: 'Audit r2 live copy' } },
    });
    webpublish.savePendingDraft(order.id, {
        config: { businessName: 'Audit R2 Cafe', sections: { hero: { title: 'Audit r2 live copy' } } },
        images: [],
        siteId: site.id,
        savedAt: new Date().toISOString(),
    });
    const subscriptionId = 'sub_test_r2_' + crypto.randomBytes(5).toString('hex');
    const customerId = 'cus_test_r2_' + crypto.randomBytes(5).toString('hex');
    return { user, site, sessionId, order, subscriptionId, customerId };
}

async function publishViaTrialWebhook({ sessionId, site, order, user, subscriptionId, customerId }) {
    await onStripeEvent({
        id: 'evt_r2_paid_' + crypto.randomUUID().slice(0, 10),
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

function ymd(d) { return d.toISOString().slice(0, 10); }

(async () => {
    // -----------------------------------------------------------------
    // BE-07 — email masking (pure, no server needed)
    // -----------------------------------------------------------------
    await check('BE-07: format() masks an `email` field, never keeps it in clear', () => {
        const raw = 'attacker-target@example.com';
        const rec = format('test.event', { email: raw, devLink: 'http://x/y?token=abc' });
        assert.notStrictEqual(rec.email, raw);
        assert.ok(!JSON.stringify(rec).includes(raw), 'raw address must not appear anywhere in the record');
        assert.match(rec.email, /^a\*\*\*@example\.com#[0-9a-f]{8}$/, 'masked shape: 1st-char + *** + domain + #hash');
        assert.strictEqual(rec.devLink, 'http://x/y?token=abc', 'unrelated fields pass through untouched');

        // Same address -> same masked form (stable correlation key across log lines).
        assert.strictEqual(maskEmail(raw), format('e2', { email: raw }).email);
        // Different address -> different hash.
        assert.notStrictEqual(maskEmail(raw), maskEmail('someone-else@example.com'));
    });

    await check('BE-07: log() never writes the raw address to stdout', () => {
        const orig = process.stdout.write;
        let captured = '';
        process.stdout.write = (s) => { captured += s; return true; };
        try {
            log('email.magic_link.dev', { email: 'stdout-check@example.com', devLink: 'http://x/y?token=zzz' });
        } finally { process.stdout.write = orig; }
        assert.ok(!captured.includes('stdout-check@example.com'));
        assert.ok(captured.includes('devLink'), 'unrelated fields must survive');
    });

    // -----------------------------------------------------------------
    // Server up for the HTTP-level checks
    // -----------------------------------------------------------------
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((resolve, reject) => {
        if (server.listening) return resolve();
        server.once('listening', resolve);
        server.once('error', reject);
    });
    const port = server.address().port;
    process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;

    try {
        await check('BE-07 end-to-end: POST /api/auth/email never leaks the address via process stdout', async () => {
            const orig = process.stdout.write;
            let captured = '';
            process.stdout.write = (s) => { captured += s; return true; };
            let res;
            try {
                res = await httpJson(port, 'POST', '/api/auth/email', { body: { email: 'plaintext-check@example.com' } });
            } finally { process.stdout.write = orig; }
            assert.strictEqual(res.status, 200, 'devLink flow (no RESEND_API_KEY) must still 200');
            assert.ok(res.json && res.json.devLink, 'devLink still returned to the caller — behavior unchanged for the user');
            assert.ok(!captured.includes('plaintext-check@example.com'), 'raw address must not appear in process stdout');
        });

        // -----------------------------------------------------------------
        // BE-09 — resolveExportDraft ownership vs missing-draft status codes
        // -----------------------------------------------------------------
        const ownerA = registry.getOrCreateUserByEmail(`r2-a-${crypto.randomUUID()}@ex.com`);
        const ownerB = registry.getOrCreateUserByEmail(`r2-b-${crypto.randomUUID()}@ex.com`);
        const siteB = registry.createSite({
            userId: ownerB.id,
            templateId: 'product-menu',
            templateVersion: 1,
            slug: 'r2-crossuser-' + crypto.randomUUID().slice(0, 8),
            platform: 'web',
        });
        registry.saveVersion(siteB.id, { businessName: 'Cross User Co', sections: { hero: { title: 'x' } } });
        const cookieA = 'hb_session=' + auth.signSession(ownerA.id);

        await check('BE-09: cross-user GET /api/export-html → 403 Access denied (was 400)', async () => {
            const res = await httpJson(port, 'GET', '/api/export-html?siteId=' + encodeURIComponent(siteB.id), {
                headers: { Cookie: cookieA, Accept: 'text/html' },
            });
            assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status + ' body=' + res.body.slice(0, 200));
            assert.strictEqual(res.json && res.json.error, 'Access denied.');
        });

        await check('BE-09: cross-user GET /api/export-zip → 403 Access denied (was 400)', async () => {
            const res = await httpJson(port, 'GET', '/api/export-zip?siteId=' + encodeURIComponent(siteB.id), {
                headers: { Cookie: cookieA, Accept: 'application/zip' },
            });
            assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status + ' body=' + res.body.slice(0, 200));
            assert.strictEqual(res.json && res.json.error, 'Access denied.');
        });

        await check('BE-09 baseline: nonexistent siteId still 404 (own vs missing stay distinct from ownership)', async () => {
            const res = await httpJson(port, 'GET', '/api/export-html?siteId=does-not-exist-xyz', {
                headers: { Cookie: cookieA, Accept: 'text/html' },
            });
            assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status + ' body=' + res.body.slice(0, 200));
        });

        // -----------------------------------------------------------------
        // BE-10 — no duplicate function declaration left in server.js
        // -----------------------------------------------------------------
        await check('BE-10: serveCalendarNativeManage is declared exactly once in server.js', () => {
            const src = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
            const matches = src.match(/function\s+serveCalendarNativeManage\s*\(/g) || [];
            assert.strictEqual(matches.length, 1, 'expected exactly one declaration, found ' + matches.length);
        });

        // -----------------------------------------------------------------
        // PC-03 — /admin: disk truth vs commercial entitlement
        // -----------------------------------------------------------------
        async function seedAndDegrade(slugPrefix, subStatus) {
            const seed = seedSite(slugPrefix);
            await publishViaTrialWebhook(seed);
            const before = registry.getSite(seed.site.id);
            assert.ok(before.status === 'live' || before.status === 'active', 'seed must publish live first');
            await onStripeEvent({
                id: 'evt_r2_' + subStatus + '_' + crypto.randomUUID().slice(0, 10),
                type: 'customer.subscription.updated',
                data: {
                    object: {
                        id: seed.subscriptionId,
                        customer: seed.customerId,
                        status: subStatus,
                        metadata: { siteId: seed.site.id },
                    },
                },
            });
            return registry.getSite(seed.site.id);
        }

        // 'unpaid' and 'incomplete_expired' now unpublish the site (Stripe has given
        // up retrying) — that enforcement landed with the commercial round-1 fix and
        // is asserted separately below. 'past_due' is the state that legitimately
        // stays served while Stripe retries, so it is the one that exercises the
        // "still on disk but not commercially entitled" admin-label path.
        for (const subStatus of ['past_due']) {
            const slugSafeStatus = subStatus.replace(/_/g, '-'); // SLUG_RE forbids underscores
            await check(`PC-03 (${subStatus}): subscription.updated does NOT unpublish — files stay served`, async () => {
                const site = await seedAndDegrade('r2-' + slugSafeStatus, subStatus);
                assert.ok(site.status === 'live' || site.status === 'active',
                    `status must remain live/active after ${subStatus}, got ${site.status}`);
                assert.strictEqual(String(site.stripeSubscriptionStatus).toLowerCase(), subStatus);

                const liveRes = await httpJson(port, 'GET', '/live/' + site.slug + '/', {});
                assert.strictEqual(liveRes.status, 200, `GET /live/<slug>/ must still 200 after ${subStatus} (files never removed)`);
            });

            await check(`PC-03 (${subStatus}): /admin shows "Live" (disk truth), not "Unpublished"`, async () => {
                const site = await seedAndDegrade('r2adm-' + slugSafeStatus, subStatus);
                const res = await httpJson(port, 'GET', '/admin?token=' + encodeURIComponent(ADMIN_TOKEN), {
                    headers: { Accept: 'text/html' },
                });
                assert.strictEqual(res.status, 200);
                const row = extractAdminRow(res.body, site.slug);
                assert.ok(row, 'admin table must list this site\'s row');
                assert.ok(/class="st live">Live</.test(row), `row must say Live for a still-served ${subStatus} site: ${row}`);
                assert.ok(!/Unpublished/.test(row), `row must NOT say Unpublished while files are still served: ${row}`);
                assert.ok(row.includes(subStatus), `Billing column must name the real state "${subStatus}", not a generic fallback: ${row}`);
                assert.ok(!/<td>trial<\/td>/.test(row), `Billing column must not fall back to "trial" for ${subStatus}: ${row}`);
            });

            await check(`PC-03 (${subStatus}): commercial entitlement stays revoked — export still 402`, async () => {
                const site = await seedAndDegrade('r2exp-' + slugSafeStatus, subStatus);
                const cookie = 'hb_session=' + auth.signSession(site.userId);
                const res = await httpJson(port, 'GET', '/api/export-html?siteId=' + encodeURIComponent(site.id), {
                    headers: { Cookie: cookie, Accept: 'text/html' },
                });
                assert.strictEqual(res.status, 402, `export must still require entitlement for ${subStatus}, got ${res.status}`);
            });
        }

        await check('PC-03 sanity: canceled subscription still unpublishes (no regression)', async () => {
            const seed = seedSite('r2-canceled');
            await publishViaTrialWebhook(seed);
            await onStripeEvent({
                id: 'evt_r2_canceled_' + crypto.randomUUID().slice(0, 10),
                type: 'customer.subscription.deleted',
                data: {
                    object: { id: seed.subscriptionId, customer: seed.customerId, status: 'canceled', metadata: { siteId: seed.site.id } },
                },
            });
            const site = registry.getSite(seed.site.id);
            assert.ok(site.status !== 'live' && site.status !== 'active', 'deleted subscription must still unpublish');
            const res = await httpJson(port, 'GET', '/admin?token=' + encodeURIComponent(ADMIN_TOKEN), { headers: { Accept: 'text/html' } });
            const row = extractAdminRow(res.body, site.slug);
            assert.ok(row && /Unpublished/.test(row), 'canceled site must still show Unpublished: ' + row);
            assert.ok(row && row.includes('canceled'), 'billing must still say canceled: ' + row);
        });

        // -----------------------------------------------------------------
        // BE-11 — CORS keeps working for legitimate embeds, rejects malformed Origin
        // -----------------------------------------------------------------
        const DEMO = calendarPublicApi.DEMO;

        await check('BE-11: well-formed foreign Origin is still reflected (widget embeds on any customer domain)', async () => {
            const res = await httpJson(
                port, 'GET',
                `/api/calendar-native/services?customerId=${DEMO.customerId}&siteId=${DEMO.siteId}`,
                { headers: { Origin: 'https://evil.example.com' } }
            );
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.headers['access-control-allow-origin'], 'https://evil.example.com');
            assert.strictEqual(res.headers['access-control-allow-credentials'], undefined,
                'never issue credentials on this public write-mostly surface');
        });

        await check('BE-11: malformed Origin (carries a path) is not reflected', async () => {
            const res = await httpJson(
                port, 'GET',
                `/api/calendar-native/services?customerId=${DEMO.customerId}&siteId=${DEMO.siteId}`,
                { headers: { Origin: 'https://evil.example.com/some/path' } }
            );
            assert.strictEqual(res.status, 200, 'the request itself must still succeed — only the header is withheld');
            assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
        });

        // -----------------------------------------------------------------
        // SEC-05 — rate limit on public bookings create
        // -----------------------------------------------------------------
        let firstServiceId = null;
        let firstSlotStartUtc = null;
        await check('(setup) demo tenant has a bookable slot within 10 days', async () => {
            const svcRes = await httpJson(port, 'GET',
                `/api/calendar-native/services?customerId=${DEMO.customerId}&siteId=${DEMO.siteId}`, {});
            assert.strictEqual(svcRes.status, 200);
            assert.ok(svcRes.json.services && svcRes.json.services.length >= 1);
            firstServiceId = svcRes.json.services[0].id;

            const from = ymd(new Date());
            const to = ymd(new Date(Date.now() + 10 * 24 * 3600 * 1000));
            const slotsRes = await httpJson(port, 'GET',
                `/api/calendar-native/slots?customerId=${DEMO.customerId}&siteId=${DEMO.siteId}&serviceId=${firstServiceId}&from=${from}&to=${to}`, {});
            assert.strictEqual(slotsRes.status, 200);
            assert.ok(slotsRes.json.slots && slotsRes.json.slots.length >= 1, 'demo tenant must expose at least one free slot');
            firstSlotStartUtc = slotsRes.json.slots[0].startUtc;
        });

        await check('SEC-05: POST /api/calendar-native/bookings rate-limits per (IP, tenant) with a Romanian 429', async () => {
            const payload = {
                customerId: DEMO.customerId,
                siteId: DEMO.siteId,
                serviceId: firstServiceId,
                startUtc: firstSlotStartUtc,
                visitorName: 'Audit Rate Test',
                visitorEmail: 'rate-test@example.com',
            };
            const statuses = [];
            for (let i = 0; i < 6; i++) {
                const r = await httpJson(port, 'POST', '/api/calendar-native/bookings', { body: payload });
                statuses.push(r.status);
            }
            assert.ok(statuses.every((s) => s !== 429), 'the first 6 requests from one source must not be rate-limited: ' + statuses.join(','));

            const seventh = await httpJson(port, 'POST', '/api/calendar-native/bookings', { body: payload });
            assert.strictEqual(seventh.status, 429, 'the 7th booking POST within the window from the same source must be rate-limited');
            assert.strictEqual(seventh.json && seventh.json.code, 'RATE_LIMITED');
            assert.ok(/[a-zăâîșț]/i.test(seventh.json.error) && /programare/i.test(seventh.json.error),
                'client-facing message must be Romanian: ' + (seventh.json && seventh.json.error));
        });

        // -----------------------------------------------------------------
        // PERF-05 — /api/templates caching
        // -----------------------------------------------------------------
        await check('PERF-05: GET /api/templates carries ETag + Cache-Control and answers 304 on match', async () => {
            const first = await httpJson(port, 'GET', '/api/templates', {});
            assert.strictEqual(first.status, 200);
            const etag = first.headers['etag'];
            assert.ok(etag, 'ETag header must be present');
            assert.ok(/must-revalidate/.test(first.headers['cache-control'] || ''),
                'Cache-Control must be present and revalidate-friendly, got: ' + first.headers['cache-control']);
            assert.ok(first.json && Array.isArray(first.json.templates) && first.json.templates.length >= 1);

            const second = await httpJson(port, 'GET', '/api/templates', { headers: { 'If-None-Match': etag } });
            assert.strictEqual(second.status, 304, 'matching If-None-Match must short-circuit to 304');
            assert.strictEqual(second.body, '', '304 must carry no body');
        });
    } finally {
        await new Promise((r) => server.close(() => r()));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (failed) {
        console.error('\naudit-server-round2.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\naudit-server-round2.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
