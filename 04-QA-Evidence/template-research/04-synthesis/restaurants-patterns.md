# product-menu — restaurant patterns

Evidence set (2026-08-23). **Do not treat blocked/parked captures as design.**

| Slug | URL | Evidence status |
|---|---|---|
| atelier-crenn | https://www.ateliercrenn.com/ | OK — desktop + mobile |
| dishoom | https://www.dishoom.com/ | OK |
| cora-pearl | https://www.corapearl.co.uk/ | OK |
| sessions-arts-club | https://sessionsartsclub.com/ | OK |
| spring | https://www.springrestaurant.co.uk/ | OK (re-captured) |
| noma | https://noma.dk/ | **BLOCKED** Cloudflare 403 — not evidence |
| rules | https://rules.co.uk/ | **BLOCKED** Cloudflare 403 — not evidence |
| the-ivy | https://www.theivy.co.uk/ | **PARKED** Spaceship domain sale — not evidence |

---

## Per-site notes (5 live)

### 1. Atelier Crenn
- **Hero job:** Immersive fine-dining art — single plated dessert as cinema, near-black stage.
- **Primary CTA:** `RESERVATIONS` text in ultra-sparse top nav (INFORMATION + RESERVATIONS only).
- **Type / color / imagery:** All-caps tracked white nav; gold line-art mark; low-key food photography on black; carousel dots + pause.
- **Instagram:** None above the fold. Atmosphere lives in owned photography.
- **Adapt:** Photography-as-product hero; 2-item nav; reservation as sole conversion chrome.
- **Avoid:** Crowding hero with copy blocks, multi-CTA stacks, bright SaaS buttons, stock interiors.

### 2. Dishoom
- **Hero job:** Cultural immersion (mood interior + quote + bilingual welcome), then route to menu/book.
- **Primary CTA:** `Book a table` in nav pill **and** hero; twin ghost `View menus` | `Book a table`.
- **Type / color / imagery:** Centered serif wordmark + large serif quote; spaced-caps sans nav; near-black shell; desaturated cinematic interior in rounded frame.
- **Instagram:** Not in first viewport — brand owns the story first.
- **Adapt:** Dual path Menus + Book; persistent book in header; dark monochrome luxury; manifesto-level short copy.
- **Avoid:** Neon accents, multi-slide promo carousels, burying booking, light-mode greys on black.

### 3. Cora Pearl
- **Hero job:** Place + desirability — split exterior night photo + press quote panel.
- **Primary CTA:** Header `BOOK A TABLE`; secondary `READ MORE`; promo band for click & collect.
- **Type / color / imagery:** Serif wordmark + large editorial quote; blush/nude + charcoal; moody lantern exterior; hamburger for secondary IA.
- **Instagram:** Not in fold — press quote stands in for social proof.
- **Adapt:** Split photo | solid brand panel; persistent book; soft powder palette; timely service banner as text, not popup.
- **Avoid:** Equal-weight long nav; food-only stock heroes; IG grid fighting the editorial first screen.

### 4. Sessions Arts Club
- **Hero job:** Club/gallery identity via art-directed object (open book/journal with B&W dish grid).
- **Primary CTA:** Header text `Reservations` + hamburger — invitation, not e-comm pill.
- **Type / color / imagery:** Dark green-black bar; pale gray stage; print typography inside the object; monochrome contact-sheet food studies.
- **Instagram:** None in hero — exclusive posture.
- **Adapt:** Object-as-hero + massive negative space; reservations always exposed; 2–3 tone palette (green, off-white, mono photo).
- **Avoid:** Loud BOOK NOW buttons; social icon clutter; generic specials ribbons.

### 5. Spring (Skye Gyngell)
- **Hero job:** Seasonal ingredient still-life as brand atmosphere (pea vines on linen, airy gallery quiet).
- **Primary CTA:** Nav text `Reserve` among Menus · About · Events · Reserve · Vouchers · Plastic Campaign.
- **Type / color / imagery:** Thin tracked serif wordmark SPRING; pale gray/white field; soft greens + magenta flower accents; produce-as-art, no plated food.
- **Instagram:** Hero is highly feed-native (still-life, calm crop); site does not force an embed in fold.
- **Adapt:** Seasonal hero swap; values link in nav optional; reserve quiet but present; photography dominates type.
- **Avoid:** Busy CTAs on the still-life; dark crush that kills airy produce; generic diner stock.

