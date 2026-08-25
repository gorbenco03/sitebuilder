# Templates — Hidook Site Builder design systems

**Hidook Site Builder** ships four **design systems** under `templates/` (`product-menu`, `local-service`, `portfolio`, `professionals`). Each folder is a vertical template: HTML/CSS/JS plus `schema.json` / `presets.json` for the wizard. The professionals system includes a local appointment-*request* flow (no external calendar).

The **browser builder** is the commercial product (account, editor, pay, publish). **Telegram** is draft-intake that creates or opens the **same** draft in that editor — not a second product that publishes a live site by itself. Do not treat legacy bakery names (`desserdina` / DESSERD) or absolute machine paths as the product.

A filled `config.json` plus `build.js` produce a static site for local/dev assembly and the builder pipeline. Live production DNS / owner launch gates are out of scope here — see `PRODUCT.md`.

## Template folder structure

```
templates/
  registry.json              # list of all available templates
  <id-vertical>/
    template.html            # the HTML template with {{...}} tokens
    styles.css               # complete stylesheet (copied unmodified)
    script.js                # vanilla JS interactions (copied unmodified)
    collage.js               # drag-and-drop photo gallery (copied unmodified)
    schema.json              # field definitions for the wizard (browser + Telegram intake)
    presets.json             # 2 realistic demo configs for preview
```

### Files in a template

| File | Role |
|--------|-----|
| `template.html` | HTML with `{{key}}` tokens, `<!-- @each -->`, `<!-- @if -->` |
| `styles.css` | Complete CSS — color variables are injected via `<style>` in `<head>` |
| `script.js` | Defensive vanilla JS (each `init*` early-returns if its elements are missing) |
| `collage.js` | Drag-and-drop photo gallery + lightbox; works on any `.collage-deck` |
| `schema.json` | Contract for the wizard: fields, types, validation, labels in English |
| `presets.json` | Demo examples with complete config — preview in the builder / intake |

## The config.json contract

The pipeline produces exactly these keys; the template must consume them correctly:

```
business{ name, tagline, title, metaDescription, about, lang }
labels{ about, instaTitle, instaFollow, scroll, waQr, waOpen }
theme{ primary, primaryLight, primaryDark, cream }
logo               (image path or '')
showWordmark       (bool)
hero{ background, ctaLabel }
servicesTitle
services[{ icon, label }]
galleryTitle
categories[{ title, blurb, photos[{ src, alt }] }]
instagram{ handle, url, gallery[] }
contact{ title, intro, instagram{url,label}, facebook{url,label},
         whatsapp, phone, phoneDisplay, waHref, address, addressHref }
seo{ ogImage, jsonLd }
footer{ address, year, note }
```

### Template rules

- `{{a.b}}` — HTML-escaped value (safe for text and attributes)
- `{{& a.b}}` — RAW value, **ONLY** for trusted values: `hero.background`, `contact.address` (contains `<br>`), `seo.jsonLd` inside `<script type="application/ld+json">`
- `<!-- @each path -->...<!-- @end -->` — iterate over an array
- `<!-- @if path -->...<!-- @endif -->` — conditional block (truthy = non-empty string/array or truthy scalar); also works **inside tags** for conditional attributes
- Any optional field (`''` or `[]`) **must** be hidden with `@if` — zero dead links

## How to add a new vertical

1. Create `templates/<id-vertical>/`
2. Copy the base files as-is:
   ```bash
   cp templates/product-menu/template.html templates/<id>/template.html
   cp templates/product-menu/styles.css   templates/<id>/styles.css
   cp templates/product-menu/script.js    templates/<id>/script.js
   cp templates/product-menu/collage.js   templates/<id>/collage.js
   ```
3. Write `schema.json` — define the fields specific to the vertical (you can add extra keys beyond the standard contract, but they must be guarded with `@if` in the template)
4. Write `presets.json` — 2 realistic demo configs with natural English copy and local demo images under `images/` (no external stock placeholders)
5. Add the vertical to `templates/registry.json`

## schema.json format

```json
{
  "templateId": "<id>",
  "version": 1,
  "name": "<Name shown in the wizard>",
  "language": "en",
  "wizardHints": {
    "vertical": "<product-menu|local-service|portfolio>",
    "aiStyle": "<tone for AI polish>"
  },
  "sections": [
    {
      "id": "<section-id>",
      "title": "<Title shown in the wizard>",
      "fields": [
        {
          "key": "business.name",
          "type": "text|textarea|color|list|photos|phone|url",
          "label": "<The field label>",
          "required": true,
          "maxLen": 60
        }
      ]
    }
  ]
}
```

Supported field types: `text`, `textarea`, `color`, `list`, `photos`, `phone`, `url`.

For `list` fields with objects, add `"itemShape": { "key": "type", ... }`.

## presets.json format

```json
{
  "presets": [
    {
      "id": "<unique-slug>",
      "name": "<Demo business name>",
      "config": { /* COMPLETE config per the contract */ }
    }
  ]
}
```

- 2 presets per template, **realistic** demo businesses
- Natural, native-sounding copy (not lorem ipsum)
- Demo images live locally under `templates/<id>/images/` — no external stock placeholders (picsum/unsplash)
- `hero.background` can also be a CSS gradient: `"linear-gradient(135deg, #c8715a, #8b1a4a)"`

## Build and test command

From the **repository root** (repo-relative paths only — do not use machine-absolute Downloads paths):

```bash
# Static assemble with root build.js (local/dev; not a production DNS cutover)
node build.js

# Test a single template's preset:
# 1. Create a temp dir
TMPDIR=$(mktemp -d)

# 2. Copy the template files
cp templates/product-menu/template.html "$TMPDIR/"
cp templates/product-menu/styles.css    "$TMPDIR/"
cp templates/product-menu/script.js     "$TMPDIR/"
cp templates/product-menu/collage.js    "$TMPDIR/"

# 3. Extract the preset's config (e.g. preset index 0) and write it to the dir
node -e "
  const p = require('./templates/product-menu/presets.json');
  const fs = require('fs');
  fs.writeFileSync('$TMPDIR/config.json', JSON.stringify(p.presets[0].config, null, 2));
"

# 4. Run the build
node -e "const {build}=require('./build.js'); console.log(build('$TMPDIR'))"

# 5. Verify no unresolved tokens remain (should return 0)
grep -c '{{' "$TMPDIR/index.html"
```
