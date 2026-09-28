'use strict';
/**
 * bot/test/audit27-r-04-server-hardening.test.js
 *
 * R-04 + R-19 (PLAN-AUDIT-2026-09-27.md, Val 3): server hardening.
 * Covers three independent findings from 04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json:
 *
 *   - api-security#1: image upload trusted the client-declared
 *     `data:<mime>;base64` label, never the real bytes. A "hero.png" whose
 *     actual content was a script sailed through and got written to disk /
 *     served publicly with Content-Type: image/png.
 *   - gap-csrf-poc#1: no route checked Origin/Referer on a state-changing
 *     request — the only thing stopping cross-site abuse was SameSite=Lax
 *     on the session cookie, entirely incidental. Also: parseJson() ignored
 *     Content-Type, so a same-site <form method=POST enctype=text/plain>
 *     could smuggle a JSON body past a browser that would otherwise refuse
 *     to attach the cookie cross-site via fetch/XHR.
 *   - copy-i18n#2: the "delete blocked" message sent the customer to a
 *     nonexistent "Facturare" section instead of the real "Anulează"
 *     button on the site's own card.
 *
 * Each case below fails against the pre-fix code and passes against this
 * task's fix. Run:
 *   node --experimental-sqlite --test bot/test/audit27-r-04-server-hardening.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-r04-hardening-'));
process.env.DATA_DIR = dataDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
process.env.SERVER_SECRET = 'r04-hardening-secret-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL; // fall back to the real request Host, like production behind no proxy
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

const registry = require('../registry.js');
const auth = require('../auth.js');
const { startServer } = require('../server.js');

let server;
let base;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function cookieFor(userId) {
    return 'hb_session=' + auth.signSession(userId);
}

function makeUser(tag) {
    return registry.getOrCreateUserByEmail(`r04-${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`);
}

// ---------------------------------------------------------------------------
// gap-csrf-poc#1 — same-origin guard on a state-changing authenticated route
// ---------------------------------------------------------------------------

test('POST /api/auth/logout-everywhere with a foreign Origin is refused (403), session stays valid', async () => {
    const user = makeUser('csrf-cross');
    const cookie = cookieFor(user.id);

    const cross = await fetch(base + '/api/auth/logout-everywhere', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://evil.example.com' },
    });
    const crossBody = await cross.json().catch(() => ({}));
    assert.equal(cross.status, 403, 'a mismatched Origin must be rejected before the route runs');
    assert.match(crossBody.error || '', /origine/i, 'the refusal message is in Romanian');

    // Prove the route never ran: the session this "attack" targeted must
    // still be live (a same-site GET, so requireAuth's guard does not gate it).
    const stillIn = await fetch(base + '/api/me', { headers: { Cookie: cookie } });
    assert.equal(stillIn.status, 200, 'logout-everywhere must not have actually run');
});

test('POST /api/auth/logout-everywhere with a matching Origin (or none) succeeds', async () => {
    const user = makeUser('csrf-same');
    const cookie = cookieFor(user.id);

    const sameOrigin = await fetch(base + '/api/auth/logout-everywhere', {
        method: 'POST',
        headers: { Cookie: cookie, Origin: base },
    });
    assert.equal(sameOrigin.status, 200, 'a same-origin request must not be blocked by the new guard');

    // Back-compat: a request with neither Origin nor Referer (older browser,
    // non-browser client) must still be allowed through to requireAuth's
    // normal 401/200 decision, not rejected outright by the CSRF guard.
    const user2 = makeUser('csrf-no-headers');
    const cookie2 = cookieFor(user2.id);
    const noHeaders = await fetch(base + '/api/auth/logout-everywhere', {
        method: 'POST',
        headers: { Cookie: cookie2 },
    });
    assert.equal(noHeaders.status, 200, 'no Origin/Referer at all must not be treated as cross-site');
});

// ---------------------------------------------------------------------------
// gap-csrf-poc#1 — parseJson() now requires the real Content-Type
// ---------------------------------------------------------------------------

test('POST /api/auth/email without Content-Type: application/json is rejected (JSON-smuggling vector closed)', async () => {
    const noType = await fetch(base + '/api/auth/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'nice-try@example.com' }),
    });
    assert.equal(noType.status, 400, 'missing/incorrect Content-Type must be a hard 400, not silently parsed');
    const body = await noType.json().catch(() => ({}));
    assert.match(body.error || '', /Content-Type/i);

    // The classic smuggling shape: a same-site <form enctype="text/plain">
    // auto-submits valid JSON as its literal body. Must be refused the same way.
    const textPlain = await fetch(base + '/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ email: 'nice-try@example.com' }),
    });
    assert.equal(textPlain.status, 400, 'text/plain-labelled JSON must not be accepted as JSON');

    // The legitimate shape (what the real builder always sends) still works.
    const ok = await fetch(base + '/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'genuine-r04@example.com' }),
    });
    assert.ok(ok.status === 200 || ok.status === 429, 'a properly-typed request must reach normal handling, got ' + ok.status);
});

// ---------------------------------------------------------------------------
// api-security#1 — real magic-byte verification on uploaded "images"
// ---------------------------------------------------------------------------

/** A genuinely valid 1x1 PNG (real magic bytes) — must always be accepted. */
const REAL_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Script content mislabelled as image/png — the exact api-security#1 repro shape. */
function fakeImageDataUrl() {
    const scriptBytes = Buffer.from('<script>window.__hb_xss_marker=1;document.title="XSS-EXECUTED"</script>', 'utf8');
    return 'data:image/png;base64,' + scriptBytes.toString('base64');
}

