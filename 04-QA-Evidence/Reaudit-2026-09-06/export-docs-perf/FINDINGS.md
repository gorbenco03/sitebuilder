# Re-audit: export/renderer, documentation, performance (2026-09-06)

Scope: verify the remediation claims against 04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md's
three lowest-scoring areas (Export/renderer 6/10, Documentatie 4/10, Performanta 4/10).
HEAD at time of audit: 7736ed7 (docs: record production as it is actually configured).
All numbers below are freshly measured/reproduced in this session, not copied from the
remediation team's own evidence, unless explicitly labeled as such. Scripts live under
04-QA-Evidence/Reaudit-2026-09-06/export-docs-perf/scratch/. No product code, tests or
docs were modified (one accidental write to the repo's sample index.html during a script
bug was caught and confirmed byte-identical to the committed version, no diff, nothing to
revert).

## Scores

| Area | Before (2026-09-06 audit) | After (this re-audit) |
|---|---|---|
| Export / renderer | 6/10 | 7/10 |
| Documentation | 4/10 | 6/10 |
| Performance | 4/10 | 9/10 |

---

## 1. Export / renderer -- 7/10

### What I reproduced as genuinely fixed

- #1 (critical) WhatsApp QR was not a valid QR code. The hand-rolled encoder is gone;
  templates/shared/qrcode.js (2297 lines, MIT-licensed "QR Code Generator for JavaScript"
  by Kazuhiko Arase, a well-known correct implementation) is now byte-identical across all
  5 templates (verified with diff against templates/professionals/qrcode.js -- no output).
  I did not pixel-decode a rendered QR with a camera/vision oracle (no such tool available
  in this environment) -- this is a code-level confirmation, not a decode confirmation.
  Listed as not fully covered below.
- #11 (critical) appointment form faked success on self-hosted exports. Reproduced
  end-to-end: exported the professionals template via bot/site-export.js
  buildStaticSiteTree, served the output from a plain Node static file server with zero
  API routes (true self-hosted scenario, no Hidook backend at all), and drove it with
  real Playwright/Chromium as a visitor. Filled the appointment form and submitted it:
  - Network: POST /api/appointments returned a real 404 (static server has no such route).
  - UI: form shows the Romanian text for "The request was NOT sent. The form stays filled
    in -- try again or use the phone or WhatsApp below." -- an honest failure state, not a
    fake success screen.
  - Script: templates/professionals/script.js lines 507-541 -- any http/https origin
    (export or live) always tries the real backend first and only shows success on a real
    ok response with body.ok true; only the sandboxed null-origin builder preview (srcdoc)
    takes the local-preview shortcut. This is a correct, well-reasoned fix.
  - Evidence: scratch/export-visitor.mjs output, reproducible on demand.
- #10 (critical) stored XSS via the portfolio icon sink, previous fix bypassable.
  Reproduced both documented bypass techniques directly against build.js's icon sink: a
  tab-character-in-scheme payload (jav + TAB + ascript:alert(1)) and a decimal-HTML-entity
  encoded payload (javascript spelled with an entity for the letter j, then alert(2)).
  Built a real portfolio site with both payloads injected into every icon field; the
  output index.html contains no href="javascript: in any form -- both bypasses are
  neutralized (build.js lines 375-396 normalize tabs/CR/LF and decode numeric character
  references before the scheme check, exactly matching the two techniques the original
  finding proved executed in a real browser). Script: scratch/xss-check.js.
- #37 (high) og:image/twitter:image relative on the live site. Verified absolute when the
  deploy origin is deterministic ahead of time (PUBLIC_URL set, matching the
  README-documented and production-documented setup): the og:image tag resolved to
  http://127.0.0.1:4321/live/seo-withpuburl-b1cb56/images/cn-hero.jpg. See the
  "New/confirmed defects" section below for the case where this is not true.
