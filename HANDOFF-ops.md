# HANDOFF — Wave 6 deploy/infrastructure ops (2026-09-06)

Written by the ops agent for this wave. Scope: backup/restore, rollback,
health/monitoring, CI security scanning, staging. Files owned by this agent:
`Dockerfile`, `.dockerignore`, `railway.json`, `.github/workflows/**`, new
`scripts/ops-*` files, new `bot/test/wave6-ops-*.test.js` files.

**Not touched, by rule**: `bot/server.js`, `bot/web.js` (owned by another
agent this wave — item 3 needs one small change there, proposed verbatim
below), `bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`
(frozen), and no root-level `*.md` other than this one (another agent is
writing the customer-facing backup/restore runbook; reconcile with that).

Language note: every string this wave adds is CLI/ops output (backup
scripts, log lines, this document), not anything a Hidook customer or site
owner ever sees. The existing convention in this codebase is that
operator-only surfaces (the `/admin` panel, `bot/logger.js` event names) are
English and customer-facing surfaces are Romanian — I followed that
convention rather than translating tooling nobody outside the platform
operator will read. If that's wrong, it's a two-line fix in
`scripts/ops-backup.js` / `scripts/ops-restore.js`.

---

## 1. Backup and restore (the highest-value item)

### What exists now

- `scripts/ops-lib.js` — the actual mechanism: `backupDatabase()` (SQLite
  `VACUUM INTO`, not a file copy — see the big comment at the top of that
  file for why that distinction matters under WAL mode with a live writer),
  `pruneSnapshots()` / `backupAll()` (retention), `restoreDatabase()`
  (integrity-checks the snapshot BEFORE touching anything live, saves a
  pre-restore safety copy of whatever is currently at the target, replaces
  the file + clears stale `-wal`/`-shm`/`-journal` sidecars, re-verifies).
- `scripts/ops-backup.js` — CLI: `node --experimental-sqlite
  scripts/ops-backup.js [--data-dir DIR] [--backup-dir DIR] [--keep N]`.
  Backs up every database `scripts/ops-lib.js#KNOWN_DBS` knows about
  (`registry.sqlite`, `calendar-native.sqlite`) that actually exists,
  skipping ones that don't (e.g. a site with no bookings enabled yet has no
  `calendar-native.sqlite`) without treating that as an error.
- `scripts/ops-restore.js` — CLI: `node --experimental-sqlite
  scripts/ops-restore.js --name registry|calendar-native --yes` (restores
  the latest snapshot) or `--snapshot PATH --target PATH --yes` (explicit).
  **Refuses to do anything without `--yes`** — a dry run prints exactly what
  it would do and exits 1, specifically so a copy-pasted command from a
  runbook can't silently nuke a live database.
- Retention default: `BACKUP_RETENTION` env, default **14** snapshots kept
  per database name. Override per-invocation with `--keep N`.
- Default locations mirror what the app itself already uses:
  `DATA_DIR` (Railway: the `/data` volume) for the live databases,
  `<DATA_DIR>/backups` for snapshots (override with `BACKUP_DIR`).

### Proof it actually works (not just "should")

`bot/test/wave6-ops-backup-restore.test.js` — seeds a real registry database
through the real `bot/registry-sqlite.js` API (users, sites, versions, paid
orders, a claimed Stripe event id), confirms it's genuinely in WAL mode with
a live `-wal` sidecar, backs it up, proves the snapshot's content-digest
matches the live database (including a write that never got explicitly
checkpointed), **deletes the original file plus its `-wal`/`-shm`
sidecars**, restores from the snapshot, and asserts:
- the restored file is **byte-for-byte identical** (SHA-256) to the snapshot
  it was restored from,
- the restored database's **content digest** (every table, every row, in a
  stable order — independent of any particular file layout) matches the
  content digest taken before the disaster,
- the restored database is fully usable through the real `registry-sqlite`
  API afterward (not just byte-equal on disk).

It also proves retention pruning keeps the newest N and deletes the rest, a
corrupt/bogus "snapshot" is rejected via `PRAGMA integrity_check` **before**
anything live is touched, and a restore over an existing target saves a
pre-restore copy that itself round-trips correctly.

