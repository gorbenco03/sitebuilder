'use strict';
/**
 * bot/test/audit27-s-2c-site-messages.test.js
 *
 * S-2C (PLAN-UX §5.2 supporting piece): backend + owner inbox for site
 * contact-form messages. Fails on the pre-S-2C repo (no /api/site-messages
 * route, no site_messages storage, no owner routes) and passes once
 * bot/site-messages.js + the routes/registry additions land.
 *
 * Pure HTTP against a real isolated server (own DATA_DIR, own
 * SERVER_SECRET, HIDOOK_TEST_PAY offline checkout) — no browser needed, per
 * the task brief ("for your oracle, POST directly to the endpoint with a
 * live slug"). Same startServer/magic-link pattern as
 * bot/test/audit27-r-03-version-integrity.test.js.
 *
 * Covers:
 *   1. A public POST with a live/paid slug is accepted and stored.
 *   2. The owner sees it via GET /api/sites/:id/messages (what the
 *      dashboard "Mesaje" modal calls), with an accurate unread count.
 *   3. A second, unrelated owner (account B) cannot read account A's
 *      messages for A's site (403, not merely "empty").
 *   4. The honeypot ('website' non-empty) is accepted (200) but the
 *      submission is silently dropped — never stored, never surfaced to
 *      the owner.
 *   5. Per-(IP, slug) rate limiting returns 429 once the window's cap is
 *      exceeded.
 *   6. Mark-as-read and delete work, are idempotent/ownership-checked, and
 *      deleting the site cascades its messages (GDPR-adjacent cleanup).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-s-2c-site-messages.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function freshTmpDataDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fullConfig(name) {
    return {
        business: { name, title: `${name} | Test`, metaDescription: `${name} — descriere de test.`, lang: 'ro' },
        hero: { background: "url('images/cn-hero.jpg')", ctaLabel: 'Sună acum' },
        contact: { phone: '+40721234567' },
        footer: { address: 'Strada Test 1, București' },
    };
}

/** Boots an isolated server on a random port and returns {base, stop}. */
async function bootIsolatedServer(prefix) {
    const tmpDir = freshTmpDataDir(prefix);
    const envOverrides = {
        DATA_DIR: tmpDir,
        HIDOOK_TEST_PAY: '1',
        HIDOOK_ISOLATED_DEPLOY: '1',
        NODE_ENV: 'test',
        SERVER_SECRET: prefix + crypto.randomBytes(8).toString('hex'),
    };
    const saved = {};
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of ['HIDOOK_FAKE_DEPLOY', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'PUBLIC_URL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
        saved[k] = process.env[k];
    }
    Object.assign(process.env, envOverrides);
    delete process.env.HIDOOK_FAKE_DEPLOY;
    delete process.env.BRAND_DOMAIN;
    delete process.env.DEPLOY_PROVIDER;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.VERCEL_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;

    for (const rel of ['../domains.js', '../deploy-cloudflare.js', '../webpublish.js', '../registry.js', '../site-messages.js', '../server.js']) {
        delete require.cache[require.resolve(rel)];
    }
    const { startServer } = require('../server.js');

    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;
    process.env.PUBLIC_URL = base;

    function restoreEnv() {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
    }

    return {
        base,
        stop: () => new Promise((resolve) => server.close(() => { restoreEnv(); resolve(); })),
    };
}

function makeClient(base) {
    const jar = {};
    return async function doFetch(urlPath, opts = {}) {
        const url = base + urlPath;
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers['Cookie'] = cookieStr;
        const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
            if (!sc) continue;
            const first = sc.split(';')[0];
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
        }
        return res;
    };
}

async function loginClient(base, email) {
    const c = makeClient(base);
    const loginRes = await fetch(base + '/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    const token = new URL(loginBody.devLink).searchParams.get('token');
    const v = await c('/auth/verify?token=' + encodeURIComponent(token));
    assert.equal(v.status, 302);
    return c;
}

/** Publish + complete offline test-pay checkout for a fresh site owned by `client`. */
async function publishLiveSite(client, name) {
    const pub = await client('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'product-menu', config: fullConfig(name), images: [] }),
    });
    assert.equal(pub.status, 200, await pub.clone().text());
    const pubBody = await pub.json();
    const m = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
    assert.ok(m, 'test-pay session id in paymentUrl');
    const complete = await client('/api/test-pay/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: m[1] }),
    });
    assert.equal(complete.status, 200, await complete.clone().text());
    const completeBody = await complete.json();
    assert.equal(completeBody.site.paid, true);
    return { siteId: pubBody.site.id, slug: pubBody.site.slug };
}