- #38 (high) business-rename cascade corrupting seo.jsonLd via unescaped text-replace.
  builder/app.js lines 391-392 now call cascadeJsonLdPath('seo.jsonLd'), a structural
  parse-then-set-then-reserialize cascade, not a substring replace. Confirmed by reading
  the code; not re-exercised end-to-end through the UI (time-boxed out).
- Custom domain self-serve (#47, high-rebuild). bot/domains.js (877 lines) implements a
  real self-serve flow: TXT+CNAME verification, Cloudflare custom-hostname attach,
  activation, and a SEO-origin flip (applyCustomDomainOrigin) that rewrites
  canonical/og:url/og:image/robots.txt/sitemap.xml and republishes so the live copy
  matches, with a matching restore path on disconnect. I ran the existing test suite
  rather than writing my own click-through (time-boxed) -- all pass against the code's own
  DNS/Cloudflare stubs: wave7-domains-validation.test.js (8/8), wave7-domains-dns-verify
  .test.js (2/2), wave7-domains-cloudflare-attach.test.js (4/4), wave7-domains-seo-origin
  .test.js (1/1, explicitly asserts the canonical/og:url/robots/sitemap flip on connect and
  the restore to the Hidook subdomain on disconnect), wave7-domains-routes.test.js (3/3,
  auth + rate limiting on the HTTP routes). This is lighter-touch verification than the
  rest of this report -- flagged under "not covered."

### New/confirmed defects (not closed by the remediation)

#A (critical, live-serving) -- the audit's own hinted suspicion, confirmed and worse than
hypothesized. When a site is published under isolated-deploy mode without PUBLIC_URL set
-- a configuration the codebase explicitly supports and has a dedicated regression test
for (bot/test/flow4-isolated-live-url.test.js, which asserts publish "must not throw" and
returns a fetchable /live/slug/ URL) -- the live site's canonical link, og:url,
robots.txt Sitemap line, and every sitemap.xml loc entry stay pointed at
"https://pending-deploy.hidook.invalid/", an RFC 2606 placeholder domain, forever. Not
"relative to the server root" -- literally a non-resolvable fake domain, shipped on a
live, publicly served page.

Reproduced twice, once via a direct call to the publish function and once through the real
HTTP server end-to-end (publish, then complete test-pay, then fetch /live/slug/,
/live/slug/robots.txt, /live/slug/sitemap.xml as a real visitor would). All three
resolved to the placeholder domain instead of the site's own path.

Root cause, in bot/webpublish.js:
- The predictedPublicOrigin helper (around line 900-917) returns an empty string for
  isolated deploy when PUBLIC_URL is unset, instead of the same "/live/" + slug fallback
  that the isolated-deploy function itself uses two lines away (line 810) -- despite a
  code comment at lines 887-889 explicitly claiming the two formulas are "identical." They
  are not, for the empty-PUBLIC_URL branch.
- Because of that, the build-time SEO origin falls back to the pending-deploy placeholder,
  and the post-deploy correction step (around lines 1601-1615) is supposed to fix it up --
  but it only rewrites files in the pre-deploy build directory, never the copy that the
  isolated-deploy function already made into the published-site folder moments earlier,
  and it only triggers a re-deploy (which would push the corrected files) when the
  provider is neither isolated nor fake -- i.e. it explicitly skips the one case that
  needs it.
- When PUBLIC_URL is set (the documented README/GO-LIVE local-dev and production setup),
  this entire path is avoided and everything is correct -- verified: canonical, og:url,
  og:image, robots.txt, sitemap.xml all resolve correctly under the /live/slug/ path.
  Production itself is not exposed to this bug (per ARCHITECTURE.md section 10b,
  production sets DEPLOY_PROVIDER=cloudflare plus BRAND_DOMAIN, which resolves the origin
  deterministically through a different code path that does not touch the pending-deploy
  placeholder at all). The bug is real and reproducible for anyone self-hosting Hidook
  itself via isolated deploy and forgetting/omitting PUBLIC_URL -- a documented-but-not-
  enforced requirement.
- Severity: critical for the affected configuration (a live page permanently serving a
  nonsense canonical/sitemap/robots to real search engines and social scrapers, with no
  self-healing on republish), scoped to a topology the shipped production config avoids.

Scripts: scratch/seo-check.js (direct publish call, with and without PUBLIC_URL),
scratch/seo-check-http.js (full HTTP round-trip as a visitor).

#B (medium) -- regenerating a ZIP/HTML export from an already-published isolated-deploy
site loses the /live/slug path. bot/site-export.js's originFromCanonical function (around
line 318-325) computes the URL origin only, which strips any path. For the documented
Cloudflare/BRAND_DOMAIN production topology this is harmless (canonical has no path
segment there). For a self-hosted/isolated Hidook instance where a site's real canonical
is a path like host:port/live/slug/, re-exporting it produces robots.txt and sitemap.xml
pointing at host:port/ (the bare Hidook host, not even the export's future domain) --
reproduced directly against the professionals template with a canonical simulating this
case: canonical stayed correct (taken verbatim from config) but robots.txt/sitemap.xml
were stripped of the path. The export README's own advice to regenerate after publishing
on the real domain does not fix this for a path-based deploy, because the path-stripping
happens regardless of when the export is regenerated. This only affects self-hosted
Hidook installs using isolated deploy, not the documented production configuration.
Script: scratch/export-visitor.mjs.

### JSON-LD

Validated with a real parser (JSON.parse, not eyeballing) on both an auto-derived
LocalBusiness block and a preset-supplied Restaurant block. Example (product-menu preset,
live-published with PUBLIC_URL set), reproduced verbatim from the actual output:

  context = https://schema.org, type = Restaurant, name = "Casa Nord",
  telephone = "+40721234567", address = a well-formed PostalAddress object with
  streetAddress/addressLocality/addressCountry.

Valid JSON, valid schema.org context, the type is a real schema.org type with a required
name and a well-formed nested PostalAddress. I did not run this through Google's Rich
Results Test (would require an outbound call to a third party) -- structural validation
only.

### What I did not cover in this area

- Pixel-decoding the rendered WhatsApp QR (no camera/vision oracle available).
- An independent, from-scratch UI click-through of the custom-domain connect flow --
  relied on the existing (passing) test suite plus code reading.
- Gallery lightbox / mobile nav / add-remove-list defects from the original report
  (numbers 3, 4, 18, 19, 21, 22) -- out of my three assigned areas; not re-verified.
- The number-38 JSON-LD cascade fix was read, not re-exercised through the browser
  builder UI.

---

## 2. Documentation -- 6/10

### Confirmed fixed

- Number 31 (high), the test command. package.json's test script is now
  "node --experimental-sqlite --test bot/test/*.test.js"; README.md explains the --test
  flag requirement and the Node-version caveat clearly and correctly. Matches.
- Number 33 (high), VISION.md invisible from README. README.md's docs-map table now lists
  VISION.md first, labeled "Source of truth -- takes priority over every other doc."
- Number 7 (critical), VISION.md vs PROJECT_STATUS.md on "is the product done."
  PROJECT_STATUS.md's event log now explicitly says the "ready" declaration is withdrawn
  pending a real full pass -- no longer contradicts VISION.md's requirement for
  independent QA before declaring the product done. Minor note: the file's top-of-file
  "Actualizat" date (2026-09-05) is one day behind today's (2026-09-06) remediation
  commits -- a staleness smell, not a contradiction.
- ARCHITECTURE.md section 10b, "Production, as actually configured," cross-checked
  against bot/webpublish.js's predictedPublicOrigin function: the claim that production
  uses DEPLOY_PROVIDER=cloudflare plus BRAND_DOMAIN (giving a per-slug subdomain, no path)
  is exactly the code branch that avoids finding #A above. Accurate.

### New defects found (checked against code, not against other docs)

#C (high) -- BACKUP-RESTORE.md tells the owner no automated backup tooling exists; it
does, and has for longer than the doc has been stale. The file states, twice: "There is
no backup tooling in this repo today" (near the top) and "An automated backup script or
cron job -- none exists in this repo yet" (section 6) -- and instructs the owner to run
manual sqlite3 .backup shell commands by hand on a cron schedule. In fact
scripts/ops-backup.js plus scripts/ops-lib.js already implement exactly this -- using
SQLite's VACUUM INTO (which ops-lib.js's own comment explains is more correct than the
sqlite3 .backup CLI approach the doc recommends, for the identical WAL-consistency reason
the doc itself gives), plus retention/pruning (default 14 snapshots) and a restore
counterpart (scripts/ops-restore.js). Confirmed by commit timestamp, not just doc text:
BACKUP-RESTORE.md was authored/merged at 2026-09-06 14:05-14:06 (commits 6ce0c36 and
14ef395) and never touched again; scripts/ops-backup.js and ops-lib.js landed 15 minutes
later at 14:21 (commit 70e0760, "feat(ops): SQLite backup/restore, rollback proof, real
readiness checks, CI scanning"). Grepping every markdown file in the repo for "ops-backup"
or "ops-lib" returns zero hits -- the tooling is completely undocumented and actively
contradicted. This is the same class of defect the task brief warned about (a runbook
that would have an owner doing the wrong thing, or missing a better thing, in a real
incident) -- here it is backup tooling instead of a deleted file, but the shape is
identical: do not trust this document over the code.
- Fix scope (informational only, not performed): update BACKUP-RESTORE.md sections 2, 3
  and 6 to point at scripts/ops-backup.js and ops-restore.js as the primary path,
  demoting the manual sqlite3 .backup commands to "what the script does under the hood"
  or a fallback.

#D (high) -- GO-LIVE.md tells the owner custom domains are still concierge-only; the
self-serve flow (audit number 47) has since shipped and replaces it. GO-LIVE.md section 7,
"Known gaps to decide on before selling," states: "Custom domains are concierge, not
self-service. Fine for launch, but it is manual work per customer -- price it in." This is
now false for the browser-builder commercial path: bot/server.js line 1303's own comment
reads "Custom domain routes (audit number 47 -- self-serve, replacing manual concierge),"
and the feature is built, routed, and covered by a passing test suite (see section 1
above). An owner following GO-LIVE.md before launch -- exactly the persona the audit scope
asks me to check this document as -- would price their service assuming manual
per-customer domain work that the product no longer requires, and might never surface the
self-serve flow to customers at all. (The legacy Telegram-intake concierge message, gated
on the CONTACT_URL variable, is a separate, narrower, frozen code path in bot/flow.js and
still exists; the doc's blanket claim about "custom domains" as a whole is what's wrong.)

### Spot-checked, no defect found

- GO-LIVE.md's env-var table does not mention the dead CALENDAR_PUBLIC_BASE_URL or
  PUBLIC_BASE_URL variables that ARCHITECTURE.md flags as "not set in production" -- no
  stale instruction to chase there.
- README.md's local-dev bootstrap command matches bot/server.js's actual env reads
  (PUBLIC_URL, SERVER_SECRET, STRIPE_SECRET_KEY, TELEGRAM_BOT_TOKEN).

### What I did not cover in this area

- A full line-by-line read of PRODUCT.md and VISION.md against each other beyond the two
  items the original audit flagged (numbers 7, 31, 33) -- not re-litigated from scratch.
  PRODUCT.md's native-calendar coverage (original finding number 32) was not re-checked.
- Following the entire GO-LIVE.md checklist commit-for-commit as a fresh clone
  (time-boxed to the env-var tables, the custom-domain claim, and the backup-runbook
  cross-reference it makes in section 6, all of which I checked); did not walk every
  checkbox in section 6 end-to-end.
- CHANGELOG.md, the HANDOFF-*.md files, and the OWNER-*.md files were not audited for
  staleness.

---

## 3. Performance -- 9/10

All numbers below are from my own fresh runs on this session's HEAD, using the CDP
throttling profile the original audit established and the remediation's own harness
already encodes (150ms RTT, 1.6Mbps down / 750kbps up, CPU 4x) -- the file
04-QA-Evidence/Audit-Fixes-2026-09-06/performance/measure.mjs, copied unmodified into my
scratch directory and run twice for reproducibility (scratch/reaudit.json, plus a
confirmatory second run whose numbers matched within noise and were then deleted to save
disk). Boots a real isolated bot/server.js, clicks "Start" on each of the 5 template
cards in a real headless Chromium, and times to a loaded, content-populated iframe.

### Per-template start (click Start to usable editor iframe), target 3 seconds or less

| Template | Wall time (this re-audit) | Heavy JS transferred | Image bytes transferred |
|---|---|---|---|
| product-menu | 1.78s | 19.6 KB | 210 KB |
| local-service | 2.28s | 23.7 KB | 311 KB |
| portfolio | 1.88s | 20.4 KB | 232 KB |
| professionals | 2.36s | 24.9 KB | 327 KB |
| desserdirina | 1.35s | 21.9 KB | 107 KB |

All 5 templates are now under the 3-second target (original audit: 7.8 to 11.7 seconds,
2.6 to 4x over). Reproduced twice, second run within about 10 milliseconds of the first
on every template -- stable, not a fluke.

Two things worth naming honestly:

1. The remediation's own performance evidence bundle (after.json / summary.json under
   04-QA-Evidence/Audit-Fixes-2026-09-06/performance/) reports worse numbers for the same
   measurement (7.5 to 8.5 second iframe load, live-site LCP 3760ms, CLS unchanged at
   0.20/0.166 from their own "before"). Running their exact current script against
   current HEAD gives numbers roughly 3 to 4x better than their own snapshot. The likely
   explanation is that their after.json was captured mid-wave, before later commits
   (one labeled "restore commercial photo-quality floor after the perf image pass," and
   one labeled "perf: finish the interrupted performance wave, real minifier gate,
   runnable npm test") landed -- both post-date the evidence bundle's timestamps. I am
   reporting what I measured at HEAD, not their snapshot; flagging the gap so it isn't
   read as me contradicting them without explanation. Their own evidence bundle is now
   stale and should probably be regenerated if it is meant to represent current-state
   proof.
2. Heavy JS transferred (about 20 to 25 KB) is far below the on-disk per-template bundle
   sizes (75 to 106 KB per the same run's build-size measurement) -- consistent with
   gzip/brotli compression (original finding number 36) actually being applied in
   transit, not just claimed.

### Live published site (product-menu), LCP and CLS at 1440 and 390

| Viewport | Wall time to load | LCP | CLS | Total transfer |
|---|---|---|---|---|
| 1440x1000 | 2114ms | 2124ms | 0 | 358,840 bytes (about 350 KB) |
| 390x844 | 2113ms | 2124ms | 0 | 358,840 bytes (about 350 KB) |

CLS of 0 at both viewports is a genuine improvement over both the original audit's 0.20
and the remediation's own claimed-after 0.20/0.166 (see the caveat above -- this reflects
later commits). I only measured LCP/CLS on the product-menu live site (the one the reused
script publishes); the other 4 templates' live sites were not independently measured for
LCP/CLS -- flagged under "not covered."

### Responsive image variants -- are they actually served differently at 390 vs 1440?

Identical total bytes at both viewports for this run is not a bug -- verified why:
build.js's responsive sizes attribute is defined as roughly 33 percent of viewport width
on desktop (1024px and up), 48 percent on tablet, 94 percent on mobile. That computes to
about 475 pixels wide needed on the 1440 desktop grid (many narrow columns) and about 366
pixels wide needed on the 390 mobile layout (fewer, wider stacked photos) -- both
real-world pixel needs land inside the same smallest available WebP size tier, so the
browser correctly picks the same file both times. Confirmed directly from measured
naturalWidth: 475px at 1440, 366px at 390, both served from the same size-tier WebP file.
This is the sizes attribute doing its job correctly for this specific grid, not evidence
that responsive variants are fake. I did not check a template/breakpoint combination with
a wider size spread (for example a true full-bleed hero image, which should pull a larger
size tier at desktop) -- flagged under "not covered."

### What I did not cover in this area

- LCP/CLS for the local-service, portfolio, professionals, and desserdirina live sites
  (only product-menu was exercised by the reused publish flow).
- A true full-bleed hero image's srcset behavior across viewports (only gallery-grid
  photos were captured in the images array for the template exercised).
