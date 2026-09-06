# HANDOFF — technical-SEO / publish-robustness wave (Wave5-seo)

Written by the agent that re-landed `worktree-agent-a9fef9db8df53e7a4` (commit
`5f0c13a`) against current `main`. Everything below touches files I do **not**
own for this task (`bot/web.js`, `bot/server.js`, `bot/registry-shared.js` /
`bot/registry-sqlite.js` / `bot/registry-json.js`), so it is written up here
instead of edited directly. Nothing below is required for the SEO/robots/
sitemap/timeout/RO-error work itself to function — each item is a small,
independent follow-up.

## 1. `bot/web.js` — wire `invoice.payment_failed`

`bot/webpublish.js` now exports `handleStripeInvoicePaymentFailed(event,
notifyAdmin)` (BE-06 — records a failed dunning attempt, notifies the owner in
Romanian, never unpublishes). `bot/web.js`'s `onStripeEvent()` already routes
`invoice.payment_succeeded` / `invoice.paid` to the sibling
`handleStripeInvoicePaid`; add the same pattern for the failure event, right
next to it:

```js
if (type === 'invoice.payment_succeeded' || type === 'invoice.paid') {
    await webpublish.handleStripeInvoicePaid(event);
    log('webhook.stripe.handled', { type });
    return;
}
if (type === 'invoice.payment_failed') {
    // web-only entry: no Telegram admin channel to notify through yet.
    await webpublish.handleStripeInvoicePaymentFailed(event, undefined);
    log('webhook.stripe.handled', { type });
    return;
}
```

(`bot/bot.js` — frozen, not touched by this note — would pass its Telegram
`notifyAdmin` the same way `handleStripePaid` already receives it there.)

Once wired, `bot/test/audit-publish-seo.test.js` could gain a companion check
asserting the same behaviour through `onStripeEvent()` directly (the direct
handler is already covered).

## 2. `bot/server.js` — stop echoing raw English/Stripe text to the browser (PC-04)

`bot/payments.js` now exports `RO_ERRORS` and `toClientMessageRo(e, context)`
— generic, Romanian, client-safe strings for the payment failure classes that
currently leak English (and sometimes Stripe's own raw API error text) straight
into JSON error responses. Call sites to update in `handleSiteCheckout` /
`handleSiteBillingPortal` (current line numbers, may drift):

- `bot/server.js:2113-2114` and `:2184-2185` — `{ error: 'Payments are not configured.' }`
  → `{ error: payments.RO_ERRORS.NOT_CONFIGURED }`
- `bot/server.js:2149-2150` — `` { error: "We couldn't start checkout: " + e.message } ``
  → `{ error: payments.toClientMessageRo(e, 'checkout') }` (keep `e.message` in the
  existing `log('server.checkout.error', ...)` call — the precise reason stays
  server-side)
- `bot/server.js:2196-2198` — `{ error: 'No billing customer on this site yet. Start a trial first, then cancel from the portal.' }`
  → `{ error: payments.RO_ERRORS.NO_CUSTOMER_YET }`
- `bot/server.js:2212-2213` — `` { error: "We couldn't open billing: " + e.message } ``
  → `{ error: payments.toClientMessageRo(e, 'billing') }` (same: keep `e.message`
  in `log('server.billing_portal.error', ...)`)

`bot/server.js` has many other English strings (`'Invalid request.'`,
`'Access denied.'`, generic 404s, etc.) — those are a much larger, separate
cleanup and out of scope for `RO_ERRORS`, which only covers the
checkout/billing failure classes this branch's audit finding named.

## 3. `bot/registry-shared.js` — let `paymentFailedAt`/`paymentFailedCount` persist on the site record

The storage round-3 rewrite added a deliberate fix: `registry.updateSite()`
now filters patches to `KNOWN_SITE_FIELDS` (core + `SITE_EXTRA_FIELDS` in
`bot/registry-shared.js`) and silently drops anything else. BE-06's handler in
`bot/webpublish.js` calls `registry.updateSite(site.id, { paymentFailedAt,
paymentFailedCount })` for forward compatibility, but today those two keys are
**not** in `SITE_EXTRA_FIELDS`, so the patch is accepted and dropped — the
durable record of a failed invoice currently lives only in the ledger
(`bot/ledger.js`, `event: 'payment_failed'`), not on the site record.

Add both fields to the allowlist:

```js
const SITE_EXTRA_FIELDS = Object.freeze([
    'ownerChatId', 'businessName', 'canceledAt', 'paidUntil',
    'stripeSubscriptionId', 'stripeSubscriptionStatus', 'subscriptionStatus',
    'stripeCustomerId',
    'paymentFailedAt', 'paymentFailedCount',
]);
```

No other change is needed — `registry-sqlite.js`'s `updateSite()` already
stores any `EXTRA_FIELD_SET` key in the `extra` JSON column, and
`registry-json.js` mirrors the same allowlist. Once this lands, an `/admin`
dashboard (or a future banner in `bot/server.js`) can read
`site.paymentFailedAt` / `site.paymentFailedCount` directly instead of
scanning the ledger.

## 4. `bot/server.js` — nice-to-have: correct MIME type for `sitemap.xml`

`bot/server.js`'s `MIME_TYPES` map (used by `serveLive()` for `/live/<slug>/*`)
has `.txt` but no `.xml` entry, so `sitemap.xml` is served as
`application/octet-stream` instead of `application/xml`. Functionally fine
(all consumers just read the body), but worth a one-line addition:

```js
const MIME_TYPES = {
    ...
    '.txt':  'text/plain; charset=utf-8',
    '.xml':  'application/xml; charset=utf-8',
};
```

## What's already done (no action needed here)

- Canonical `<link>` / `<meta property="og:url">`, absolute `og:image`, a
  LocalBusiness JSON-LD block, `robots.txt` and `sitemap.xml` are all now
  produced for both the live publish path (`bot/webpublish.js`) and the
  ZIP/HTML export path (`bot/site-export.js`).
- Cloudflare/Vercel/Netlify/Revolut/Stripe/domains.js outbound fetch calls
  all now carry an explicit `AbortSignal.timeout(...)` (env-overridable) so a
  hung provider can no longer block a publish or checkout forever.
- `payments.RO_ERRORS` / `payments.toClientMessageRo` exist and are covered
  by `bot/test/audit-publish-seo.test.js`; they just are not called from
  `bot/server.js` yet (item 2 above).
