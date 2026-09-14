# Explorare cont — owner de la zero + client plătitor recurent

Data: 2026-09-14. Explorator, nu fixer — niciun cod de produs, șablon, schemă sau test nu a fost
schimbat. Singurele modificări din acest raport sunt sub `04-QA-Evidence/Feedback-2026-09-14/explore-account/`.

## Notă despre `PLAN-FEEDBACK-2026-09-14.md`

Fișierul cerut în brief nu există în repo. Cel mai apropiat e `PLAN-FEEDBACK-2026-09-13.md`; Suita E
de acolo ("Programează-te online" fără formular) e despre calendarul de rezervări, nu despre
zona explorată aici, și e deja acoperită de commit-uri recente (`fc0f9d8`, `ab62aeb`, `83220ed`).
Am continuat cu scopul complet descris direct în task (SCOPE), care e self-contained.

`git log --since=2026-09-12 --oneline` verificat înainte de fiecare constatare — niciuna dintre cele
de mai jos nu atinge fișiere schimbate de commit-urile recente (portofoliu, desserdirina,
professionals, booking select contrast).

## Mediu local

- Server local, fără Stripe/Cloudflare/email reale: `HIDOOK_ISOLATED_DEPLOY=1 HIDOOK_TEST_PAY=1`,
  fără `STRIPE_SECRET_KEY`/`CLOUDFLARE_API_TOKEN`/`RESEND_API_KEY`, `DATA_DIR` temporar,
  `node --experimental-sqlite` (backend-ul sqlite din `bot/registry.js` cere flag-ul pe Node 23,
  altfel orice endpoint care atinge registry-ul cade cu 500 — nu e bug de produs, doar un pas de
  bootstrap absent din `scripts/flow2-local-server.js`).
- Trebuie rulat `node scripts/build-builder.js` înainte de orice testare locală — fără
  `builder/generated/` (engine.js, templates-data.js, thumbs) landing page-ul arată
  „Designurile nu sunt disponibile momentan.” Nu e bug, e un pas de build lipsă din pornirea locală.
- Viewport 1280×900 și 390×844, Chromium prin panoul de browser al agentului.
- Playwright era disponibil prin symlink-ul `node_modules` deja prezent în worktree, dar explorarea
  s-a făcut interactiv (browser pane) — evidența e text/JSON (DOM, `fetch`, network), nu PNG-uri
  persistate pe disc. Vezi `EVIDENCE.md` pentru excerptele exacte (console/network/DOM) pe fiecare
  constatare; nu există capturi .png comise (oricum ignorate de git).

## Sumar (severitate: blocker > major > minor > polish)

| ID | Severitate | Flow | Viewport | Rezumat |
|----|-----------|------|----------|---------|
| F1 | major | Landing / previzualizare design | 1280 | Modalul „Previzualizare” de pe landing rămâne blocat pe „Se încarcă previzualizarea…” la nesfârșit, pentru orice șablon — conținutul e randat corect în `srcdoc`, dar semnalul „ready” din iframe nu ajunge niciodată la părinte. |
| F2 | major | Plată / Facturi | 1280 | Pagina „Facturi” arată o factură de 99 € „plătită” chiar în ziua în care începe trialul de 7 zile, deși taxarea reală e abia în ziua 7 — nicio distincție vizuală între „programat” și „încasat”. |
| F3 | minor | Autentificare (email magic-link) | — | Emailul cu link-ul de autentificare (`bot/email.js`) e integral în engleză, singurul loc din produs care nu e în română. |
| F4 | minor | Plată / trial | 1280 | Butonul „Adaugă un card — începe trialul de 7 zile — 99€” alătură prețul direct de „începe trialul”, fără nicio mențiune „după trial” pe buton însuși (explicația e doar în paragraful de deasupra). |
| F5 | minor, unconfirmed | Dashboard / Șterge site | 1280 | Imediat după „Șterge definitiv” (confirmat corect, cu nume tastat), „Proiectele mele” arată un proiect nou cu exact același nume, ca ciornă — pare o ciornă locală re-apărută, nu situl șters, dar vizual poate părea că ștergerea n-a avut efect. |

