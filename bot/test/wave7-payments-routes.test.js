'use strict';
/**
 * bot/test/wave7-payments-routes.test.js
 *
 * The guard against opening a second live subscription was built in
 * bot/webpublish.js and covered there. This covers the wiring: that
 * handleSiteCheckout actually calls it, that customer.subscription.created is
 * routed, and that invoice history is reachable.
 *
 * The distinction matters here more than usual. The audit's worst payments
 * finding was a paying customer labelled "Expirat" and pushed into a second
 * subscription that billed alongside the first. A guard that exists but is
 * never called leaves that defect exactly as it was, while every unit test
 * around it passes.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-payments-routes.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

test('handleSiteCheckout consults the renewal guard before creating a session', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
    const start = src.indexOf('async function handleSiteCheckout(');
    assert.notStrictEqual(start, -1, 'handleSiteCheckout must exist');
    const body = src.slice(start, src.indexOf('\nasync function ', start + 10));

    assert.match(body, /canStartRenewalCheckout/, 'checkout must ask whether a renewal is allowed');
    assert.match(body, /reconcileSiteFromStripe/, 'checkout must heal a stale paidUntil from Stripe first');

    // Order matters: healing after the decision would be pointless, and
    // creating the session before the guard would defeat it entirely.
    const heal = body.indexOf('reconcileSiteFromStripe');
    const guard = body.indexOf('canStartRenewalCheckout');
    const create = body.indexOf('payments.createCheckout');
    assert.ok(heal < guard, 'the site must be reconciled before the guard decides');
    assert.ok(guard > -1 && (create === -1 || guard < create),
        'the guard must run before a Checkout Session is created');
});

test('a refused renewal answers 409 with a Romanian explanation', () => {
    const payments = require('../payments.js');
    const msg = payments.RO_ERRORS.ALREADY_ACTIVE_SUBSCRIPTION;
    assert.ok(msg && msg.length > 0, 'a refusal message must exist');
    assert.match(msg, /[ăâîșț]/i, 'the refusal must be Romanian');
    // The customer is being told "no" about their own money. It has to say what
    // to do next rather than only refusing.
    assert.match(msg, /contact/i, 'the refusal must tell the owner how to reach a human');

    const src = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
    const start = src.indexOf('async function handleSiteCheckout(');
    const body = src.slice(start, src.indexOf('\nasync function ', start + 10));
    assert.match(body, /sendJson\(res, 409/, 'a refused renewal must answer 409, not 200 or 500');
});

test('customer.subscription.created reaches the subscription handler', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot', 'web.js'), 'utf8');
    const start = src.indexOf('async function onStripeEvent(');
    assert.notStrictEqual(start, -1, 'onStripeEvent must exist');
    const body = src.slice(start, start + 2500);
    assert.match(body, /customer\.subscription\.created/,
        'without .created, a subscription that goes straight to active never records its status, ' +
        'and the renewal guard treats an empty status as allow');
    const created = body.indexOf('customer.subscription.created');
    const handler = body.indexOf('handleStripeSubscriptionEvent');
    assert.ok(created < handler, '.created must be part of the branch that calls the subscription handler');
});

test('invoice history is reachable and ownership-gated', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot', 'server.js'), 'utf8');
    assert.match(src, /\/api\\\/sites\\\/\(\[\^\/\]\+\)\\\/invoices\$/,
        'the invoices route must be mounted');
    const start = src.indexOf('async function handleSiteInvoices(');
    assert.notStrictEqual(start, -1, 'handleSiteInvoices must exist');
    const body = src.slice(start, src.indexOf('\n}', start));
    assert.match(body, /resolveOwnedSite/, 'invoice history must be ownership-gated');
    assert.match(body, /getInvoiceHistory/, 'it must read the ledger-backed history');
});
