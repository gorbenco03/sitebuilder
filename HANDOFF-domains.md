# HANDOFF — self-serve custom domains (Wave 7, audit finding #47)

Written by the agent that owns `bot/domains.js`, `bot/deploy-cloudflare.js`, `bot/webpublish.js`
and `bot/site-export.js` for this wave. Routes, auth, and owner-facing markup live in
`bot/server.js` / `bot/web.js` / `builder/**` / `templates/**`, which are out of scope for this
agent — everything below needs a change there instead of being edited directly.

## What already exists (no server.js/web.js change needed to use it)

`bot/domains.js` exports a complete self-serve state machine — validate → show DNS records → poll
→ attach + poll TLS → active → disconnect. It needs **only** these four pieces of data from the
caller, none of which require touching the registry schema:

- `siteId` — `site.id`
- `projectName` — `site.projectName` (the Cloudflare Pages project name)
- `domain` — the raw string the owner typed
- `currentOrigin` (only on the first call) — `site.url`, used once to know what to restore on
  disconnect

```js
const domains = require('./domains.js');

// 1. Owner submits a domain
const instructions = await domains.startDomainConnection({ siteId, projectName, domain, currentOrigin: site.url });
// -> { domain, targetHost, isApex, status, records: [{tip,nume,valoare,ttl,scop}, ...], note, instructiuni, message }

// 2. Owner clicks "Verifică"
const dnsResult = await domains.checkDomainConnection({ siteId });
// -> { status: 'awaiting_dns'|'dns_partial'|'dns_verified', txt: {...}, cname: {...}, message }

// 3. Once dns_verified, attach + start TLS provisioning (can be chained
//    automatically right after step 2 reports dns_verified, or behind its own button)
const activateResult = await domains.activateDomainConnection({ siteId });
// -> { status: 'provisioning'|'active'|'error', message }

// 4. Poll again later (e.g. every 30-60s while status is 'provisioning', or on page reload)
const tlsResult = await domains.checkTlsStatus({ siteId });

// 5. Disconnect
const disconnectResult = await domains.disconnectDomainConnection({ siteId });

// Cheap, no-network reads for rendering the current state (e.g. GET page load):
domains.getDomainForSite(siteId);       // full record or null
domains.getActiveDomainForSite(siteId); // active domain string or null
```

Every one of `DOMAIN_VALIDATION`/flow errors is a normal `Error` with `.code` set to one of:
`MISSING`, `IS_IP`, `INVALID_FORMAT`, `IS_HIDOOK_DOMAIN`, `ALREADY_CLAIMED`, `PAGES_HOST_UNKNOWN`,
`NOT_VERIFIED`, `ATTACH_FAILED`, `NO_DOMAIN` — and `.message` is already Romanian and safe to show
directly to the owner (no raw provider text ever leaks through, same rule `payments.js`'s
`toClientMessageRo` already follows elsewhere in this codebase).

## 1. Routes to add in `bot/server.js`