- Editor runtime performance after the initial load (typing latency, drag/drop,
  undo/redo) -- out of scope per the audit brief's "Start to usable editor" definition,
  but worth naming as unmeasured.
- Any measurement on a real remote host (Railway/Cloudflare) -- everything here is local
  CDP throttling, per the audit's own established methodology, not real-network
  conditions.

---

## Findings by severity (this re-audit only; does not restate original-audit items not
touched here)

Critical
- #A -- Live isolated-deploy sites without PUBLIC_URL serve the pending-deploy placeholder
  domain as canonical/og:url/robots.txt/sitemap.xml, permanently, with no self-healing on
  republish. Not exposed by the documented production configuration.
  bot/webpublish.js, predictedPublicOrigin (around line 900-917) and the post-deploy
  correction block (around line 1601-1615).

High
- #C -- BACKUP-RESTORE.md claims no automated backup tooling exists; scripts/ops-backup.js
  plus ops-lib.js (built 15 minutes later, same day) do exactly that, undocumented
  anywhere.
- #D -- GO-LIVE.md section 7 claims custom domains are concierge-only; the self-serve flow
  (audit number 47) has shipped and is tested, contradicting the doc's own launch-pricing
  advice.

Medium
- #B -- Re-exporting a ZIP/HTML from an already-published isolated-deploy site loses the
  /live/slug path in robots.txt/sitemap.xml (bot/site-export.js's originFromCanonical
  function strips it). Not exposed by the documented Cloudflare/BRAND_DOMAIN production
  topology.

