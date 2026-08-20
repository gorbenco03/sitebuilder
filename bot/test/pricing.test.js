'use strict';
/**
 * bot/test/pricing.test.js — Pay-before-publish + single pricing source (S2).
 *
 * Contract:
 *   - bot/pricing.js is the only amount source (10000 cents; renewal 2900)
 *   - EU → EUR, GB/UK → GBP, else USD
 *   - Country from CF-IPCountry, else explicit country/region, else USD
 *   - GET /api/config exposes amount + currency + renewal (not a 3-day free trial)
 *   - Unpaid POST /api/publish must NOT set status live / must NOT deploy
 *
 * Run: node bot/test/pricing.test.js
 */
const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const http   = require('http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-test-'));
process.env.DATA_DIR          = tmpDir;
process.env.SERVER_SECRET     = 'pricing-test-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_FAKE_DEPLOY = '1';
process.env.PUBLIC_URL        = 'http://127.0.0.1:0';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BUILD_FEE_EUR;
delete process.env.BUILD_FEE_USD;
delete process.env.RETAINER_EUR;
delete process.env.TRIAL_DAYS;
delete process.env.PAYMENT_CURRENCY;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;
delete process.env.CLOUDFLARE_API_TOKEN;

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

// ── Unit: pricing.js ─────────────────────────────────────────────────────────
const pricingPath = path.join(__dirname, '..', 'pricing.js');

