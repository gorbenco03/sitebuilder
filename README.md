# DESSERD landing — template data-driven

Landing static, dar **decuplat de conținut**: tot ce e specific unui client stă în `config.json`,
iar pagina finală se generează din `template.html`. Asta e fundația produsului automatizat
(bot Telegram → agent AI → site).

## Fișiere

| Fișier | Rol |
|---|---|
| `config.json` | **Sursa unică de adevăr** — datele clientului (nume, texte, produse, poze, culori, contacte). Asta completează agentul AI. |
| `template.html` | Scheletul cu placeholdere `{{...}}` și blocuri `<!-- @each ... -->`. Se editează manual doar pentru a schimba designul. |
| `build.js` | Generează `index.html` din `template.html` + `config.json`. Zero dependențe. |
| `index.html` | **Generat** — nu se editează manual (se suprascrie la fiecare build). |
| `styles.css`, `script.js` | Stiluri și interacțiuni (comune tuturor clienților). |
| `images/` | Logo + poze locale ale clientului. |
| `bot/` | Bot Telegram + orchestrator AI + module de plată/deploy. |

## Schema config.json

Câmpurile cheie (toate obligatorii pentru build fără token-uri nerezolvate):

```jsonc
{
  "business": { "name", "tagline", "title", "metaDescription", "about", "lang" },
  "theme": { "primary", "primaryLight", "primaryDark", "cream" },
  "logo": "images/logo.jpg",
  "hero": { "background", "ctaLabel" },
  "servicesTitle": "string",
  "services": [ { "icon": "✦", "label": "string" } ],
  "galleryTitle": "string",          // ← titlul secțiunii galerie
  "categories": [                    // ← SCHEMA NOUĂ (înlocuiește câmpul plat „gallery")
    {
      "title": "string",             // titlul categoriei
      "blurb": "string",             // o propoziție descriptivă
      "photos": [
        { "src": "images/foto.jpg", "alt": "descriere" }
      ]
    }
  ],
  "instagram": { "handle", "url", "posts": [] },
  "contact": {
    "title", "intro",
    "instagram": { "url", "label" },
    "facebook":  { "url", "label" },
    "whatsapp": "44...",              // doar cifre cu prefix de țară
    "address": "string (HTML)"
  },
  "footer": { "address", "year", "note" }
}
```

### `categories` vs `gallery` (vechi)

Versiunea anterioară folosea un câmp plat `"gallery": [{ "src", "alt" }]`. Schema nouă grupează
pozele în **categorii** cu titlu și blurb. `build.js` iterează `categories` cu `@each categories`,
iar în interior iterează `photos` cu `@each photos` (loop-uri imbricate).

Botul produce întotdeauna `categories`. Dacă ai un `config.json` vechi cu `gallery`, rulează
`build.js` după ce l-ai migrat manual sau prin bot.

## Cum se generează site-ul

```bash
node build.js
```

Pentru un client nou: înlocuiești `config.json` + pozele din `images/`, rulezi `node build.js`,
și ai un `index.html` gata de publicat. Asta e exact pasul pe care îl automatizează agentul AI.

## Sintaxa template-ului

- `{{business.name}}` — valoarea de la calea respectivă din `config.json`.
- Blocuri repetabile simple:
  ```html
  <!-- @each services -->
    <li>{{icon}} {{label}}</li>
  <!-- @end -->
  ```
- Blocuri **imbricate** (ex: categorii → poze):
  ```html
  <!-- @each categories -->
    <h3>{{title}}</h3>
    <!-- @each photos -->
      <img src="{{src}}" alt="{{alt}}">
    <!-- @end -->
  <!-- @end -->
  ```
  Variabila din loop-ul interior (`{{src}}`, `{{alt}}`) se rezolvă pe elementul **intern**
  (photo), iar cea din loop-ul exterior (`{{title}}`) pe elementul **extern** (category).
- Pentru liste de string-uri (ex. `instagram.posts`) se folosește `{{.}}` pentru elementul însuși.

## Bot Telegram

Vezi `bot/README.md` pentru instrucțiuni complete de pornire, variabile de mediu și arhitectura fluxului SaaS.

```bash
cd bot && TELEGRAM_BOT_TOKEN=xxxxx npm start
```

## Preview local

```bash
node .claude/serve.js   # http://localhost:4173
```
