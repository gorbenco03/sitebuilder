# S70 — Professionals vertical + appointment request calendar

**Status:** HANDOFF ONLY (implementation freeze on branch; not semantic ACCEPT).
**Freeze SHA:** `4d2be3e1c6f74d8daacba925b9d260f120b9ea0f`
**Tree:** `c0f31b3693ced078be0653ee763383b99084d559`
**Parent:** `923f35f3edc4694f90ae87142759467fd4357eb0` (S71-fix ACCEPT)
**Branch / worktree:** `wt/s70-professionals` → `/Users/Work/.hermes/worktrees/s70-professionals`
**Kanban:** `t_169e6bc2`

## R1 rework (changes_requested → freeze)

1. Freeze commit on parent 923f35f — one additive commit SHA `4d2be3e` (HANDOFF may amend tip if SHA line lags).
2. `GET /api/appointments` requires `requireAuth` + site ownership (slug/projectName, case-insensitive); unauth → 401, non-owner → 403; POST stays public for visitors.
3. `appointments/` in `.gitignore` (runtime store never committed).
4. No `_cleanup2.js` / review scratch in tree.

## What shipped

1. **Fourth design system** `templates/professionals/`
   - Calm editorial paper/ink/brass (not restaurant/salon/trade clone)
   - `schema.json`, `presets.json` (≥2 RO presets: Cabinet Marin, Studio Lex & Co)
   - `template.html` / `styles.css` / `script.js`
   - Sections: hero, trust strip, services, process, about/credentials, **appointment request**, FAQ, Instagram slot, contact

2. **Appointment calendar = local request, not booking**
   - Client generates slots from `appointment.weekly` + types (Europe/Bucharest default)
   - Live sites POST `POST /api/appointments` → `DATA_DIR/appointments/<slug>.json`
   - Response status always **`requested`** (never confirmed booking)
   - `GET /api/appointments?slug=` owner-only (session + owns site); visitor PII never public
   - Builder preview falls back to sessionStorage + “stare locală de previzualizare”
   - No Calendly / Google Calendar / OAuth

3. **Catalog wiring**
   - `templates/registry.json` + `GET /api/templates`
   - Builder chip `Servicii profesionale` + `DESIGN_BADGE_BY_ID`
   - `npm run build:app` regenerates `builder/generated/*` (includes professionals)

4. **Tests**
   - New: `bot/test/s70-professionals-appointments.test.js` (catalog, render, live publish, POST request, list 401/403/200, republish persist)
   - Updated catalog counts: s3, engine, telegram-draft, builder-editor-commercial, stranger-e2e, templates-readme

## Evidence

| Artifact | Path |
|---|---|
| Desktop 1440 | `04-QA-Evidence/S70-professionals/professionals-desktop-1440.png` |
| Mobile 390 | `04-QA-Evidence/S70-professionals/professionals-mobile-390.png` |
| Inline HTML | `04-QA-Evidence/S70-professionals/professionals-cabinet-marin.html` |
| Metrics | `04-QA-Evidence/S70-professionals/metrics.json` |

Capture: Brave headless against local static serve of rendered Cabinet Marin preset.
Independent Playwright @390/@1440: overflowX=0 (Brave PNG clipping is capture artifact).

## Commands run (exit 0)

```
node bot/test/s70-professionals-appointments.test.js
node bot/test/s3-design-systems.test.js
node bot/test/builder-editor-commercial.test.js
node bot/test/s50-builder-pay-republish.test.js
node bot/test/stranger-e2e.test.js
node bot/test/templates-readme-commercial.test.js
node bot/test/engine.test.js
node bot/test/s48-editor-vertical-labels.test.js
node bot/test/telegram-draft.test.js
```

## Acceptance map

| Criterion | Evidence |
|---|---|
| Professionals in catalog as 4th system | registry + s3 + s70 tests |
| Distinct art direction | CSS paper/ink; s3 clone checks; unique `pr-*` classes |
| Appointment request UI + success “Cerere trimisă” | template + script; HTML evidence |
| Persist request locally (not confirmed) | POST /api/appointments → status requested |
| List PII gated | GET requires auth+own; s70 401/403/200 |
| Edit/republish keeps appointment copy | s70 republish check |
| Causal tests | s70 suite |
| Browser proof | desktop/mobile PNGs |

## Out of scope / known limits

- No owner inbox UI for reviewing requests (storage + authenticated GET only)
- Weekly availability edited as list fields; no drag-calendar admin
- Research REPORT was empty at implement time — product shape from vertical patterns + card body + paper/ink system
- `seo.jsonLd` preset string still non-JSON (engine omits safely; same class of warning as other templates)

## Reviewer notes

- Do **not** treat as ACCEPT until independent design/QA/advocate pass.
- Hotspot files: `bot/server.js` (appointments routes), `templates/registry.json`, `builder/app.js` badge map.
- Same-profile must not self-ACCEPT.
