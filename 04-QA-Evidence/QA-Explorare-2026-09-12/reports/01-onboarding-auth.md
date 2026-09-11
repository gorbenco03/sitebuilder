# Onboarding & Auth (primul contact, fără cont) — raport explorare

Server local pornit după modelul din `bot/test/delete-site-oracle.mjs` (HIDOOK_TEST_PAY=1,
HIDOOK_ISOLATED_DEPLOY=1, NODE_ENV=test, DATA_DIR temporar, `build-builder.js` + `startServer({port:0})`).
Navigare reală cu Playwright/Chromium (`node_modules/playwright`), 1440×900 și 390×844.
Scripturi: `probes/onboarding-auth.mjs`, `probes/onboarding-auth-part2.mjs`, `probes/preview-modal.mjs`.
Loguri brute: `probes/run.log`, `probes/run2.log`, `probes/run3.log`,
`probes/onboarding-auth-findings.json`, `probes/onboarding-auth-part2-findings.json`.

Acoperit:
- Landing `/app/` la 1440×900 și 390×844: cookie banner, nav (Designuri / Cum funcționează /
  Proiectele mele), hero CTA, secțiunea „Cum funcționează", grila de 5 designuri, overflow orizontal.
- Fiecare din cele 5 șabloane (product-menu, local-service, portfolio, professionals,
  desserdirina): click „Începe" → măsurat timp până la editor vizibil + conținut real în iframe;
  click „Previzualizare" pe un card → modal de previzualizare cu toggle desktop/mobil (testat pe portfolio).
- Login: `#dashboard` neautentificat → `#btn-dashboard-auth` → `#form-auth-email` → email gol,
  email invalid (`not-an-email`), email valid + dublu-click pe „Trimite", `#dev-link`, ajungere pe
  dashboard logat.
