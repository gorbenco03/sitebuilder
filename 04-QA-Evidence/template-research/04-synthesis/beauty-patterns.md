# portfolio — beauty / salon / spa patterns

Evidence set (2026-08-23).

| Slug | URL | Evidence status |
|---|---|---|
| minimale-skin | https://minimaleskin.com/ | OK |
| bluemercury | https://www.bluemercury.com/ | OK (retail-heavy; adapt carefully) |
| blow-ltd | https://www.blowltd.com/ | OK |
| sally-hershberger | https://www.sallyhershberger.com/ | OK |
| exhale-spa | https://exhalespa.com/ | **WEAK** — hero media missing in capture; CTAs usable only |

---

## Per-site notes (5)

### 1. Minimale Skin
- **Hero job:** Premium clinical-luxe positioning + book (Soho injectables / skin).
- **Primary CTA:** Pill `BOOK NOW` in header **and** large hero book.
- **Type / color / imagery:** Tracked caps sans nav + serif display headline; powder blue / dove gray; art-directed still life (hand, pearls, treatment cue).
- **Instagram:** Icon-only in header (IG + review + email) — no feed in fold.
- **Adapt:** Always-visible Book; calm powder palette; serif + sans pair; location in headline; gift cards in nav.
- **Avoid:** Neon glam; treatment price wall on first screen; syringe-fear imagery for general salons.

### 2. Bluemercury
- **Hero job:** Promotional product spotlight (split still-life + navy offer panel).
- **Primary CTA:** `SHOP NOW` (retail) — swap verb to Book for service businesses.
- **Type / color / imagery:** Serif logo + large serif promo head; navy/white; gold product packaging still-life; carousel.
- **Instagram:** Not in fold.
- **Adapt:** Split image | solid CTA panel; high-contrast primary button; serif/sans luxury pair.
- **Avoid:** Full e-comm mega-nav and cart-first IA for appointment-only salons; “Shop” as only conversion.

### 3. Blow Ltd
- **Hero job:** Convert demand for mobile hair/makeup — face-led service-in-progress photo.
- **Primary CTA:** Header `BOOK ONLINE` + hero `GET A QUOTE NOW` (outline/soft peach on photo).
- **Type / color / imagery:** White type on dark scrim; editorial H1; warm coral/peach outline accent; glam close-up.
- **Instagram:** Not in first viewport; press logo strip for trust instead.
- **Adapt:** Full-bleed beauty photo + scrim; Book always in nav; outline CTAs that don’t kill the photo; trust strip.
- **Avoid:** Low-contrast type on skin; equal-weight Shop/Learn/Join; solid blocks that erase the hero face.

### 4. Sally Hershberger
- **Hero job:** Status/aesthetic via monochrome editorial portrait carousel (brand authority).
- **Primary CTA:** **Missing on fold** — gap for appointment businesses. Nav: Shop · Salons · Wholesale · Portfolio · About.
- **Type / color / imagery:** Condensed white wordmark on black bar; B&W fashion portrait; near-monochrome luxury.
- **Instagram:** Not shown on fold.
- **Adapt:** Monochrome editorial hero; tight black chrome; portfolio IA.
- **Avoid:** Shipping empty hero copy regions; no Book in header for salon templates.

### 5. Exhale Spa (weak capture)
- **Hero job:** Wellness calm + promo — capture lost main media (white void).
- **Primary CTA:** Sage `BOOK NOW` + `GIFT CARDS` dual buttons; top promo bar.
- **Type / color / imagery:** Script tagline “to a better you”; tan bars; sage CTAs — spa palette readable even without photo.
- **Instagram:** Not visible.
- **Adapt:** Book + Gift dual path; soft spa greens/tans; promo strip.
- **Avoid:** Treating broken-hero white void as intentional design; script-only without a photo fallback.

---

## Adapt / avoid table

| Pattern | Adapt for Hidook portfolio | Avoid |
|---|---|---|
| Hero | Real work / face / treatment lifestyle; calm luxury | Beige sludge, stock smiles, missing Book |
| CTA | **Book** sticky in chrome + hero; optional Gift / Quote | Shop-only retail IA for pure service |
| Type | Serif display + tracked UI sans | Decorative script overload on photos |
| Color | Powder blue, blush, monochrome black, sage — one accent | Nightclub neon; indigo SaaS cards |
| Work | Gallery-first series (keep collage) after thin chrome | Services as generic icon tile row only |
| Instagram | Mid-page grid of real clients/results | Header glyph with no feed; noisy autoplay |

---

## Winning composition for `portfolio`

1. **Sticky chrome** — mark · Gallery · Services · **Book** CTA (always).
2. **Hero** — full-bleed editorial photo + short tagline + Book (ghost or fill). No empty left slab without copy.
3. **Gallery first** — series by category (hair, nails, injectables…) — keep existing collage-deck structure.
4. **Services** — list with optional duration/price-from; each can deep-link to book.
5. **Instagram** — mandatory module (spec below) as **client proof grid**.
6. **Booking panel** — phone / WhatsApp / hours (keep).

Demote: Apple-blue as the only beauty accent; treating retail cart patterns as default.

---

## Instagram module spec — beauty

**Contract:** same as product-menu — `embedUrl` iframe + `gallery[]` fallback. **Note:** current `portfolio` template has gallery path but should gain **parity `instagram.embedUrl` iframe** like product-menu.

**Look for this vertical:**
- Section title tone: `Rezultate reale` / `From the chair` / `Pe Instagram`.
- Prefer **square grid 3×2 or 3×3** (Instagram-native) even when embed is present — beauty converts on faces/results.
- Embed: optional second row or tab; if embed fails, gallery alone is enough.
- Soft paper background (`#f7f4ef` / powder); thin hairlines; radius 4–8px on cells.
- Hover: subtle opacity only (no zoom gimmicks required).
- Placement: **after gallery/services, before booking** so Book still closes the page.
- Caption optional under grid: “Lucrări reale ale clienților — nu stoc.”

---

## Token direction

| Token | Calm luxe | Editorial mono | Spa soft |
|---|---|---|---|
| bg | `#e8eef2` powder | `#000` / `#111` | `#f4f1ea` |
| ink | `#2a3340` | `#fff` | `#1d1d1f` |
| accent | slate book pill | white outline / one gold | sage `#6b7f5a` |
| display | serif | condensed grotesque | mixed script sparingly |
| radius | 8–980 pill CTAs | 0–8 | 8–12 |
| imagery | still-life + skin | B&W portrait | serene interior |

Presets: one med-spa powder, one salon mono, avoid generic teal SaaS.
