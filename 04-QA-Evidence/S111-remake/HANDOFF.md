# S111 — HANDOFF (NOT semantic ACCEPT)

## Outcome
PASS (implementation + causal tests + isolated live evidence). Independent critic + QA + advocate required.

## Scope
Owner policy after S110 advocate STILL STANDING:
1. Public Instagram only when Instafidget/partner embed is connected.
2. Never direct `instagram.com` iframe; omit section when not connected (no gallery pretending).
3. Mobile chrome at 390 readable (nav / email / site name / Detalii URLs).
4. Operator mid-run: `/app` bare slash + HEAD `/app/` routing.

Base: `87ab552` → branch `wt/s111-instafidget-policy` worktree `/Users/Work/.hermes/worktrees/s111-instafidget-policy`.

## Changes
- `build.js`: `isConnectedSocialFeedEmbed` + `normalizeInstagramForPublic` in `renderHtml` — reject IG/FB hosts; connected → partner iframe only; not connected → clear handle/gallery/posts so section is omitted.
- `templates/*/presets.json`: cleared direct `instagram.com` embedUrl (url/gallery/handle kept for Detalii + contact).
- `builder/app.css`: nav nowrap; user-badge single-line ellipsis (not break-word shred); site-card-name wraps; Detalii URL no `overflow-wrap:anywhere`.
- `builder/index.html`: absolute `/app/app.css|app.js|generated/*` assets.
- `bot/server.js`: bare `/app` → 302 `/app/`; HEAD on `/app/*`, `/live/*`, `/health`, `/`.
- `bot/test/s111-instafidget-policy.test.js`: causal RED on parent + GREEN HEAD + HTTP `/app` checks.
- Evidence: `04-QA-Evidence/S111-remake/`.

## Verification
```
node bot/test/s111-instafidget-policy.test.js     → exit 0
node bot/test/s107-s106-advocate.test.js          → exit 0
node bot/test/s103-s101-qa-fail.test.js           → exit 0
node bot/test/s99-s97-qa-fail.test.js             → exit 0
node bot/test/s95-s94-advocate.test.js            → exit 0
node bot/test/s89-s88-advocate.test.js            → exit 0
node bot/test/s70-professionals-appointments.test.js → exit 0
node bot/test/s63-owner-builder-gaps.test.js      → exit 0
node bot/test/s62-app-test-pay-live.test.js       → exit 0
node bot/test/s50-builder-pay-republish.test.js   → exit 0
node bot/test/s3-design-systems.test.js           → exit 0
node bot/test/social-feed-partner.test.js         → exit 0
node bot/test/s74-s72-qa-fail.test.js             → exit 0
node bot/test/builder-boot.test.js                → exit 0
node bot/test/s60-stranger-chrome.test.js         → exit 0
node bot/test/engine.test.js (after build:app)    → exit 0
node scripts/s111-browser-evidence.js             → exit 0 (pass:true)
```
Pre-existing (not introduced): `s53-no-factory-placeholders` still asserts registry length 3 while registry has 4 systems (professionals).

## Live evidence (isolated)
- no IG: `/live/qalive-s111-noig/` — no `instagram-embed-iframe`, no `instagram.com` iframe src, no `pm-social` section (contact IG link only).
- with partner: `/live/qalive-s111-withig/` — iframe `https://isolated.local/social-feed/isolated-s111-partner-fixture` only.
- GET `/app` → 302 `/app/`; HEAD `/app/` → 200 `text/html`; HTML loads `/app/app.css` 200.
- Playwright module not installed in this worktree; HTTP + saved HTML used. Screenshots optional for advocate.

## Artifacts
- `/Users/Work/.hermes/worktrees/s111-instafidget-policy/04-QA-Evidence/S111-remake/EVIDENCE.md`
- `.../live-no-ig.html`, `.../live-with-ig.html`, `.../EVIDENCE.json`

## Risks
- Contact footer still links to profile URL (not iframe) — intentional.
- Gallery remains in preset/config for editor Detalii but is stripped at public render.
- PRODUCT.md still mentions gallery fallback historically; runtime policy is S111 normalizer.

## Handoff
HANDOFF ONLY — NOT ACCEPT. Next: independent critic → QA → advocate on this worktree/branch. No push, no Telegram, no production.
