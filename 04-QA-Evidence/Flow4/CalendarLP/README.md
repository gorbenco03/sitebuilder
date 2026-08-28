# Flow 4.3 — Calendar Professional groundwork + LP readiness

**Card:** t_ff21c670 (timeout recovery of t_ee87e058)
**Base:** `7c3c3e198fc4bafe7c67a24afcb3bb9fa6c9cf68` (Flow 4.2 ACCEPT)
**Authority:** VISION.md §8–9, §11 Flow 4

## Shipped

### 1. Calendar Professional (option C)

- Documented **option C** (Hidook hosts cal.diy later): `OWNER-CALENDAR-CAL-DIY.md`
- Integration boundary + env placeholders: `bot/calendar-boundary.js`
- Public honesty on `/api/config` via `calendar` object (`publicMode: local-request`, `calDiyEnabled: false`)
- Professionals template **unchanged** in behaviour: appointment **request** only (no fake cal.diy embed)
- Owner-gate list names **domain / secrets / DB / deploy / spend** (for later)

### 2. LP readiness

- Builder landing hard-coded EUR amounts (`99€`, `29€/an`) replaced with config-driven spans filled from `GET /api/config` / `bot/pricing.js` (trial 7 zile, 99 then 29/an)
- **No invented hidook.agency brand hex/tokens** — landing CSS left as-is
- **Visual remake waits on owner brand tokens** (see `LP-BRAND-TOKENS.md` in this folder)

### 3. Oracles

```bash
node bot/test/flow4-calendar-lp-oracle.test.js
node bot/test/flow4-stale-commercial-docs.test.js
node bot/test/wave6-trial-copy.test.js
node bot/test/pricing.test.js
node bot/test/s70-professionals-appointments.test.js
```

## Out of scope (explicit)

Hosting cal.diy, production Stripe, LP visual redesign, Telegram, push, live DNS, real charges.
