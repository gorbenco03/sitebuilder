# Templates — sistem multi-vertical

Fiecare folder din `templates/` reprezintă un **șablon** pentru o verticală de afaceri (product-menu, local-service, portfolio). Botul Telegram generează un `config.json` conform contractului, iar `build.js` produce un site static complet.

## Structura unui șablon

```
templates/
  registry.json              # lista tuturor șabloanelor disponibile
  <id-vertical>/
    template.html            # șablonul HTML cu tokeni {{...}}
    styles.css               # stiluri complete (se copiază nemodificat)
    script.js                # interacțiuni vanilla JS (se copiază nemodificat)
    collage.js               # galerie foto drag-and-drop (se copiază nemodificat)
    schema.json              # definția câmpurilor pentru wizard-ul botului
    presets.json             # 2 config-uri demo realiste pentru previzualizare
```

### Fișierele din șablon

| Fișier | Rol |
|--------|-----|
| `template.html` | HTML cu tokeni `{{cheie}}`, `<!-- @each -->`, `<!-- @if -->` |
| `styles.css` | Stiluri CSS complete — variabilele de culoare sunt injectate via `<style>` în `<head>` |
| `script.js` | JS vanilla defensiv (fiecare `init*` face early-return dacă elementele lipsesc) |
| `collage.js` | Galerie foto drag-and-drop + lightbox; funcționează pe orice deck `.collage-deck` |
| `schema.json` | Contract pentru botul Telegram: câmpuri, tipuri, validări, etichete în română |
| `presets.json` | Exemple demo cu config complet — folosite de bot pentru previzualizare |

## Contractul config.json

Botul produce exact aceste chei; șablonul trebuie să le consume corect:

```
business{ name, tagline, title, metaDescription, about, lang }
labels{ about, instaTitle, instaFollow, scroll, waQr, waOpen }
theme{ primary, primaryLight, primaryDark, cream }
logo               (cale imagine sau '')
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

### Reguli de template

- `{{a.b}}` — valoare HTML-escapată (sigur pentru text și atribute)
- `{{& a.b}}` — valoare RAW, **DOAR** pentru valori de încredere: `hero.background`, `contact.address` (conține `<br>`), `seo.jsonLd` în `<script type="application/ld+json">`
- `<!-- @each path -->...<!-- @end -->` — iterație peste un array
- `<!-- @if path -->...<!-- @endif -->` — bloc condiționat (truthy = string/array ne-gol sau scalar truthy); funcționează și **în interiorul tag-urilor** pentru atribute condiționate
- Orice câmp opțional (`''` sau `[]`) **trebuie** ascuns cu `@if` — zero linkuri moarte

## Cum adaugi o verticală nouă

1. Creează `templates/<id-vertical>/`
2. Copiază identic fișierele de bază:
   ```bash
   cp templates/product-menu/template.html templates/<id>/template.html
   cp templates/product-menu/styles.css   templates/<id>/styles.css
   cp templates/product-menu/script.js    templates/<id>/script.js
   cp templates/product-menu/collage.js   templates/<id>/collage.js
   ```
3. Scrie `schema.json` — definește câmpurile specifice verticalei (poți adăuga chei extra față de contractul standard, dar acestea trebuie gardate cu `@if` în template)
4. Scrie `presets.json` — 2 config-uri demo realiste cu texte românești naturale și imagini `picsum.photos/seed/<cuvant-unic>/1200/800`
5. Adaugă verticala în `templates/registry.json`

## Formatul schema.json

```json
{
  "templateId": "<id>",
  "version": 1,
  "name": "<Nume afișat în bot>",
  "language": "ro",
  "wizardHints": {
    "vertical": "<product-menu|local-service|portfolio>",
    "aiStyle": "<ton pentru polish AI>"
  },
  "sections": [
    {
      "id": "<id-sectiune>",
      "title": "<Titlu afișat în wizard>",
      "fields": [
        {
          "key": "business.name",
          "type": "text|textarea|color|list|photos|phone|url",
          "label": "<Întrebarea în română>",
          "required": true,
          "maxLen": 60
        }
      ]
    }
  ]
}
```

Tipuri de câmpuri suportate: `text`, `textarea`, `color`, `list`, `photos`, `phone`, `url`.

Pentru câmpuri de tip `list` cu obiecte, adaugă `"itemShape": { "cheie": "tip", ... }`.

## Formatul presets.json

```json
{
  "presets": [
    {
      "id": "<slug-unic>",
      "name": "<Numele afacerii demo>",
      "config": { /* config COMPLET conform contractului */ }
    }
  ]
}
```

- 2 presets per șablon, afaceri demo **realiste** din diaspora RO/MD
- Texte românești naturale (nu lorem ipsum)
- Imagini demo: `https://picsum.photos/seed/<cuvant-unic>/1200/800`
- `hero.background` poate fi și gradient CSS: `"linear-gradient(135deg, #c8715a, #8b1a4a)"`

## Comandă de build și testare

```bash
# Construiește site-ul principal (desserdina)
node /Users/kirill/Downloads/desserdirina/build.js

# Testează un preset al unui șablon:
# 1. Creează un dir temporar
TMPDIR=$(mktemp -d)

# 2. Copiază fișierele șablonului
cp templates/product-menu/template.html "$TMPDIR/"
cp templates/product-menu/styles.css    "$TMPDIR/"
cp templates/product-menu/script.js     "$TMPDIR/"
cp templates/product-menu/collage.js    "$TMPDIR/"

# 3. Extrage config-ul presetului (ex. preset index 0) și scrie-l în dir
node -e "
  const p = require('./templates/product-menu/presets.json');
  const fs = require('fs');
  fs.writeFileSync('$TMPDIR/config.json', JSON.stringify(p.presets[0].config, null, 2));
"

# 4. Rulează build
node -e "const {build}=require('./build.js'); console.log(build('$TMPDIR'))"

# 5. Verifică că nu au rămas tokeni nerezolvați (trebuie să returneze 0)
grep -c '{{' "$TMPDIR/index.html"
```
