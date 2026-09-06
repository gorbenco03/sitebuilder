# HANDOFF-docs.md

Written by the docs/repository-hygiene wave (2026-09-06, closing audit report
`04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md` §4 medium findings #17-#20,
#29/#42, plus the backup-runbook and CHANGELOG/ARCHITECTURE/LICENSE gaps).

This wave's scope was root-level `*.md` files, `bot/README.md`, `bot/DEPLOY.md`,
`templates/README.md`, `.gitignore`, `.gitattributes`, and new
`ARCHITECTURE.md` / `CHANGELOG.md` / `LICENSE` / `BACKUP-RESTORE.md`. It was
explicitly **not** authorized to edit any source file. The items below are
things that are wrong, missing, or unconfirmed, but that require either a
source-code change or an owner decision — out of this wave's reach. Each one
is a specific, actionable item for whichever wave/owner does own that surface.

## 1. `bot/registry.sqlite` is committed to git on `main` — should be untracked

Verified: `git ls-tree -r main | grep sqlite` shows exactly one tracked
SQLite file, `bot/registry.sqlite` (blob `6625d61…`, 106KB, added at commit
`8a13c19` alongside the SQLite-registry feature commit `317b631`). Extracted
and inspected read-only (`sqlite3 <extracted-blob> ".tables"` /
`SELECT count(*) FROM users` / `sites`): it is an **empty**, schema-only
database — 0 users, 0 sites — almost certainly produced by running the
server locally without `DATA_DIR` set (see §2 of `ARCHITECTURE.md` /
`bot/registry-db.js`'s fallback default, which writes next to the source file
in that case) and then swept up by an unqualified `git add`.

No real customer data is exposed by this — but a runtime database file has no
business in version control (it will keep changing on every local run,
bloats every future clone, and normalizes exactly the habit `BACKUP-RESTORE.md`
warns against: "a database file in git" reads as a backup mechanism to a
future reader, and it explicitly is not one). This wave added
`*.sqlite`/`*.sqlite-wal`/`*.sqlite-shm`/`*.sqlite-journal` to `.gitignore` so
it cannot happen again, but **`.gitignore` does not untrack an already-tracked
file** — that needs an explicit `git rm --cached bot/registry.sqlite` (keeps
it on disk if anyone has one locally, just stops tracking it) from a wave
that owns `bot/` and can verify nothing in the test suite or Docker build
depends on that exact tracked file being present (a quick grep suggests
nothing does — `bot/registry-db.js` always creates the file itself on first
open if missing — but that wave should confirm before removing it, since this
wave's scope forbids editing `bot/`).

## 2. `LICENSE` — proprietary default not owner-confirmed

This wave added a root `LICENSE` file (audit finding #19: no LICENSE existed
at all) using an "all rights reserved" proprietary notice, on the reasoning
that `package.json` already declares `"private": true` and the product is
sold as a hosted SaaS, not published as open source — proprietary is the
standard default for that shape of project absent an explicit decision. This
is a **judgment call, not a verified fact**: the owner has not stated a
license preference anywhere in this repo. Two things the owner should confirm
explicitly (both called out in the `LICENSE` file itself, not left silent):

- The exact legal entity name and jurisdiction to name as copyright holder
  (`VISION.md` §10 lists "date legale/VAT/jurisdicție" as an owner gate that
  has not been exercised yet — the `LICENSE` file currently says "Hidook",
  the product's public brand name, not a confirmed legal entity).
- Whether the license terms for a **customer's own exported site** (the
  HTML/CSS/JS a customer downloads via Export ZIP/HTML, built from their own
  content, containing the non-editable `Build by hidook.tech powered by
  hidook.agency` attribution) should be spelled out anywhere — today nothing
  in this repo states what a customer may do with their own export, and the
  root `LICENSE` (this repo's own code license) does not answer that
  question by itself. This is a product/legal decision, not a docs fix.

## 3. `bot/registry-migrate.js` references a design doc that does not exist in this repo

`bot/registry-migrate.js`'s header comment says "see DESIGN-stocare.md, etapa
3" for the migration contract. Searched the full working tree
(`find . -iname 'DESIGN-stocare*'`) — no such file exists anywhere in this
repo. It may be an internal planning document that lived outside the repo
(e.g. in the separate Hermes governance tree) and was never committed, or the
comment may predate a rename. `ARCHITECTURE.md` §6 documents the migration
contract directly from the code instead of citing that missing file, so
nothing here is blocked — but whoever next touches `bot/registry-migrate.js`
should either commit the referenced design doc or fix the stale reference in
its own header comment. Not fixed by this wave: that comment is inside a
source file, out of scope.

## 4. Residual `git stash` entries — see `AGENTS.md`, not repeated here

`AGENTS.md` ("Never use `git stash`" rule) now lists and describes the 3
entries found in the shared `refs/stash` as of this wave (inspected read-only
via `git stash show`, none dropped). Not repeating the inventory here to
avoid two documents drifting out of sync with each other — `AGENTS.md` is the
one place that should carry it, since it also carries the underlying rule.
