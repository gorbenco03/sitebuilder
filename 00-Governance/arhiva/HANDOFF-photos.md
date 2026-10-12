# Handoff — Wave 9, "manage all photos"

No `templates/**` or `bot/**` changes were required to fix the actual audit
finding (the unreachable "manage all photos" modal) or to make large-photo
uploads resize properly — both root causes lived entirely in
`builder/app.js` / `builder/index.html`. This file exists per the project's
"describe it here if you need a template/bot change" convention — recorded
for completeness even though most of the answer is "none required."

## What was fixed, entirely within `builder/**`

- `findPhotoPaths()` never recursed into arrays of plain objects, only plain
  objects themselves — so `categories[i].photos` (the actual gallery shape
  used by portfolio, local-service, product-menu and desserdirina) was never
  discovered, `photoPaths.length` was always `0`, and the drawer's "Manage
  photos" button never rendered for any template. Fixed the recursion; no
  template data needed to change shape.
- `openImagePickerForPath()` (the hero-background "Alege o poză" control)
  read the picked file straight to an unresized `data:` URL — the one upload
  path in the whole app that didn't. Now resizes through the same
  `resizeImageToDataUrl(file, 1600, 0.82)` pipeline every other picker uses.
- The modal itself (`buildGalleryModal()`) is rebuilt into an actual "every
  photo on the site" surface: category galleries (grouped under the
  category's own title, not a raw config path), the hero background, and the
  logo — each demo (still-template-asset) photo flagged, alt text editable,
  reorder + in-place replace controls, and a dedicated always-visible "Poze"
  topbar button.

## One real gap that WOULD need a `templates/**` change to close

`templates/portfolio/schema.json`'s `team.members` list declares its
`itemShape` as `{ name: "text", role: "text", bio: "text", photo: "text" }` —
`photo` is typed as plain **text**, not any kind of image field. In practice
each team member's photo is a single string path, edited only by clicking
the rendered `<img>` directly on the canvas (which already goes through the
correct resize pipeline via `applySelectedImageFile()` — that part is fine).

It is **not** surfaced by the new "Poze" modal: `findPhotoPaths()` only
discovers *arrays* of `{src, alt}` objects, and a single string field nested
inside a list item doesn't fit that shape (nor should the modal start
guessing which arbitrary `"text"` fields are secretly photo paths — false
positives would be worse than the gap). This is the only place in any
shipped template where a real, meaningful photo isn't reachable from the new
"manage all photos" surface.

**If a future wave wants full coverage of per-item photos in lists**
(team members here; the same pattern would apply to any future
`itemShape` with a photo-like field), the clean fix is a real `itemShape`
sub-type — e.g. `"photo"` instead of `"text"` — that:
- `templates/portfolio/schema.json` would declare for `team.members.photo`
  (and any future template with an equivalent field),
- `builder/app.js`'s `findPhotoPaths()` / the new modal could then discover
  generically (no per-template special-casing needed), the same way it
  already treats the schema-declared `"photos"` type (`instagram.gallery`)
  as a first-class citizen today.

Not fixed here because it is a schema/content contract change outside
`builder/**`, and — per this wave's rules — `templates/**` is other agents'
territory this round.
