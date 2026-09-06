# HANDOFF — Wave7 payments (VAT, dunning, invoice history, no-double-subscription)

**Author:** Wave7 payments agent. Owns `bot/payments.js`, `bot/ledger.js`,
`bot/webpublish.js`, `OWNER-STRIPE-TRIAL.md`, `bot/test/wave7-payments-*.js`.
Does **not** own `bot/server.js`, `bot/web.js`, or `builder/**` — every change
below needs one of those files, so it is described here instead of applied.

All new functions referenced below are exported from `bot/webpublish.js` /
`bot/payments.js` today and covered by `bot/test/wave7-payments-*.test.js`.
This document is the wiring list to make them reachable from the product.

---

## 1. Stop a site from opening a second live subscription (critical)

**The bug** (audit's worst payments finding): `handleSiteCheckout` in
`bot/server.js` (around line 2128) decides `isRenewal = !!site.paid` and, if
so, immediately creates a brand-new Stripe Checkout Session — with no check
for whether the site's *existing* subscription is still open. If the
dashboard's local `paidUntil` looks stale (webhook lag, or any other drift)
while Stripe still has the subscription active/trialing/past_due, clicking
"Reînnoiește hosting" opens a **second** live subscription that bills
alongside the first (`_storeStripeBillingIds` then overwrites
`stripeSubscriptionId` with the new one, orphaning the old subscription —
exactly the "orphaned double billing" the audit named).

**The fix, already built and tested** in `bot/webpublish.js`:

- `webpublish.reconcileSiteFromStripe(site)` — if the site is paid, has a
  `stripeSubscriptionId`, and `paidUntil` looks expired, asks Stripe directly
  whether the subscription is still active/trialing and heals `paidUntil`
  from Stripe's own `current_period_end` if so. No-op under
  `HIDOOK_TEST_PAY`/no Stripe key (always safe to call unconditionally).
- `webpublish.canStartRenewalCheckout(site)` → `{allowed, reasonCode?,
  reasonRo?}`. Refuses (`reasonCode: 'SUBSCRIPTION_STILL_ACTIVE'`) when
  `site.stripeSubscriptionStatus`/`subscriptionStatus` is one of
  `active`/`trialing`/`past_due` (`payments.SUBSCRIPTION_ENTITLED_STATUSES`).
  Allows when unpaid (first publish), or when the status is a terminal one
  (`canceled`/`cancelled`/`unpaid`/`incomplete_expired`) or absent (no
  webhook has told us anything yet — same as today, so existing
  `HIDOOK_TEST_PAY` flows in `s51-builder-renewal.test.js` are unaffected).

**Exact edit needed in `bot/server.js#handleSiteCheckout`** (around line 2128,
right after the `payments.isConfigured()` check and before pricing/order
creation):

```js
async function handleSiteCheckout(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const reg  = getRegistry();
    let site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });

    if (!payments.isConfigured()) {
        return sendJson(res, 503, { error: payments.RO_ERRORS.NOT_CONFIGURED });
    }

    // Wave7 — heal a stale "Expirat" from Stripe's own truth before deciding
    // anything, then refuse to open a second live subscription for a site
    // that already has one. See HANDOFF-payments.md.
    const webpublish = require('./webpublish.js');
    site = await webpublish.reconcileSiteFromStripe(site);
    const guard = webpublish.canStartRenewalCheckout(site);
    if (!guard.allowed) {
        return sendJson(res, 409, { error: guard.reasonRo || payments.RO_ERRORS.ALREADY_ACTIVE_SUBSCRIPTION });
    }

    const p         = pricing.getPricingFromRequest(req);
    // ...unchanged from here down...
```

No other line in the function needs to change — `site` is already reused
below for `site.paid`/`site.paidUntil`, and `reconcileSiteFromStripe` returns
the (possibly healed) record.

---

## 2. Dunning state on the dashboard

`GET /api/sites` (`bot/server.js#handleGetSites`) already returns the raw
registry record verbatim — `site.paymentFailedAt`, `site.paymentFailedCount`,
and `site.stripeSubscriptionStatus` are **already in the JSON the browser
gets today**. No server.js change is required to surface the data; only
`builder/app.js` needs to render it.

`webpublish.getDunningState(site)` turns those same fields into what to show:

```js
{ severity: 'warning', code: 'PAYMENT_RETRY_IN_PROGRESS', attemptCount, lastFailedAt, messageRo }
// or
{ severity: 'critical', code: 'SITE_DOWN_PAYMENT_FAILED', messageRo }
// or null (nothing to show)
```

**Suggested `builder/app.js#buildSiteCard` insertion** (right after the
existing hosting-until / trial-line block, before `actions` is built —
see the current code around line 4558):

```js
// Wave7 dunning: card, card, then a plain-language warning strip.
// getDunningState logic lives in bot/webpublish.js — mirror it here or,
// better, have the server attach it: `site.paymentIssue` computed server-side
// via webpublish.getDunningState(site) and included in the GET /api/sites
// response, so the badge logic isn't duplicated in two languages.
if (site.paymentIssue) {
  const warn = document.createElement('div');
  warn.className = 'site-card-payment-issue site-card-payment-issue--' + site.paymentIssue.severity;
  warn.textContent = site.paymentIssue.messageRo;
  info.appendChild(warn);
}
```

Cheapest wiring: add one line to `bot/server.js#handleGetSites` (and
`handleGetSite`) attaching `paymentIssue: webpublish.getDunningState(s)` onto
each serialized site before `sendJson`, so `builder/app.js` never needs to
reimplement the decision table:

```js
async function handleGetSites(req, res) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const webpublish = require('./webpublish.js');
    const sites = (await getRegistry().listSites(userId)).map((s) => ({
        ...s,
        paymentIssue: webpublish.getDunningState(s),
    }));
    sendJson(res, 200, { sites });
}
```

The dark-site notice (`handleStripeSubscriptionEvent`'s new `notifyAdmin`
call on `unpaid`/`incomplete_expired`) has no owner-facing channel to ring on
the web platform yet — `bot/web.js#onStripeEvent` still passes
`notifyAdmin: undefined` everywhere (same documented gap as
`handleStripeInvoicePaymentFailed` already had). Until a real channel exists,
the dashboard card above **is** the notice. When one exists, wire it as:

```js
// bot/web.js
if (type === 'customer.subscription.deleted' || type === 'customer.subscription.updated') {
    await webpublish.handleStripeSubscriptionEvent(event, { notifyAdmin: /* real channel */ });
    ...
}
```

---

## 3. `customer.subscription.created` is not routed at all today

`bot/web.js#onStripeEvent` only special-cases `.deleted` and `.updated`;
every other event type (including `.created`) falls through to
`handleStripePaid`, which checks `cs.payment_status` — a Subscription object
has no such field, so it silently no-ops. That means
`webpublish.handleStripeSubscriptionEvent`'s new `.created` handling (see its
docblock — needed so `stripeSubscriptionStatus` is populated the moment
Stripe creates the subscription, not only on its first status *change*)
never actually runs against a real webhook until `bot/web.js` routes it.

