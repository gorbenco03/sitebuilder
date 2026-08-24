# S71-fix — mobile header CTA

- Cause: `.btn-primary { display:inline-flex }` overrode `.header-cta { display:none }` (same specificity, later rule).
- Fix: `.app-header a.header-cta` / `.app-header .header-cta` (higher specificity) → `display:none` default; `@media (min-width:640px)` → `inline-flex`.
- Acceptance (Playwright getComputedStyle `#header-cta`):
  - 390: `display === 'none'`
  - 1440: not `none` (inline-flex)
- Hero CTA remains visible on mobile; only mast `#header-cta` is hidden.
