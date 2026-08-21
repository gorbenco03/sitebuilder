'use strict';
/**
 * bot/test/telegram-draft.test.js — S4: Telegram intake opens the same browser draft.
 *
 * Contract (PRODUCT.md Surfaces):
 *   Telegram = acquisition / guided intake that opens the **same** draft.
 *   No second checkout or deploy state machine. Pay stays browser /api/publish.
 *
 * Run: node bot/test/telegram-draft.test.js
 * Exits non-zero on the first failed assertion batch.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const CATALOG = ['product-menu', 'local-service', 'portfolio'];
const REJECTED = ['patiserie', 'constructii', 'servicii', 'beauty', 'evenimente'];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-draft-'));
process.env.DATA_DIR = tmpDir;
process.env.PUBLIC_URL = 'http://127.0.0.1:9876';
// Ensure Stripe/Revolut are NOT configured so finish cannot "accidentally" need live keys.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.REVOLUT_API_KEY;
delete process.env.REVOLUT_SECRET_KEY;
delete process.env.PAYMENT_PROVIDER;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'test-secret-telegram-draft-s4';

const flowPath = path.join(__dirname, '..', 'flow.js');
const flowSrc  = fs.readFileSync(flowPath, 'utf8');
const flow     = require('../flow.js');
const registry = require('../registry.js');

let failed = 0;
const results = [];

async function check(name, fn) {
    try {
        await fn();
        results.push({ ok: true, name });
        console.log('PASS', name);
    } catch (e) {
        failed++;
        results.push({ ok: false, name, msg: e.message });
        console.error('FAIL', name, '-', e.message);
    }
}

function makeCtx(chatId, replies) {
    return {
        chat: { id: chatId },
        from: { id: chatId, username: 'test_user', first_name: 'Ana' },
        reply: async (text) => { replies.push(String(text)); },
    };
}

function makeSession(overrides = {}) {
    const siteDir = fs.mkdtempSync(path.join(tmpDir, 'site-'));
    const config = {
        business: { name: 'Cafe Ana' },
        hero: { title: 'Cafe Ana', subtitle: 'Bun venit' },
    };
    fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(config), 'utf8');
    return {
        phase: 'wizard',
        data: { name: 'Cafe Ana' },
        siteDir,
        siteSlug: 'cafe-ana-test',
        siteConfig: config,
        gallery: [],
        ...overrides,
    };
}

/**
 * Stranger /start welcome product copy only (Salut! … before consentNote()).
 * Excludes legacy start=paid deep-link replies and GDPR consent tail.
 */
