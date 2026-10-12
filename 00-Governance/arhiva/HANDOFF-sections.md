# Handoff — Wave 7, add/remove/reorder page sections

No `template.html` / `styles.css` / `script.js` changes were needed for this
feature on `professionals`, so there is nothing blocking for the template
owner this wave. This file exists per the wave's rule ("if you need a markup
change, describe it here") — recorded for completeness even though the
answer is "none required."

## How it works without touching template.html

`templates/professionals/template.html` already wraps every optional page
section in a top-level `<section id="…">…</section>` block (services,
process, about, appointment, faq, instagram, contact). `build.js`'s new
`reorderSections()` post-processes the fully-rendered HTML string: it finds
those blocks by id, then reorders/drops them per `config.sections` (an
ordered array of `{ id, removed }`). No template edits were required because
the ids and boundaries the template already authors were sufficient.

`config.sections` is only ever read/written when present; a config saved
before this feature has no such key, so the reorder step is skipped entirely
and output is byte-identical to before (see
`bot/test/wave7-sections-backward-compat.test.js`).

## Sections intentionally left OUT of the addressable set (not a request — just documenting the boundary)

- **Hero** (`<section class="pr-hero">`) has no `id` attribute, so it is not
  addressable by `reorderSections()` and always stays first. This was a
  deliberate choice, not an oversight — the hero is the site's first
  impression and was never meant to be reorderable.
- **Footer** (`<footer class="pr-foot">`) and the cookie banner
  (`#hb-cookie-banner`, mounted at the top of `<body>`) are not `<section>`
  elements at all and carry no `id` in the addressable sense either. They
  are structurally fixed by product policy (legal links, consent flow) and
  were deliberately excluded from the feature's reach — see
  `NON_REMOVABLE_SECTION_IDS` in `build.js` and the guardrail tests in
  `bot/test/wave7-sections-render-order.test.js`.

If a future wave wants hero/footer to become manageable too, the template
owner would need to add `id="hero"` / `id="footer"` to those elements — but
given the product-policy reasons above, that is a deliberate future decision
for someone to make, not a defect to fix.

## If this feature extends to other templates

`local-service`, `portfolio`, `product-menu` and `desserdirina` do not yet
have a `pageSections` entry in their `schema.json`, so their builder UI never
shows the "Secțiuni pagină" panel and their configs never gain a `sections`
key — `build.js`'s `reorderSections()` is already template-agnostic (it just
looks for `<section id="…">` blocks in whatever HTML it's given), so turning
this on for another template should only require:

1. Confirming that template's `template.html` already wraps its optional
   content blocks in `<section id="…">` (the same pattern used here) — if
   not, that is the one legitimate `template.html` change this feature would
   ever need, and should go through the template owner.
2. Adding a `pageSections` array to that template's `schema.json` (same
   shape as `templates/professionals/schema.json`).
3. Deciding which of that template's sections are structurally non-removable
   and adding their ids to `NON_REMOVABLE_SECTION_IDS` in `build.js`.

No other files need to change — `builder/app.js`'s panel and `build.js`'s
render step both key off `schema.pageSections`/`config.sections` generically.
