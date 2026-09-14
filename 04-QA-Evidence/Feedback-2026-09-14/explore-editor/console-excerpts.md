# Console / diagnostic excerpts

Raw structured data for every run is in `raw-log.json` (screenshot filenames,
list add/remove counts, undo/redo results, per-run console/pageerror/long-task
counts). This file holds the excerpts that don't fit neatly in the JSON —
pulled from focused, isolated re-runs used to verify findings twice.

## F1 — desserdirina: custom @font-face fonts fail to load in the editor preview

`raw-log.json` → runs `desserdirina/desktop` and `desserdirina/mobile` →
`diagnostics.consoleErrors` (20 entries each), e.g.:

```
Access to font at 'http://127.0.0.1:<port>/app/fonts/montserrat-400-normal-latin.woff2'
from origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
Failed to load resource: net::ERR_FAILED
```
(repeated for every Cormorant Garamond / Montserrat weight — 10 font files ×
2 console lines = 20)

Isolated verification (`document.fonts` inside the preview iframe):
```json
{
  "origin": "null",
  "h1Font": "\"Cormorant Garamond\", Georgia, serif",
  "fontsReady": "loaded",
  "loadedFontFamilies": [
    "Cormorant Garamond:unloaded", "...", "Cormorant Garamond:error", "...",
    "Montserrat:unloaded", "...", "Montserrat:error", "..."
  ]
}
```
`document.location.origin` inside `#preview-iframe` is the literal string
`"null"` — an opaque origin, because `builder/index.html:355`'s
`sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"`
omits `allow-same-origin`. Only desserdirina declares `@font-face` at all
(`templates/desserdirina/styles.css`), which is why the other four templates
show zero console errors for the identical flow.
Screenshot: `screens/desserdirina-desktop-01-open.png` — the "Desserdirina"
wordmark renders in a plain sans-serif fallback, not the brand's Cormorant
Garamond script/serif.

## F2 — desserdirina: drawer overlay intermittently blocks the canvas after opening

`raw-log.json` → `desserdirina/desktop` and `desserdirina/mobile` → the second
`edit-long-text` step entry (mislabeled by the harness's catch block — the
error actually happened while re-clicking the first text field for the
"clear field" step, right after undo/redo):

```
locator.click: Timeout 20000ms exceeded.
  - waiting for locator('#preview-iframe').contentFrame()
      .locator('[data-hb-edit][data-hb-kind="text"]').first()
    - locator resolved to <span ... data-hb-edit="business.name" ...>Desserdirina</span>
  - attempting click action
    - <div aria-hidden="true" id="drawer-overlay" class="drawer-overlay"></div>
      intercepts pointer events
    - retrying click action ... "element is not stable" (28+ retries over ~14s)
```

Isolated re-run (same open → edit → undo → redo sequence, no drawer-related
code changed) reproduced the identical stack trace a third time:
```
- <div aria-hidden="true" id="drawer-overlay" class="drawer-overlay"></div> intercepts pointer events
28 × retrying click action ... element is not stable
```
A fourth isolated attempt (extra console/state polling added) did **not**
reproduce it — `#drawer-overlay` stayed `display:none` throughout. So this is
a genuine but intermittent race, not deterministic every run.

Likely mechanism: `builder/app.js` ~line 8330, `showScreen('edit')` schedules
`openDrawer()` for "every newly selected design" via a double
`requestAnimationFrame` guard (`shouldAutoOpenDrawer() && !drawerOpen`); the
exploration helper's one-shot "close the drawer if it's visible, then wait
400ms" (matching `bot/test/audit-editor-list-add.test.js`'s
`openTemplateEditor()`) can race against that rAF-scheduled call on
desserdirina specifically — plausibly because its first paint is slower
(20 failed font requests as in F1 add work before the canvas settles),
pushing the rAF auto-open past the point the helper already checked and
closed it. When it wins the race, `#drawer-overlay` sits over the whole
canvas and swallows clicks for 10+ seconds even though `#details-drawer`
itself is not visibly open.

## F3 — professionals: "Replace photo" wraps the invisible WhatsApp QR image

`raw-log.json` → `professionals/desktop` and `professionals/mobile` →
`photo-replace` step:
```
"error": "page.waitForEvent: Timeout 5000ms exceeded while waiting for event \"filechooser\""
```

Isolated inspection of the only `.hb-img-btn` present in the professionals
preview at load:
```json
{
  "wrapClass": "hb-img-wrap",
  "wrapRect": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "imgSrc": null,
  "imgDisplay": "block",
  "btnDisplay": "block",
  "btnOpacity": "0",
  "wrapDisplay": "contents",
  "html": "<span class=\"hb-img-wrap\" style=\"display: contents;\"><img id=\"wa-qr-img\" alt=\"WhatsApp QR\" width=\"240\" height=\"240\"><button type=\"button\" class=\"hb-img-btn\">Înlocuiește fotografia</button></span>"
}
```
`templates/professionals/template.html:583` — `<img id="wa-qr-img" alt="{{labels.whatsapp}} QR" width="240" height="240">`
is the WhatsApp-widget's QR-code placeholder (no `src`, filled in by
`script.js` only when the WhatsApp QR panel is opened on the public site).
`builder/edit-overlay.js`'s generic `setupImages()` wraps every `<img>` on
the page as an editable photo slot with no exclusion for this one, so it
grows a "Înlocuiește fotografia" button identical to a real photo's — except
this one sits on a 0×0 element and can never actually be clicked or receive
a file. It happens to be the *only* `.hb-img-btn` professionals has this
early in the DOM (the template has exactly two `<img>` tags total: the logo,
which `setupImages()` skips, and this QR image), so scripted or
keyboard/DOM-order-driven attempts to "replace the first photo" land here
and go nowhere.

## F4 — false leads ruled out (recorded for completeness, not in REPORT.md)

- **local-service: 0 `.hb-add-btn` found.** Not a bug — local-service ships
  its own custom add/remove controls (`.hb-ls-add` / `.hb-ls-remove`,
  `templates/local-service/script.js` ~line 302-452) and deliberately removes
  the generic `.hb-add-btn`/`.hb-remove-btn` the editor injects, "to keep
  this template's own controls as the single source of truth for all four
  lists." Verified the 4 custom add buttons exist, are enabled, and are
  correctly labelled ("+ Adaugă certificare", "+ Adaugă serviciu", "+ Adaugă
  punct", "+ Adaugă categorie").
- **product-menu: custom accent hex `#F5F0E6` "did nothing" visually.**
  Not a bug — the `--accent` CSS variable *does* update correctly (confirmed
  via `getComputedStyle`), and the theme engine recomputes button text color
  for contrast: `rgb(245,240,230)` background with `rgb(10,10,10)` text
  measured at a 17.4:1 contrast ratio. The button only *looked* unchanged
  because the chosen color is close to the page's own cream background —
  an owner's color choice, not a rendering bug.