- Link de autentificare folosit a doua oară (context de browser nou, fără sesiune) — verificat mesajul.
- Deconectare (`#btn-logout`) și reconectare cu același email (magic link nou).
- Dashboard gol pentru cont nou (autentificat, 0 site-uri).
- Ciornă nesalvată (editare fără cont, prin banner-ul „Fă site-ul al tău în 20 de secunde") →
  autentificare → verificat dacă textul editat a rămas în editor.
- Reload pe `#templates`, `#cum-e`, `#dashboard`, `#edit` (mijlocul editorului, cu iframe încărcat).
- Consolă (`console`, `pageerror`, `requestfailed`) capturată pe tot parcursul de mai sus.
- Verificare țintă de atingere (bounding box) pe mobil pentru butoane cheie din fluxul de auth.

Neacoperit (nu ține de zona mea / nu am apucat):
- Fluxul de plată/publicare efectivă (checkout, `#btn-pay-publish`) — e zona altui agent; l-am
  atins doar cât să declanșez auth-ul din publish, nu l-am testat exhaustiv.
- Calendarul nativ (`professionals`) și fluxul Telegram — explicit excluse din briefing.
- „Deconectare de pe toate dispozitivele" (`#account-menu-logout-all`) — nu am apucat.
- Conflict multi-tab pe aceeași ciornă (semnalat în cod la `builder/app.js` ~1476) — nu l-am provocat.
- Alte browsere în afară de Chromium (Playwright); Safari/Firefox nu au fost testate.
- Livrare reală de email (am folosit doar `#dev-link`, vizibil în `NODE_ENV=test`).

## DEFECTE (observate, cu dovadă)

### D1. Modalul de autentificare din dashboard spune „Autentifică-te ca să publici", deși userul nu publică nimic
- Severitate: minor
- Unde: `#dashboard` neautentificat → buton „Autentificare"
- Pași:
  1. Vizitator nou, fără cont, merge direct pe `/app/#dashboard`.
  2. Vede „Autentifică-te ca să vezi proiectele." + buton „Autentificare".
  3. Apasă „Autentificare".
- Observat: se deschide modalul de auth cu titlul fix „Autentifică-te ca să publici" — copy
  gândit pentru fluxul de publicare, reutilizat neschimbat și pentru intrarea din dashboard.
- Așteptat: titlu neutru sau contextual (ex. „Autentifică-te" / „Autentifică-te ca să-ți vezi
  proiectele"), pentru că userul nu a cerut să publice nimic — poate fi confuz („de ce zice
  publică, eu doar voiam să văd contul meu?").
- Dovadă: screenshot `shots/auth-03-empty-email-error.png` (desktop) și
  `shots/part2-mobile-02-email-form.png` (mobil 390×844) — ambele arată titlul „Autentifică-te ca
  să publici" deschis din butonul de dashboard.
- Indiciu cod: `builder/index.html:483` — `<h2 class="modal-title">Autentifică-te ca să
  publici</h2>` e text static în markup, unic pentru `#publish-step-2`; `builder/app.js:5483-5498`
  (`wireDashboardAuthButton`) doar arată/ascunde formularul (`show($('form-auth-email'))`, etc.),
  nu schimbă niciodată titlul — deci același `<h2>` static apare indiferent de unde a fost
  deschis modalul.

### D2. Fonturile proprii ale șablonului „Desserdirina" nu se încarcă niciodată în previzualizarea din editor (CORS)
- Severitate: minor (nu afectează site-ul publicat, doar previzualizarea live din editor)
- Unde: editor, șablonul Desserdirina (id intern `desserdirina`, categoria „Cofetărie")
- Pași:
  1. De pe landing, alege designul „Desserdirina" → „Începe".
  2. Așteaptă editorul (iframe `#preview-iframe` vizibil).
- Observat: consola browserului arată 10 erori CORS + `net::ERR_FAILED`, de exemplu:
  `Access to font at 'http://127.0.0.1:PORT/app/fonts/montserrat-400-normal-latin.woff2' from
  origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is
  present on the requested resource.` — pentru toate cele ~10 fișiere `.woff2` (Montserrat +
  Cormorant Garamond, normal/italic/latin/latin-ext). Niciunul dintre celelalte 4 șabloane
  (product-menu, local-service, portfolio, professionals) nu are aceste erori — ele nu folosesc
  fonturi proprii (`@font-face`), deci nu declanșează verificarea CORS.
- Cauză tehnică verificată: `#preview-iframe` din `builder/index.html` are
  `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"` — fără
  `allow-same-origin`, deci conținutul iframe-ului rulează cu origine opacă („null"), chiar dacă
  fișierele vin de pe același server. Fonturile necesită mereu mod CORS la fetch (spre deosebire
  de imagini/CSS), iar `serveStatic`/`sendCachedFile` din `bot/server.js` (secțiunea „Static file
  serving — /app/*”, ~linia 1153 și în jos) nu adaugă niciun header `Access-Control-Allow-Origin`
  pe răspunsurile pentru `/app/fonts/*.woff2` → browserul blochează fontul.
- Efect vizibil: proprietarul de afacere editează „Desserdirina" și vede titlul/textele randate cu
  fontul de rezervă al sistemului, nu cu Cormorant Garamond/Montserrat cum arată de fapt designul
  — un decalaj între ce vede în editor și ce va vedea vizitatorul real (fonturile s-ar încărca
  normal pe site-ul publicat, care nu mai e într-un iframe sandbox).
- Așteptat: fonturile self-hosted să se încarce și în previzualizarea din editor, ca previzualizarea
  să fie fidelă.
- Dovadă: `probes/onboarding-auth-findings.json`, secțiunea `console`, intrările tag
  `template-desserdirina` (10× `error` CORS + 10× `requestfailed`); screenshot
  `shots/template-desserdirina-01-editor-open.png` (titlul „Desserdirina” randat cu fontul de
  rezervă, nu cu serif-ul Cormorant Garamond din design).
- Indiciu cod: `templates/desserdirina/styles.css` (singurul șablon cu `@font-face` +
  `/fonts/*.woff2`), `builder/index.html` (atributul `sandbox` pe `#preview-iframe`),
  `bot/server.js` (funcția `serveStatic`, fără header CORS pe fișierele din `/app/*`).

Nu am găsit alte defecte în zona mea: zero `pageerror` (excepții JS) pe tot parcursul; niciun
overflow orizontal pe mobil (390×844) pe landing, grila de șabloane sau fluxul de auth; toate
mesajele de eroare din formularul de email sunt în română, clare și corecte (`Introdu adresa de
email.` / `Introdu o adresă de email validă.`); dublu-click pe „Trimite linkul pe email" a produs
un singur email/link de auth (nu un race/duplicat — verificat în log-ul serverului,
`probes/run.log` linia 30 vs 40: un singur `email.magic_link.dev` per acțiune reală); refolosirea
unui link de autentificare deja folosit arată clar „Linkul de autentificare a expirat. Încearcă
din nou." (screenshot `shots/auth-07-reused-magic-link.png`); reload pe orice hash (`#templates`,
`#cum-e`, `#dashboard`, `#edit` cu iframe încărcat) păstrează exact locul unde era userul.

## SUGESTII (nu sunt defecte; ar face diferența)

- S1. Pentru D1: titlul modalului de auth ar putea fi setat dinamic în `wireDashboardAuthButton()`
  (un `textContent` pe `<h2 class="modal-title">` chiar înainte de `openModal('modal-publish')`),
  la fel cum restul funcției deja manipulează vizibilitatea formularului — fix mic, izolat.
- S2. Pentru D2: fie adaugă `Access-Control-Allow-Origin: *` pe răspunsurile statice pentru
  `/app/fonts/*` (sigur, pentru că sunt fonturi publice, nu date sensibile), fie adaugă
  `allow-same-origin` la `sandbox`-ul iframe-ului de previzualizare dacă riscul de securitate e
  acceptabil — a doua opțiune are implicații mai largi și ar trebui evaluată separat.
- S3. Fluxul de „Previzualizare" din grila de șabloane (buton separat de „Începe") e rapid (~1s
  măsurat) și clar — device toggle desktop/mobil funcționează bine; merită păstrat vizibil ca atare
  pentru clienți nesiguri care vor să vadă înainte să se angajeze la editare.
- S4. După deconectare, userul ajunge pe landing (`#templates`), nu înapoi pe `#dashboard` — e o
  alegere rezonabilă (Playwright a confirmat mesajul „Te-ai deconectat.” e clar), dar dacă owner-ul
  vrea un flux „reconectare rapidă”, l-ar putea aduce înapoi pe `#dashboard` cu butonul de
  autentificare deja vizibil.

## VERIFICĂRI CERUTE — status

1. Landing-ul `/app/`: cookie banner, „Cum funcționează”, „Designuri”, „Alege un design”, texte
   clare, butoane funcționale, overlap pe mobil.
   → CONFIRMAT ca funcțional și curat. Cookie banner apare corect (`#hb-cookie-banner`), „Acceptă”
   îl închide (persistă via localStorage+cookie). Nav-ul (`Designuri`/`Cum funcționează`/„Proiectele
   mele” ascuns până la login) funcționează. Hero CTA (`#hero-cta`) și CTA din header
   (`#header-cta`, ascuns intenționat sub 640px — confirmat în `builder/app.css` liniile ~220-227,
   306-308, nu e bug) duc corect la grila de 5 designuri. Niciun overflow orizontal la 390px
   (`scrollWidth === clientWidth` măsurat pe fiecare ecran). Cookie banner pe mobil are butonul
   „Acceptă” de 44×94px (respectă ținta minimă de atingere). Dovadă: `shots/landing-*.png`.

2. Fiecare din cele 5 șabloane → preview sau editor direct, timp până utilizabil.
   → CONFIRMAT: „Începe” duce direct în editor (nu doar preview), cu conținut real randat în
   iframe. Timpi măsurați (click → `#preview-iframe` vizibil + stabil, headless Chromium local):
   product-menu 729ms, local-service 729ms, portfolio 838ms, professionals 1366ms, desserdirina
   1359ms. Toate sub 1.4s — rapid. Fiecare șablon are și buton separat „Previzualizare” (verificat
   pe portfolio/„Salon”): deschide un modal de previzualizare cu toggle desktop/mobil în ~1s,
   Escape îl închide corect. Dovadă: `probes/onboarding-auth-findings.json` → `timings`;
   `shots/template-*-01-editor-open.png`; `shots/preview-modal-*.png`.

3. Fluxul de login fără cont → `#dashboard` → `#btn-dashboard-auth` → email → magic link →
   dashboard; email invalid, gol, dublu-click, link folosit de două ori, deconectare/reconectare;
   mesaje în română inteligibile.
   → CONFIRMAT, cu o observație (D1 mai sus): fluxul complet funcționează cap-coadă. Email gol →
   „Introdu adresa de email.”; email invalid → „Introdu o adresă de email validă.”; dublu-click pe
   „Trimite” → un singur link/email generat (fără duplicare); `#dev-link` → autentificare reușită,
   `#dashboard` afișat cu marcaj de logat (`#btn-logout`); link reused (context de browser nou) →
   toast clar „Linkul de autentificare a expirat. Încearcă din nou.”; logout → toast „Te-ai
   deconectat.”, revenire la landing; reconectare cu același email → magic link nou, generat corect
   (token diferit), acces la dashboard restaurat. Singurul aspect discutabil e titlul modalului
   (D1). Dovadă: `shots/auth-*.png`, `shots/part2-*.png`, `probes/run.log`/`run2.log`.

4. Dashboard gol (utilizator nou): ce vede, e clar ce trebuie să facă.
   → CONFIRMAT clar. `#sites-list` afișează: icon 📋 + „Nu ai creat încă niciun site.” + buton
   „Creează primul site” → `#templates`. Simplu și fără ambiguitate. Dovadă: notă din
   `onboarding-auth-findings.json` (`Dashboard #sites-list innerHTML`).

5. Ciornă nesalvată: editează fără cont, apoi login — se păstrează?
   → CONFIRMAT că se păstrează. Am editat numele afacerii prin banner-ul „Fă site-ul al tău în 20
   de secunde” (`#quickstart-name` + „Aplică”) fără cont, am verificat că `localStorage['hb.draft.v1']`
   conținea textul editat, apoi m-am autentificat prin `#btn-dashboard-auth` și am revenit pe
   `#edit` — textul editat era încă acolo, randat în iframe. Dovadă: notele
   „localStorage hb.draft.v1 present before login… contains edited name: true” și „Draft edit […]
   preserved in editor after login: true” din `onboarding-auth-findings.json`; screenshot-uri
   `shots/draft-01-edited-no-account.png`, `shots/draft-03-edit-after-login.png`.

6. Reload pe fiecare pagină/hash: rămâne unde era?
   → CONFIRMAT pentru toate hash-urile testate: `#templates`, `#cum-e`, `#dashboard`, și — cel mai
   sensibil — `#edit` cu editorul deja încărcat (iframe cu conținut). După reload, URL-ul rămâne
   identic și `#preview-iframe` e din nou vizibil. Dovadă: notele „Reload on #hash: … match=true”
   din `onboarding-auth-findings.json`; screenshot-uri `shots/reload-hash-*.png`.

7. Consola: orice eroare/warning pe pașii de mai sus.
   → Zero excepții JS (`pageerror`) pe tot parcursul explorării. Singurele erori de consolă
   observate: (a) `401 Unauthorized` la fiecare încărcare de pagină — provine din verificarea
   normală „cine sunt eu” (`GET /api/me`, cf. comentariul din `bot/server.js:22`) când userul nu e
   logat încă; e gestionat corect de aplicație (nu produce nimic vizibil stricat), doar zgomot în
   consolă — l-aș considera cosmetic, nu defect. (b) cele 10 erori CORS pe fonturile Desserdirina
   → raportate ca D2 mai sus, cu dovadă separată.
