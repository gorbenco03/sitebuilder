# HANDOFF — templates/professionals (Wave10 polish)

Written by the agent that owns `templates/professionals/{template.html,styles.css,script.js,schema.json,presets.json}`
for the Wave10 "close the gap with local-service" pass. Two notes for whoever
next touches this template or the shared build tooling — neither blocks
anything today, both are outside my file ownership (`build.js`/`builder/**`).

## 1. `build.js`'s `@if` only tests a single path — no `||`/`&&`

While adding a footer social-icon row (later reverted for byte-budget
reasons, see below) I wrote `<!-- @if contact.instagram.url || contact.facebook.url -->`
expecting an "or". `build.js`'s `@if` parser (around the `@each|@if` regex,
`build.js:622`) only supports one path with an optional leading `!` negation
— it does not parse `||`/`&&` at all, so that condition is treated as a
literal (always-falsy) path and the whole block silently never renders. Not
a bug (this engine was never meant to be a full expression language), just a
trap for the next person who reaches for it — the workaround is what I ended
up doing: gate each element independently and let an always-rendered wrapper
be empty when none of the fields are set (safe as long as the wrapper has no
border/background of its own).

## 2. `bot/test/audit-performance.test.js`'s byte ceiling for `professionals.js` is now tight

The regression ceiling for the browser-builder's bundled "heavy" payload
(`HEAVY_JS_CEILING_BYTES.professionals = 109000`, in a file I don't own) sits
at 109000 bytes. After this wave's changes the built payload measures
~107.8KB — about 1.1KB of headroom left. Two things worth knowing before the
next round of polish on this template:

- `scripts/build-builder.js` embeds `template.html` **byte-for-byte,
  comments included** (only `styles.css` gets its comments stripped by the
  minifier) — so any verbose explanatory HTML comment costs real budget,
  while the same explanation in `styles.css` is free. I kept my CSS comments
  reasonably detailed for exactly this reason and trimmed the HTML ones.
- I built (and then reverted) a footer social-icon row wired to the existing
  `contact.instagram.url` / `contact.facebook.url` / `contact.whatsapp`
  fields — local-service has one and professionals' footer looks a little
  bare without it. It worked and looked fine, but three inline SVG icons
  (~2.6KB of path data, one of them a third copy of the WhatsApp glyph
  already inlined twice elsewhere in this same file) pushed the bundle to
  ~112.6KB, over the ceiling. If someone wants that footer row back, the
  cheap way to afford it inside the current budget is a single hidden
  `<svg><symbol id="...">` sprite defined once with `<use href="#...">`
  references at each call site, instead of inlining the full `<path>` three
  more times — I did not do this myself to keep this wave's diff scoped to
  what it actually needed.

No changes needed on your end for either of these unless you're the one
raising the ceiling or extending the `@if` parser.
