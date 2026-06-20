# DESSERD site bot

Bot Telegram care generează automat un landing page pentru o afacere mică — prin conversație AI sau wizard pas cu pas.

## Flux SaaS (implicit când AI este configurat)

1. `/start` — Botul salută și invită clientul să descrie liber afacerea (text + poze).
2. **Chat AI** — La fiecare mesaj, botul apelează `ai.js → generateSiteConfig()`. Câtă vreme lipsesc informații cheie (nume, contact, poze), botul pune întrebări follow-up generate de AI.
3. Când config-ul e complet (nume + cel puțin un contact + cel puțin o poză), botul construiește site-ul local cu `build.js`.
4. **Domeniu** — Botul întreabă ce domeniu vrea clientul; verifică disponibilitatea via `domains.js`. Dacă e indisponibil, sugerează alternative.
5. **Plată** — Creează o sesiune Stripe Checkout (total = taxa platformă + prețul domeniului). Trimite link-ul clientului și monitorizează plata în background.
6. **Deploy** — După confirmare plată: cumpără domeniul (Vercel Domains API), publică site-ul (Vercel), atașează domeniul, returnează link-ul live.

## Modul wizard (fallback / `/wizard`)

Activat automat când `AI_PROVIDER=none` sau la comanda `/wizard`. Ghid pas cu pas:

1. Nume afacere
2. Slogan
3. Descriere (About us)
4. Produse / servicii
5. Instagram (sau „skip")
6. Facebook (sau „skip")
7. WhatsApp (sau „skip")
8. Adresă (sau „skip")
9. Logo (poză)
10. Galerie — 3-6 poze, finalizare cu `/gata`

La `/gata` botul construiește și publică (sau salvează local dacă nu sunt chei de deploy).

## Comenzi

| Comandă | Efect |
|---|---|
| `/start` | Pornește flux AI (sau wizard dacă AI_PROVIDER=none) |
| `/wizard` | Forțează modul wizard pas cu pas |
| `/gata` | Finalizează galeria în modul wizard |
| `/anuleaza` | Resetează sesiunea curentă |

## Pornire

```bash
cd bot
npm install      # o singură dată

# Minim (fără AI, fără deploy):
TELEGRAM_BOT_TOKEN=xxxxx npm start

# Cu AI Anthropic:
TELEGRAM_BOT_TOKEN=xxxxx AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... npm start

# Complet (AI + Stripe + Vercel):
TELEGRAM_BOT_TOKEN=xxxxx \
  AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... \
  STRIPE_SECRET_KEY=sk_live_... \
  VERCEL_TOKEN=... \
  BUILD_FEE_EUR=49 \
  npm start
```

## Variabile de mediu

### Obligatorie

| Variabilă | Descriere |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token de la @BotFather (`/newbot`) |

### AI (opțional — fără ele se folosește wizardul)

| Variabilă | Descriere |
|---|---|
| `AI_PROVIDER` | `anthropic` sau `openai` (default: `none`) |
| `ANTHROPIC_API_KEY` | Cheie API Anthropic (necesar când `AI_PROVIDER=anthropic`) |
| `OPENAI_API_KEY` | Cheie API OpenAI (necesar când `AI_PROVIDER=openai`) |
| `AI_MODEL` | Suprascrie modelul implicit (`claude-haiku-4-5-20251001` / `gpt-4o-mini`) |

### Plată (opțional — fără, plata e sărită)

| Variabilă | Descriere |
|---|---|
| `STRIPE_SECRET_KEY` | Cheie secretă Stripe (`sk_live_...` sau `sk_test_...`) |
| `BUILD_FEE_EUR` | Taxa platformă în EUR (default: `49`) |
| `BOT_USERNAME` | Username-ul botului (folosit în success/cancel URL Stripe) |

### Deploy (opțional — fără, site-ul e salvat doar local)

| Variabilă | Descriere |
|---|---|
| `VERCEL_TOKEN` | Token Vercel (activează deploy + cumpărare domenii) |
| `VERCEL_TEAM_ID` | ID echipă Vercel (opțional, necesar pentru conturi de echipă) |
| `NETLIFY_TOKEN` | Token Netlify — alternativă la Vercel pentru deploy (fără domenii) |

## Note tehnice

- **Fără nicio cheie** — botul funcționează complet: generează site-ul local în `../sites/<slug>/`, dar nu publică și nu cumpără domeniu.
- **Stripe polling** — Nu e nevoie de un endpoint public (webhook). `pollUntilPaid()` verifică sesiunea Stripe la fiecare 5 secunde, până la 15 minute.
- **Sesiuni** — în memorie; se pierd la restart. Extensibil la Redis / SQLite pentru producție.
- **Schema config** — Botul produce întotdeauna `categories` (nu `gallery` plat). Detalii în `../README.md`.

## Arhitectura fișierelor

```
bot/
  bot.js          — Instanțiere Bot + înregistrare handlers (wiring only)
  flow.js         — Mașina de stări + toată logica (orchestrator)
  ai.js           — Adapter AI (Anthropic / OpenAI / none)
  payments.js     — Stripe Checkout
  domains.js      — Vercel Domains API
  deploy-vercel.js — Deploy static site pe Vercel
  deploy.js       — Deploy pe Netlify (legacy fallback)
```
