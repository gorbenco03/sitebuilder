# Template research — Hidook Site Builder

Owner lock 2026-08-23: do **not** invent a look. For each of the three commercial systems, capture **5 live sites**, screenshot them, extract the best reusable patterns, then apply those into our template. Instagram/social feed is **mandatory** on every system.

## Systems

| System | Vertical | Live references |
|---|---|---|
| `product-menu` | Restaurants / menu | ateliercrenn.com, springrestaurant.co.uk, dishoom.com, sessionsartsclub.com, corapearl.co.uk |
| `portfolio` | Beauty / salon / spa | exhalespa.com, minimaleskin.com, bluemercury.com, blowltd.com, sallyhershberger.com |
| `local-service` | Construction / local trade | turnerconstruction.com, mathesonconstructors.com, woodhull.com, mortenson.com, clarkconstruction.com |

If a URL is blocked or dead, replace it with another **live** site in the same vertical and record the swap in `SOURCES.md`.

## Non-negotiables

1. Instagram / social feed is included in every template (provider-neutral `instagram.embedUrl` iframe + gallery fallback).
2. Copy patterns, do not clone a brand, logo, photo, or proprietary UI chrome.
3. Research folder only here. Do not push, deploy, or charge.
4. Telegram bot stays paused.
5. Team decides internally which patterns win. Owner is not QA.

## Package

```
04-QA-Evidence/template-research/
  README.md
  BRIEF.md
  SOURCES.md
  01-restaurants/
  02-beauty/
  03-construction/
  04-synthesis/
    restaurants-patterns.md
    beauty-patterns.md
    construction-patterns.md
    recommended-direction.md
```

## Synthesis status (S46)

Per-site notes + adapt/avoid + Instagram module specs + keep/remake live under `04-synthesis/`.  
Start at `04-synthesis/recommended-direction.md`. Instagram (`embedUrl` + gallery fallback) is mandatory on every system.
