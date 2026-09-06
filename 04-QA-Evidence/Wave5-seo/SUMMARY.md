# Wave5-seo — technical-SEO / publish-robustness re-land

Re-implements the intent of `worktree-agent-a9fef9db8df53e7a4` (commit
`5f0c13a`, based on the pre-round-2/3-audit tree `2225ca7`) against current
`main` (`8a13c19`), keeping what main already covers (unpaid/incomplete_expired
unpublish, absolute og:image) and adding what was still missing: canonical/
og:url, LocalBusiness JSON-LD, robots.txt/sitemap.xml (live + ZIP export),
provider fetch timeouts (Cloudflare/Vercel/Netlify/Revolut/Stripe/domains.js),
Romanian client-safe checkout/billing error text, and BE-06 (invoice.payment_failed
recording).

## Baseline (before this branch's changes, same tree everyone else starts from)
`node --experimental-sqlite --test bot/test/*.test.js`:
  tests 172, pass 156, fail 16 (see repo-root baseline capture; 16 known-red
  files: flow3-legal-export, s54-commercial-photos, s55-subject-photos, and
  ~9 files failing on `.registry.json`/other-agent-owned areas — matches the
  task's stated known-red baseline).

## After this branch's changes
`node --experimental-sqlite --test bot/test/*.test.js`:
  tests 173, pass 157, fail 16 — same 16 failing files as baseline (see
  git history / task description), zero new failures. The +1 test / +1 pass
  is this branch's own new oracle, `bot/test/audit-publish-seo.test.js`.

## Red-before / green-after evidence in this directory

- `red-before-DI05-hang-8s-no-output.txt` — running the new oracle against
  the pre-fix source (deploy-cloudflare.js etc. reverted) hangs on the very
  first DI-05 check with zero output; killed after 8s to prove it is an
  *unbounded* hang (the bug being fixed), not a slow pass.
- `red-before-non-DI05-scratch-script.js` / `red-before-non-DI05-output.txt`
  — a scratch script (not part of the committed suite) exercising the
  non-hanging assertions (F5/F6/prof-06/BE-06/PC-04) against the same
  pre-fix tree: all 8 fail, as expected (none of that logic existed yet).
- `green-after-full-oracle.txt` — the real, committed
  `bot/test/audit-publish-seo.test.js` run against the fixed tree: all 16
  checks pass, exit 0.

Reproduce locally: `git stash`-free method used here was `git diff` → save
patch → `git checkout -- <owned files>` → run oracle (red) → `git apply`
patch back → run oracle (green). See the two scratch/output file pairs above
for the exact commands' output.