Positive/confirmed-fixed (listed for completeness, not defects)
- Number 1, WhatsApp QR (code-level, not pixel-decoded); number 7, VISION/PROJECT_STATUS
  contradiction; number 10, portfolio stored XSS (both documented bypasses re-tested and
  blocked); number 11, appointment form fake-success on self-hosted export (full
  visitor-level reproduction); number 31, test command; number 33, VISION visibility;
  number 37, absolute og:image (when origin is deterministic); number 38, JSON-LD cascade;
  number 47, self-serve custom domains; and the template-start / LCP / CLS / compression
  performance work.

## What I did not get to at all

- Original findings numbered 3, 4, 18, 19, 20, 21, 22 (gallery lightbox, add/remove
  lists, mobile nav, portfolio branding residue, color-flash race, cookie-banner
  re-appearance) -- frontend/builder-UX territory, not in my three assigned areas.
- Payments/backend/security findings (numbers 8, 14, 15, and 23 through 30) -- explicitly
  out of scope for this pass.
- Calendar-native findings (numbers 12, 39, 40) and Telegram findings (numbers 13, 41) --
  out of scope.
- A full fresh-clone walkthrough of README.md as a brand-new developer, start to finish
  (I verified the specific documented commands/claims relevant to export/docs/perf, not
  every step).
- Independent pixel-level QR decode; independent full click-through of the custom-domain
  UI flow (relied on the existing passing test suite for the latter).
- LCP/CLS/responsive-image measurement for 4 of the 5 templates' live sites.
- Real-network (non-simulated) performance on an actual deployed host.
