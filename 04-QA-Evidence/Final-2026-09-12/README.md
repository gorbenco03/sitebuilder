# Dovezi finale — 2026-09-12

Runda de dovezi a produsului livrat, pe arborele de la `be411f8`.

- `site-<șablon>-<lățime>.png` — cele 5 șabloane publicate (`buildStaticSiteTree` cu
  `presets[0]`), la 1440 / 768 / 390, captură de pagină întreagă.
- `site-checks.json` — pentru fiecare combinație: scroll orizontal (fals peste tot) și
  numărul de erori de consolă (zero peste tot).

Verificat pe acest arbore, nu afirmat:
- `npm test` — 616 teste, 615 trec. Singurul roșu e `bot/test/flow3-legal-export.test.js`,
  oracolul specific Brave documentat în `PLAN-QA-2026-09-12.md` §0.
- `bot/test/suite7-template-contract.test.js` — 5 șabloane × 3 lățimi × 3 teme (presetul
  implicit plus două culori pe care clientul le poate alege), cu `KNOWN_RED = {}`.
- `bot/test/fullpass-63230d2.mjs` — parcurgerea cap-coadă de 46 de pași.

Rundele intermediare de dovezi din valurile 1–4 au fost șterse; asta e singura care rămâne,
conform §0 din plan. Capturile din `04-QA-Evidence/**` sunt ignorate de git (`.gitignore`),
deci PNG-urile există doar pe mașina care a rulat runda.
