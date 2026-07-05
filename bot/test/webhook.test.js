'use strict';
/**
 * Test: Stripe webhook signature verification (payments.js) + HTTP server routing
 * (server.js) + flow.handleStripeWebhookEvent guards (negative paths — the positive
 * publish path needs a live deploy provider and is covered by the E2E checklist).
 *
 * Run:  node bot/test/webhook.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Isolate everything DATA_DIR-backed (sessions, ledger, ratelimit) BEFORE requiring flow.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-test-'));
process.env.DATA_DIR = tmpDir;

const payments = require('../payments.js');
const { createHandler, startServer } = require('../server.js');
const flow = require('../flow.js');

let failed = false;
function check(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => console.log('PASS', name))
        .catch((e) => { failed = true; console.error('FAIL', name, '-', e.message); });
}

/** Build a valid Stripe-Signature header for a payload (the scheme Stripe uses). */
function sign(payload, secret, tSec = Math.floor(Date.now() / 1000)) {
    const mac = crypto.createHmac('sha256', secret).update(`${tSec}.${payload}`, 'utf8').digest('hex');
    return `t=${tSec},v1=${mac}`;
}

const SECRET = 'whsec_test_secret_123';

(async () => {
    // ------------------------------------------------------------------
    // payments.verifyWebhookSignature
    // ------------------------------------------------------------------
    await check('valid signature verifies', () => {
        const body = JSON.stringify({ type: 'checkout.session.completed' });
        assert.strictEqual(payments.verifyWebhookSignature(body, sign(body, SECRET), SECRET), true);
    });

    await check('Buffer body verifies identically', () => {
        const body = Buffer.from('{"a":1}');
        assert.strictEqual(payments.verifyWebhookSignature(body, sign(body.toString(), SECRET), SECRET), true);
    });

    await check('wrong secret is rejected', () => {
        const body = '{"a":1}';
        assert.strictEqual(payments.verifyWebhookSignature(body, sign(body, 'whsec_other'), SECRET), false);
    });

    await check('tampered body is rejected', () => {
        const header = sign('{"amount":100}', SECRET);
        assert.strictEqual(payments.verifyWebhookSignature('{"amount":999}', header, SECRET), false);
    });

    await check('stale timestamp is rejected (replay protection)', () => {
        const body = '{"a":1}';
        const old  = Math.floor(Date.now() / 1000) - 4000;   // > 300s tolerance
        assert.strictEqual(payments.verifyWebhookSignature(body, sign(body, SECRET, old), SECRET), false);
    });

    await check('malformed header / missing parts are rejected, never throw', () => {
        const body = '{"a":1}';
        for (const h of ['', 'garbage', 't=abc,v1=00', 't=123', 'v1=deadbeef', null, undefined]) {
            assert.strictEqual(payments.verifyWebhookSignature(body, h, SECRET), false, `header: ${h}`);
        }
        assert.strictEqual(payments.verifyWebhookSignature('', sign('', SECRET), SECRET), false);
    });

    await check('constructWebhookEvent parses on valid sig, throws on invalid', () => {
        const body = JSON.stringify({ type: 'x', id: 'evt_1' });
        const evt  = payments.constructWebhookEvent(body, sign(body, SECRET), SECRET);
        assert.strictEqual(evt.id, 'evt_1');
        assert.throws(() => payments.constructWebhookEvent(body, 'garbage', SECRET), /Invalid Stripe webhook signature/);
    });

    // ------------------------------------------------------------------
    // server.js routing (ephemeral port)
    // ------------------------------------------------------------------
    const received = [];
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const srv = startServer({ port: 0, onStripeEvent: async (e) => { received.push(e); } });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    await check('GET /health → 200 {ok:true}', async () => {
        const res = await fetch(`${base}/health`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual((await res.json()).ok, true);
    });

    await check('POST /webhooks/stripe without secret configured → 503', async () => {
        const res = await fetch(`${base}/webhooks/stripe`, { method: 'POST', body: '{}' });
        assert.strictEqual(res.status, 503);
    });

    await check('POST /webhooks/stripe with bad signature → 400', async () => {
        process.env.STRIPE_WEBHOOK_SECRET = SECRET;
        const res = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'stripe-signature': 'garbage' },
            body: '{"type":"checkout.session.completed"}',
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(received.length, 0, 'handler must not run on bad signature');
    });

    await check('POST /webhooks/stripe with valid signature → 200 + handler runs', async () => {
        const body = JSON.stringify({ id: 'evt_ok', type: 'checkout.session.completed', data: { object: {} } });
        const res = await fetch(`${base}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'stripe-signature': sign(body, SECRET) },
            body,
        });
        assert.strictEqual(res.status, 200);
        await new Promise((r) => setTimeout(r, 30));   // handler runs after the ACK
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].id, 'evt_ok');
    });

    await check('unknown route → 404', async () => {
        const res = await fetch(`${base}/nope`);
        assert.strictEqual(res.status, 404);
    });

    srv.close();

    // ------------------------------------------------------------------
    // flow.handleStripeWebhookEvent — guard rails (no publish is triggered)
    // ------------------------------------------------------------------
    const paidEvent = (chatId, csId, extra = {}) => ({
        type: 'checkout.session.completed',
        data: { object: { id: csId, payment_status: 'paid', metadata: { chatId: String(chatId), platform: 'telegram' }, ...extra } },
    });

    await check('ignores unrelated event types', async () => {
        const r = await flow.handleStripeWebhookEvent({ type: 'invoice.paid', data: { object: {} } });
        assert.strictEqual(r.handled, false);
    });

    await check('ignores completed-but-unpaid sessions (delayed methods)', async () => {
        const evt = paidEvent(111, 'cs_1');
        evt.data.object.payment_status = 'unpaid';
        const r = await flow.handleStripeWebhookEvent(evt);
        assert.strictEqual(r.handled, false);
        assert.match(r.reason, /not paid/);
    });

    await check('no chatId metadata → not handled', async () => {
        const evt = { type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'paid', metadata: {} } } };
        const r = await flow.handleStripeWebhookEvent(evt);
        assert.strictEqual(r.handled, false);
    });

    await check('unknown chat (order already finished) → acked as handled, no throw', async () => {
        const r = await flow.handleStripeWebhookEvent(paidEvent(424242, 'cs_3'));
        assert.strictEqual(r.handled, true);
        assert.match(r.reason, /no session/);
    });

    await check('checkout session id mismatch → rejected', async () => {
        flow.sessions.set(555, { phase: 'pay', stripeSessionId: 'cs_real' });
        const r = await flow.handleStripeWebhookEvent(paidEvent(555, 'cs_forged'));
        assert.strictEqual(r.handled, false);
        assert.match(r.reason, /mismatch/);
        flow.sessions.delete(555);
    });

    await check('already published → idempotent no-op', async () => {
        flow.sessions.set(556, { phase: 'done', stripeSessionId: 'cs_x', published: true });
        const r = await flow.handleStripeWebhookEvent(paidEvent(556, 'cs_x'));
        assert.strictEqual(r.handled, true);
        assert.match(r.reason, /already/);
        flow.sessions.delete(556);
    });

    await check('wizard-phase session (not yet at payment) → rejected', async () => {
        flow.sessions.set(557, { phase: 'wizard', stripeSessionId: null });
        const r = await flow.handleStripeWebhookEvent(paidEvent(557, 'cs_y'));
        assert.strictEqual(r.handled, false);
        assert.match(r.reason, /phase/);
        flow.sessions.delete(557);
    });

    // ------------------------------------------------------------------
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