I additionally ran the actual CLI end to end by hand (not through the test
harness) against a throwaway `DATA_DIR` outside the repo: seed → `node
scripts/ops-backup.js` → `rm` the live file + WAL + SHM → `node
scripts/ops-restore.js --name registry` (no `--yes`, confirmed dry-run exits
1 and touches nothing) → `... --yes` (confirmed `integrity=ok`) → re-read
the site through the app's own registry API and got the identical record
back. Full transcript: `04-QA-Evidence/Wave6-ops/cli-drill-transcript.txt`.
Machine-readable digest/hash evidence from the automated test:
`04-QA-Evidence/Wave6-ops/backup-restore-proof.json`.

### What the owner should actually do (runbook — mirror this into the other agent's doc)

**Schedule backups.** Nothing in this repo currently invokes
`ops-backup.js` on a timer — that needs a Railway Cron Job (or scheduled
service) running, inside the same container image:
```
node --experimental-sqlite scripts/ops-backup.js
```
Recommended: hourly. `NODE_OPTIONS=--experimental-sqlite` is already set at
the image level (see `Dockerfile`), so the flag above is redundant there but
kept for anyone running it outside the container.

**Restore procedure** (real disaster, not a drill):
1. Stop the service (Railway → the service → suspend/scale to 0). Do NOT
   restore into a database a live process still has open — this is a
   file-level operation and does not coordinate with a running writer.
2. `railway run node --experimental-sqlite scripts/ops-restore.js --name
   registry --yes` (and `--name calendar-native` if that database is also
   affected). Without `--name`, `--target`/`--snapshot` let you restore an
   arbitrary file.
3. Read the printed `integrity=ok` / `preRestoreBackup=...` line. If
   integrity isn't `ok`, STOP — do not restart the service against a file
   that failed its own re-check after restore; investigate the snapshot
   chain instead (an older snapshot in `<DATA_DIR>/backups/` is very likely
   still fine).
4. Restart the service, hit `/health`, spot-check a known site/booking.

**Where snapshots live**: on the same Railway volume as the live databases
(`<DATA_DIR>/backups`). That is deliberately not yet "off-box" — see
Known gaps below.

### Known gaps (explicitly not solved this wave — no real cloud calls allowed)

- **Off-box copies.** Snapshots sit on the same Railway volume as the live
  data. A volume-level disaster (not "a bad migration", an actual lost
  volume) takes the backups with it. The honest fix is an offsite copy step
  after `ops-backup.js` runs — e.g. push each new snapshot to S3/R2/Backblaze
  — which needs real credentials this wave explicitly may not touch. The
  hook point is exactly `backupAll()`'s return value in
  `scripts/ops-lib.js` (each entry has `snapshotPath`); wiring an upload
  after that call is a small addition once credentials exist.
- **No cron wired up yet.** `ops-backup.js` is a command, not a schedule.
  Someone needs to add a Railway Cron Job for it (or a `setInterval` inside
  `web.js` — the latter is arguably worse: it ties backup liveness to the
  same process being healthy, which is exactly the case you don't want to
  depend on during an incident).

---

## 2. Rollback

### The procedure

Railway keeps prior deployments. "Roll back a bad deploy" = **redeploy the
previous successful image** (Railway dashboard → Deployments → previous →
Redeploy) or, source-of-truth version, `git revert <bad commit>` on `main`
and push, which the existing `.github/workflows/ci.yml` `test` job runs
before Railway redeploys. Both are code-only operations — neither touches
the database.

### What that means for schema migrations — tested, not just asserted

`bot/test/wave6-ops-rollback.test.js` checks two separate claims:

**A. Every migration that exists today is additive-only**, verified against
the actual SQL strings in `bot/registry-schema.js` (`SCHEMA_SQL_V1`) and
`bot/calendar-native/schema.js` (`SCHEMA_SQL_V1/V2/V3`): `CREATE TABLE`,
`CREATE INDEX`, and one `ALTER TABLE calendar_bookings ADD COLUMN
anonymized_at` (V3). None of them `DROP` a table/column, `DELETE`, or
`TRUNCATE`. The test then proves the practical consequence directly: it
opens a calendar-native database that has already migrated through V3, and
runs an INSERT and a SELECT built with the *exact column list V1 had* —
i.e. code from before V3 shipped — and both succeed unmodified. **This is
what makes "redeploy the previous image, leave the database alone" a valid
rollback for every migration in this codebase today**: an older binary
simply never mentions a column/table a newer one added, and SQLite doesn't
care.

