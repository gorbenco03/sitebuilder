# S71-R — Awwwards-grade art direction for Hidook landing/builder

**Status:** HANDOFF ONLY research. Not semantic ACCEPT. No product code edited. No push/deploy/secrets.

**Date:** 2026-08-25  
**Workspace:** `/Users/Work/.hermes/worktrees/sitebuilder-awwwards-research`  
**Method:** Firecrawl `branding`+`images` + full-page screenshots (`firecrawl-website-design-clone`), plus visual inspection of those exact captures. Local Chrome remote-debug was blocked (needs user Allow); Firecrawl screenshots are the visual evidence.

**Owner constraints honored:**

- Patterns, not clones. Reference screenshots are **internal contact sheets**.
- Production uses owned/licensed/safe assets unless the owner names a source asset.
- No AI-slop generic SaaS landing. Concrete systems below.
- Landing-page **and** restaurant-template references.
- Product truth unchanged: choose design → edit → Instagram before pay → pay 100 → live → edit/republish; renewal 29; no fake claims.

---

## 1. What is wrong with the current Hidook surface

Measured from `s69` `builder/app.css` + `builder/index.html` (not restyled in this lane):

| Token / pattern | Current | Why it reads cheap vs 2026 refs |
|---|---|---|
| Canvas | `#FAFAF9` | Cool near-white; refs use dirty paper `#F3EFE8` / `#F8F2E5` or void black |
| Ink | `#111827` | Tailwind gray, not brown-black |
| Accent | `#5B5BD6` + `#EEF2FF` chips | Default indigo SaaS. Closest ref (Linear `#5E6AD2`) is a **dev tool**, wrong audience |
| Type | system-ui, hero `clamp(1.75rem–2.5rem)` / 800 | No display face; all UI weight |
| Radius | 12 / 16 / 20 | Soft factory cards. Refs: 0–8 |
| Fold | Centered stack, 620px, **tech badge** “Builder + hosting gestionat” | Forbidden raw-tech label. No product picture |
| Catalog | `minmax(300px)` grid, **180px** preview letterbox | Squarespace/Awwwards treat the site crop as the object |
| Motion | 160–220ms, fine | Keep; do not add GSAP |

This is an art-direction miss: the page explains a builder instead of **showing designed sites**.

---

## 2. Evidence index (11 captures)

All branding JSON + PNG live under `.firecrawl/`. Per-site DESIGN.md under `refs/DESIGN-<slug>.md`. Token dump: `refs/token-summaries.json`.

| # | Slug | Live URL | Lane | Firecrawl scheme / key tokens | Screenshot |
|---|---|---|---|---|---|
| 1 | awwwards | https://www.awwwards.com/ | Landing index / SOTD fold | light `#F8F8F8` / ink `#222` / CTA black; **h1 extract 14px is wrong** — display is huge | `.firecrawl/awwwards-screenshot.png` |
| 2 | framer | https://www.framer.com/ | Product landing (dark) | dark `#000` / Inter + GT Walsheim / h1 54 / radius 8 / white CTA | `.firecrawl/framer-screenshot.png` |
| 3 | webflow | https://webflow.com/ | Product landing (light) | light `#fff` / ink `#080808` / `#146EF5` / h1 80 / radius 4 | `.firecrawl/webflow-screenshot.png` |
| 4 | squarespace | https://www.squarespace.com/ | **Catalog fold north star** | light / `#1E4C41` / h1 72 / radius 0 | `.firecrawl/squarespace-screenshot.png` |
| 5 | linear | https://linear.app/ | **Builder chrome only** | dark `#08090A` / `#5E6AD2` / h1 64 / radius 8 | `.firecrawl/linear-screenshot.png` |
| 6 | stripe | https://stripe.com/ | Trust / stat rhythm | light / `#533AFD` / h1 48 / radius 0 | `.firecrawl/stripe-screenshot.png` |
| 7 | dishoom | https://www.dishoom.com/ | Restaurant template | cream `#F0ECE0` / dual Menus+Book | `.firecrawl/dishoom-screenshot.png` |
| 8 | ballena | https://ballenacabo.com/ | Restaurant template | paper `#F8F2E5` / sage `#779580` / terracotta split / BOOK NOW | `.firecrawl/ballena-screenshot.png` |
| 9 | gilli | https://www.caffegilli.com/en | Restaurant template | `#FCFCFC` / navy `#142342` / gold `#DAC773` / cinematic stills | `.firecrawl/gilli-screenshot.png` |
| 10 | giacosa | https://www.giacosafirenze.com/en | Restaurant template | teal `#223A40` / champagne display / BOOK NOW + phone | `.firecrawl/giacosa-screenshot.png` |
| 11 | joakim | https://latabledejoakim.fr/ | Restaurant template | paper `#F6F4F3` / clay `#9B7C6D` / radius 0 / extreme space | `.firecrawl/joakim-screenshot.png` |

