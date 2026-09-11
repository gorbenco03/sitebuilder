# QA Explorare — 2026-09-12

Material sursă pentru `PLAN-QA-2026-09-12.md` (rădăcina repo-ului).

- `reports/01..10-*.md` — cele 10 rapoarte ale agenților exploratori (Sonnet), câte unul pe
  zonă; format comun (Acoperit / Neacoperit / DEFECTE cu dovadă / SUGESTII / VERIFICĂRI CERUTE).
- `docs/doc1..4.md` + `docs/docN-media/` — textul și capturile din cele 4 documente Word de
  feedback extern; `docs/feedback-register.md` — cele 27 de puncte, mapate pe șabloane
  (doc1 = local-service, doc2 = portfolio, doc3 = professionals, doc4 = desserdirina).
- `shots/` — capturile agenților (prefixe: `ec-`, `sec-`, `pbl-`, `wa08-`, `perf-`, `cal-`,
  `images-final/`, `pub-`, numerotate pentru mobil). PNG-urile sunt ignorate de git
  (`.gitignore`), deci există doar pe mașina pe care a rulat explorarea.
- `BRIEFING.md` — instrucțiunile comune date agenților (regulile, harness-ul, formatul).

Metodă: server local (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, `DATA_DIR` temporar),
Playwright/Chromium din `node_modules`, 1440×900 / 768×1024 / 390×844. Zero modificări în repo,
zero acces la producție.