**B. That is a schema-level guarantee, not a data-level one — and the test
proves the difference is real, not theoretical.** The one place this
codebase does an irreversible in-place data mutation is
`bot/calendar-native/retention.js`'s `runRetentionSweep()`: it overwrites
`visitor_name`/`visitor_email`/`visitor_phone`/`note` for old bookings. The
test runs the sweep, confirms the PII is gone, and confirms — by
construction, since no such function exists anywhere in the codebase —
that nothing about "rolling back the deploy" brings it back. The **only**
thing that does is restoring the database from a backup taken before the
sweep ran (`scripts/ops-restore.js` — item 1), and the test proves that
specific recovery path end to end (backup before the sweep → run the sweep
→ restore → original PII is back).

**Honest summary for the owner:**
- **Code rollback is currently always schema-safe** (every migration is
  additive) — this is a property of what's been written so far, not a
  guarantee the tooling enforces. The day someone writes a `DROP COLUMN` or
  a data-rewriting migration, "redeploy the old image" stops being safe for
  that migration on its own.
- **Code rollback is never data-safe.** Anything a newer deploy wrote or
  changed in the database (anonymization, a paid order, a claimed webhook
  event, a published site version) stays exactly as the newer deploy left
  it after you roll the code back. If a bad deploy corrupted or destroyed
  data, the fix is `scripts/ops-restore.js` from a pre-incident snapshot,
  not a code rollback — and that means the backup schedule from item 1 is
  what actually bounds how bad "roll back a bad deploy" can be, not the
  rollback mechanism itself.
- The registry's own SQLite cutover ships its own emergency switch —
  `REGISTRY_BACKEND=json` — which the test confirms still resolves
  `bot/registry.js` to the original `bot/registry-json.js` module with zero
  code changes. That's a rollback path for the *storage engine choice*
  specifically (pre-existing, this wave just verified it still works), not
  a general answer to "undo a schema migration".

### A note on schema versioning I found while writing this (not fixed — not mine to fix)

`bot/calendar-native/schema.js` exports `SCHEMA_VERSION = 2`, but
`bot/calendar-native/db.js`'s `migrate()` has a hardcoded `if (current < 3)`
block that always applies `SCHEMA_SQL_V3` regardless of that constant. It
works today (every fresh or existing database ends up at migration version
3 in the `schema_migrations` table), but the exported `SCHEMA_VERSION`
constant no longer describes reality, and the final "safety net" block
(`if (current < SCHEMA_VERSION)`) is dead code — `current` is always `3` by
the time it's reached, which is `>= 2`. Cosmetic today; worth a one-line fix
(`SCHEMA_VERSION = 3`) before a V4 migration is ever added, or the safety
net will silently do nothing when it's needed. Left alone here since
`bot/calendar-native/schema.js` isn't in this agent's ownership list.

---

## 3. Monitoring and alerting

### What `/health` actually asserted before this wave

```js
// bot/server.js, current code
if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health') {
    if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end();
    }
    return sendJson(res, 200, { ok: true, service: 'hidook-bot', uptimeSec: Math.round(process.uptime()) });
}
```

**Nothing.** It never touches the registry database, the calendar database,
or the disk. `bot/test/wave6-ops-health.test.js` proves this concretely: it
starts the real server against a `DATA_DIR` whose `registry.sqlite` is
deliberately corrupt garbage, hits `/health`, and gets back `200
{"ok":true,...}` anyway. Railway's `healthcheckPath: /health`
(`railway.json`) currently can only ever restart the container for being
*unresponsive*, never for being *up but broken*.

### What I built to fix it (module only — I don't own `bot/server.js`)

`scripts/ops-health-lib.js` — fully tested in isolation
(`bot/test/wave6-ops-health.test.js`), zero new dependencies:

- `isAlive()` — trivial, no I/O, "the process can execute JS at all". This
  is what a **liveness** probe should check (restart on failure).
