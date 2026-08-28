# LP brand tokens — owner gate (not this slice)

**VISION.md §9:** Landing page must adapt to **hidook.agency** brand. Rules:

- Do **not** guess hidook.agency colours / hex / brand tokens.
- LP visual remake waits on **exact** brand tokens or access to the brand source.
- Copy already reads commercial pricing from config (`bot/pricing.js` via `/api/config`).

## Current state (Flow 4.3)

| Item | Status |
|------|--------|
| Exact agency primary/secondary hex tokens in-repo | **Absent** |
| Builder landing visual (layout/CSS) | **Left as-is** — no invented palette |
| Pricing copy on product-visible landing | Config-driven: trial 7 zile, first period 99, renewal 29/an |
| Owner gate | Brand tokens + any production LP cutover |

When the owner supplies tokens, a later slice may restyle `builder/index.html` + `builder/app.css` without changing the commercial model.