Verificat și funcțional corect (fără constatări): sign-up cu magic link (fericit + email invalid +
token expirat/invalid — mesaje clare, în română), alegere șablon → editor fără cont, publicare cu
slug cu diacritice/spații/foarte lung (auto-simplificat/trunchiat corect, cu explicație), Istoric
(restaurare + toast de confirmare), Anulează (dezactivează imediat live-ul — am verificat 404 pe
`/live/<slug>/` — și marchează abonamentul „canceled”), Șterge (confirmare cu textul exact al
numelui sitului, copy clar despre ce se șterge ireversibil), Domeniu (validare format + mesaj clar
că nu poate continua fără o adresă Cloudflare reală — limită așteptată local), landing page la 390px
(fără overflow, lizibil).

Nu am apucat să acopăr (timp insuficient în această trecere): dashboard calendar nativ (activare,
servicii, staff, confirmare/anulare programare), un al doilea site neplătit, trial expirat, webhook
sosit de două ori prin UI (dedup-ul e verificat doar în cod), „opened in another browser”, editare →
republicare completă end-to-end, sesiune expirată în timpul editării.

---

## F1 — Modalul de previzualizare a designului nu se încarcă niciodată (major)

**Flow:** Landing page → „Designuri” → „Previzualizare” pe orice card de șablon.
**Viewport:** 1280×900 (desktop).
**Reprodus:** de 2 ori (modal închis și redeschis, al doilea click pe „Previzualizează Salon”).

**Pași:**
1. `http://127.0.0.1:54321/` (fără cont).
2. Click „Previzualizează” pe cardul „Salon”.
3. Modalul „Previzualizare: Salon” se deschide și arată „Se încarcă previzualizarea…”.

**Așteptat:** previzualizarea completă a șablonului (același conținut pe care editorul îl arată
după „Începe cu designul Salon”).

**Actual:** rămâne pe „Se încarcă previzualizarea…” la infinit — verificat cu așteptări cumulate de
peste 7-9 secunde, mult peste timerul intern de fallback de 2000ms din
`prepareInteractivePreviewDocument` (builder/app.js:2357-2385, funcția `arm()` la linia ~2382 trimite
semnalul de „ready” forțat după `n>80` iterații de 25ms = 2000ms indiferent de stare).

**Dovadă (DOM/JS, nu doar captură de ecran — vezi EVIDENCE.md pentru JSON complet):**
- `iframe.srcdoc.length === 110902` — conținutul șablonului Salon e efectiv prezent în iframe.
- `iframe.getAttribute('aria-busy') === 'true'` și clasa `preview-iframe--loading` rămân neschimbate
  la verificări repetate, la 1.5s, 4.5s și 7.5s după deschidere.
- Un listener global `window.addEventListener('message', ...)` atașat înainte de al doilea click nu
  a înregistrat NICIUN mesaj (`window.__hbMsgLog` gol) — semnalul `{type:'hb-preview-ready', token}}`
  din `prepareInteractivePreviewDocument` (builder/app.js:2372-2374) nu ajunge niciodată la părinte.
- Test de control: un `postMessage` dintr-un iframe `sandbox="allow-scripts"` minimal, în același tab,
  ajunge la părinte corect (confirmă că mediul de testare NU blochează `postMessage` din iframe-uri
  sandboxed — problema e reală, nu un artefact al uneltei de testare).
- Conținutul real din `srcdoc`-ul blocat, copiat într-un iframe NOU (`sandbox` identic), se randează
  instant și corect — deci conținutul și randarea HTML/CSS sunt intacte; doar handshake-ul
  „ready”/afișarea iframe-ului original din modal nu se finalizează niciodată.

**Responsabil (fără presupuneri, cod citit direct):**
`builder/app.js` — `prepareInteractivePreviewDocument()` (2357-2385), `waitForInteractivePreview()`
(2389-2415), `replacePreviewDocument()`/`openPreviewModal()` (~7260-7335); iframe-ul modalului e
`builder/index.html:572` (`id="preview-modal-iframe"`, `sandbox="allow-scripts allow-popups
allow-popups-to-escape-sandbox"`).

**De ce major:** previzualizarea de pe landing e funcția explicit promovată lângă fiecare card
(„Previzualizează”) — pentru un vizitator care nu vrea încă să intre în editor, e complet inutilizabilă,
pe orice șablon. Nu e blocker doar pentru că fluxul real de conversie („Începe cu designul X”) ocolește
acest modal și duce direct la un editor funcțional (verificat separat, cu conținut randat corect).