- `checkReadiness({ dataDir })` — real dependency checks:
  - **registry database**: opens it and does an actual write+delete round
    trip (not just "the file exists" or "the connection opened") via
    `scripts/ops-lib.js#checkDatabaseWritable`. Missing/corrupt → not ready.
  - **calendar-native database**: same check, but its *absence* is not a
    failure (not every site has booking enabled) — only an existing-but-broken
    file is.
  - **disk space**: `fs.statfsSync(dataDir)`; below 10% free is reported as
    a reason (tune `DISK_FREE_RATIO_WARN` in that file if 10% is wrong for
    the actual volume size in use).
  - Returns `{ ok, checks: { registryDb, calendarDb, disk }, reasons }` and
    emits a structured `health.ready` / `health.not_ready` log line via
    `bot/logger.js` every time it's called (see "what to log" below — this
    is exactly the event an alert should key off).

### Proposed change to `bot/server.js` (for the owning agent — exact patch, not applied here)

Add a readiness route next to the existing one, and leave the existing
`/health` as pure liveness (so Railway's `healthcheckPath` — which gates
*restarts* — doesn't restart a container just because the database is
briefly slow; that's what an alert on `/health/ready` is for, not a
container restart):

```js
const { isAlive, checkReadiness } = require('../scripts/ops-health-lib');

// ── Health (liveness — process is up, no I/O) ─────────────────────────
if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health') {
    if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end();
    }
    return sendJson(res, 200, { ...isAlive(), service: 'hidook-bot' });
}

// ── Readiness (real dependencies: DB reachable+writable, disk) ────────
if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health/ready') {
    const r = checkReadiness();
    const status = r.ok ? 200 : 503;
    if (req.method === 'HEAD') {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end();
    }
    return sendJson(res, status, r);
}
```

Whether `railway.json`'s `healthcheckPath` should point at `/health` or
`/health/ready` is a real tradeoff, not a typo to fix: pointing it at
`/health/ready` gets automatic restarts on a broken database, but also
means Railway will restart-loop the container during a genuine, temporary
DB blip instead of just serving degraded and recovering — restarting a
process doesn't fix a broken volume, and a restart loop makes an incident
harder to debug, not easier. I left `railway.json` pointed at plain
`/health` (liveness) and recommend `/health/ready` feed an **alert**, not
the restart policy. If the owner wants Railway to auto-restart on database
failure too, that's a one-line `healthcheckPath` change once `/health/ready`
exists.

### Structured logging — what exists, what this wave added, what to alert on

Already in place (`bot/logger.js`, unowned by me, unchanged): one JSON line
per event to stdout/stderr, `webhook.stripe.*`, `server.started`,
`server.error`, email masked automatically. This wave adds, in the modules
it owns:
- `ops.backup.snapshot_created` / `ops.backup.snapshot_failed` /
  `ops.backup.pruned` / `ops.backup.prune_failed` /
  `ops.backup.skipped_missing` (`scripts/ops-lib.js`)
- `ops.restore.completed` / `ops.restore.snapshot_corrupt` /
  `ops.restore.pre_restore_backup_failed` (`scripts/ops-lib.js`)
- `health.ready` / `health.not_ready` (`scripts/ops-health-lib.js`, level
  `error` when not ready — every readiness poll logs, so an aggregator can
  alert on the rate of `health.not_ready`, not just its existence)

**What an owner should alert on** (this is the deliverable the audit asked
for; wiring it into a real alerting product — Railway's own alerts, a
Slack webhook, PagerDuty — needs credentials this wave can't touch, so this
is the specification, not the integration):
1. `health.not_ready` appearing more than once in a row (a single blip
   during a backup/VACUUM is expected; a sustained run is not).
2. `ops.backup.snapshot_failed` at all, ever — a failed backup is silent
   data-loss risk that compounds every day it goes unnoticed.
3. `webhook.stripe.handler_error` (already emitted, unowned) — a paid order
   that didn't get recorded.
4. `server.error` (already emitted, unowned) — the HTTP server itself
   erroring.
5. Zero `ops.backup.snapshot_created` lines in a 25-hour window once the
   Railway Cron Job from item 1 exists — the absence of a heartbeat is
   itself the signal that backups have stopped running at all.

---

## 4. Secret and dependency scanning in CI

`.github/workflows/ci.yml` gained a second job, `security`, alongside the
existing `test` job (parallel, does not slow down the test job):

