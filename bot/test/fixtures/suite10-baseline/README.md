# suite10 baseline fixtures

## What this is

For every template x every preset in `templates/*/presets.json`, this
directory holds the exact HTML that `build.js`'s `renderHtml(templateHtml,
presetConfig)` — no `opts`, i.e. the PUBLIC/published path, the same one
`bot/site-export.js`'s `buildStaticSiteTree()` and `bot/webpublish.js` use —
produced at commit `7cc77419ed04ebc6d96acce60b590f58bb357af8`, saved
byte-for-byte. `manifest.json` records that commit and which file belongs to
which template/preset.

`bot/test/suite10-instagram-teaser-never-published.test.js` re-renders every
preset the same way today and asserts the result is byte-identical to the
file here. That commit was chosen deliberately: it is `main`'s HEAD from
before either of the two parallel agents building the Instagram-teaser
feature had landed any commit anywhere. It is a frozen snapshot of "the
public render before the teaser existed", not a live re-derivation — see
the "why not `git show main:...`" note in that test file's header for why a
live lookup against `main` would stop being a pre-feature baseline the
moment the feature merges to `main`.

## When refreshing this fixture is legitimate

Only when the byte diff is fully explained by an **intentional,
Instagram-teaser-UNRELATED** change to a template's public output — for
example: a copy fix, a new/replaced photo, an unrelated markup or CSS-class
rename, a new preset added to `presets.json`. In that case:

```sh
node scripts/regen-suite10-baseline.js          # dry run: prints the diff, writes nothing
# read the diff. confirm every changed preset is explained by your actual change.
node scripts/regen-suite10-baseline.js --write  # writes the new fixtures + manifest.json
```

Commit the refreshed fixture files and `manifest.json` together with the
template change that caused the diff, in the same PR/commit — a baseline
refresh with no accompanying template change explaining it is a red flag on
review, not a routine chore.

## When it is NOT legitimate — read this part twice

If the byte diff exists because Instagram-teaser markup, the
`data-hb-ig-connect` button, or an example-tile image filename reached the
**public** render path, that is **not** a stale fixture. That is
`suite10-instagram-teaser-never-published.test.js` doing exactly the one
job it was written for: catching a live customer's published site about to
show fabricated Instagram content as if it were that business's own feed
(see the S111 policy referenced in that test's header and in
`build.js`'s `normalizeInstagramForPublic()`).

**Regenerating the fixture in that situation does not fix anything — it
deletes the only thing standing between that bug and a real business's real
site.** A guard that gets silenced routinely stops being a guard; this one
exists specifically so that a mistake like "the teaser's `@if` gate got
inverted" or "the veil forgot to check `hidden`" fails loudly instead of
shipping.

`scripts/regen-suite10-baseline.js` has a hard-coded check for exactly this:
even with `--write`, it refuses to write anything if any newly-rendered
preset's public HTML contains `hb-ig-teaser`, `data-hb-ig-teaser`, or
`data-hb-ig-connect`. If you hit that refusal, the fixture is not the
problem — go find out why the public render path grew that marker.

If you are genuinely unsure which case you are in, treat it as the second
case until proven otherwise: fix the leak (or ask whoever owns the teaser
feature to), do not refresh the baseline to make the test quiet.

## Regenerating

See `scripts/regen-suite10-baseline.js` — it is the checked-in version of
the one-off script originally used to capture this baseline, safe to run
again (dry-run by default, `--write` to apply, self-refusing on a detected
leak as described above).