---

## F2 — „Facturi” arată o factură de 99 € în prima zi a trialului gratuit, înainte de taxare (major)

**Flow:** Alege design → editează → Publică → card de test → Proiectele mele → Facturi.
**Viewport:** 1280×900.
**Reprodus:** o dată prin UI, confirmat separat prin citirea codului server (`bot/webpublish.js`) —
mecanismul e determinist (nu depinde de timing), deci nu e nevoie de a doua trecere UI pentru
încredere.

**Pași:**
1. Alege șablonul Salon → „Publică site-ul” → adresă `atelier-ivoire` → autentificare cu magic link →
   „Adaugă un card — începe trialul de 7 zile — 99€” (checkout de test, fără Stripe real).
2. Modalul de succes confirmă: „Site-ul tău e live — trial de 7 zile început”.
3. Cardul din „Proiectele mele” spune corect: „Trial de 7 zile · prima taxare 99€ pe 21 septembrie
   2026” (7 zile de la 14 septembrie — corect).
4. Click „Facturi” pe același card, imediat, în aceeași sesiune, fără să treacă nicio zi.

**Așteptat:** fie lista e goală (nu s-a încasat încă nimic), fie arată clar un rând „programat” /
„se va taxa pe 21 septembrie 2026”, distinct vizual de o factură deja încasată.

**Actual:** lista arată deja `14 sept. 2026 — Publicare (primul an) — 99,00 EUR`, identic ca formă cu
orice factură plătită, fără niciun cuvânt sau etichetă „programat”/„pending”/„în așteptare”.
HTML exact (din `#invoices-list`):
```html
<div class="invoice-item">
  <div class="invoice-item-main">
    <span class="invoice-date">14 sept. 2026</span>
    <span class="invoice-kind">Publicare (primul an)</span>
  </div>
  <span class="invoice-amount">99,00&nbsp;EUR</span>
</div>
```
Niciun status/badge în marcaj — nimic care să spună „nu e încă încasat”.

**Cauza (citită direct în cod, nu presupusă):** `bot/webpublish.js`, `handleStripePaid()`
(liniile ~2036-2110). Funcția tratează identic două cazuri complet diferite din punct de vedere al
banilor:
```js
const paymentStatus = cs.payment_status;
if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') { ... return; }
...
ledger.append({ event: 'invoice', siteId, orderId, kind,
  invoiceId: ..., amountCents: order.amountCents, currency: order.currency });
```
`payment_status: 'no_payment_required'` e exact ce trimite Stripe la finalul unui Checkout Session
care doar salvează cardul pentru un abonament cu `trial_period_days` — NU s-a încasat nimic încă.
Comentariul din cod chiar recunoaște asta („Card-on-file success: immediate charge OR subscription
trial (no charge yet)”), dar tot scrie în ledger un rând `invoice` cu `amountCents` = prețul întreg,
identic cu cazul unei încasări reale (`payment_status: 'paid'`). `getInvoiceHistory()`
(`bot/webpublish.js:1046`) citește orice rând `invoice` din ledger fără să distingă cele două cazuri,
iar randarea din `builder/app.js:8265-8290` nu adaugă niciun status. Asta se întâmplă și cu Stripe
real, nu doar cu `HIDOOK_TEST_PAY` — nu e un artefact de mediu local.

**De ce major, nu doar minor:** e exact genul de ambiguitate legată de bani pe care task-ul cere să o
semnalăm explicit — un owner care tocmai a citit „ești taxat în ziua 7 dacă nu anulezi” și apoi
deschide „Facturi” și vede o „factură” de 99 € datată azi poate crede rezonabil că a fost taxat deja
în trial, ceea ce contrazice mesajul de încredere din restul produsului.

**Responsabil:** `bot/webpublish.js:2036-2110` (`handleStripePaid`), `bot/webpublish.js:1046`
(`getInvoiceHistory`), `builder/app.js:8265-8292` (randare `#invoices-list`), server-side
`bot/server.js:1831` / `handleSiteInvoices`.

---

## F3 — Emailul cu link-ul de autentificare e integral în engleză (minor)

**Flow:** Autentificare cu magic link (orice punct din produs care cere login).
**Viewport:** n/a (conținut email).