test('S-2C: public POST /api/site-messages is accepted for a live slug and the owner can read it back', async () => {
    const { base, stop } = await bootIsolatedServer('audit27-s2c-a-');
    try {
        const cA = await loginClient(base, 'audit27-s2c-a-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const { siteId, slug } = await publishLiveSite(cA, 'S2C Owner A');

        const post = await fetch(base + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, name: 'Ion Popescu', contact: '0721234567', message: 'Salut, vreau o ofertă.' }),
        });
        assert.equal(post.status, 200, await post.clone().text());
        const postBody = await post.json();
        assert.equal(postBody.ok, true);

        const list = await cA('/api/sites/' + siteId + '/messages');
        assert.equal(list.status, 200, await list.clone().text());
        const listBody = await list.json();
        assert.equal(listBody.messages.length, 1, 'owner sees exactly the one submitted message');
        assert.equal(listBody.unread, 1, 'unread count matches (S-2C\'s dashboard badge reads this field)');
        assert.equal(listBody.messages[0].name, 'Ion Popescu');
        assert.equal(listBody.messages[0].contact, '0721234567');
        assert.equal(listBody.messages[0].message, 'Salut, vreau o ofertă.');
        assert.equal(listBody.messages[0].readAt, null);
    } finally {
        await stop();
    }
});

test('S-2C: a submission for a draft (never published) or unknown slug is refused, never stored', async () => {
    const { base, stop } = await bootIsolatedServer('audit27-s2c-b-');
    try {
        const cA = await loginClient(base, 'audit27-s2c-b-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const draft = await cA('/api/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: 'product-menu', config: fullConfig('S2C Draft Only') }),
        });
        assert.equal(draft.status, 200, await draft.clone().text());
        const draftBody = await draft.json();
        const draftSlug = draftBody.site.slug;

        const postUnpublished = await fetch(base + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: draftSlug, name: 'X', contact: 'x@x.com', message: 'hi' }),
        });
        assert.equal(postUnpublished.status, 404, 'an unpublished/unpaid site must refuse the submission');

        const postUnknown = await fetch(base + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: 'no-such-slug-' + crypto.randomUUID().slice(0, 8), name: 'X', contact: 'x@x.com', message: 'hi' }),
        });
        assert.equal(postUnknown.status, 404);
    } finally {
        await stop();
    }
});

test('S-2C: account B cannot read or manage account A\'s site messages', async () => {
    const { base, stop } = await bootIsolatedServer('audit27-s2c-c-');
    try {
        const cA = await loginClient(base, 'audit27-s2c-c-a-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const { siteId, slug } = await publishLiveSite(cA, 'S2C Owner A2');

        const post = await fetch(base + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, name: 'Vizitator', contact: 'v@v.com', message: 'Mesaj privat pentru A' }),
        });
        assert.equal(post.status, 200);

        const listA = await cA('/api/sites/' + siteId + '/messages');
        const mid = (await listA.json()).messages[0].id;

        const cB = await loginClient(base, 'audit27-s2c-c-b-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const listB = await cB('/api/sites/' + siteId + '/messages');
        assert.equal(listB.status, 403, 'B must not be able to list A\'s messages');

        const readB = await cB('/api/sites/' + siteId + '/messages/' + mid + '/read', { method: 'POST' });
        assert.equal(readB.status, 403, 'B must not be able to mark A\'s message read');

        const delB = await cB('/api/sites/' + siteId + '/messages/' + mid, { method: 'DELETE' });
        assert.equal(delB.status, 403, 'B must not be able to delete A\'s message');

        // Untouched by B's refused attempts — still there, still unread, for A.
        const listA2 = await cA('/api/sites/' + siteId + '/messages');
        const listA2Body = await listA2.json();
        assert.equal(listA2Body.messages.length, 1);
        assert.equal(listA2Body.messages[0].readAt, null);
    } finally {
        await stop();
    }
});

