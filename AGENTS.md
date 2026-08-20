# AGENTS.md — Hidook Site Builder

Read `PRODUCT.md` first. Owner is the client. Do not Telegram the owner, do not ask them to test slices.

## Repo

`/Users/Work/Desktop/sitebuilder` — `github.com/gorbenco03/sitebuilder`.

- Local commits allowed on feature branches / worktrees.
- **No push, no production deploy, no live DNS, no real charges** without explicit owner approval.
- Do not print secrets.

## Stack

Zero-dep static renderer (`build.js`) + Node bot/server (`bot/`) + vanilla builder (`builder/`). Templates in `templates/`. Browser engine is generated: `npm run build:app` → `builder/generated/` (gitignored; **must** be produced by Docker/production build).

## Standing product rules

- Browser builder is the commercial product. Telegram only creates/opens the same draft.
- Pay before public publish. No live unpaid trial.
- Price 100 EUR / 100 GBP / 100 USD by country bucket; renewal 29 same currency / year.
- Three design systems; current templates/DESSERD look are not approved.
- Instafidget is another team: only a neutral social-feed slot.

## Tests

Existing: `node bot/test/*.test.js` (no npm test script). Do not weaken tests. Fake deploy (`HIDOOK_FAKE_DEPLOY`) is not the client journey.

## Git

One task = one worktree/branch. No force-push, reset, or merge to main except integrator after `VERDICT: ACCEPT`.
