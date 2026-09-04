# Advocate 5508863 / HEAD 3099ebb — stranger pass

Isolated `/app/` (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`).
Oracles-green is not a pass. Binding screenshots are named from the action just performed.

## Verdict

ADVOCATE: LOST

## Oracles (evidence, not a pass)

- `node bot/test/fullpass-63230d2.mjs` — defects=0 steps=46
- `node bot/test/mobile-chrome-390-aabb.test.js` — OK (5 systems locked)
- `node bot/test/desserdirina-hero-no-desserd.test.js` — OK (OCR clean on seed file + editor 390)

## Named-fixed defects (opened as pixels)

All three from 4112579 are gone on editor mobile-preview 390 with cookie open:

1. Professionals credibility strip — «Online și la cabinet» is fully visible. Cookie is bottom-left, WhatsApp bottom-right. No «Online și la ca».
   - `04-QA-Evidence/Advocate-5508863/10-iframe-390-professionals-cookie-default.png`
   - `04-QA-Evidence/mobile-chrome-390-aabb/click-mobile-preview-390-professionals-cookie-open.png`
2. Portfolio cookie vs FAB — cookie left, FAB right, «EXPLOREAZĂ» intact.
   - `04-QA-Evidence/Advocate-5508863/20-iframe-390-portfolio-cookie-default.png`
   - `04-QA-Evidence/mobile-chrome-390-aabb/click-mobile-preview-390-portfolio-cookie-open.png`
3. Local-service duplicate WhatsApp — exactly one `.ls-dock__wa`, no floating duplicate, cookie above the dock, «premium» unclipped.
   - `04-QA-Evidence/Advocate-5508863/15-iframe-390-local-service-cookie-default.png`
   - `04-QA-Evidence/mobile-chrome-390-aabb/click-mobile-preview-390-local-service-cookie-open.png`

AABB metrics in `named-fixes.json`: professionals strip `clippedX=false`; portfolio hint `clippedX=false`; local-service `waCount=1`.

## What was opened

- Landing cookie + catalog (5 systems) vs Squarespace-class template galleries: photo cards, Romanian commercial copy, 7 zile / 99€ / 29€/an
- Legal `/app/terms.html` `privacy.html` `cookies.html` — tab titles Romanian (`Termeni de utilizare`, `Confidențialitate`, `Cookie-uri`); no Placeholder juridic
- Editor all 5: Details auto-open, Cal.com field on professionals, desktop + 390 preview, WhatsApp QR
- Unpaid HTML export Romanian gate (`Intră în cont ca să descarci HTML-ul.`)
- Instagram empty-email (`Introdu adresa de email.`)
- Test-pay live, return-to-editor canvas, paid HTML export, past_due export gate
- Cookie «Află mai mult» in preview opens in-canvas cookie policy (not 404)
- Cancel: Înapoi → Proiectele mele → Anulează → Ciornă (`probe-click-anuleaza.png`)

## Not defects

- Walk harness `goto #projects` did not switch the catalog tab; Anulează is on Proiectele mele (clicked) and on the trial-success projects card. Not the stranger path.
- Editor topbar ellipsis «Servicii prof…» is overflow chrome, not unread seed copy (prior advocate).
- Mechanical `scrollHeight` a few px on serif headlines (descenders) with letters fully visible.
- Isolated live URL is loopback `/live/<slug>/` by design.
- Desktop cookie sitting on the left of the professionals ticker: same content is in the hero; cookie-dock ACCEPT already placed the banner bottom-left to clear the FAB.

## Proof-of-flow (this SHA only)

`04-Deliverables/Advocate-5508863/`

- `OVERVIEW.md` — step-by-step with one still per step
- `stills/01`…`16` — action-named screenshots
- `flow.webm` / `flow.mp4` — one continuous recording, same tab: catalog → edit → preview 390 → trial/card → live → return editor → export → cancel
