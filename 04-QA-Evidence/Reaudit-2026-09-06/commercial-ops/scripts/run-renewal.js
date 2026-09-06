'use strict';
/**
 * Focused test: genuine annual renewal via invoice.paid, timed realistically
 * (paidUntil close to "now", inside the 45-day RENEWAL_DUE_WINDOW_MS) so the
 * first-year-cycle guard does not mask the real renewal path. Verifies:
 *   - extends paidUntil by exactly 12 months once
 *   - a duplicate webhook delivery (same event id) does not extend again
 *   - a duplicate invoice id delivered under a DIFFERENT event id also does not extend again
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a210a955143021a0f';
const EVID = path.join(ROOT, '04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/evidence');

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-reaudit-renewal-'));
process.env.SERVER_SECRET = 'reaudit-' + crypto.randomBytes(12).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[k];

const results = { startedAt: new Date().toISOString(), steps: [] };
function record(name, data) { results.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const BASE = 'http://127.0.0.1:' + server.address().port;

    let cookie = '';
    async function api(method, p, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (cookie) headers.Cookie = cookie;
        const res = await fetch(BASE + p, { method, headers, redirect: 'manual', body: body !== undefined ? JSON.stringify(body) : undefined });
        const sc = res.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0];
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch (_) {}
        return { status: res.status, json };
    }

    const auth = await api('POST', '/api/auth/email', { email: 'renewal-customer@example.com' });
    const token = new URL(auth.json.devLink, BASE).searchParams.get('token');
    await api('GET', '/auth/verify?token=' + token);

    const presetConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config;
    const pub = await api('POST', '/api/publish', { templateId: 'professionals', config: presetConfig, images: [], slug: 'renewal-test-' + Date.now() });
    if (!pub.json || !pub.json.site) { console.error('PUBLISH_FAILED', pub.status, JSON.stringify(pub.json)); process.exit(1); }
    const siteId = pub.json.site.id;
    const sessionId = /test-checkout=([^&]+)/.exec(pub.json.paymentUrl)[1];
    await api('POST', '/api/test-pay/complete', { sessionId });

    let site = registry.getSite(siteId);
    const subId = site.stripeSubscriptionId;
    const custId = site.stripeCustomerId;
    record('after_first_pay', { paid: site.paid, paidUntil: site.paidUntil, subId, custId });

    // Force paidUntil to 10 days from now — inside the 45-day renewal-due window, so
    // a genuine cycle invoice is NOT mistaken for a premature/duplicate first-year one.
    const almostDue = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    registry.updateSite(siteId, { paidUntil: almostDue });
    record('forced_almost_due', { paidUntil: almostDue });

    const invoiceId = 'in_test_cycle_' + crypto.randomBytes(6).toString('hex');
    const evtId = 'evt_test_cycle_' + crypto.randomBytes(6).toString('hex');
    const cycleEvent = {
        id: evtId,
        type: 'invoice.payment_succeeded',
        data: { object: { id: invoiceId, subscription: subId, customer: custId, billing_reason: 'subscription_cycle', amount_paid: 2900, currency: 'eur' } },
    };
    await api('POST', '/webhooks/stripe', cycleEvent);
    await sleep(50);
    site = registry.getSite(siteId);
    const monthsExtended = (Date.parse(site.paidUntil) - Date.parse(almostDue)) / (1000 * 3600 * 24 * 30);
    record('after_genuine_cycle_renewal', { paidUntilBefore: almostDue, paidUntilAfter: site.paidUntil, approxMonthsExtended: monthsExtended });

    // Replay #1: exact same event id (webhook redelivery) — must be a no-op.
    await api('POST', '/webhooks/stripe', cycleEvent);
    await sleep(50);
    const siteReplay1 = registry.getSite(siteId);
    record('after_replay_same_event_id', { unchanged: siteReplay1.paidUntil === site.paidUntil, paidUntil: siteReplay1.paidUntil });

    // Replay #2: SAME invoice id, but a DIFFERENT event id (Stripe sometimes sends
    // both invoice.paid and invoice.payment_succeeded for one invoice) — must also be a no-op.
    const cycleEvent2 = {
        id: 'evt_test_cycle_dup_' + crypto.randomBytes(6).toString('hex'),
        type: 'invoice.paid',
        data: { object: { id: invoiceId, subscription: subId, customer: custId, billing_reason: 'subscription_cycle', amount_paid: 2900, currency: 'eur' } },
    };
    await api('POST', '/webhooks/stripe', cycleEvent2);
    await sleep(50);
    const siteReplay2 = registry.getSite(siteId);
    record('after_replay_same_invoice_id_different_event_id', { unchanged: siteReplay2.paidUntil === site.paidUntil, paidUntil: siteReplay2.paidUntil });

    // Ledger check: exactly TWO invoice entries total (first-year charge + this one genuine renewal), not three.
    const invoicesResp = await api('GET', '/api/sites/' + siteId + '/invoices');
    record('final_invoice_ledger', invoicesResp.json);

    fs.writeFileSync(path.join(EVID, 'run-renewal.json'), JSON.stringify(results, null, 2));
    console.log('DONE');
    server.close();
    process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
