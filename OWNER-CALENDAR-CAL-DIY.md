# Owner runbook — Professional calendar (cal.diy, option C)

**Audience:** product owner. Studio prepared the integration boundary and this stub; **hosting, DNS, spend, secrets, and production cutover stay owner-gate**.

**Authority:** `VISION.md` §8 (Calendar Professional) and §10 (Owner gates).

**Chosen path: option C** — Hidook hosts a **cal.diy** instance later for the Professional plan. Not option A (in-process library — impossible; cal.diy is a full app), not option B (customer-owned external booking link as the primary product), not option D (spike-only forever).

---

## What the product does today (honest)

| Surface | Behaviour |
|---------|-----------|
| `templates/professionals` | Local **appointment request** form. Visitor picks a slot; submit → `POST /api/appointments`. |
| API | Status is always **`requested`** — never a confirmed booking. Owner lists via authenticated `GET /api/appointments`. |
| Live templates | **No** cal.diy / Cal.com iframe, **no** “book now on hosted calendar”, **no** fake production embed. |
| Code boundary | `bot/calendar-boundary.js` + env placeholders below. `GET /api/config` exposes public honesty fields only. |

Do **not** ship a fake live booking widget that implies production cal.diy before this runbook’s “done” criteria.

---

## Integration boundary (engineering)

cal.diy is a **separate** Next.js/TypeScript monorepo with **PostgreSQL/Prisma**. Hidook Site Builder stays zero-dep Node + JSON files. Integration is **side-by-side**, not `require('cal.diy')`.

```
[Visitor] → professionals site (static)
              today: POST /api/appointments  → DATA_DIR/appointments/<slug>.json  (requested)
              later: optional embed/link to Hidook-hosted cal.diy  → cal.diy Postgres
[Owner/studio] → builder chrome (no fake calendar admin)
[Ops] → cal.diy app deploy + Postgres + email + backups (owner spend)
```

### Env / config placeholders (this repo — unset = disabled)

| Env | Purpose | When set |
|-----|---------|----------|
| `CAL_DIY_BASE_URL` | Public origin of the self-hosted cal.diy app | After DNS + deploy |
| `CAL_DIY_PUBLIC_EMBED_URL` | Future embed URL template for Professional sites | After embed contract exists |
| `CAL_DIY_API_KEY` | Server-to-server secret (never to templates) | After cal.diy admin |
| `CAL_DIY_WEBHOOK_SECRET` | Verify inbound booking webhooks | After webhook endpoint |
| `CAL_DIY_DATABASE_URL` | Postgres URL for the **cal.diy** app (not Site Builder `DATA_DIR`) | After DB provision |
| `CAL_DIY_ENABLED` | Must be exactly `1` **and** base URL set before any future arming | Owner decision |

`bot/calendar-boundary.js` reads these. In Flow 4.3 the product **still forces** `publicMode: local-request` and `calDiyEnabled: false` so public templates cannot claim hosted booking.

---

## Runbook stub — future self-hosted cal.diy

**What:** One Hidook-operated cal.diy (MIT fork of Cal.com) for Professional customers’ real booking.

**Where (suggested — owner picks final):**

1. Separate host/service (not inside `bot/server.js`).
2. Managed Postgres with backups.
3. DNS under owner domain (e.g. `calendar.<brand-domain>` — exact host is owner gate).
4. Transactional email for booking confirmations (same sender gate as product email).

**Order (do not skip):**

1. **Spend** — approve hosting + Postgres + email cost.
2. **DB** — provision Postgres; store URL as `CAL_DIY_DATABASE_URL` on the cal.diy host only.
3. **Deploy** — build/run cal.diy from upstream release; migrations; health check.
4. **Domain** — DNS + TLS for the calendar host (`CAL_DIY_BASE_URL`).
5. **Secrets** — API key, webhook secret, session secrets; never commit.
6. **GDPR** — booking PII subprocessors named on legal pages; DPA as needed.
7. **Product wiring** (later studio slice) — honest Professional embed/link only when gates clear; keep request fallback until then.
8. **Verify** — real booking creates confirmed event in cal.diy; cancel path works; no Site Builder JSON store pretending to be cal.diy.

**What “done” looks like:**

- [ ] cal.diy serves HTTPS on the chosen domain with working health.
- [ ] Postgres backups tested; restore drill once.
- [ ] Owner-only secrets in host env (not git).
- [ ] Legal copy lists calendar subprocessors.
- [ ] Professional template either still uses local **request** honesty **or** a real cal.diy booking surface — never a mock iframe.
- [ ] Site Builder `CAL_DIY_*` env documented in deploy notes; `CAL_DIY_ENABLED=1` only after the above.
- [ ] No production charge or live DNS change was made by studio without owner.

---

## Owner-gate list (later — not this slice)

Studio does **not** ask for these until local/staging work that can be done without them is finished:

| Gate | Why owner-only |
|------|----------------|
| **domain** | Live DNS / Cloudflare for calendar host under hidook.agency (or chosen brand domain) |
| **secrets** | Production API keys, webhook secrets, DB credentials |
| **DB** | Production Postgres provision, backups, retention |
| **deploy** | Production cal.diy cutover, scaling, upgrades |
| **spend** | Hosting, DB, email deliverability, monitoring cost |

Also still owner-only from `VISION.md` §10: Stripe live, email sender production, legal/VAT, **exact hidook.agency brand tokens**, any real charge/push/production deploy.

---

## Out of scope for Flow 4.3

- Actually hosting cal.diy
- Production Stripe or live DNS
- Fake “Book on Hidook Calendar” widget
- LP visual redesign (waits on brand tokens — see `04-QA-Evidence/Flow4/CalendarLP/`)

---

## Pointers

- Boundary module: `bot/calendar-boundary.js`
- Appointment honesty tests: `bot/test/s70-professionals-appointments.test.js`
- Flow 4.3 oracle: `bot/test/flow4-calendar-lp-oracle.test.js`
- VISION: sections 8, 9, 10, 11 (Flow 4)