Awwwards SOTD 2026-08-24 `/zeroz` (https://otsuka-air.jp/) is **documented as avoid for product**: WebGL/3DCG/Three.js brand film. Use only as “what high-end *campaign* sites do,” not Hidook chrome.

Extractor caveats (do not blindly paste tokens): Awwwards h1=14px; Framer `textPrimary #000` on `#000`; Giacosa body 35px > h1 20px; Stripe/Webflow body sizes sometimes read display. **Screenshot wins.**

---

## 3. Pattern matrix

Columns are what to **adapt** into Hidook. Rows are systems.

| System | Framer | Webflow | Squarespace | Linear | Stripe | Awwwards | Dishoom | Ballena | Gilli | Giacosa | Joakim |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Hero composition** | Centered 2-line + one product frame | Centered 2-line + 3 entry cards | **Full-bleed photo + overlapping live sites** | Product window on black | Left headline + gradient wash | **Mega title + one featured site** | Quote on dark interior + 2 pills | Architecture still + overlay type | Facade still + 2 pills | Cinematic still + PLAY | Script + clay slab, photo late |
| **Type rhythm** | 54 / 14, grotesque | 80 / 16, tight tracking | 72 display, tiny meta | 64 / 15, hairline UI | 48 / light weight | Huge condensed vs 12px meta | Serif quote + tracked caps UI | 4-word tracked overlay, ~90px | Small navy essay, gold metal | Champagne serif + huge clock | Italic statement, 0 radius |
| **Spacing / asymmetry** | Even stack, huge black gaps | Even marketing grid | **Cropped neighbors = depth** | Left title / right body | Wide padding, 4-up stats | Sparse section labels | Editorial rag + captioned stills | **50/50 photo \| terracotta** | Long still-life chapters | Peach slab interrupt | **Vast empty paper** |
| **Image treatment** | UI chrome, then masonry of shipped sites | Editor still + people video + metric overlay | Designed templates as objects | App screenshot as object | Gradient product UI | Laptop-in-room preview | Owned interiors + food, captions | Place + plated dish, no stock diners | Object stills on colored fields | Archival + one cocktail | One plated close-up |
| **Cards / catalog** | Masonry site crops | 3 feature cards then filmstrip | **Filter chips + designed-site carousel** | Not a catalog | 2×3 product tiles | Featured then 4-up later | 3 photo destinations with paper labels | 3 equal tiles Events/Gallery/Gifts | 3-up pastry objects | Story blocks, not cards | Almost no cards |
| **Product proof** | Logo row + shipped masonry | Logo filmstrip + named quotes | 7M / $10B / 170+ (do **not** fake) | Logo row | 135+ / $1.9T (do **not** fake) | SOTD itself | Awards boxes (optional) | Place photo is proof | Heritage facade | “1815” line + phone | Craft photo |
| **CTA grammar** | White fill + ghost download | Blue fill `Start for free` + text links | **One white GET STARTED on photo** | White pill + ghost | Purple fill + ghost | Black Submit | **View menus + Book a table** | Text `EXPLORE` / `VIEW FULL MENU` + BOOK NOW | Gold + navy pair | BOOK NOW + phone | Text link only (too weak for us) |
| **Motion / interaction** | Implied card hover | Carousel / video | Static overlap | Quiet 180ms | Gradient theatre | Static index | Static editorial | CSS link arrows | **GSAP chapters — do not port** | Optional video | Stillness |
| **Mobile implication** | 1-col frames | 1-col cards, wrap headline | **One preview, no side peeks** | Icon topbar | Stats 2×2 | Title wrap, 1-col cards | Stack pills, 1-col destinations | Stack split, 36–44px type | 1-col objects | Sticky Book | Shorter clay, full-bleed photo |
| **Hidook use** | Proof masonry | 3 vertical entries | **Landing fold** | **Editor chrome** | Honest stat row | Featured template | **product-menu** | **product-menu** | Image rhythm | Dark-luxury track | Emptiness / clay |

---

## 4. Adapt / avoid (copyright + taste)

### Adapt (systems)

1. **Catalog-as-hero** (Squarespace + Awwwards): the fold is a designed site, not a paragraph.
2. **One primary verb** (Squarespace / Linear): `Alege un design` or `Începe`. Ghost second: `Vezi exemplu`.
3. **True proof only** (Stripe rhythm, Hidook numbers): 100 first year · 29 renewal · pay before live · HTTPS · edit after pay.
4. **Quiet chrome** (Linear on paper): one filled button; everything else is text.
5. **Restaurant dual path** (Dishoom): `Meniu` + `Rezervă`, Book always in the bar.
6. **Split photo \| color panel** (Ballena): template-friendly, no WebGL.
7. **Still-life rhythm** (Gilli, simplified): hero → one full-bleed food field → 3-up objects → story.
8. **Contact cluster** (Giacosa): CTA + phone + address together.
9. **Clay / paper emptiness** (Joakim): section color, not a broken image.

### Avoid (assets + wrong product)

- Any reference logo, photo, video, wordmark, template (BOTANICA etc.).
- WebGL / Three.js / GSAP scroll hijack (`/zeroz`, Gilli chapters).
- Dark Linear/Framer landing for a local-business buyer.
- Indigo / Stripe purple / Webflow blue as brand.
- Fake scale, fake quotes, fake logos.
- Tech badges, DESSERD, factory/bakery stock, chalkboard “MENU BOARD”.
- Cookie banners as a design stripe (Giacosa capture).
- Recoloring `#5B5BD6` → terracotta and shipping the same 180px cards.

---

## 5. Recommended Hidook art direction

Canonical tokens + component rules: **`DESIGN.md`** (this folder). Lint-able Google DESIGN.md shape.

**Polarity:** paper + ink + terracotta. Not dark-mode SaaS. Not lilac.

**Landing fold (desktop 1440):**

```
[ Hidook          Designuri   Cum e         Alege un design ]
[                                                         ]
[  Site-ul afacerii tale,                                 ]
[  gata azi.                                              ]
[  Alege un design, editează, publici live după 100       ]
[  (12 luni; apoi 29/an).                                 ]
[                                                         ]
[     [crop] [==== featured template preview ====] [crop] ]
```

- Featured preview is an **owned** product-menu / portfolio / local-service render, not a stock mock.
- No badge. Price lives in the sentence.
- Then chips + taller catalog cards (≥360px crop).

**Builder chrome:** keep the S59–S70 flow and control labels; restyle to paper/ink. Publish stays the only filled action. Drawer and modal share the same 8px / hairline / 14px UI. Touch targets ≥44px.

**Motion:** CSS 180–220ms, `prefers-reduced-motion: reduce` → instant. No new animation libraries.

**Professionals / calendar:** when it lands, use paper/ink + forest `#1E3A32` for booking chrome so it does not fight this landing.

---

## 6. Restaurant template direction (product-menu)

Do not pick one clone. Ship **two demo polarities**:

| Track | Canvas | Ink | Accent | Hero | CTA |
|---|---|---|---|---|---|
| Light editorial | `#F8F2E5` | `#14120F` | terracotta `#9A4030` or sage `#5E6B56` | Place or still-life | Ghost Meniu + solid Rezervă |
| Dark luxury | `#121614` | `#F3EFE8` | cream or gold line `#C6B07A` | One plated object / cocktail | Book in bar + phone |

Structure (keep existing menu accordion / IG module):

1. Sticky mast — wordmark · Meniu · Poveste · **Rezervă**
2. Photography hero (one idea)
3. Menu groups
4. Short story (not a SaaS feature grid)
5. Gallery
6. Instagram (embed or 3×3 fallback) **after** gallery
7. Hours / map / phone / Rezervă

IG is living proof, not a footer glyph. Do not put IG in the hero.

---

## 7. Builder implementation notes (for S71 remake)

Scope the remake to **visual language**, not flow:

- `builder/index.html` fold + badge removal + catalog markup if overlap needs extra featured card.
- `builder/app.css` token swap + hero + `.template-card` height/radius/type.
- Editor topbar / publish modal / details drawer: same tokens, no new decoration.
- Template CSS for `product-menu` (and later others) so live sites match the new grammar.
- Do **not** touch pay amounts, Telegram, S43/S57, or invent copy that implies AI/agents/enterprise.

Suggested type loading (licensed/safe): Google/Fontshare **Newsreader** + **Geist**. If Geist cannot ship, Inter.

Verification when implementing (not this card): desktop 1440 + mobile 390 of landing, catalog, editor topbar, publish modal, one restaurant live preview. Focus states visible. Existing pay/edit tests still green.

---

## 8. Residual risks

- Firecrawl branding tokens are sometimes inverted or undersized — implementers must read screenshots + `DESIGN.md` prose, not only hex tables.
- Local browser-use Chrome approval was not available; screenshots are Firecrawl full-page (desktop width ~1920). No independent 390px capture this lane — mobile notes are inferred from composition.
- Joakim capture is sparse (intentional emptiness, not a wall). Giacosa includes a cookie band — ignore as design.
- Squarespace/Stripe/Webflow proof numbers are **their** scale; copying them would be a fake claim.

---

## 9. Deliverable map

| File | Role |
|---|---|
| `REPORT.md` | This handoff |
| `DESIGN.md` | Hidook tokens + build rules |
| `refs/DESIGN-*.md` | 11 source DESIGN.md extracts |
| `refs/token-summaries.json` | Compact Firecrawl tokens |
| `.firecrawl/*-branding.json` | Raw scrape |
| `.firecrawl/*-screenshot.png` | Visual source of truth |

**Next card:** `t_ec3e012e` (builder-grok) remakes landing/catalog/chrome from this brief. Still HANDOFF ONLY at product level until independent design/QA/advocate review.