function extractStrangerStartWelcomeSrc(src) {
    // Literal concat that ends with consentNote() then STEPS[0]
    const m = src.match(
        /['"]👋 Salut![\s\S]{0,1200}?consentNote\(\)/
    );
    return m ? m[0] : null;
}

function foldRo(s) {
    return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/** Product narrative only — drop GDPR ℹ️ block (may mention publish as data purpose). */
function productNarrative(text) {
    const i = String(text).indexOf('ℹ️');
    return i >= 0 ? String(text).slice(0, i) : String(text);
}

(async () => {
    // ── S10: /start welcome must not promise Telegram publishes the live site ──
    await check('handleStart welcome source must not promise publică/publica site-ul', () => {
        const welcome = extractStrangerStartWelcomeSrc(flowSrc);
        assert.ok(welcome, 'stranger /start Salut! welcome must exist before consentNote()');
        const folded = foldRo(welcome);
        // Exact bad product promise from pre-S10 copy (with/without diacritics)
        assert.ok(
            !/publica\s+site-ul/.test(folded),
            'handleStart welcome must not say publică/publica site-ul (Telegram is not the publisher)'
        );
        // AI/we publish here as the Telegram outcome
        assert.ok(
            !/si\s+publica\s+site/.test(folded) &&
            !/alege\s+culorile\s+si\s+publica/.test(folded) &&
            !/publicam\s+(automat\s+)?site/.test(folded),
            'handleStart welcome must not promise Telegram/AI publishes the site'
        );
    });

    await check('handleStart welcome may point to Hidook builder draft (edit + pay before publish)', () => {
        const welcome = extractStrangerStartWelcomeSrc(flowSrc);
        assert.ok(welcome, 'stranger /start Salut! welcome must exist');
        const folded = foldRo(welcome);
        assert.ok(
            /builder|editor|draft|hidook/.test(folded),
            'welcome should mention the Hidook builder / draft path'
        );
        assert.ok(
            /plat|edit/.test(folded),
            'welcome may note edit and/or pay before publish'
        );
    });

    await check('handleStart runtime welcome reply does not promise Telegram publishes', async () => {
        const replies = [];
        const chatId = 910001;
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId, username: 'start_user', first_name: 'Ana' },
            match: '',
            reply: async (text) => { replies.push(String(text)); },
        };
        await flow.handleStart(ctx);
        assert.ok(replies.length >= 1, 'handleStart must send a welcome reply');
        // Product outcome only (GDPR consentNote may still say data is used to build/publish)
        const folded = foldRo(productNarrative(replies[0]));
        assert.ok(
            !/publica\s+site-ul/.test(folded),
            'runtime welcome product copy must not contain publică/publica site-ul'
        );
        assert.ok(
            !/alege\s+culorile\s+si\s+publica/.test(folded),
            'runtime welcome must not promise AI publishes the site'
        );
        assert.ok(
            /builder|editor|draft|hidook/.test(folded),
            'runtime welcome should open path to Hidook builder draft'
        );
    });

    // ── Source contract: active finish must not be Telegram-checkout commerce ──
    await check('flow.js finish path must not create Stripe checkout with platform=telegram', () => {
        // Isolate the active finish helper body (exported or legacy name).
        const markers = [
            'async function finishTelegramIntake',
            'async function _prepareCheckoutAndFinish',
            'async function prepareTelegramDraft',
        ];
        let body = null;
        for (const m of markers) {
            const i = flowSrc.indexOf(m);
            if (i >= 0) {
                // Take until next top-level async function or module.exports
                const rest = flowSrc.slice(i);
                const end = rest.search(/\nasync function |\nmodule\.exports/);
                body = end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
                break;
            }
        }
        assert.ok(body, 'finish helper function must exist in flow.js');
        // Must not open a payment checkout from Telegram finish
        assert.ok(
            !/createCheckout\s*\(/.test(body),
            'active Telegram finish must not call createCheckout'
        );
        assert.ok(
            !/createOrder\s*\(/.test(body),
            'active Telegram finish must not create payment orders'
        );
        // Must not send users to t.me paid deep-links as the commercial path
        assert.ok(
            !/start=paid/.test(body),
            'active finish must not use t.me/?start=paid success URL'
        );
    });

    await check('flow.js finish path must open builder via createLoginToken + /auth/verify', () => {
        const hasExport =
            typeof flow.finishTelegramIntake === 'function' ||
            typeof flow.prepareTelegramDraft === 'function' ||
            typeof flow._prepareCheckoutAndFinish === 'function';
        assert.ok(hasExport, 'finishTelegramIntake (or equivalent) must be exported for tests');

        const srcHit =
            flowSrc.includes('createLoginToken') &&
            (flowSrc.includes('/auth/verify') || flowSrc.includes('auth/verify'));
        assert.ok(srcHit, 'finish path must call createLoginToken and build /auth/verify URL');
    });

    await check('flow.js must not default createSite templateId to patiserie', () => {
        assert.ok(
            !/templateId:\s*session\.data\s*&&\s*session\.data\.templateId\s*\|\|\s*['"]patiserie['"]/.test(flowSrc) &&
            !/templateId:\s*['"]patiserie['"]/.test(flowSrc),
            'patiserie must not be the createSite default'
        );
        // Rejected verticals must not appear as commercial defaults near createSite in finish
        for (const bad of REJECTED) {
            const re = new RegExp(`createSite\\([\\s\\S]{0,200}['"]${bad}['"]`);
            assert.ok(!re.test(flowSrc), `createSite must not default to rejected id ${bad}`);
        }
    });

    // ── Behavioral: finishTelegramIntake ────────────────────────────────────
    const finish =
        flow.finishTelegramIntake ||
        flow.prepareTelegramDraft ||
        flow._prepareCheckoutAndFinish;

    await check('finishTelegramIntake is a function', () => {
        assert.strictEqual(typeof finish, 'function', 'export finishTelegramIntake');
    });

    if (typeof finish === 'function') {
        await check('finish: registers draft unpaid site (no live deploy)', async () => {
            const chatId = 900001;
            const replies = [];
            const ctx = makeCtx(chatId, replies);
            const session = makeSession({ templateId: 'local-service' });

            await finish(ctx, session, chatId);

            const user = registry.getOrCreateUserByTelegram(chatId, {});
            const sites = registry.listSites(user.id);
            assert.ok(sites.length >= 1, 'at least one site registered');
            const site = sites[sites.length - 1];
            assert.strictEqual(site.status, 'draft', 'status must be draft');
            assert.strictEqual(site.paid, false, 'paid must be false');
            assert.ok(!site.url, 'must not have a live public URL');
            assert.notStrictEqual(site.status, 'live', 'must not be live');
        });

        await check('finish: templateId from session.templateId (catalog), never patiserie', async () => {
            const chatId = 900002;
            const replies = [];
            const ctx = makeCtx(chatId, replies);
            const session = makeSession({ templateId: 'portfolio' });

            await finish(ctx, session, chatId);

            const user = registry.getOrCreateUserByTelegram(chatId, {});
            const sites = registry.listSites(user.id);
            const site = sites[sites.length - 1];
            assert.strictEqual(site.templateId, 'portfolio');
            assert.ok(CATALOG.includes(site.templateId));
            assert.ok(!REJECTED.includes(site.templateId));
        });

        await check('finish: default templateId is catalog product-menu when unset', async () => {
            const chatId = 900003;
            const replies = [];
            const ctx = makeCtx(chatId, replies);
            const session = makeSession(); // no templateId

            await finish(ctx, session, chatId);

            const user = registry.getOrCreateUserByTelegram(chatId, {});
            const sites = registry.listSites(user.id);
            const site = sites[sites.length - 1];
            assert.ok(CATALOG.includes(site.templateId), `got ${site.templateId}`);
            assert.strictEqual(site.templateId, 'product-menu');
        });

        await check('finish: reply includes builder magic-link URL (/auth/verify + token)', async () => {
            const chatId = 900004;
            const replies = [];
            const ctx = makeCtx(chatId, replies);
            const session = makeSession({ templateId: 'product-menu' });

            await finish(ctx, session, chatId);

            const joined = replies.join('\n');
            assert.ok(
                /\/auth\/verify\?token=/.test(joined),
                'reply must include /auth/verify?token= magic link'
            );
            assert.ok(
                joined.includes(process.env.PUBLIC_URL) || joined.includes('http://127.0.0.1:9876'),
                'reply must use PUBLIC_URL for builder link'
            );
            // Human Romanian: continue in site builder — not Telegram publishes after pay
            assert.ok(
                /builder|editor|contin/i.test(joined),
                'reply must tell user to continue in the site builder'
            );
            assert.ok(
                !/publicăm automat/i.test(joined) && !/După plată publicăm automat/i.test(joined),
                'must not say Telegram will publish automatically after pay'
            );
            assert.ok(
                !/t\.me\//i.test(joined) || !/start=paid/i.test(joined),
                'must not send t.me paid checkout as commercial path'
            );
            assert.ok(
                !/\[Plătește aici\]/i.test(joined),
                'must not embed Telegram Stripe pay link as the finish CTA'
            );
        });

        await check('finish: magic token consumes to the same user + siteId payload', async () => {
            const chatId = 900005;
            const replies = [];
            const ctx = makeCtx(chatId, replies);
            const session = makeSession({ templateId: 'local-service' });

            await finish(ctx, session, chatId);

            const joined = replies.join('\n');
            const m = joined.match(/\/auth\/verify\?token=([0-9a-f]{64})/i);
            assert.ok(m, 'token hex in URL');
            const token = m[1];
            const payload = registry.consumeLoginToken(token);
            assert.ok(payload, 'token must be valid');
            const user = registry.getOrCreateUserByTelegram(chatId, {});
            assert.ok(payload.userId === user.id || payload.email, 'token binds user');
            if (payload.userId) assert.strictEqual(payload.userId, user.id);
            assert.ok(payload.siteId, 'token carries siteId for that draft');
            const site = registry.getSite(payload.siteId);
            assert.ok(site, 'siteId resolves');
            assert.strictEqual(site.userId, user.id);
            assert.strictEqual(site.status, 'draft');
            assert.strictEqual(site.paid, false);
        });

        await check('finish: does not create registry orders / stripe session on intake', async () => {
            const chatId = 900006;
            const replies = [];
            const ctx = makeCtx(chatId, replies);
            const session = makeSession({ templateId: 'product-menu' });
            // Snapshot order count via registry file
            const regFile = path.join(tmpDir, '.registry.json');
            const before = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : {};
            const ordersBefore = Object.keys(before.orders || {}).length;

            await finish(ctx, session, chatId);

            const after = JSON.parse(fs.readFileSync(regFile, 'utf8'));
            const ordersAfter = Object.keys(after.orders || {}).length;
            assert.strictEqual(ordersAfter, ordersBefore, 'no new payment orders on Telegram finish');
        });
    }

    // ── Legacy pay/deploy: point to builder, no new TG deploy happy path ──
    await check('legacy phase=pay text points user to builder (not silent wait forever)', async () => {
        const chatId = 900010;
        const replies = [];
        // Seed a legacy pay session
        flow.sessions.set(chatId, { phase: 'pay', stripeSessionId: 'cs_legacy', data: {} });
        const ctx = {
            chat: { id: chatId },
            message: { text: 'salut' },
            reply: async (t) => { replies.push(String(t)); },
        };
        await flow.handleText(ctx);
        const joined = replies.join('\n');
        assert.ok(replies.length > 0, 'must reply');
        // Prefer builder guidance over pure "waiting for payment"
        assert.ok(
            /builder|editor|\/app\//i.test(joined) || /contin/i.test(joined),
            'legacy pay session should be steered to the browser builder'
        );
    });

    // ── server.js auth/verify accepts userId tokens (telegram intake) ──
    await check('GET /auth/verify accepts createLoginToken({userId,siteId}) → session + /app/', async () => {
        const server = require('../server.js');
        const auth = require('../auth.js');
        const user = registry.getOrCreateUserByTelegram(900020, { username: 'verify_tg' });
        const site = registry.createSite({
            userId: user.id,
            templateId: 'product-menu',
            templateVersion: 1,
            slug: 'verify-draft-' + crypto.randomBytes(3).toString('hex'),
            platform: 'telegram',
        });
        const { token } = registry.createLoginToken({
            userId: user.id,
            siteId: site.id,
            purpose: 'telegram-intake',
        });

        process.env.PUBLIC_URL = 'http://127.0.0.1:0';
        const srv = server.startServer({ port: 0 });
        await new Promise((r) => srv.once('listening', r));
        const addr = srv.address();
        const base = `http://127.0.0.1:${addr.port}`;

        const res = await fetch(`${base}/auth/verify?token=${token}`, { redirect: 'manual' });
        assert.strictEqual(res.status, 302);
        const loc = res.headers.get('location') || '';
        assert.ok(loc.includes('/app/'), `redirect must open /app/, got ${loc}`);
        const setCookie = res.headers.get('set-cookie') || '';
        assert.ok(setCookie.includes('hb_session='), 'session cookie must be set');

        // Cookie authenticates as the telegram user
        const me = await fetch(`${base}/api/me`, { headers: { Cookie: setCookie.split(';')[0] } });
        assert.strictEqual(me.status, 200);
        const body = await me.json();
        assert.strictEqual(body.user.id, user.id);

        srv.close();
    });

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

    if (failed) {
        console.error(`\ntelegram-draft.test.js: ${failed} failed`);
        process.exit(1);
    }
    console.log('\ntelegram-draft.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    process.exit(1);
});