- **Secret scan**: `node scripts/ops-secret-scan.js` — a zero-dependency,
  in-repo static scanner (not a third-party Action) that checks every
  git-tracked file for real-secret-shaped strings: AWS access key ids,
  live Stripe secret/restricted keys (`sk_live_`/`rk_live_` — deliberately
  NOT `sk_test_`, which this codebase's own tests use on purpose), PEM
  private key blocks, Slack tokens, GitHub tokens, JWT-shaped strings.
  Chose in-repo-and-dependency-free over `gitleaks`-the-Action specifically
  because this repo ships zero runtime dependencies as a stated design
  choice, and a scanner that's ~150 lines of plain Node can be read and run
  locally by anyone with nothing installed. A short allowlist
  (`PLACEHOLDER_HINTS` in that file: `test`, `example`, `fake`, `dummy`,
  `changeme`, ...) keeps it from crying wolf on this codebase's own test
  fixtures — a scanner that flags its own tests trains everyone to ignore
  it. **Exits 1 with the finding printed on any hit — no `|| true`.**
  `bot/test/wave6-ops-secret-scan.test.js` proves every pattern it claims to
  catch is actually caught, proves placeholders are exempted, proves this
  repository currently scans clean (a regression guard — this test goes red
  the day a real-shaped secret lands in a tracked file), and proves the CLI
  itself exits 0/1 correctly via a real subprocess spawn, with a genuinely
  planted-then-deleted fixture for the dirty case.

  If a stronger tool is wanted later (gitleaks also scans git *history*,
  which this in-repo scanner deliberately doesn't — it checks the current
  tracked tree only), that's an additive change to the same job, not a
  replacement — the two aren't mutually exclusive.

- **Dependency audit**: `npm audit --audit-level=high` for both the root
  (`playwright` + dev tooling) and `bot/` (`grammy`, its one real runtime
  dependency — `bot/bot.js`'s Telegram intake). Both ran clean locally
  (`found 0 vulnerabilities`) at the time of this wave. **No `|| true`** —
  a `high`+ finding fails the build. `--audit-level=high` (not `moderate`)
  is a deliberate floor, not laziness: this is a two-person-adjacent
  project, and a `moderate` gate on `npm audit`'s notoriously noisy
  transitive-dependency advisories would train the same "ignore red CI"
  reflex the audit finding is trying to prevent. Tighten to `moderate`
  once someone is actually triaging audit output regularly.

---

## 5. Staging

There is one Railway environment today (`bot/DEPLOY.md`: one service, one
`/data` volume, one Stripe webhook target). What I could configure without
any real credentials or touching a live environment:

- **CI is now the first gate** (already existed: `test` job; this wave adds
  `security`). Both must pass before a human even considers deploying — that
  is the zero-infrastructure floor of "verified against something before it
  reaches customers."
- **Recommended staging setup** (not created — needs a second Railway
  project + a second Stripe account in test mode, i.e. real infrastructure
  decisions and a second set of credentials, which this wave may not touch):
  1. A second Railway environment (Railway supports multiple environments
     per project, or a second project entirely) tracking a `staging` branch,
     with its **own** `/data` volume (never share the production volume —
     that defeats the entire point, and would let a staging bug corrupt
     real customer data).
  2. `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from Stripe **test mode**,
     a **separate** webhook endpoint pointed at the staging URL.
     `DEPLOY_PROVIDER=cloudflare` with a **separate** Cloudflare Pages
     project (or none — the deploy step can be skipped in the flow the
     builder tests without needing a live Pages deploy) so `wrangler`
     activity from staging tests never touches the real
     `hidook.agency`/production Pages project.
     `bot/test/wrangler-identity-commercial.test.js` already guards the
     production `wrangler.toml` against staging/sample project names
     leaking in the other direction — worth adding the mirror-image
     assertion once a staging `wrangler.toml` exists.
  3. A branch protection rule requiring the `test` + `security` CI checks to
     pass before merge to `main` (a GitHub repo setting, not a file in this
     repo — someone with admin on the GitHub repo needs to turn this on;
     I can't from here).
  4. The `ops-backup.js`/`ops-restore.js` restore drill in
     `bot/test/wave6-ops-backup-restore.test.js` doubles as the staging
     smoke test for "does restore actually work" — running it against a
     staging volume copy before trusting a restore in a real incident is
     exactly the kind of "verify against something production-like" the
     task asked for, and it needs no additional code, just running the
     existing test/CLI against staging's own data directory.

None of the above required a real credential or touched anything live — the
actual staging *environment* (a second Railway project/service) is a
console click + a second Stripe test-mode key that only the account owner
can create; I've laid out exactly what to configure once someone does.
