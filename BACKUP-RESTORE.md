# BACKUP-RESTORE.md — Hidook Site Builder

Authority: `VISION.md` is the synchronized source of truth for product scope;
`ARCHITECTURE.md` describes the components named here. This file exists
because there is **no backup tooling in this repo today** — the 2026-09-06
audit flagged this (finding #19/#29: "database is a single JSON file, read and
rewritten whole, with no documented backup") and the storage engine has since
moved to SQLite, but backup/restore was never written down anywhere. Every
paying customer's site and every booking lives under one directory. This is
the runbook for not losing it.

If you have not read a step here on a real host before you take real payments,
you do not have a backup — you have an assumption.

## 1. What actually needs backing up

Everything lives under **one path**, `$DATA_DIR` (Railway: a mounted volume at
`/data`; see `GO-LIVE.md` §2.1 and `bot/DEPLOY.md` §3). Verified against
`bot/registry-db.js`, `bot/calendar-native/db.js`, and `bot/ratelimit.js`:

| Path under `DATA_DIR` | Contents | Loss impact if missing |
|---|---|---|
| `registry.sqlite` (+ `-wal`, `-shm` while running) | Every account, site record, draft/paid/live status, version history, Stripe order/event idempotency ledger | **Total** — every customer, every site, every payment record gone |
| `calendar-native.sqlite` (+ `-wal`, `-shm`) | Native-calendar tenants, services, availability, bookings, email outbox/audit (opt-in sites only) | Every booking and availability config for opted-in Professional sites gone |
| `.sessions.json` | Builder login sessions | Low — customers just sign in again via magic link |
| `.ledger.jsonl` | Append-only payment/audit ledger | Loses an audit trail; Stripe Dashboard is still authoritative for money |
| `.ratelimit.json` | Rate-limit counters | None — safe to lose, regenerates |
| `published/<slug>/` | The actual static files each live customer site serves | Every live site goes down (404) until republished from the registry, which is still possible if `registry.sqlite` survives |
| `appointments/<slug>.json` | Legacy local appointment-*request* store (non-native calendar) | Loses pending local requests for sites that never opted into the native calendar |

`.registry.json` may also exist transiently on a host that has not yet
migrated: `bot/registry-migrate.js` reads it once to populate
`registry.sqlite` and never modifies or deletes it. It is not the live source
of truth once migration has run — `registry.sqlite` is — but back it up too
if present; it is a free extra copy of pre-migration data.

**The two `.sqlite` files are the only things that cannot be regenerated or
recovered from Stripe/Cloudflare after the fact.** Prioritize them.

## 2. Why "just copy the file" is not safe for the SQLite stores

Both `registry-db.js` and `bot/calendar-native/db.js` open their database with
`PRAGMA journal_mode = WAL`. In WAL mode, recent writes can live in a
sidecar `-wal` file rather than the main `.sqlite` file until a checkpoint
happens. A plain `cp registry.sqlite /backup/` **while the process is
running** can silently miss the WAL contents (or copy a main file and a WAL
file from two different, inconsistent moments) and produce a copy that opens
without error but is missing recent writes.

Use one of these instead, in order of preference:

### 2a. `sqlite3 .backup` (preferred — online, consistent, no downtime)

The SQLite CLI (`sqlite3`, not this repo's `node:sqlite`) has a built-in
online backup command that is safe to run against a live database:

```bash
sqlite3 "$DATA_DIR/registry.sqlite" ".backup '/backup/registry-$(date +%Y%m%dT%H%M%S).sqlite'"
sqlite3 "$DATA_DIR/calendar-native.sqlite" ".backup '/backup/calendar-native-$(date +%Y%m%dT%H%M%S).sqlite'"
```

This produces a single self-contained, consistent file — no separate `-wal`/
`-shm` to manage — and does not block the running application beyond a brief
lock during the copy. This repo does not currently ship a wrapper script for
this; the commands above are the whole procedure.

### 2b. Host/provider volume snapshot

If your host (Railway or otherwise) offers point-in-time volume snapshots,
those capture the main file and any WAL/SHM sidecars together and are
consistent as long as the snapshot itself is atomic. This also backs up
`published/<slug>/` and everything else under `DATA_DIR` in one step — the
simplest option operationally, but verify your specific provider's snapshot
mechanism is actually atomic before relying on it exclusively.

### 2c. Never do this

- `cp $DATA_DIR/registry.sqlite /backup/` with the app still running and no
  checkpoint — may produce a corrupt or stale copy (see above).
- Committing a database file to git as a "backup". Beyond the obvious (secrets
  and customer PII in a version-control history that many worktrees/agents on
  this machine can read), `bot/registry.sqlite` is checked into git today at
  the repo root of `main` — as of this writing it is an empty, schema-only
  fixture (0 users, 0 sites; verified with `sqlite3 <blob> ".tables"` and
  `SELECT count(*) FROM users/sites`), not real customer data. It still should
  not be tracked; see `HANDOFF-docs.md` for the cleanup this file cannot make
  (it is a source-tree change, not a docs change).

## 3. Recommended schedule

There is no automated backup job in this codebase. Until one exists:

1. **Minimum**: a daily `sqlite3 .backup` (§2a) of both databases via cron or
   your host's scheduled-job feature, retained for at least 14 days, stored
   somewhere other than the same volume (a different disk/bucket — a backup
   next to the thing it backs up does not survive the failure it is meant to
   protect against).
2. **Better**: host-level volume snapshots (§2b) on the same or tighter
   schedule, as a second independent copy.
3. Before any risky operation (Node/dependency upgrade, manual `DATA_DIR`
   surgery, schema migration you have not tested elsewhere first): take an
   ad hoc backup immediately before, by hand.

## 4. Restore procedure

### 4a. Restoring the registry or calendar database

1. Stop the process (or at minimum stop routing traffic to it) — restoring
   into a live WAL-mode database while the app is writing is not safe.
2. Replace the target file:
   ```bash
   cp /backup/registry-<timestamp>.sqlite "$DATA_DIR/registry.sqlite"
   rm -f "$DATA_DIR/registry.sqlite-wal" "$DATA_DIR/registry.sqlite-shm"
   ```
   (same pattern for `calendar-native.sqlite`). Removing any stale `-wal`/
   `-shm` sidecars next to the restored file matters — a leftover WAL from
   the *old* database state can otherwise get replayed on top of the
   restored file the next time it is opened.
3. Start the process. `bot/registry-db.js` / `bot/calendar-native/db.js` will
   run their own `migrateSchema()` on open, which is safe to run against an
   already-current schema (it checks `registry_schema_migrations` /
   the calendar's equivalent version table first).
4. Verify with `GET /health`, then `GET /admin` (with the admin token) to
   confirm site records are present, before resuming traffic.

### 4b. Restoring `published/<slug>/` for a single site

If `registry.sqlite` is intact but a site's built output is missing or
corrupted, you do not need a file-level restore at all: the registry stores
enough to rebuild it. Use the existing rollback path
(`POST /api/sites/:id/rollback`, or `bot/webpublish.js` `publishSite` on the
site's last known-good version) to regenerate `published/<slug>/` from
`build.js` + the stored config — this is the same code path an owner uses to
roll back to a previous version, not a special-cased restore script.

### 4c. Restoring the whole `DATA_DIR`

Same as 4a but for every path in §1 at once — stop the process, replace the
volume/directory contents from the snapshot, restart, verify `/health` and
`/admin`, then a real customer site loads at its live URL before you resume
traffic.

## 5. Test the restore before you need it

An untested backup is a hope, not a backup. Before taking real payments (this
belongs alongside the `GO-LIVE.md` §6 pre-launch checklist, which this repo
does not yet cross-reference — see `HANDOFF-docs.md`):

- [ ] Take a `sqlite3 .backup` of a `registry.sqlite` with at least one real
      test site in it.
- [ ] Restore it into a **different** `DATA_DIR` (never test a restore
      against your only copy) and confirm the site record round-trips.
- [ ] Repeat for `calendar-native.sqlite` with at least one test booking.
- [ ] Time how long the restore actually takes — that number is your real
      recovery-time expectation, not a guess.

## 6. What this file does not cover

- Backing up Stripe data itself — Stripe is the system of record for
  payments; this repo's `.ledger.jsonl` is an audit trail, not a replacement.
- Backing up anything outside `DATA_DIR` — the application code lives in git
  (this repo) and is not part of this runbook.
- An automated backup script or cron job — none exists in this repo yet. If
  one is built, it belongs under `scripts/` and this file should be updated
  to point at it instead of the manual `sqlite3 .backup` commands above.