`bot/email.js`, `sendMagicLink()` — fără `RESEND_API_KEY` (dev/local) sau cu el (producție), textul
HTML e identic și 100% în engleză: subiect „Sign in to Hidook Site Builder”, corp „Click the button
below to sign in. This link is valid for 15 minutes.”, „If you didn't request this link, you can
safely ignore this email.” Restul produsului (landing, editor, toate mesajele de eroare/succes,
paginile legale, dashboard) e integral în română. `bot/test/email-brand.test.js` verifică doar
că textul conține „Hidook” și nu „DESSERD” — nimic despre limbă.

**De ce minor:** nu blochează nimic (link-ul funcționează, butonul e clar), dar e singurul punct de
contact scris în altă limbă decât restul produsului, pentru exact publicul țintă (afaceri mici din
România) descris în brief.

**Responsabil:** `bot/email.js:29-53`.

---

## F4 — Butonul de plată alătură prețul direct de „începe trialul”, fără calificativ pe buton (minor)

**Flow:** Publică → „Adaugă un card ca să fii live”.
**Viewport:** 1280×900.

Paragraful explicativ de deasupra butonului e corect și clar: „Adaugă un card ca să începi trialul de
7 zile. Site-ul e live imediat. Ești taxat în ziua 7 dacă nu anulezi. Apoi reînnoire 29€/an.” Dar
butonul însuși (`builder/index.html:534-535`, `id="btn-pay-publish"`) spune:

> Adaugă un card — începe trialul de 7 zile — **99€**

fără niciun „după trial” sau „în ziua 7” pe buton. Un utilizator care scanează doar CTA-ul (comportament
obișnuit) poate citi asta ca „apăs și plătesc 99€ acum”, nu „apăs, intru în trial gratuit, plătesc
peste 7 zile dacă nu anulez”.

**De ce minor, nu major:** paragraful de deasupra e suficient de clar și e imposibil de ratat vizual
(e direct deasupra butonului) — dar juxtapunerea rămâne o sursă plauzibilă de confuzie pe exact
tema pe care task-ul cere maximă claritate (bani).

**Responsabil:** `builder/index.html:534-535`.

---

## F5 — După ștergerea definitivă a unui site, apare un proiect nou cu același nume (minor, unconfirmed)

**Flow:** Proiectele mele → Șterge → tastează numele exact → „Șterge definitiv”.
**Viewport:** 1280×900.
**Reprodus:** o singură dată — marchez explicit „unconfirmed” conform regulii din task.

După ștergere, `GET /api/sites` confirmă corect că site-ul plătit vechi a dispărut (id vechi
`d6ca5621…` nu mai există) și `/live/atelier-ivoire/` dă 404 (ștergerea reală funcționează).
Dar „Proiectele mele” arată imediat un card nou, cu exact același nume „atelier-ivoire”, status
„draft”, `paid:false`, `id` complet diferit (`eac060d9…`), creat chiar în momentul ștergerii. Cel mai
probabil e o ciornă locală (localStorage) rămasă de la editarea anterioară care se re-sincronizează
cu contul la următorul render al dashboard-ului — deci datele reale (abonament, site live) chiar au
fost șterse ireversibil, exact cum promite dialogul. Dar vizual, imediat după un avertisment „această
acțiune este ireversibilă”, a vedea un proiect cu identic același nume în listă e genul de moment în
care un owner s-ar putea întreba, rezonabil, dacă ștergerea a funcționat cu adevărat.

**Responsabil (de investigat, nu confirmat):** logica de auto-sync a ciornei locale din
`builder/app.js` (draft persistat în `localStorage`, cheie unică globală — vezi comentariul din jurul
`startWithTemplate()`, linia ~7168 și `existingDraftForSwitch`) rulată la încărcarea dashboard-ului.

---

## Verificări pozitive (fără constatări, incluse pentru trasabilitate)

- **Sign-up cu magic link, fericit:** email valid → `Link trimis! Verifică inbox-ul.` → dev-link din
  `POST /api/auth/email` (`devLink` în răspuns, doar în non-producție) → `GET /auth/verify?token=...`
  autentifică, `GET /api/me` confirmă sesiunea (cookie HttpOnly — nu apare în `document.cookie`, cum
  trebuie).
- **Email invalid (`not-an-email`):** blocat client-side, „Introdu o adresă de email validă.”, fără
  request către server.
