# Recommended direction — three Hidook systems

Research date: 2026-08-23. Handoff for template implementation (not this card).  
**Patterns only — do not clone brands, logos, photos, or proprietary chrome.**

---

## Capture hygiene

| Discarded | Reason |
|---|---|
| noma.dk, rules.co.uk | Cloudflare browser-check — not design |
| theivy.co.uk | Parked Spaceship domain page |
| woodhull.com capture | Wrong property (1994–2007 personal archive) |
| exhale-spa | Partial — missing hero media; CTA palette only |

**Final 5+5+5 evidence**
- Restaurants: Atelier Crenn, Dishoom, Cora Pearl, Sessions Arts Club, Spring  
- Beauty: Minimale Skin, Bluemercury, Blow Ltd, Sally Hershberger, Exhale (weak)  
- Construction: Turner, Matheson, Mortenson, Clark, Layton  

Details: sibling `*-patterns.md` files.

---

## Cross-vertical truths

1. **Photography is the product.** Stock and icon-tile heroes lose to real food / real hair / real jobsites.
2. **One primary action above the fold** — Reserve · Book · Call/Estimate — repeated in sticky chrome.
3. **Instagram is living proof**, never a lone footer glyph. Every Hidook system must ship `instagram.embedUrl` iframe **and** `instagram.gallery` fallback.
4. **Sparse chrome wins.** Enterprise GCs and fine dining both strip nav; local lead-gen still surfaces phone.
5. **Do not ship Apple.com cosplay as the commercial identity.** Keep Kowalski motion / blur util if useful; restyle surfaces so verticals feel restaurant / salon / trade — not three skins of the same SF Pro landing.

---

## Keep vs remake (current `templates/`)

### Keep (structure & product contract)

| Keep | Why |
|---|---|
| Three system IDs: `product-menu`, `portfolio`, `local-service` | Product IA already maps verticals |
| Config contract: business, theme, hero, services, categories/gallery, instagram, contact, seo | Wizard + build.js already wired |
| `@if` / `@each` token pipeline | Correct optional-field discipline |
| Collage deck + lightbox | Work/gallery proof engine |
| product-menu **menu EN/RO** accordion | Differentiator for restaurants |
| local-service **util phone + sticky call dock** | Matches construction research better than national GC sites |
| portfolio **gallery-first** section order | Matches beauty editorial pattern |
| product-menu **instagram.embedUrl iframe** path | Canonical IG module — extend to other two |
| Defensive script early-returns | Zero-dep stability |
| Theme CSS variables injection | Client color without forks |

### Remake / restyle (visual & IA emphasis)

| Remake | Why |
|---|---|
| product-menu “chalkboard / ticket stub / MENU BOARD” default persona | Live refs are photography-editorial, not bakery ticket theatre |
| Shared Apple black/`#f5f5f7`/SF-only personality across all three | Research shows distinct polarities (dark food luxury, powder beauty, navy trade) |
| portfolio missing `instagram.embedUrl` iframe parity | Mandatory IG on every system |
| local-service gallery-only IG (no embed) | Same parity gap |
| portfolio Book not always the strongest story when hero is empty/copy-light | Beauty refs fail when Book is buried (Sally gap) — enforce Book in chrome + hero |
| local-service leaning “industrial diagonal” without project caption language | Add project name/location meta like Mortenson/Clark |
| Icon-only services as primary proof | Prefer photo-backed services/projects |
| Demo presets (bakery / generic) | Reseed from vertical patterns (dark restaurant + blush restaurant; powder spa + mono salon; navy GC + orange-accent trade) |

### Do not do in follow-up without a new card

- Edit live production sites or push deploy  
- Clone any reference logo, custom illustration, or proprietary UI kit  
- Treat Telegram as publish path  
- Drop phone dock on local-service “because Turner doesn’t show a phone”

---

## Instagram (mandatory) — unified behavior

```
instagram.handle
instagram.url
instagram.embedUrl          # iframe src when set
instagram.gallery[]         # always preferred fallback / companion grid
instagram.posts[]           # optional blockquotes (product-menu already)
```

| System | Module mood | Grid | Placement |
|---|---|---|---|
| product-menu | Kitchen / dining proof | squares 3×2–3×3 | after menu + food gallery, before contact |
| portfolio | Client results / chair | squares 3×3 | after work gallery + services, before booking |
| local-service | Jobsite progress | 16:9 or 4:3, 2×2–2×3 | after projects, before final CTA band |

Implementation rule: if `embedUrl` truthy → render iframe; **always** render gallery when non-empty (embed can fail offline). Follow link uses `instagram.url`. Empty handle hides whole section via `@if`.

Partner note: Instafidget remains a **neutral slot** via embedUrl — no Instafidget branding required in client CSS.

---

## System-specific north stars

### product-menu (restaurants)
- **North star:** Dishoom clarity (Menus + Book) + Crenn/Spring photography discipline + Cora split optional for light presets.
- **Hero:** Food or place photo first; short tagline; Reserve persistent.
- **Tokens:** Offer dark-luxury and light-editorial preset tracks (see restaurants-patterns.md).

### portfolio (beauty)
- **North star:** Minimale calm book-first + Blow face-led service hero + Sally mono authority (with Book added).
- **Hero:** Real work photography; Book never optional in chrome.
- **Tokens:** Powder / mono / sage spa tracks.

### local-service (construction)
- **North star:** Matheson/Layton real-site proof + Turner aerial craft **plus** Hidook phone/estimate (refs under-deliver conversion).
- **Hero:** Project photo + dual Call / Estimate.
- **Tokens:** Navy trust + industrial orange accent options.

---

## Suggested implementation order (next cards)

1. Schema/parity: `instagram.embedUrl` on portfolio + local-service; gallery fallback tests.  
2. Visual restyle per system using tokens in `*-patterns.md` (CSS/HTML only; no brand clones).  
3. Preset rewrite (RO/MD realistic demos) with photography-first picsum seeds or licensed placeholders.  
4. Builder preview QA on mobile 390 + desktop 1440.  
5. Dogfood publish path in fake deploy only.

---

## Explicit non-goals

- Inventing a fourth system  
- Owner QA / Telegram owner pings  
- Semantic ACCEPT of product code in this research card  

**HANDOFF ONLY; NOT semantic ACCEPT.**
