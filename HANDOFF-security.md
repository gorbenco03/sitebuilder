# HANDOFF — Wave 10 security (re-audit follow-up, 2026-09-06)

Scope for this wave was `bot/server.js`, `bot/ratelimit.js`, `bot/site-legal.js`,
and new tests under `bot/test/wave10-security-*` — `bot/payments.js`,
`bot/webpublish.js`, `builder/**`, and `templates/**` were off limits. Nothing
in this wave actually *required* a change in those files (confirmed by
publishing all five templates end to end under the new CSP with zero
violations — see `bot/test/wave10-security-csp-live.test.js`), but two things
are worth flagging for whoever next opens them.

## 1. Deployment note: `TRUST_PROXY=cloudflare` must be set in production

`getClientIp()` in `bot/server.js` no longer trusts `X-Forwarded-For` at all
by default (that was the H1 finding — it was trivially spoofable and
defeated every per-IP rate limit in the app). The new default is safe but
inert: with `TRUST_PROXY` unset, every request's rate-limit bucket key is
the raw socket peer address.

If this app is deployed directly on Railway with **no** Cloudflare
orange-cloud DNS in front of it, that's fine — the socket peer IS the real
visitor IP, and per-visitor rate limiting continues to work exactly as
before.

If it's deployed **behind Cloudflare** (the documented path per
`GO-LIVE.md` and the one `bot/pricing.js` already assumes for
`CF-IPCountry`), the operator **must** set `TRUST_PROXY=cloudflare` in the
environment, or every visitor's request arrives with the same socket peer
(Cloudflare's edge IP) and all per-IP rate limits collapse into one shared
bucket for the whole site — not a security hole, but a real availability
regression (one aggressive visitor could exhaust the bucket for everyone).
This isn't a code change anyone needs to make; it's an ops/docs item —
whoever next touches `GO-LIVE.md`'s Cloudflare section should add a line
for it. It doesn't belong in this wave's diff since `GO-LIVE.md` isn't code
and touching it risked colliding with other agents working the same
release.

## 2. The tightened live-site CSP does not (and cannot) help C2

The independent re-audit's C2 finding — a stored XSS in `build.js`'s
`{{& icon}}` sink via a named HTML entity (`javascript&colon;...`) that
survives the existing numeric-entity/TAB normalization — is **not fixed by
this wave's CSP change**, and can't be by CSP alone: `DEFAULT_CSP`'s
`script-src` still needs `'unsafe-inline'` (every template ships inline
`<script>`/`<style>` — see the constant's docblock in `bot/server.js` for
exactly which template uses what), and `'unsafe-inline'` on `script-src`
does not restrict `javascript:` link execution. Whoever picks up C2 should
not read "CSP got tightened" as "the icon sink is now safer" — it isn't,
for that specific bug shape. The tightening *does* newly block the
unrelated case of an injection that tries to **load an external script**
(`<script src="https://attacker.example/x.js">`), which the old
`default-src *` allowed outright.

If C2's real fix (decode named entities too, or better, parse+re-serialize
the SVG through an allowlist sanitizer instead of a regex normalize-then-
blocklist) ever lets `build.js` emit a nonce or hash for its inline
`<script>` blocks, `DEFAULT_CSP`'s `script-src 'unsafe-inline'` could then
be dropped in favor of a nonce — that would be the point where CSP starts
actually mitigating C2's bug *shape*, not just the external-script variant.
Not this wave's scope; just leaving the trail for later.

## Everything else

No other cross-file coupling. `bot/site-legal.js` (privacy/terms/cookies +
cookie banner) was in this wave's owned-files list but needed no changes —
its only script (`cookie-banner.js`) and styles are same-origin/inline,
already covered by the tightened `DEFAULT_CSP`, and it was included in the
five-template live-render sweep (well, four of the five templates' legal
pages share the same generator — desserdirina's screenshot in
`04-QA-Evidence/Wave10-security/csp/` shows the footer's Confidențialitate/
Termeni/Cookie-uri links and the cookie-consent banner rendering and
functioning normally).
