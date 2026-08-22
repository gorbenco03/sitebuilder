# local-service — construction / trade patterns

Evidence set (2026-08-23).

| Slug | URL | Evidence status |
|---|---|---|
| turner | https://www.turnerconstruction.com/ | OK |
| matheson | https://mathesonconstructors.com/ | OK |
| mortenson | https://www.mortenson.com/ | OK |
| clark | https://www.clarkconstruction.com/ | OK (cookie overlay partial) |
| layton | https://www.laytonconstruction.com/ | OK — **replacement** |
| woodhull | https://www.woodhull.com/ | **INVALID** — personal 2007 archive, not GC — not evidence |
| mattconstruction / dpr | — | Prior 403; not in final set |

National GCs under-index on **phone / free estimate**. Hidook local-service clients are lead-gen — **we keep phone + estimate above the fold** even when reference sites bury contact.

---

## Per-site notes (5 live)

### 1. Turner
- **Hero job:** Scale + purpose — aerial active urban jobsite dusk; “Making a Difference” + “What do you want to build?”
- **Primary CTA:** Soft prompt arrow; Contact in nav — **no phone/estimate** (enterprise RFP model).
- **Type / color / imagery:** Clean sans + one script word + red underline; photo-driven dark; real cranes/formwork.
- **Instagram:** Not in fold.
- **Adapt:** Real aerial/active site photography; restrained accent; purpose headline.
- **Avoid:** Soft-only CTA for local trades; obstructive cookie cards over the hero.

### 2. Matheson
- **Hero job:** Crew + capability — “We build what matters” over real workers/PPE (video hero).
- **Primary CTA:** Header solid `GET IN TOUCH` (good pattern; still not phone).
- **Type / color / imagery:** Bold navy sans; lime accent rule; blue scrim on photo; crane framed below fold.
- **Instagram:** Not in fold.
- **Adapt:** Real crew photography; navy + one safety-adjacent accent; short nav (Projects · Services · About) + one CTA.
- **Avoid:** Stock handshakes; autoplay with sound; feature-list heroes.

### 3. Mortenson
- **Hero job:** Brand cinema + finished flagship (Fiserv Forum night) — “Let’s redefine possible.”
- **Primary CTA:** None on hero; project credit link only.
- **Type / color / imagery:** Tracked eyebrow; huge white display; deep blue wash; labeled project pin.
- **Instagram:** Not in fold.
- **Adapt:** Finished project as proof; city + project name caption; carousel of flagships.
- **Avoid:** Zero-CTA heroes for SMB/local GC templates.

### 4. Clark
- **Hero job:** Prestige finished interior atrium + partial headline “Building What…”; project name overlay.
- **Primary CTA:** Contact Us text only — no estimate/phone.
- **Type / color / imagery:** Heavy geometric sans; brand blue; architectural photography with people for scale.
- **Instagram:** Not in fold.
- **Avoid:** Cookie modal covering headline; copying enterprise “careers-first” IA for local estimators.

### 5. Layton (swap-in)
- **Hero job:** Split — tagline/proof copy | aerial active concrete + red cranes.
- **Primary CTA:** Contact in nav only; body “Ready to join us?” leans recruiting.
- **Type / color / imagery:** Blue wordmark; serif headline + sans body; cool gray/blue; authentic WIP aerial.
- **Instagram:** Not in fold.
- **Adapt:** Split proof + jobsite photo; Portfolio-first nav; multi-office credibility line.
- **Avoid:** Missing phone/estimate for lead-gen; cookie bar blocking lower hero.

---

## Adapt / avoid table

| Pattern | Adapt for Hidook local-service | Avoid |
|---|---|---|
| Hero | Real project or active site photo + clear local promise | Stock crane sunset; cartoon/old personal pages |
| CTA | **Phone + Cere ofertă / Estimate** sticky util + hero dual buttons | Enterprise soft questions only |
| Type | Bold display + readable body; optional one serif head | Script overload; thin gray on photo |
| Color | Navy/charcoal + one accent (safety orange **or** blue) | Lavender hobby sites; rainbow sections |
| Services | Proof-linked services (card → project), not icon soup alone | 15 equal CSI tiles with no photos |
| Projects | Large photos + location/type captions | Uncredited buildings; empty lots only |
| Instagram | Jobsite progress feed as trust | Empty social widgets; header icon spam |

---

## Winning composition for `local-service`

1. **Utility strip (keep, strengthen)** — `tel:` display · service zone · **Cere ofertă** fill button.
2. **Hero** — project photography (finished or honest WIP) + tagline + dual actions: Estimate + Call. Stats meters OK if real.
3. **Projects** — photo-led grid with captions (keep collage categories as “Lucrări”).
4. **Services** — short list tied to proof, not generic emoji icons as the only story.
5. **Process / about** — brief trust (years, zone, insurance language if client provides).
6. **Instagram** — jobsite proof module (spec below).
7. **Contact band + sticky mobile call dock** — keep dock; ensure desktop util never drops phone.

Industrial diagonal gimmicks optional; clarity > chrome. Apple glass util can stay for sticky performance but **accent should feel trade-trust**, not only iOS blue.

---

## Instagram module spec — construction

**Contract:** `instagram.embedUrl` iframe + `gallery[]` fallback. **Parity gap:** local-service today is gallery-only — add embed iframe path like product-menu.

**Look for this vertical:**
- Title: `De pe șantier` / `Proiecte în lucru` / `Pe Instagram`.
- Grid bias: **landscape 16:9 or 4:3** cells (jobsite reads better than beauty squares), 2×2 desktop / 2-col mobile; or mixed masonry of 4–6 shots.
- Embed iframe optional under grid when partner URL set.
- Background: light paper or dark charcoal band with high-contrast type.
- Each cell → profile or project album URL.
- Caption: “Foto reale de pe șantier — dovadă, nu stoc.”
- Placement: **after projects/services, before final CTA band** so phone CTA still frames the close.
- Never replace the sticky call dock with social icons.

---

## Token direction

| Token | Navy trust | Industrial dark | Light operate |
|---|---|---|---|
| bg | `#f4f5f7` | `#0a0c0f` | `#f5f5f7` |
| ink | `#0f1720` | `#f5f5f7` | `#1d1d1f` |
| accent | `#0b3d91` or `#ff4d00` | `#ff4d00` | `#0071e3` (OK secondary) |
| display | bold grotesque / optional serif head | bold grotesque | SF-like system OK |
| radius | 4–8 (util 8) | 0–6 | 8–980 pills |
| imagery | aerial WIP + finished exteriors | night builds | crew + PPE authentic |

Presets: one residential/remodel local, one commercial GC tone — both with phone + estimate mandatory in demo config.