Mirror `handleRollback`'s shape (`requireAuth` → load site via `getRegistry().getSite(siteId)` →
ownership check `site.userId !== userId` → `sendJson`). Suggested insertion point: right after the
existing `/api/sites/:id/billing-portal` route block (~line 3128 on today's HEAD).

```js
// /api/sites/:id/domain  — GET current state, POST start connection, DELETE disconnect
const domainMatch = url.match(/^\/api\/sites\/([^/]+)\/domain$/);
if (req.method === 'GET' && domainMatch)    return await handleGetDomain(req, res, domainMatch[1]);
if (req.method === 'POST' && domainMatch)   return await handleStartDomain(req, res, domainMatch[1]);
if (req.method === 'DELETE' && domainMatch) return await handleDisconnectDomain(req, res, domainMatch[1]);

// /api/sites/:id/domain/verify — POST: poll DNS, and once verified, auto-attach + first TLS poll
const domainVerifyMatch = url.match(/^\/api\/sites\/([^/]+)\/domain\/verify$/);
if (req.method === 'POST' && domainVerifyMatch) return await handleVerifyDomain(req, res, domainVerifyMatch[1]);

// /api/sites/:id/domain/status — POST: re-poll TLS/Cloudflare status only (cheap, for a
// "still provisioning" polling loop after DNS is already verified)
const domainStatusMatch = url.match(/^\/api\/sites\/([^/]+)\/domain\/status$/);
if (req.method === 'POST' && domainStatusMatch) return await handleDomainTlsStatus(req, res, domainStatusMatch[1]);
```

Handler bodies (same auth/ownership shape as `handleRollback`):

```js
async function handleGetDomain(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const domains = require('./domains.js');
    sendJson(res, 200, { record: domains.getDomainForSite(siteId) });
}

async function handleStartDomain(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const body = await parseJson(req);
    const { domain } = body || {};
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const domains = require('./domains.js');
    try {
        const instructions = await domains.startDomainConnection({
            siteId, projectName: site.projectName, domain, currentOrigin: site.url,
        });
        sendJson(res, 200, instructions);
    } catch (e) {
        sendJson(res, 400, { error: e.message, code: e.code });
    }
}

async function handleVerifyDomain(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const domains = require('./domains.js');
    try {
        const dnsResult = await domains.checkDomainConnection({ siteId });
        if (dnsResult.status !== 'dns_verified') return sendJson(res, 200, dnsResult);
        // DNS just came good — chain straight into attach + first TLS poll so
        // the owner doesn't need a second click for this transition.
        const activateResult = await domains.activateDomainConnection({ siteId });
        sendJson(res, 200, activateResult);
    } catch (e) {
        sendJson(res, 400, { error: e.message, code: e.code });
    }
}

async function handleDomainTlsStatus(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const domains = require('./domains.js');
    try {
        sendJson(res, 200, await domains.checkTlsStatus({ siteId }));
    } catch (e) {
        sendJson(res, 400, { error: e.message, code: e.code });
    }
}

async function handleDisconnectDomain(req, res, siteId) {
    const userId = requireAuth(req, res);
    if (!userId) return;
    const reg = getRegistry();
    const site = await reg.getSite(siteId);
    if (!site) return sendJson(res, 404, { error: 'Site not found.' });
    if (site.userId !== userId) return sendJson(res, 403, { error: 'Access denied.' });
    const domains = require('./domains.js');
    try {
        sendJson(res, 200, await domains.disconnectDomainConnection({ siteId }));
    } catch (e) {
        sendJson(res, 400, { error: e.message, code: e.code });
    }
}
```

**Rate limiting**: `POST /domain/verify` and `POST /domain/status` do real outbound DNS/Cloudflare
calls (each individually timeout-bounded — see below — but nothing stops a client from spamming
the button). Recommend reusing whatever per-IP or per-site rate-limit helper `server.js` already
applies to other mutating routes (e.g. checkout) with a modest floor like one call per 5-10s per
site; this agent's file-ownership boundary doesn't include `server.js` so the limiter itself isn't
implemented here.

## 2. Owner-facing UI (in `builder/**`, out of scope for this agent)

Suggested states, driven directly off the `status` field `domains.js` returns:

- **No domain connected** (`getDomainForSite` → `null`): a text input ("Domeniul tău, ex:
  afacereamea.ro") + a "Conectează" button → `POST /domain`.
- **`awaiting_dns` / `dns_partial`**: render the `records` table from the `POST /domain` (or `GET
  /domain`) response — columns Tip / Nume / Valoare / TTL, each value in a `<code>` with a copy
  button. Show `note` (only present for apex domains) as a highlighted callout, and `message` as
  plain status text. This is **not an error state** — style it neutrally/informational (e.g. a
  clock icon, not a red X), with a "Verifică" button (`POST /domain/verify`) and a "ultima
  verificare: {lastCheck.checkedAt}" timestamp once one exists. DNS propagation legitimately takes
  minutes to hours — the copy already reflects that, but the visual treatment matters just as much
  for it to actually read as normal.
- **`provisioning`**: same neutral styling, message already says "certificatul de securitate se
  activează…". Poll `POST /domain/status` every 30-60s while in this state (or only on demand via a
  "Verifică din nou" button — either is fine; just don't hammer it, see rate-limit note above).
- **`active`**: green/success state, show the domain as a clickable link, plus a "Deconectează"
  button behind a confirmation dialog: "Sigur vrei să deconectezi {domain}? Site-ul va rămâne
  disponibil pe {site.url}." (matches Rule 5's "must leave the site reachable on its Hidook
  subdomain" requirement — word it so the owner isn't afraid disconnect takes the site down).
- **`error`**: red state, `message`/`lastError` shown, with the same "Conectează"/"Verifică" flow
  available again as a retry (the record is not deleted on error — retrying just re-runs the same
  steps).

Also: once a domain is `active`, the dashboard's "your live site" link should prefer
`https://${record.targetHost}` over `site.url`, since that is now the address the owner actually
wants to show off — and it is the one this flow actually verified and attached (for a non-apex
domain `targetHost === domain`; for an apex domain `targetHost` is the `www.` host, see §3 below —
link to that, not the bare apex, since the apex only works once the owner has ALSO set up the
external registrar forwarding this flow can't verify). `site.url` (the Hidook subdomain/pages.dev
link) still needs to stay visible/reachable somewhere in the UI, since it is guaranteed to keep
working even before a domain is connected, during "still waiting" DNS states, and after a
disconnect.

## 3. A real design constraint the stub can't fully hide: apex domains

Cloudflare Pages custom domains cannot use a CNAME on the domain apex (`example.com`) — that's a
DNS-standard limitation (a zone's apex/SOA record can't coexist with a CNAME at the same name), not
a Cloudflare or Hidook one. Without either (a) migrating the domain's nameservers to Cloudflare
(out of scope — this is meant to be self-serve without asking the owner to switch registrars) or
(b) the owner's own DNS provider supporting an ALIAS/ANAME record (not universal, especially among
Romanian `.ro` resellers), there's no reliable A/AAAA IP this codebase can hand out for a bare apex
that would actually be Cloudflare's real, current Pages edge address — and fabricating one would be
worse than not offering it, since it would silently stop working the moment Cloudflare changes it.

**What this wave does instead**: for an apex domain (`example.com`, exactly two labels), the flow
targets `www.example.com` — that's the hostname that gets the CNAME, gets attached to Cloudflare,
and becomes the live/canonical origin (`record.targetHost` in the code, `startDomainConnection`'s
returned `note` explains this to the owner in Romanian and tells them to add an apex→www
redirect/forwarding rule at their registrar, which is a near-universal registrar feature). This
is the same practical pattern Squarespace/Wix use for apex domains without their own DNS.

**What is NOT modeled here and would need a live Cloudflare account to build for real**: Cloudflare
does offer a true apex path via its "Cloudflare for SaaS" custom-hostname product, which can supply
fallback-origin IPs for apex-without-Cloudflare-DNS setups — but the exact IPs/behavior are
account-specific and cannot be exercised against the fake provider this task requires (no real
credentials, no live API calls). If/when this product wants true one-click apex support without a
www redirect, that's the integration to evaluate — flagging it here rather than quietly shipping
guessed IP addresses.

## 4. Other things the stub couldn't express (documented rather than pretended away)

- **Cloudflare's real Pages custom-domain status enum**: `bot/deploy-cloudflare.js#getDomainStatus`
  and `bot/domains.js#mapCloudflareStatus` only depend on a `status` field. The actual set of
  values Cloudflare's live API returns (`pending`, `pending_deployment`, `initializing`,
  `verifying`, `active`, `deactivated`, `blocked`, and possibly others) was not independently
  verified against a real account for this task's constraints — `mapCloudflareStatus` treats
  anything that isn't `active`/`deactivated`/`blocked`/`error` as `provisioning` (never alarming,
  never falsely `active`), which is the safe default either way, but worth a real-account
  smoke-test before this ships live.
- **DNS propagation timing**: the fake resolver in the tests answers instantly; real DNS can take
  minutes to many hours (up to 24-48h in rare cases for some registrars). The product-facing copy
  already says so — there's no way to shorten this for real, only to make waiting feel normal.

## 5. `bot/registry-shared.js` was deliberately NOT touched

`updateSite()`'s patch is filtered to a fixed field allowlist (`KNOWN_SITE_FIELDS`) as one of that
subsystem's own deliberate defect fixes, and that file isn't in this agent's ownership. Rather than
add `customDomain`-shaped fields there (which would need coordinating with whoever owns
`bot/registry-shared.js`/`bot/registry-sqlite.js`/`bot/registry-json.js`), this wave keeps all
domain-connection state in its own file — `$DATA_DIR/custom-domains.json` (or
`<repo-root>/custom-domains.json` when `DATA_DIR` is unset), one JSON object keyed by `siteId`,
written by `bot/domains.js` alone. `site.url` in the registry is untouched by this feature; it
always continues to mean "the Hidook-hosted subdomain/pages.dev address," which is exactly what
lets disconnect guarantee the site stays reachable there no matter what happened to the custom
domain.
