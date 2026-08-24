# S71 — Art direction remake (implementation notes)

**Status:** HANDOFF ONLY. Not semantic ACCEPT.  
**Base:** `cce8b0b` (S69 ACCEPT). Branch `wt/s71-awwwards-remake`.  
**Sources consumed:** `04-QA-Evidence/S71-firecrawl/DESIGN.md` + `REPORT.md` (from t_02716103 Firecrawl research).

## Tokens shipped (product chrome)

| Role | Value | Notes |
|---|---|---|
| Paper | `#F3EFE8` | Landing canvas |
| Surface | `#FFFcf7` | Cards / chrome |
| Ink | `#14120F` | Primary button + wordmark |
| Ink muted | `#5C564E` | Body |
| Accent | `#9A4030` | Terracotta emphasis (em, links) |
| Forest | `#1E3A32` | Focus ring / quiet secondary |
| Line | `#D9D2C6` | Hairlines |
| Display | Newsreader 500 | Google Fonts |
| UI | Inter 400–600 | Geist fallback per brief |

## Pattern adaptations (not clones)

1. **Catalog-as-hero** (Squarespace / Awwwards): overlapping owned template previews in fold; center = restaurant.
2. **One primary verb:** ink `Alege un design`; ghost `Cum funcționează`.
3. **True proof only:** 100 / 29 / pay-before-live / edit after pay — no fake scale.
4. **Quiet chrome** (Linear density on paper): one filled Publică; Detalii drawer hairline labels.
5. **Taller catalog crops:** preview ≥300–360px (was 180px letterbox).
6. **No tech badge**, no indigo `#5B5BD6`, no DESSERD.

## Avoided

- Competitor logos/photos/WebGL/GSAP.
- Indigo SaaS chips, system-ui-only product face.
- Fake testimonials / user counts.
- Shipping third-party assets into production UI (hero stage uses **owned** template renders via HidookEngine).

## Files touched

- `builder/index.html` — fold, chips, proof, how, footer, publish icon, fonts
- `builder/app.css` — token system + landing + chrome
- `builder/app.js` — stage populate, chips filter, price slots, editor outline colors

## Asset flag

- Google Fonts (Newsreader + Inter) loaded via fonts.googleapis.com — licensed webfont CDN, not a competitor asset.
- No Awwwards / Dishoom / Ballena / Squarespace images embedded in product.

## Verification

- Focused suites S50–S69 companion list: pass (see handoff metadata).
- Browser Chrome remote-debug blocked on this host (needs user Allow); headless capture attempted via scripts/s71-capture.mjs when playwright present.
- Static assert: no `hero-badge`, no `Builder + hosting`, no `#5B5BD6` in builder index/css chrome.
