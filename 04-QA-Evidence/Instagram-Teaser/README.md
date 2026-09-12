# Instagram teaser — QA evidence (2026-09-12)

## Role of this folder

This is the QA/adversarial pass on the Instagram "teaser" feature: an example
Instagram grid that should render **only** in the builder preview (edit mode),
for a customer who has not connected Instagram, and must **never** reach a
published/exported site. Scope for this pass was tests + evidence only — no
changes to `build.js`, `templates/`, `builder/edit-overlay.js` or
`builder/app.js`.

## Status: the feature has not landed in this worktree

Before doing anything else this pass verified whether either of the two
parallel agents' work was already present:

```
grep -rl "hb-ig-teaser" --include="*.js" .                        # this worktree: no hits
grep -rl "hb-ig-teaser" .claude/worktrees/agent-a21c38553679d0323  # sibling worktree: no hits
grep -rl "hb-ig-teaser" .claude/worktrees/agent-a7b2fb0270823e150  # sibling worktree: no hits
grep -rl "hb-ig-teaser" .claude/worktrees/agent-abbe4709503baa6c0  # sibling worktree: no hits
grep -rl "hb-ig-teaser" .claude/worktrees/agent-aed21245fcd759ca4  # sibling worktree: no hits
```

None of the accessible worktrees contain any `hb-ig-teaser` / `data-hb-ig-teaser`
/ `data-hb-ig-connect` markup, in `build.js`, any `template.html`, or
`builder/app.js` / `builder/edit-overlay.js`. This worktree's HEAD is also
identical to `main` (`7cc77419ed04ebc6d96acce60b590f58bb357af8`) — i.e. this
is the state strictly BEFORE either agent's commits exist.

One piece of asset prep **has** landed for 3 of the 5 templates: each of
`templates/product-menu`, `templates/portfolio` and `templates/local-service`
already has 6 unreferenced `<prefix>-ig1..ig6[-Nw].{jpg,webp}` images per
preset sitting in its `images/` directory (e.g.
`templates/product-menu/images/cn-ig1.jpg` for the `casa-nord` preset),
confirmed **not referenced anywhere** in any `template.html` or
`presets.json` today. These are almost certainly the future example tiles
(they match the "6 `<li><img></li>`" contract exactly), but the section
markup itself does not exist yet, and `professionals`/`desserdirina` have no
such images yet either.

Per the run brief's own contingency ("if it is missing, say so plainly...
deliver item 1 against a fixture and whatever else you can, rather than
inventing results"), this is that plain statement. Nothing below fabricates
a passing/failing teaser that does not exist.

## What was delivered anyway

1. **`bot/test/suite10-instagram-teaser-never-published.test.js`** — the
   guard. Runs today, fully green, against the real templates (not a mock
   fixture) for all 5 templates x every preset:
   - asserts the public render (`renderHtml()` with no `editMode`) contains
     none of `hb-ig-teaser` / `data-hb-ig-teaser` / `data-hb-ig-connect`, nor
     any of that preset's candidate example-tile filenames (derived two ways:
     the pre-positioned `-ig1..6` assets described above, AND — once the
     section exists — whatever filenames actually appear inside a
     `data-hb-ig-teaser` block in the editMode render, so it keeps working
     without edits once the feature lands);
   - asserts that public render is byte-identical to a frozen baseline
     snapshot captured at commit `7cc77419ed04ebc6d96acce60b590f58bb357af8`
     (see `bot/test/fixtures/suite10-baseline/manifest.json`), so even a
     change that doesn't literally contain one of the markers above still
     fails loudly;
   - **proves it is not vacuous**: splices a realistic teaser (matching the
     task's exact markup contract, including `data-hb-ig-connect` and an
     `images/cn-ig1.jpg`-style tile) into a real, clean public render, and
     asserts the guard function throws on the mutated copy and is silent on
     the original. Confirmed by running the file:
     ```
     $ node --test bot/test/suite10-instagram-teaser-never-published.test.js
     ✔ suite10: Instagram teaser never appears in the published (no-editMode) render — 5 templates x every preset
     ✔ suite10: guard is not vacuous — proven RED on an injected teaser, GREEN on the real render
     ```

2. **`bot/test/suite10-instagram-teaser-a11y-contrast.test.js`** — the WCAG
   1.4.3 contrast probe for the veil's lead text and CTA, reusing (ported
   verbatim, not reinvented) the ink-hide-then-screenshot-then-sample method
   from `bot/test/suite7-template-contract.test.js` (the file whose own
   header explains that 96 of 108 earlier "violations" on this exact kind of
   check were sampling artefacts, not real defects — see that file's
   "Method notes" before trusting any new probe against it). Scoped to all
   5 templates x the same 3 themes suite7 uses x 390px/1280px.
   Because the section does not exist anywhere yet, this file renders every
   template/theme/viewport combination, finds no `data-hb-ig-teaser`
   anywhere, and calls `t.skip(...)` with an explicit explanation — an
   honest skip, not a fabricated pass:
   ```
   $ node --test bot/test/suite10-instagram-teaser-a11y-contrast.test.js
   ﹣ suite10: Instagram-teaser veil text and CTA meet WCAG 1.4.3 contrast — 5 templates x 3 themes x 2 widths
     # Instagram-teaser section (data-hb-ig-teaser) not found in ANY template's
     editMode render ... The two parallel agents' work has not landed in this
     worktree yet — this is not a pass, it is an honest skip.
   ```
   It self-activates per template once the section lands (a template that
   already has it gets measured for real even if others don't yet).

3. **Visual evidence (screenshots)** — NOT produced. The brief asks for
   Playwright screenshots of "the teaser at rest and revealed" on each
   template at 390px/1280px — there is no teaser to screenshot yet in either
   this worktree or any sibling worktree checked above. Producing
   screenshots of "no teaser present" would not exercise anything item 1's
   test doesn't already prove more rigorously (byte-identical to a
   pre-feature baseline, plus a proven-non-vacuous absence check), and
   standing up the full builder app (server + auth + template-select flow)
   purely to re-confirm a negative already established at the code level was
   judged not worth the cost here. This is a real gap, not an oversight —
   re-run this pass (or hand it to a fresh QA pass) once the markup exists,
   and both new test files above will immediately start giving per-template,
   per-theme, per-viewport signal.

## `npm test` result

See the accompanying run report (in the chat/agent transcript that produced
this evidence, not duplicated here) for the exact pass/fail counts of the
full suite, including the two new suite10 files. Only pre-existing red
expected: `flow3-legal-export` (documented Brave-specific).