async function publishWithImage(cookie, dataUrl, slug) {
    return fetch(base + '/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
            templateId: 'professionals',
            slug,
            config: { business: { name: slug } },
            images: [{ name: 'hero.png', dataUrl }],
        }),
    });
}

test('POST /api/publish rejects a fake "image" whose real bytes are not PNG/JPEG/WEBP', async () => {
    const user = makeUser('upload-fake');
    const cookie = cookieFor(user.id);
    const slug = 'r04-fake-img-' + crypto.randomBytes(4).toString('hex');

    const res = await publishWithImage(cookie, fakeImageDataUrl(), slug);
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 422, 'mislabelled non-image content must be refused, got ' + res.status + ' ' + JSON.stringify(body));
    assert.match(body.error || '', /jpeg\/png\/webp/i);

    // Never created/deployed with the fake payload.
    const sites = registry.listSites(user.id);
    assert.ok(!sites.some((s) => s.slug === slug && s.status === 'live'), 'a rejected image must never reach a live site');
});

test('POST /api/publish accepts a genuinely valid PNG (no regression on real uploads)', async () => {
    const user = makeUser('upload-real');
    const cookie = cookieFor(user.id);
    const slug = 'r04-real-img-' + crypto.randomBytes(4).toString('hex');

    const res = await publishWithImage(cookie, REAL_PNG_DATA_URL, slug);
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 200, 'a real PNG must still be accepted, got ' + res.status + ' ' + JSON.stringify(body));
});

// ---------------------------------------------------------------------------
// copy-i18n#2 — delete-blocked message points at the real "Anulează" control
// ---------------------------------------------------------------------------

test('DELETE /api/sites/:id while a subscription is active points to "Anulează" on the card, not a nonexistent "Facturare" section', async () => {
    const user = makeUser('delete-copy');
    const site0 = registry.createSite({
        userId: user.id,
        templateId: 'professionals',
        templateVersion: 1,
        slug: 'r04-active-sub-' + crypto.randomBytes(4).toString('hex'),
        platform: 'web',
    });
    registry.updateSite(site0.id, {
        paid: true,
        status: 'live',
        stripeSubscriptionStatus: 'active',
        paidUntil: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const site = registry.getSite(site0.id);

    const res = await fetch(base + '/api/sites/' + encodeURIComponent(site.id), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: cookieFor(user.id) },
        body: JSON.stringify({ confirmName: site.projectName }),
    });
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.code, 'ACTIVE_SUBSCRIPTION');
    assert.doesNotMatch(body.error || '', /Facturare/, 'must not point to the nonexistent "Facturare" section');
    assert.match(body.error || '', /Anulează/, 'must name the real "Anulează" control on the site\'s own card');
});
