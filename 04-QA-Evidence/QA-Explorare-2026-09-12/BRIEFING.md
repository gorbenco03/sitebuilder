# Briefing comun — explorare QA Hidook Site Builder (2026-09-12)

Ești un tester exploratoriu. Sarcina ta: să NAVIGHEZI efectiv prin partea ta din
produs, într-un browser real, și să raportezi ce ai VĂZUT — nu ce ai dedus din cod.

## Reguli absolute
1. **NU modifici nimic în repo.** Zero editări, zero commit, zero `git stash`. Ești
   read-only pe `/Users/Work/Desktop/sitebuilder`. Scripturile tale de probă le scrii
   NUMAI în directorul tău de scratch (vezi mai jos).
2. **NU atingi** `bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`.
3. **NU rulezi `npm test`** (durează 10+ minute și nu e treaba ta).
4. **NU folosești site-ul de producție** (`lp.hidook.agency`) și nu te loghezi nicăieri
   real. Pornești un server LOCAL, cu date temporare.
5. Raportezi doar ce ai observat. Fiecare defect are dovadă: un screenshot, o valoare
   măsurată, un mesaj de consolă, un răspuns HTTP. Fără dovadă → e „ipoteză", nu defect.

## Cum pornești produsul local (pattern verificat)
Toate oracolele din `bot/test/` fac la fel. Model de urmat, citește-l primul:
`bot/test/delete-site-oracle.mjs` (liniile 1–160: env, startServer, cookie banner,
login cu magic link prin `#dev-link`, dashboard). Elemente cheie:

```js
process.env.HIDOOK_TEST_PAY = '1';          // checkout offline, fără Stripe
process.env.HIDOOK_ISOLATED_DEPLOY = '1';   // publicare în $DATA_DIR/published/<slug>
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-'));
process.env.SERVER_SECRET = 'qa-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL; delete process.env.STRIPE_SECRET_KEY; delete process.env.VERCEL_TOKEN;
require(ROOT + '/scripts/build-builder.js');               // OBLIGATORIU înainte de server
const { startServer } = require(ROOT + '/bot/server.js');
const server = startServer({ port: 0 });                    // port liber, fără conflicte
// base = 'http://127.0.0.1:' + server.address().port
// Builder:   base + '/app/'      Dashboard: hash '#dashboard'
// Site live: base + '/live/<slug>/'
```
Playwright: `require(ROOT + '/node_modules/playwright').chromium` — NICIODATĂ un
Chrome/Brave hardcodat. Node: `node --experimental-sqlite script.mjs`.
Login: pe `#dashboard` apare `#btn-dashboard-auth` → `#input-email` → `#btn-send-magic`
→ `#dev-link` (link de dev, vizibil în NODE_ENV=test) → click → ești logat.
Cookie banner: `#hb-cookie-banner` → `#hb-cookie-accept`.

Șabloanele: `templates/{product-menu,local-service,portfolio,professionals,desserdirina}/`
(`template.html`, `styles.css`, `presets.json` cu `presets[0].config`, `schema.json`).

## Ce înseamnă „navighezi"
Faci ce ar face un client real: dai click, scrii, încarci, salvezi, reîncarci pagina,
te uiți dacă a rămas. La 1440×900 ȘI la 390×844 unde e relevant. Notezi consola
(`page.on('console')`, `page.on('pageerror')`, `page.on('requestfailed')`).
Măsori timpi când ceva pare lent (`performance.now()` înainte/după).
Faci screenshot la fiecare lucru ciudat: `<scratch>/shots/<area>-NN-<ce>.png`.

## Format raport — OBLIGATORIU, scris în `<scratch>/qa-reports/<area>.md`
```
# <Area> — raport explorare
Acoperit: <lista concretă a ce ai încercat, ~10-30 linii>
Neacoperit: <ce n-ai apucat / n-a mers să testezi și DE CE>

## DEFECTE (observate, cu dovadă)
### D1. <titlu scurt, concret>
- Severitate: blocker | major | minor      (blocker = clientul nu poate termina treaba)
- Unde: <șablon / ecran / element>
- Pași: 1. … 2. … 3. …
- Observat: <exact ce s-a întâmplat>
- Așteptat: <ce ar fi trebuit>
- Dovadă: <cale screenshot / valoare măsurată / mesaj consolă>
- Indiciu cod (opțional, doar dacă ai verificat): <fișier:linie>

## SUGESTII (nu sunt defecte; ar face diferența)
- S1. … (o linie, concret, cu de ce)

## VERIFICĂRI CERUTE (dacă briefing-ul tău are o listă): pentru fiecare → CONFIRMAT / INFIRMAT / NU AM PUTUT, cu dovadă
```
Fii concret și scurt. „Butonul X la 390px are 31px înălțime (măsurat), sub 44" e bine.
„UX-ul e cam slab" nu e nimic. Dacă nu găsești defecte într-o zonă, spune asta — e o
informație utilă, nu un eșec.

## Context produs (ca să știi ce cauți)
Hidook Site Builder: un constructor de site-uri de prezentare pentru afaceri mici din
România, 5 șabloane, editor vizual în browser, publicare pe hosting static, plată cu
trial 7 zile, calendar de programări nativ (doar professionals). Owner-ul (clientul
nostru) a zis: „site-ul are foarte multe lacune, undeva rulează greșit, bug-uri,
freeze-uri; trebuie să fie simplu și ușor dar funcțional cap-coadă, plus chestii care
fac diferența". Caută exact asta.