---

## Adapt / avoid table (synthesis)

| Pattern | Adapt for Hidook product-menu | Avoid |
|---|---|---|
| Hero | Full-bleed or split **owned food/place photography**; one idea per viewport | Stock “happy diners”, indigo SaaS gradients, multi-card marketing grids |
| CTA | Persistent **Reserve / Book a table** in chrome; optional second **Menus** | PDF-only menu with no in-page path; competing Shop/Join equal to book |
| Type | Serif or refined display for brand/quote; tracked caps for UI; sparse hierarchy | System-only dense UI; long hero essays |
| Color | Near-monochrome dark **or** blush/air light — photography carries hue | Rainbow UI; pure Apple glass clone as the product identity |
| Menu | One-tap menu section / accordion groups (keep our EN/RO menu block) | Hidden menus; hero wall of prices |
| Proof | Press line or mood photo — not fake review widgets | Cookie walls treated as design; cloning Crenn/Dishoom chrome 1:1 |
| Instagram | Mid-page living proof module (spec below) | Footer glyph only; autoplay noise above the fold |

---

## Winning composition for `product-menu`

1. **Sticky thin mast** — wordmark left · optional 2–4 text links · primary **Rezervă / Book** pill right.
2. **Hero stage** — photography-first (food still-life, exterior, or single plated object). Short tagline optional. Ghost secondary “Meniu” + primary book if needed. No chalkboard ticket gimmick as the default identity.
3. **Menu rail** — keep structured categories (our accordion / tickets can stay as *structure*, restyle chrome to paper/dark editorial).
4. **About / story** — short prose card, not a SaaS feature grid.
5. **Gallery** — collage of real dishes/room (existing collage deck).
6. **Instagram module** — mandatory (below).
7. **Contact / hours / map** — book + phone + address.

Remove or demote: “MENU BOARD” kicker language, pastry-ticket theatre if it fights the vertical, Apple-default blue-as-brand if client theme is dark luxury or blush.

---

## Instagram module spec — restaurants

**Contract (already partially on product-menu):**
- `instagram.handle`, `instagram.url`
- `instagram.embedUrl` → provider-neutral iframe (Instafidget / official embed / partner)
- `instagram.gallery[]` → image URLs for fallback grid
- optional `instagram.posts[]` blockquotes if embed unavailable

**Look for this vertical:**
- Section on **paper or near-black** matching hero polarity (dark systems → dark section with light type; blush/light systems → soft paper).
- Head: title (`Pe Instagram` / `From the kitchen`) + `@handle` + Follow text link.
- **If embedUrl:** single full-width iframe, min-height ~480–560px, radius 8–12px, no chrome chrome-clone.
- **Else gallery:** 2×3 or 3×3 square cells, object-fit cover, gap 4–8px, each cell links to profile. Prefer real dish/room crops (client uploads).
- Placement: **after menu + gallery, before contact** — living proof, not footer afterthought.
- Do **not** put IG in the hero or sticky nav icons-only without a feed.

---

## Token direction (derived set, not one clone)

| Token | Dark-luxury track | Light-editorial track |
|---|---|---|
| `--bg` / paper | `#0a0a0a` / `#111` | `#f3eee8` / `#f5f5f7` |
| `--ink` | `#f5f5f7` | `#1a1410` |
| `--accent` | warm gold or soft cream CTA | terracotta / deep green or charcoal pill |
| `--type-display` | serif or tight grotesque | light tracked serif wordmark |
| `--type-ui` | spaced caps sans 12–14px | same |
| `--radius` | 0–8px (sharp luxury) or soft 12 on media | 0–8 |
| Imagery | single subject, vignette, high craft | seasonal still-life / exterior night |

Wizard keeps `theme.primary*` injection; presets should ship one dark + one light restaurant demo, not bakery chalkboard defaults.
