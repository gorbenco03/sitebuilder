# HANDOFF — portfolio (Salon) polish pass, Wave10

Scope of this wave: `templates/portfolio/**` only, plus new tests under
`bot/test/wave10-portfolio-*`. This file records things noticed while doing
that work which need a change **outside** those files, so another agent can
pick them up — nothing below was applied, and nothing outside my scope was
touched.

## Possible cross-template `aspect-ratio` + baked width/height attribute interaction

**What I found, and where:** `templates/portfolio/styles.css` had several
`<img>` rules of the shape `width: 100%; aspect-ratio: <ratio>; object-fit:
cover;` with no `height` declared. `build.js`'s `injectResponsiveImages` (CLS
hardening) writes real `width`/`height` HTML *attributes* onto every `<img>`,
taken from the source file's own intrinsic pixel size. Those attributes map
to a `height` **presentational hint** in the browser's cascade — lower
priority than any author CSS rule, but it still fully satisfies the box's
`height` property (making it non-`auto`). Per spec, the CSS `aspect-ratio`
property is only consulted to compute a used height when `height` computes
to `auto` — so with a non-auto height already supplied by the attribute
hint, `aspect-ratio` in the stylesheet was silently never applied at all, and
every one of these images rendered at its own **raw source pixel height**
instead of the intended ratio.

This stayed invisible wherever a category's photos all happened to share the
same source dimensions (by luck, not by design — e.g. this template's
"Coafură și culoare" gallery category, where every source photo happens to
be 960×960). It became a real, visible defect wherever dimensions were mixed
within one row (this template's "Manichiură și nail art" category ships 2
photos at 960×960 and 2 at 960×643): the mixed-height images produced
visibly different image heights side-by-side, with blank space inside the
figure frame under the shorter ones. Confirmed with a live measurement
(`getBoundingClientRect`/`getComputedStyle` on the built page, not just
reading the CSS source) — see `04-QA-Evidence/Wave10-portfolio/`.

**The fix I applied here:** add `height: auto;` next to each `aspect-ratio`
declaration in `templates/portfolio/styles.css` (`.pf-frame img,
.collage-photo img`; `.pf-person__pic img`; `.pf-ig__cell img`). This is the
standard, spec-correct pairing for `aspect-ratio` on a replaced element and
is a pure CSS change — verified it does not regress CLS (still exactly 0 on
all 3 shipped presets, both 1440px and 390px — see
`bot/test/wave10-portfolio-cls.test.js`).

**Why this might be worth checking on other templates:** the same
`injectResponsiveImages` behavior applies to *every* template's built pages
(it's in `build.js`, shared). I did **not** check `local-service`,
`product-menu`, `professionals`, or `desserdirina` for the same
vulnerability — grepping their CSS shows a mix of techniques (some set
`height: 100%` on the `<img>` with the ratio living on a parent instead,
which sidesteps this entirely; `desserdirina` has an explicit comment
choosing "fixed aspect-ratio, not height: auto" for a documented reason of
its own, so it may be intentionally different and should not be blindly
"fixed" the same way). This is a **flag for someone to check with fresh
eyes**, not a confirmed defect elsewhere — I have not reproduced it outside
`templates/portfolio/`, and each template's actual DOM/CSS technique differs
enough that the same one-line fix may not even apply cleanly.

## Not investigated further (out of this wave's scope)

- Whether the same owner-editable-list add/remove mechanics that were fixed
  in the round-2/round-3 audits also need a look at `pf-sched__list` (hours)
  or `pf-team__grid` (team) — neither had a visible "+ Adaugă" control on any
  shipped preset in this pass, consistent with the prior audit's note that
  these may not be owner-extensible by design. Not re-verified here.