(async () => {
    await check('bot/pricing.js exists and exports getPricing', async () => {
        assert.ok(fs.existsSync(pricingPath), 'bot/pricing.js must exist');
        const pricing = require(pricingPath);
        assert.strictEqual(typeof pricing.getPricing, 'function');
        assert.strictEqual(typeof pricing.resolveCountryCode, 'function');
        assert.strictEqual(pricing.PRICE_CENTS, 10000);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
    });

    await check('EU country → EUR 10000 / renewal 2900', async () => {
        const pricing = require(pricingPath);
        for (const cc of ['RO', 'DE', 'FR', 'IT', 'ES', 'NL']) {
            const p = pricing.getPricing({ country: cc });
            assert.strictEqual(p.currency, 'eur', cc);
            assert.strictEqual(p.amountCents, 10000);
            assert.strictEqual(p.renewalCents, 2900);
            assert.strictEqual(p.amount, 100);
            assert.strictEqual(p.renewal, 29);
        }
    });

    await check('GB and UK → GBP', async () => {
        const pricing = require(pricingPath);
        assert.strictEqual(pricing.getPricing({ country: 'GB' }).currency, 'gbp');
        assert.strictEqual(pricing.getPricing({ country: 'UK' }).currency, 'gbp');
        assert.strictEqual(pricing.getPricing({ country: 'gb' }).amountCents, 10000);
    });

    await check('non-EU / non-UK → USD', async () => {
        const pricing = require(pricingPath);
        for (const cc of ['US', 'CA', 'AU', 'JP', 'BR']) {
            assert.strictEqual(pricing.getPricing({ country: cc }).currency, 'usd', cc);
        }
    });

    await check('CF-IPCountry wins over explicit country', async () => {
        const pricing = require(pricingPath);
        const p = pricing.getPricing({
            headers: { 'cf-ipcountry': 'DE' },
            country: 'US',
        });
        assert.strictEqual(p.countryCode, 'DE');
        assert.strictEqual(p.currency, 'eur');
    });

    await check('explicit country used when CF absent; default USD bucket', async () => {
        const pricing = require(pricingPath);
        const explicit = pricing.getPricing({ country: 'RO' });
        assert.strictEqual(explicit.currency, 'eur');
        const fallback = pricing.getPricing({});
        assert.strictEqual(fallback.currency, 'usd');
        assert.ok(fallback.countryCode === 'US' || fallback.countryCode == null || fallback.countryCode === '');
    });

    await check('getPricingFromRequest reads CF-IPCountry header', async () => {
        const pricing = require(pricingPath);
        assert.strictEqual(typeof pricing.getPricingFromRequest, 'function');
        const p = pricing.getPricingFromRequest({ headers: { 'cf-ipcountry': 'GB' } });
        assert.strictEqual(p.currency, 'gbp');
        assert.strictEqual(p.amountCents, 10000);
    });

    // ── Integration: server config + unpaid publish gate ────────────────────
    const { startServer } = require('../server.js');
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.PUBLIC_URL = base;

    // Minimal cookie client
    const jar = {};
    async function client(urlPath, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers.Cookie = cookieStr;
        const res = await fetch(base + urlPath, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
            const [pair] = sc.split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        }
        return res;
    }

    await check('GET /api/config default → amount 100, currency usd, renewal 29 (no free trialDays=3)', async () => {
        const res = await fetch(`${base}/api/config`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(body.amount, 100, 'amount must be 100');
        assert.strictEqual(body.amountCents, 10000);
        assert.strictEqual(String(body.currency).toLowerCase(), 'usd');
        assert.strictEqual(body.renewal, 29);
        assert.strictEqual(body.renewalCents, 2900);
        // Must not advertise a 3-day unpaid live trial
        if (body.trialDays != null) {
            assert.notStrictEqual(body.trialDays, 3, 'must not advertise trialDays=3 free trial');
        }
        // Commercial amount must not be the old 49 default
        assert.notStrictEqual(body.priceEur, 49);
        assert.notStrictEqual(body.amount, 49);
    });

    await check('GET /api/config with CF-IPCountry: RO → EUR', async () => {
        const res = await fetch(`${base}/api/config`, { headers: { 'CF-IPCountry': 'RO' } });
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(String(body.currency).toLowerCase(), 'eur');
        assert.strictEqual(body.amount, 100);
        assert.strictEqual(body.renewal, 29);
    });

    await check('GET /api/config ?country=GB → GBP', async () => {
        const res = await fetch(`${base}/api/config?country=GB`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.strictEqual(String(body.currency).toLowerCase(), 'gbp');
        assert.strictEqual(body.amountCents, 10000);
    });

    // Auth for publish tests
    const testEmail = 'pricing-' + Date.now() + '@example.com';
    {
        const res = await fetch(`${base}/api/auth/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail }),
        });
        const body = await res.json();
        assert.ok(body.devLink, 'devLink required for test auth');
        let token;
        try { token = new URL(body.devLink).searchParams.get('token'); }
        catch {
            const qs = body.devLink.includes('?') ? body.devLink.slice(body.devLink.indexOf('?') + 1) : body.devLink;
            token = new URLSearchParams(qs).get('token');
        }
        await client(`/auth/verify?token=${token}`);
    }

    const templatesDir = path.join(__dirname, '..', '..', 'templates');
    let tplId = 'patiserie';
    try {
        const dirs = fs.readdirSync(templatesDir).filter((d) => {
            try { return fs.statSync(path.join(templatesDir, d)).isDirectory(); } catch { return false; }
        });
        if (dirs.length) tplId = dirs[0];
    } catch (_) {}

    const MINIMAL_CONFIG = {
        business: { name: 'Pricing Test Co', tagline: 'T', title: 'T', metaDescription: 'd', about: 'a', lang: 'ro' },
        labels:   { about: 'A', instaTitle: 'I', instaFollow: 'F', scroll: 'S', waQr: 'Q', waOpen: 'O' },
        theme:    { primary: '#E8588C', primaryLight: '#f07aa5', primaryDark: '#d14477', cream: '#fafafa' },
        logo: '', showWordmark: true,
        hero:     { background: '#fff', ctaLabel: 'Go' },
        servicesTitle: 'S',
        services: [{ icon: '✦', label: 'X' }],
        galleryTitle: '',
        categories: [],
        instagram: { handle: '', url: '', gallery: [] },
        contact: { title: 'C', intro: 'i', instagram: { url: '', label: '' }, facebook: { url: '', label: '' }, whatsapp: '', phone: '', phoneDisplay: '', waHref: '', address: '', addressHref: '' },
        seo:    { ogImage: '', jsonLd: '' },
        footer: { address: 'A', year: 2026, note: 'n' },
    };

    // Spy: unpaid path must not call deploy. HIDOOK_FAKE_DEPLOY still active — we assert
    // status/url instead of monkey-patching the deploy stack.
    await check('POST /api/publish unpaid (no Stripe) → draft, not live, no public deploy', async () => {
        const res = await client('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateId: tplId,
                config: MINIMAL_CONFIG,
                images: [],
                slug: 'pricing-unpaid-' + crypto.randomBytes(3).toString('hex'),
            }),
        });
        const body = await res.json().catch(() => ({}));
        assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
        assert.ok(body.site, 'must return site');
        assert.strictEqual(body.site.paid, false, 'unpaid');
        assert.notStrictEqual(body.site.status, 'live', 'must not go live unpaid');
        // No public production URL from deploy
        if (body.site.url) {
            assert.ok(
                !String(body.site.url).includes('.test.local'),
                'fake deploy URL must not be assigned on unpaid path'
            );
        }
        assert.strictEqual(body.paymentUrl, null, 'no Stripe → paymentUrl null');
        // trialEndsAt must not be required for unpaid draft
        // (may be null/undefined — must not be a free live trial window)
        if (body.site.status === 'live') {
            throw new Error('unpaid live publish is forbidden');
        }
    });

    await check('server.js does not hardcode BUILD_FEE default 49 as commercial amount', async () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        // Allowed to mention 49 only in comments about migration; commercial path must use pricing.js
        assert.ok(src.includes("require('./pricing.js')") || src.includes('require("./pricing.js")'),
            'server.js must require pricing.js');
        assert.ok(!/parseFloat\(process\.env\.BUILD_FEE_EUR\)\s*\|\|\s*parseFloat\(process\.env\.BUILD_FEE_USD\)\s*\|\|\s*49/.test(src),
            'server.js must not keep BUILD_FEE default 49 as amount source');
    });

    await check('flow.js consumes pricing.js (no unpaid live trial publish as commercial path)', async () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'flow.js'), 'utf8');
        assert.ok(src.includes("require('./pricing.js')") || src.includes('require("./pricing.js")'),
            'flow.js must require pricing.js');
        // Old free trial publish path markers should be gone from the active Telegram finish path
        assert.ok(
            !src.includes('Trial publish — IMEDIAT și GRATUIT') &&
            !src.includes('IMEDIAT și GRATUIT pe platforma noastră'),
            'flow.js must not advertise immediate free trial publish'
        );
    });

    await check('webpublish.js uses pricing.js for checkout amounts', async () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'webpublish.js'), 'utf8');
        assert.ok(src.includes("require('./pricing.js')") || src.includes('require("./pricing.js")'),
            'webpublish.js must require pricing.js');
        assert.ok(!/parseFloat\(process\.env\.BUILD_FEE_EUR\)\s*\|\|\s*parseFloat\(process\.env\.BUILD_FEE_USD\)\s*\|\|\s*49/.test(src),
            'webpublish must not hardcode BUILD_FEE default 49');
    });

    await check('builder copy: no free trial / GRATUIT publish promises', async () => {
        const html = fs.readFileSync(path.join(__dirname, '..', '..', 'builder', 'index.html'), 'utf8');
        const app  = fs.readFileSync(path.join(__dirname, '..', '..', 'builder', 'app.js'), 'utf8');
        const combined = html + '\n' + app;
        assert.ok(!/3 zile gratuite/i.test(combined), 'no "3 zile gratuite"');
        assert.ok(!/publici GRATUIT/i.test(combined), 'no "publici GRATUIT"');
        assert.ok(!/Publicăm site-ul tău GRATUIT/i.test(combined), 'no free publish modal title');
        assert.ok(!/perioadă de probă/i.test(combined) || !/Gratuit cu perioadă/i.test(combined),
            'no free trial hero badge');
        // permanent hosting from one payment
        assert.ok(!/păstrează permanent/i.test(combined) && !/păstrezi permanent/i.test(combined),
            'must not promise permanent hosting from one payment');
    });

    srv.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
