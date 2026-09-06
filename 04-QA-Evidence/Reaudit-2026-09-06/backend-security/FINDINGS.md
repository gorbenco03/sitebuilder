# Re-audit — Backend & Security (2026-09-06)

Re-audit of the backend/security remediation claims in
`04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md` (original audit at HEAD
`2225ca7`, scored backend 6/10, security 4/10). This pass runs against HEAD
`7736ed7` (`main`, merged into this worktree — "docs: record production as it
is actually configured, read from the live service"), against an isolated
local server booted straight from this worktree's `bot/server.js`
(`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, `NODE_ENV=test`, a temp
`DATA_DIR`, no real keys, `node --experimental-sqlite`) — same pattern as
`_audit-harness.mjs`, adapted in `_harness.mjs` to point at this worktree.

All scripts referenced below live next to this file and were actually run;
outputs are pasted or summarized inline.

## Scores

**Backend: 7/10.** The registry moved off a single JSON file onto SQLite
with parameterized queries throughout (spot-checked, no string-built SQL
found), the calendar-native engine enforces tenant isolation at the SQL
`WHERE` level on every mutation (defense in depth beyond the route-level
authorization check), Stripe webhook signature verification is correctly
required in production, the admin view is gated by a timing-safe token
compare, oversized/malformed bodies are rejected cleanly, and PII email
masking in logs works as designed. Two real rough edges pull it down from
8: rate limiting is easily defeated by construction (see HIGH finding
below — this is a backend design gap, not just a "security" checkbox), and
a synchronous `JSON.parse` stack-overflow on deeply nested bodies leaks a
raw internal error string to the client instead of failing closed with a
clean 400.

**Security: 5/10.** Up from 4/10 — several of the original critical findings
are genuinely fixed (auth dev-link fallback is now production-gated,
security headers are applied globally, cross-account authorization is
solid everywhere tested, including all the new surfaces: custom domains,
invoice history, calendar owner/resource routes). But two things keep this
out of "good" territory: **logout was never touched at all** — it is not a
regression, it is the exact original critical finding, unfixed — and **the
stored XSS that was reported fixed is still exploitable**, via exactly the
bug shape this task asked to hunt for (the filter normalizes what it
checks, the browser decodes something the filter didn't). A commercial
product handling real customer payments should not ship either of these,
let alone both at once, after they were specifically called out and marked
resolved.

---

## CRITICAL findings (confirmed, reproduced)

### C1 — Logout does not exist server-side; the original finding was never fixed

`bot/server.js` has no route for `/api/auth/logout` anywhere in its 3622
lines. Confirmed two ways:

- Static: `grep -n "api/auth" bot/server.js` → only `/api/auth/email` and
  `/api/auth/telegram`. `grep -ni "logout\|revoke" bot/server.js` → zero
  matches in the whole file.
- Live: `live-probe.mjs` calls `POST /api/auth/logout` with a valid session
  cookie → **404**. It then replays the *same, pre-logout* cookie against
  `GET /api/me` → **200**, full account access, with the session's original
  30-day `Max-Age` untouched.

The frontend (`builder/app.js:3548`, `doLogout()`) calls
`fetch('/api/auth/logout', {method:'POST'})`, silently swallows any error,
and unconditionally shows "Te-ai deconectat." (you have been signed out) —
so a user who clicks "Deconectare" is told they are logged out while their
session cookie remains fully valid. Session cookies (`bot/auth.js`) are a
stateless `v1.<payload>.<hmac>` token good for 30 days
(`buildSessionCookie`, `Max-Age=2592000`), verified purely by signature +
expiry — there is no server-side session store, allowlist, or revocation
mechanism of any kind, so there is nothing a real logout route could even
revoke against today; it would need one added (e.g. a token-id + revocation
table, or short-lived tokens with refresh).

This is verbatim the original RAPORT.md finding #15
("Deconectare nu invalidează sesiunea pe server"). The remediation-claim
summary in this task's brief says logout was fixed. It was not — same code,
same gap, confirmed live.

**Impact:** a captured `hb_session` cookie (XSS — see C2, shared/public
computer, browser-history sync, a proxy or access log) stays fully valid
for up to 30 days after the account holder believes they signed out, with
no way for the user or the operator to end that one session early short of
rotating `SERVER_SECRET` for **every** user at once.

**Reproduction:** `node --experimental-sqlite live-probe.mjs`, see checks
"logout endpoint exists (expect 404 = confirmed missing)" and
"SECURITY: old session cookie still valid after 'logout'" in the output.

### C2 — Stored XSS in the portfolio `{{& icon}}` sink survives the "fix," via a named HTML entity instead of a numeric one

This is the same bug *shape* as original finding #10
(`static-renderer-export/xss-poc-portfolio-icon-sink.html`, "javascript:"
hidden via a literal TAB inside the scheme name) — and the fix that shipped
for it is incomplete in exactly the way this task asked to look for: it
checks a *normalized* version of the source text, but doesn't normalize the
same way the browser does.

`build.js`'s raw `icon` sink (`build.js:364-401`, used by the portfolio
template's `{{& icon}}` chip list, `templates/portfolio/template.html:153`)
strips `\t\r\n` and decodes **numeric** character references
(`&#106;`, `&#x6A;`) before testing the value against
`/^\s*(?:javascript|data|vbscript)\s*:/i` — explicitly citing the original
TAB-hiding and numeric-entity bypasses as the two things it defends against
(`build.js:373-388`). It does **not** decode **named** character references
(`&colon;`, `&amp;`, etc.), which the HTML5 parser resolves identically to
numeric ones. `&colon;` → `:` is a standard named reference recognized by
every modern browser.

**Empirically confirmed, end to end:**

1. `probe-colon-entity.mjs` — a minimal Playwright check, no product code
   involved — confirms a real Chromium sets
   `xlink:href` to the literal string `javascript:window.__xss=1` after
   parsing `xlink:href="javascript&colon;window.__xss=1"`, and clicking the
   resulting link executes it (`XSS FIRED: true`).
2. `xss-icon-colon-entity.mjs` — calls `build.js`'s exported `renderHtml()`
   (the exact function that produces both the live page and the preview)
   with a real portfolio preset (`templates/portfolio/presets.json`,
   `presets[0].config`), with one service's `icon` field replaced by an
   SVG containing `<a xlink:href="javascript&colon;window.__hb_xss=(window.__hb_xss||0)+1">`.
   The payload survives **verbatim** into the rendered output —
   `contains "javascript&colon;" (unmodified, bypassing the normalizer): true`,
   `payload present verbatim in rendered HTML: true`. Full output saved at
   `xss-icon-colon-rendered.html` in this directory.
3. `xss-icon-colon-click.mjs` — loads that exact rendered HTML in a real
   headless Chromium, clicks the poisoned chip icon link a visitor would
   see, and confirms:
   ```
   live DOM xlink:href attribute value: javascript:window.__hb_xss=(window.__hb_xss||0)+1
   XSS PAYLOAD EXECUTED (window.__hb_xss set): 1
   ```

**Impact:** identical to the original finding — a business owner who pastes
a "service icon" SVG (or has one injected via any upstream config-tampering
path) gets arbitrary JavaScript execution in the context of their own paid,
published, live site, in front of every visitor who clicks that icon.
`{{& icon}}` is only wired into the `portfolio` template today
(`grep -rl "{{& icon}}" templates/*/template.html` → one hit), so the blast
radius is that one template, but the underlying sink logic lives in shared
`build.js` and the same normalize-then-blocklist pattern is reused for
`hero.background`'s CSS `url()` sink — that one is not exploitable the same
way only because `escapeHtml()` re-encodes the literal `&` *after* the
scheme check runs (`build.js:352-353`), which happens to break the entity
before the browser ever sees it; it is incidental, not a deliberate second
layer, and the `icon` sink has no such second pass. Any *other* raw sink
added later that skips the final `escapeHtml()` step (as `icon` does,
because it must emit literal SVG markup) inherits this exact gap.

**Fix direction (not applied — this is an audit, no product code was
touched):** decode named references too before the scheme check (Node has
no built-in named-entity decoder, but the reference table is small and
stable), or better, parse+re-serialize the SVG through an allowlist-based
sanitizer instead of a regex normalize-then-blocklist — the more durable
fix `build.js`'s own comments gesture at but don't take.

**Reproduction:** `node probe-colon-entity.mjs`,
`node xss-icon-colon-entity.mjs`, `node xss-icon-colon-click.mjs` (all in
this directory; no server boot required for the last two — they exercise
`build.js` directly).

---

## HIGH findings (confirmed)

### H1 — Per-IP rate limiting is unconditionally bypassable via X-Forwarded-For spoofing

`getClientIp()` (`bot/server.js:143-150`) takes the first value of
`X-Forwarded-For` verbatim, with **no trusted-proxy allowlist** — its own
comment says as much ("Never used for access-control decisions —
X-Forwarded-For is attacker-supplied unless a trusted proxy sets it"), but
it *is* the sole key for every IP-scoped rate limit in the app:
`allowAuthEmail`'s per-IP bucket (`bot/ratelimit.js:95-103`), and every
`ratelimit.allowAndConsume(...)` call keyed by `getClientIp(req)` — booking
creation, domain-poll routes.

**Live confirmation** (`live-probe.mjs`, check "SECURITY: per-IP rate limit
bypassed via spoofed X-Forwarded-For"): looping 30 times, each request to
`POST /api/auth/email` used a *different* target email **and** a spoofed
`X-Forwarded-For` header set to a fresh fake IP — the per-IP bucket never
engaged (`ipLimitHit: false`). The per-*email* limit did correctly engage
within 8 requests when hammering one fixed email address without spoofing
anything, so a single victim inbox still can't be flooded — but the
per-*IP* limit, whose whole stated purpose (per `bot/ratelimit.js`'s own
top-of-file comment) is "anyone could flood it to spam arbitrary inboxes,"
is trivially defeated by an attacker who varies both the target email and
a spoofed header on every request. The same bypass applies to any other
`allowAndConsume` caller keyed on `getClientIp` alone (e.g. the custom
domain DNS/TLS poll routes, `bot/server.js:1320-1332`, and calendar
booking creation) whenever this server is deployed without a reverse proxy
that strips/overwrites inbound `X-Forwarded-For` before it reaches Node.

**Consequence:** unbounded magic-link email sending to arbitrary,
attacker-chosen inboxes (spam/harassment via the operator's sending
reputation), unbounded growth of the login-token store, and — if deployed
without Cloudflare/another header-stripping proxy in front, which is a real
possibility given the original audit already flagged the docs as
recommending Railway *without* Cloudflare in front for currency detection —
the exact abuse case this limiter's own comments say it exists to prevent.

**Not a regression** — this was explicitly flagged as a residual risk in
this task's brief and is unchanged from the original audit's observation;
recorded here as a live-confirmed HIGH rather than a new discovery.

---

## MEDIUM / LOW findings (confirmed)

### M1 — Deeply nested JSON crashes JSON.parse and leaks the raw error string

`deep-json-probe.mjs`: a `POST /api/draft` body containing JSON nested 5,000
levels deep (30KB on the wire) makes the server's `JSON.parse` throw
`RangeError: Maximum call stack size exceeded`; the handler's catch-all
returns it as `{"error":"Maximum call stack size exceeded"}` with HTTP 500.
The process itself does **not** crash or hang — confirmed by a `/health`
check immediately after, which returned 200 — and each request only cost
single-digit-to-tens of milliseconds even at 200,000 levels, so this is not
a practical single-request DoS. It is still (a) a raw internal error string
handed to the client rather than a clean validation `400`, and (b) proof
that request bodies are never depth-checked before parsing, which is worth
closing before it's combined with something costlier than the current
`JSON.parse` engine behavior.

### L1 — Admin token accepted via query string

`extractAdminToken` (`bot/server.js:596-605`) accepts `HIDOOK_ADMIN_TOKEN`
either as a `Bearer` header (good) or as `?token=` in the URL. A token
that ends up in a URL is exposed to server access logs, browser history,
and `Referer` headers on any outbound link from that page. The compare
itself is timing-safe and fails closed when unset — this is a hygiene
note, not an access-control gap.

### L2 — Live-published sites ship a CSP that provides no XSS mitigation

`DEFAULT_CSP` (`bot/server.js:424-429`, applied to every route that isn't
`/app/*`, including every `/live/<slug>/*` customer site) is
`default-src * data: blob: 'unsafe-inline'; object-src 'none'; base-uri
'self'; frame-ancestors 'self'`. `'unsafe-inline'` on `default-src` (there
is no separate `script-src`) means inline `<script>` and `javascript:`
navigations are not restricted by CSP at all on customer sites — it adds
nothing against C2 or any similar future sink bug. `APP_CSP` (the builder
itself) also keeps `'unsafe-inline' 'unsafe-eval'` for `script-src`, which
is understandable for a hand-rolled builder with inline handlers but is
also strictly weaker than it could be. Recorded as a missed
defense-in-depth layer, not a standalone vulnerability.

---

## What held up (confirmed solid, tested live unless noted)

- **Cross-account authorization — solid everywhere tested, including every
  new surface named in this task's brief.** `live-probe.mjs` set up two real
  accounts (A, B) via the magic-link flow, gave B a site, and had A attempt:
  GET/POST on B's site, versions, invoices, domain (get/start/verify/
  disconnect), checkout, billing-portal, social-feed disconnect, and
  rollback — every one came back 403. The calendar-native owner-tenant hard
  bind (`bot/calendar-native/owner-api.js:58-110`, `authorizeOwnerTenant`)
  was tried two ways — A's own `customerId` (=own session uid, passes the
  hard bind) paired with B's `siteId` (rejected: site ownership check),
  and A supplying B's `customerId` directly (rejected: `customerId !==
  session uid`) — both 403. Every calendar-engine mutation read
  (`cancelBookingAsOwner`, `rescheduleBookingAsOwner`, `reassignBookingAsOwner`,
  `confirmBookingAsOwner`, `bot/calendar-native/engine.js`) additionally
  scopes its SQL WHERE clause by `customer_id AND site_id`, not just the
  route-level check — real defense in depth, not just a gate at the door.
  Path traversal in a siteId URL segment (`../../etc/passwd`) → 404, not
  a filesystem read.
- **SQL injection surface: no string-built queries found.** Every
  `db.prepare()` call found in `registry-sqlite.js` and the
  `calendar-native/*` modules uses `?` placeholders for values; the two
  places that build a template-literal `UPDATE ... SET ${sets.join(', ')}`
  (`registry-sqlite.js:72,236`) only ever push fixed literal column-name
  strings into `sets` (e.g. `'username = ?'`), never attacker-controlled
  keys — values always go through the parameter array. A SQLi-shaped site
  id (`' OR '1'='1`) round-tripped through `/api/sites/:id` returns a clean
  404, no error, no leak.
- **Magic-link mechanics are solid.** Token is single-use — replaying an
  already-consumed `/auth/verify?token=...` sets no cookie
  (confirmed live). A one-character tamper on a fresh, unconsumed token is
  rejected (no cookie set). A one-character tamper on a valid session
  cookie is rejected with 401 (HMAC verification working as designed,
  `bot/auth.js` `verifySession`).
- **Auth dev-link fallback (original CRITICAL) — correctly fixed.**
  `handleAuthEmail` (`bot/server.js:1124`) only emits the `devLink`
  fallback, and only echoes it in the response body, when
  `NODE_ENV !== 'production'` (`bot/server.js:1156,1169`); in production
  without `RESEND_API_KEY` it now logs an error and returns
  `{ok:true, sent:false}` with no token exposure. This eliminates the
  original full-account-takeover-via-any-email bug.
- **Security headers are applied globally, not per-route.**
  `applySecurityHeaders()` runs once at the top of every request
  (`bot/server.js:3180`) before any handler — confirmed live on `/app/`,
  an unpublished `/live/<slug>/`, and `/api/config`: `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, and a route-appropriate CSP +
  `X-Frame-Options` are present on all three. This is a real fix of the
  original "zero security headers" finding, with the CSP-strength caveat
  in L2 above.
- **Stripe webhook signature verification is correctly enforced in
  production.** `/webhooks/stripe` requires `STRIPE_WEBHOOK_SECRET` and a
  valid `stripe-signature` (`payments.constructWebhookEvent`,
  `bot/server.js:3253-3263`) — a bad signature gets 400, no secret
  configured gets 503. The unsigned-JSON fast path only activates when
  `HIDOOK_TEST_PAY=1 AND NODE_ENV!=='production' AND` no webhook secret is
  set — correctly unreachable in production.
- **Admin view access control is sound.** `HIDOOK_ADMIN_TOKEN` compared
  with `crypto.timingSafeEqual`, fails closed (404, not a hint-revealing
  403) when unset or wrong (`bot/server.js:596-618`). See L1 for the one
  hygiene nit.
- **PII-safe logging works as designed.** `bot/logger.js` automatically
  masks any field literally named `email` (`maskEmail`); confirmed live in
  every server log line emitted during these tests, e.g.
  `"email":"a***@example.test#eace1c20"`.
- **Oversized and malformed request bodies are handled cleanly.** A 3MB
  body against the 1MB-capped `/api/auth/email` → 413. A hand-truncated
  malformed-JSON body → 400 with a plain `{"error":"Invalid JSON."}`, no
  stack trace, no file paths.
- **Calendar manage tokens are unguessable and hashed at rest.**
  `mintManageToken()` uses `crypto.randomBytes(24)` (192 bits) base64url-
  encoded; only `sha256(token)` is stored and looked up
  (`bot/calendar-native/engine.js:52-58`), matching the original audit's
  praise for the magic-link token design.
- **Concurrency safety in the booking engine** (praised in the original
  audit as the best-engineered code in the repo) was not re-tested live in
  this pass but nothing in the diff since 2225ca7 touches the
  `BEGIN IMMEDIATE`/unique-index logic in a way that looked risky on read.

---

## What I did not get to (explicit gaps)

- **The full HTTP publish → live round trip for C2.** The XSS was confirmed
  by calling `build.js`'s `renderHtml()` directly (the exact function
  `webpublish.js` calls to produce both the live page and preview) rather
  than driving `/api/publish` → `HIDOOK_TEST_PAY` → `/live/<slug>/` end to
  end over HTTP. The rendering code path is identical either way, but the
  last-mile step between `renderHtml()`'s output and what `serveLive()`
  sends over the wire was not additionally re-verified.
- **CSRF.** Session cookies are `SameSite=Lax`, which blocks the cookie
  from riding along on a cross-site POST from a top-level navigation, but
  no state-changing route was specifically tested for a CSRF bypass (e.g.
  via a same-site subdomain, or a GET-based state change).
- **`domains.js` internals** (DNS/TLS verification, Cloudflare API calls) —
  only the auth/ownership wrapper in `server.js` was read; did not audit
  `checkDomainConnection`/`activateDomainConnection`/`checkTlsStatus` for
  SSRF-shaped issues (e.g. a custom domain value used to drive an outbound
  request to an internal address).
- **Telegram bot flows** (`bot/flow.js`, `bot/bot.js`) — out of this pass's
  focus (backend HTTP API + calendar), not re-audited here.
- **Exhaustive SQL injection fuzzing** beyond the parameterized-query code
  read and one live SQLi-shaped-ID probe — did not attempt second-order
  injection (a value safe going in but concatenated unsafely downstream)
  or blind timing-based probing.
- **Live Stripe/Resend/Cloudflare/Vercel/Netlify behavior** — per the
  task's rules, no real keys or third-party services were used; only the
  isolated/test-mode code paths were exercised, same limitation the
  original audit recorded.
- **Concurrent-load rate-limit/XFF exploitation at scale** — H1 was
  confirmed functionally (30 sequential spoofed requests, 0 blocks) but not
  pushed to a real volume/throughput test.
- **`registry-migrate.js`, `registry-json.js`, `registry-shared.js`** —
  read only `registry-sqlite.js` and `registry-db.js` (the active backend
  in this worktree); did not review the legacy JSON backend or the
  migration path between them for injection or data-integrity issues.

---

## Files referenced

- `bot/server.js`, `bot/auth.js`, `bot/ratelimit.js`, `bot/logger.js`,
  `bot/registry-sqlite.js`, `bot/registry-db.js`, `bot/domains.js`,
  `build.js`, `templates/portfolio/template.html`,
  `templates/portfolio/presets.json`,
  `bot/calendar-native/{engine,owner-api,manage-api}.js`
- Scripts in this directory: `_harness.mjs`, `live-probe.mjs`,
  `deep-json-probe.mjs`, `probe-colon-entity.mjs`,
  `xss-icon-colon-entity.mjs`, `xss-icon-colon-click.mjs`,
  `xss-icon-colon-rendered.html` (full rendered proof-of-concept page)
