# Wave7 images — handoff notes for whoever owns template.html / styles.css / script.js

Wave7 added a responsive image pipeline (`scripts/generate-image-variants.js` +
a small, tightly-scoped addition to `build.js`'s `build()` function —
`injectResponsiveImages()`). It upgrades every `<img src="images/xxx.jpg">`
that has a `templates/<id>/images/variants.json` manifest entry into:

```html
<picture>
  <source type="image/webp" srcset="images/xxx-480w.webp 480w, images/xxx-960w.webp 960w"
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 48vw, 94vw">
  <img src="images/xxx.jpg" alt="…" loading="lazy" decoding="async" width="960" height="960">
</picture>
```

This is a **post-render string transform** in `build()` (Node-only — it never
touches `renderHtml()`, which must stay filesystem-free to keep working
inside the browser-bundled builder). It does not require any template.html
change to work, and I did not touch template.html/styles.css/script.js.
Two things are worth your attention though:

## 1. The hero photo (CSS `background: url(...)`) got nothing

Every template's hero is a plain CSS background on a `<div style="background:
...">` (`{{& hero.background}}`), not an `<img>`. `<picture>`/`srcset` only
works on `<img>` elements, and a plain inline `style=""` attribute can't carry
an `@media` rule to swap images by viewport width. So the hero — the single
largest photo on every page — currently ships completely unchanged: no WebP,
no width variants, and the CSS quality-floor commercial photos there stay
exactly as fixed-size as they were before Wave7.

If you want the hero to benefit too, the two realistic paths are:

- **Convert the hero markup to an `<img>`/`<picture>` instead of a CSS
  background** (with the gradient overlay as a separate absolutely-positioned
  element, or an `::before`/`::after` in CSS) — then `injectResponsiveImages()`
  can pick it up automatically the same way it does gallery photos, once I (or
  a follow-up) also generate hero variants in `scripts/generate-image-variants.js`
  (currently it deliberately skips files only ever referenced via `url(...)`,
  since there was nothing at the `<img>` layer to attach a srcset to).
- **Or**, if the CSS background must stay, at minimum a WebP-only format swap
  is possible via `background: image-set(url('images/xxx-hero.webp')
  type('image/webp'), url('images/xxx-hero.jpg') type('image/jpeg'))
  center/cover`. I deliberately did NOT do this myself: `image-set()` support
  gaps mean an unsupported browser can drop the *entire* `background`
  shorthand value (gradient overlay included), and breaking the hero on any
  browser felt like too much risk to take unilaterally on a file I don't own.
  If you want this, happy to generate hero WebP variants — it's one line in
  the generator's exclusion list.

## 2. The `sizes` estimate is deliberately generic, not tuned per template

`RESPONSIVE_IMG_SIZES` in `build.js` is one shared value —
`(min-width: 1024px) 33vw, (min-width: 640px) 48vw, 94vw` — used for every
picture-wrapped photo in every template. It's a reasonable approximation of
"1 column mobile → 2 columns ~640-720px → 3 columns ~960-1024px inside a
~1000-1280px max-width wrap," which is roughly true everywhere, but it is not
pixel-exact per template (e.g. local-service's `--max: 1040px` 3-column grid
cell actually renders at ~324px CSS width, not the 33vw-of-1440px≈475px the
`sizes` string implies — harmless, since the browser still picks the smallest
*sufficient* candidate, but not exact). If/when someone who owns the CSS wants
tighter values per grid, the two touch points are: the `RESPONSIVE_IMG_SIZES`
constant in `build.js`, and (if you want per-context values instead of one
global constant) `injectResponsiveImages()` would need to know which CSS class
wraps a given `<img>` — currently it doesn't inspect surrounding markup at all,
by design, to stay a dumb/safe string transform.

## 3. Owner-uploaded photos (data: URIs) only got a CLS fix, not variants

See the final report for the full reasoning — `injectResponsiveImages()`
decodes intrinsic width/height straight out of a `data:image/...;base64` `src`
(covers the logo and any photo an owner replaces in the editor) so it still
reserves layout space, but it never gets a `<picture>`/WebP treatment, since
there's no build step in the bot's publish path (`bot/webpublish.js` /
`bot/site-export.js`, both untouched) that would run `sips`/`cwebp` against an
arbitrary uploaded photo at publish time. That's a real, intentional gap, not
an oversight — flagging it here too in case whoever owns the publish path
wants to pick it up.