test('S-2C: the honeypot field is accepted (200) but the submission is silently dropped, never stored', async () => {
    const { base, stop } = await bootIsolatedServer('audit27-s2c-d-');
    try {
        const cA = await loginClient(base, 'audit27-s2c-d-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const { siteId, slug } = await publishLiveSite(cA, 'S2C Honeypot');

        const post = await fetch(base + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slug, name: 'Bot', contact: 'bot@bot.com', message: 'spam spam spam',
                website: 'http://spam.example', // honeypot — a real visitor never fills this
            }),
        });
        assert.equal(post.status, 200, 'a bot must never learn its submission was rejected');

        const list = await cA('/api/sites/' + siteId + '/messages');
        const listBody = await list.json();
        assert.equal(listBody.messages.length, 0, 'the honeypot submission must never reach the owner\'s inbox');
    } finally {
        await stop();
    }
});

test('S-2C: mark-as-read and delete work and are ownership-checked; deleting the site cascades its messages', async () => {
    const { base, stop } = await bootIsolatedServer('audit27-s2c-e-');
    try {
        const cA = await loginClient(base, 'audit27-s2c-e-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const { siteId, slug } = await publishLiveSite(cA, 'S2C Read Delete');

        await fetch(base + '/api/site-messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, name: 'A', contact: 'a@a.com', message: 'msg1' }),
        });
        await fetch(base + '/api/site-messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, name: 'B', contact: 'b@b.com', message: 'msg2' }),
        });

        const list0 = await (await cA('/api/sites/' + siteId + '/messages')).json();
        assert.equal(list0.messages.length, 2);
        assert.equal(list0.unread, 2);
        const [m1, m2] = list0.messages;

        const readRes = await cA('/api/sites/' + siteId + '/messages/' + m1.id + '/read', { method: 'POST' });
        assert.equal(readRes.status, 200);
        const list1 = await (await cA('/api/sites/' + siteId + '/messages')).json();
        assert.equal(list1.unread, 1, 'exactly one message was marked read');

        // Idempotent: marking the same message read again still succeeds.
        const readAgain = await cA('/api/sites/' + siteId + '/messages/' + m1.id + '/read', { method: 'POST' });
        assert.equal(readAgain.status, 200);

        const delRes = await cA('/api/sites/' + siteId + '/messages/' + m2.id, { method: 'DELETE' });
        assert.equal(delRes.status, 200);
        const list2 = await (await cA('/api/sites/' + siteId + '/messages')).json();
        assert.equal(list2.messages.length, 1);
        assert.equal(list2.messages[0].id, m1.id);

        // Deleting an already-deleted / unknown message id is a clean 404, not a 500.
        const delAgain = await cA('/api/sites/' + siteId + '/messages/' + m2.id, { method: 'DELETE' });
        assert.equal(delAgain.status, 404);

        // Deleting the site cascades its messages. Going through the real
        // HTTP DELETE /api/sites/:id here would also need to cancel the
        // real-money-shaped Stripe subscription test-pay just created
        // (ACTIVE_SUBSCRIPTION guard, unrelated to S-2C) — so this proves
        // the cascade at the same registry layer handleDeleteSite itself
        // calls (reg.deleteSite), same as bot/account-data.js#eraseAccount
        // relies on for GDPR account erasure.
        const reg = require('../registry.js');
        reg.deleteSite(siteId);
        assert.deepEqual(reg.listSiteMessagesBySite(siteId), [], 'a deleted site must not leave its contact-form inbox behind');
    } finally {
        await stop();
    }
});

test('S-2C: per-(IP, slug) rate limiting refuses further submissions with 429', async () => {
    const { base, stop } = await bootIsolatedServer('audit27-s2c-f-');
    try {
        const cA = await loginClient(base, 'audit27-s2c-f-' + crypto.randomUUID().slice(0, 8) + '@example.com');
        const { slug } = await publishLiveSite(cA, 'S2C Rate Limit');

        const statuses = [];
        for (let i = 0; i < 15; i++) {
            const r = await fetch(base + '/api/site-messages', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug, name: 'Flood ' + i, contact: 'x@x.com', message: 'x' }),
            });
            statuses.push(r.status);
        }
        assert.ok(statuses.some((s) => s === 429), 'must rate-limit a burst of submissions to the same slug: ' + statuses.join(','));
        assert.ok(statuses.some((s) => s === 200), 'must still have accepted at least the first few, under the limit');
    } finally {
        await stop();
    }
});