**Exact one-line addition to `bot/web.js#onStripeEvent`:**

```js
if (
    type === 'customer.subscription.deleted' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.created'   // ← add this
) {
    await webpublish.handleStripeSubscriptionEvent(event);
    log('webhook.stripe.handled', { type });
    return;
}
```

Also add `customer.subscription.created` to the Stripe Dashboard webhook
endpoint's subscribed events list (alongside the ones already listed in
`OWNER-STRIPE-TRIAL.md`).

Without this wiring, `canStartRenewalCheckout`'s guard above still degrades
safely (an empty `stripeSubscriptionStatus` is treated as "allow" — see its
docblock), it just won't catch the bug on a subscription whose status never
changed after creation (the common "straight to active" case) until this is
wired.

---

## 4. Invoice history ("Facturi")

`webpublish.getInvoiceHistory(site)` returns an array (newest first) of
`{ event, siteId, kind, invoiceId, amountCents, currency, hostedInvoiceUrl,
invoicePdf, ts, ... }`, sourced from a durable ledger event
(`bot/ledger.js`'s `.ledger.jsonl`) this branch now appends on every
successful charge — both `HIDOOK_TEST_PAY` and real Stripe. Fully provable
offline (see `bot/test/wave7-payments-invoices.test.js`).

**Suggested new route in `bot/server.js`** (beside the other
`/api/sites/:id/...` routes, e.g. after `handleSiteBillingPortal`):

```js
// /api/sites/:id/invoices
const invoicesMatch = url.match(/^\/api\/sites\/([^/]+)\/invoices$/);
if (req.method === 'GET' && invoicesMatch) {
    return await handleSiteInvoices(req, res, invoicesMatch[1]);
}
```

```js
async function handleSiteInvoices(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const webpublish = require('./webpublish.js');
    const invoices = webpublish.getInvoiceHistory(site);
    sendJson(res, 200, { invoices });
}
```

**Suggested `builder/app.js` UI**: a "Facturi" ghost button next to the
existing "Istoric" button in `buildSiteCard` (around line 4626), opening a
simple list/modal of `invoices` — `hostedInvoiceUrl`/`invoicePdf` (when
present, real-Stripe only) as links, else just the date/amount/kind for the
`HIDOOK_TEST_PAY` and pre-automatic-tax first-year rows that only carry our
own ledger record.

`payments.listCustomerInvoices(customerId)` (real Stripe, optional
enrichment/fallback) is also exported if a fuller Stripe-side list is ever
wanted instead of/alongside the ledger.

---

## 5. VAT — what was enabled, and what still needs the owner + accountant

See `OWNER-STRIPE-TRIAL.md` → "VAT / EU tax compliance" for the full
runbook. Summary for this handoff:

- `STRIPE_AUTOMATIC_TAX=1` (new env var, **default off**) turns on
  `automatic_tax`, `billing_address_collection: 'required'`, and
  `tax_id_collection` (B2B VAT id → reverse charge) on Checkout
  (`bot/payments.js#createCheckout`). Off by default because enabling
  `automatic_tax` before Stripe Tax is configured in the Dashboard makes
  Checkout Session creation **fail outright** — flipping this on
  unconditionally would have been strictly worse than the audit gap.
- All inline `price_data` (Checkout line + the renewal-phase Price) now set
  `tax_behavior: 'exclusive'` unconditionally, so a future flag-flip computes
  VAT **on top of** 99/29 rather than Stripe guessing.
- Nothing in `bot/server.js`/`builder/**` needs to change for this — it is
  entirely inside the Checkout Session Stripe already builds. The only
  action item is operational (Stripe Dashboard + accountant), not code.

---

## 6. Re-verify test coverage

`bot/test/wave7-payments-*.test.js` (4 files) cover all of the above at the
`bot/payments.js`/`bot/webpublish.js` level. They cannot exercise the actual
HTTP routes described in §1/§2/§4 above (those live in `bot/server.js`,
outside this agent's ownership) — once wired, add a focused HTTP-level test
(pattern: `bot/test/s51-builder-renewal.test.js`) asserting:

- `POST /api/sites/:id/checkout` → `409` with a Romanian body when the site's
  `stripeSubscriptionStatus` is active/trialing/past_due.
- `GET /api/sites/:id/invoices` → the ledger-backed list.
- `GET /api/sites` → each site carries `paymentIssue` matching
  `getDunningState`.