- **Token expirat/invalid:** `GET /auth/verify?token=garbage` redirecționează la
  `#login-expired`, banner „Linkul de autentificare a expirat. Încearcă din nou.” — mesaj corect, în
  română.
- **Alege design → editor fără cont:** funcționează, nu cere autentificare până la publicare (corect,
  conform modelului „editezi liber, plătești ca să publici”).
- **Slug cu diacritice/spații** (`Frizerie Ăâșț Nr.5!!`): auto-simplificat la `frizerie-aast-nr5`, cu
  explicație clară („Adresele web nu au spații sau diacritice — am simplificat-o în
  „frizerie-aast-nr5"."). **Slug foarte lung** (117 caractere): trunchiat client-side la 40 de
  caractere înainte de verificarea de disponibilitate (`/api/slug-check?slug=` cu exact 40 `a`-uri) —
  sub limita DNS de 63 caractere per label, deci fără risc de eșec la provisioning real.
  **Slug ocupat:** nu am ajuns să testez explicit (al doilea site cu același slug), dar `slug-check`
  răspunde `{available: true/false}` — mecanismul există.
- **Istoric:** afișează 4 versiuni cu timestamp, „Restabilește” funcționează, toast de confirmare
  „Versiunea a fost restabilită.”
- **Anulează:** `POST /api/sites/:id/billing-portal` → URL local (`#test-billing-portal=...`) →
  confirmă imediat „Abonamentul a fost anulat. Site-ul e ciornă.”; verificat direct prin API:
  `status` trece la `unpublished`, `url: null`, `subscriptionStatus: "canceled"`, `canceledAt` setat,
  iar `/live/atelier-ivoire/` dă efectiv 404 imediat — comportamentul de bază (taie live-ul, oprește
  facturarea) e corect. (Notă: click-ul din UI pe „Anulează” nu a declanșat vizibil cererea în prima
  încercare — posibil element stale după re-render-ul dashboard-ului de la modalele Domeniu/Facturi;
  apelul direct la endpoint a confirmat mecanismul serverului. Nu am avut timp să izolez dacă e o
  problemă reală de click-target în UI — semnalez ca notă, nu ca finding separat, fiindcă nu am
  reprodus-o intenționat de două ori.)
- **Șterge:** cere textul exact al numelui sitului, copy clar: „Această acțiune este ireversibilă: se
  șterge site-ul publicat, ciornele, domeniul propriu conectat și datele de programări.”
- **Domeniu:** format invalid → „Acesta nu pare a fi un domeniu valid. Exemplu corect: myshop.com sau
  afacereamea.ro.”; domeniu valid → „Nu am putut determina adresa Cloudflare a site-ului tău.
  Republică site-ul o dată și încearcă din nou.” — limită așteptată local (fără Cloudflare real în
  `HIDOOK_ISOLATED_DEPLOY`), mesaj corect și acționabil.
- **Landing la 390px:** fără overflow orizontal, text lizibil, butoanele „Continuă editarea”/„Renunță”
  din banner-ul de draft neterminat se văd complet.
- **Pagini legale** (`builder/privacy.html`, `terms.html`, `cookies.html` — cele servite efectiv de
  produs la `/app/privacy.html` etc.): complete, fără placeholder-uri, în română. (Notă: paginile de
  la rădăcina repo-ului — `privacy.html`, `terms.html`, `cookies.html` — conțin `[PLACEHOLDER: ...]`
  intenționat marcate, dar acelea sunt output-ul site-ului demo DESSERD construit de `npm run build`,
  nu pagini ale produsului Hidook; nu afectează un client real.)
- **Banner „Ai un proiect neterminat”:** apărut corect pentru o ciornă chiar neterminată/neplătită —
  nu am reprodus varianta cunoscută (banner pe un site plătit live), care e deja în lucru la altă
  sesiune.

## Fișiere/module atinse de constatări (fără schimbări făcute)

- `builder/app.js:2357-2415, 7260-7335` (F1)
- `builder/index.html:572` (F1), `builder/index.html:534-535` (F4)
- `bot/webpublish.js:1046, 2036-2110` (F2)
- `builder/app.js:8265-8292` (F2)
- `bot/email.js:29-53` (F3)
- `builder/app.js:7151` și logica de draft local (F5, neconfirmat)

Vezi `EVIDENCE.md` pentru excerptele JSON/console/network complete pe fiecare constatare.
