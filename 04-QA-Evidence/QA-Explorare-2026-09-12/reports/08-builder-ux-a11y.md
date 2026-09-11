# Builder UX & Accesibilitate — raport explorare

Acoperit:
- Server local pornit conform pattern-ului din `bot/test/delete-site-oracle.mjs`
  (HIDOOK_TEST_PAY=1, HIDOOK_ISOLATED_DEPLOY=1, DATA_DIR temp, port 0), Playwright din
  `node_modules/playwright`, Node cu `--experimental-sqlite`.
- Inventar de texte vizibile: landing (hero, chips, how-section, footer), topbar editor
  (toate cele 15+ butoane/etichete), drawer de detalii (Salon/professionals/local-service/
  product-menu), toate cele 9 modale din `index.html` (publish, success, preview, versions,
  gallery, instagram, domain, invoices, delete-site) — text extras din DOM, nu din cod.
- Flux complet de publicare (portfolio, professionals, local-service) cu HIDOOK_TEST_PAY,
  ajuns pe dashboard cu site "Activ" și butoanele Editează/Anulează/Istoric/Domeniu/
  Facturi/Șterge/Configurează calendarul.
- Fiecare modal: deschidere prin trigger real (click), 25× Tab pentru capcană de focus,
  Esc, click în afara casetei (colț overlay), revenire focus la elementul declanșator.
  Testat pe: color-popover, modal-gallery, modal-instagram, modal-domain, modal-invoices,
  modal-delete-site.
- Modal Șterge definitiv: nume greșit → buton confirmare rămâne dezactivat (verificat
  `.isDisabled()`).
- Eroare de rețea reală în timpul salvării: `page.route('**/api/draft', abort)` în timp ce
  editam text în preview → stare "Nu s-a salvat" + buton "Reîncearcă"; am dat retry cât
  ruta era încă blocată (rămâne eroare, nu crapă), apoi am deblocat ruta și am dat retry
  din nou (revine la "Salvat").
- 500 simulat pe `/api/publish` (`route.fulfill(status:500)`) declanșat prin click real pe
  "Continuă cu această adresă" cu sesiune autentificată.
- Dublu-click / re-click rapid pe "Continuă cu această adresă" cu `/api/publish` întârziat
  artificial 800-1000ms (`route.continue()` cu delay), numărând efectiv câte cereri HTTP
  au plecat.
- Parcurgere completă doar din tastatură (Tab/Shift+Tab/Enter/Escape) de la
  `#skip-to-content`, prin toată bara de sus a editorului (20 de opriri Tab), verificând
  indicatorul de focus (`outline`/`box-shadow`) la fiecare oprire; activare "Culoare" cu
  Enter; editare de text în canvas (iframe) și confirmare de salvare — DOAR cu tastatura —
  urmată de `page.reload()` pentru a verifica persistența.
- Contrast măsurat programatic (WCAG relative luminance, din `getComputedStyle`, nu
  estimat vizual) pe: buton ghost din topbar, pastilă "Salvat"/"Nu s-a salvat", contor
  checklist ("17/24"), eticheta "Înapoi", placeholder câmp quickstart.
- 1280×720 (laptop mic): verificare overflow orizontal / elemente tăiate pe topbar,
  canvas, drawer.
- Eșec de rețea la pornirea unui șablon (`/generated/templates/portfolio.js` abortat) —
  verificat la 200/500/1000/1500/2500/3500/4500 ms ca să nu ratez fereastra toast-ului.
- Imagini blocate în preview (`**/template-assets/**` abortat) — verificat starea
  elementelor `<img>` (naturalWidth, complete, alt).
- Consolă (`console`, `pageerror`, `requestfailed`) monitorizată pe tot parcursul de mai
  sus.

Neacoperit:
- Vizualizarea mobilă (390×844) a builder-ului — în afara ariei mele explicite (1440×900
  + 1280×720); am văzut că alt agent are deja `10-mobile-builder-probe.mjs` în scratch.
- Modalul de versiuni (`modal-versions`) nu am reușit să-l redeschid cu un al doilea test
  dedicat (butonul se numește "Istoric", nu "Versiuni" — am folosit selectorul greșit
  inițial); din cod (`builder/app.js:7567`) el FACE parte din lista de Esc-închidere,
  deci comportamentul e cel corect (ca gallery/instagram), dar nu am captura de ecran
  proprie pentru el.
- Editorul Instafidget (feed Instagram) după conectare reală — necesită produsul partener,
  nu am mers dincolo de modalul de conectare.
- Nu am testat calendarul nativ (professionals) — e zona altui agent.
- Notă despre integritatea probelor: scratchpad-ul e comun mai multor agenți QA în
  paralel; scriptul meu inițial `probes/explore.mjs` a fost suprascris de alt agent în
  timpul sesiunii (fișier de sistem confirmă schimbarea). Rezultatele deja rulate au fost
  păstrate în acest raport din log-ul de execuție; pentru orice script scris după acel
  moment am folosit prefixul unic `wa08-` la capturi ca să evit coliziuni ulterioare.

## DEFECTE (observate, cu dovadă)

### D1. Esc nu închide 3 din cele 9 modale (Domeniu, Facturi, Șterge definitiv)
- Severitate: minor (există alternative funcționale: X și click în afara casetei), dar
  notabil pentru că una dintre cele trei e modalul de **ștergere definitivă** — exact
  locul unde utilizatorul vrea reflex să apese Esc ca să iasă rapid dintr-o acțiune
  ireversibilă.
- Unde: dashboard → orice site publicat → butoanele "Domeniu" / "Facturi" / "Șterge".
- Pași: 1. Publică un site (oricare șablon). 2. Pe dashboard, click "Domeniu" (sau
  "Facturi", sau "Șterge"). 3. Apasă Esc.
- Observat: modalul rămâne deschis. Pentru "Poze" și "Adaugă Instagram" (aceleași
  caracteristici de dialog — capcană de focus da, overlay-click da), Esc închide corect.
- Așteptat: Esc să închidă orice modal deschis, consecvent cu celelalte 6.
- Dovadă: rulare instrumentată — `[DEFECT] domain: Esc closes modal = false`,
  `[DEFECT] invoices: Esc closes modal = false`, `[DEFECT] delete-site: Esc closes modal
  = false`, în timp ce `[OK] gallery/instagram: Esc closes modal = true` în aceeași
  sesiune de test. Capcana de focus și click-în-afară au funcționat corect pentru toate
  cele 9.
- Indiciu cod: `builder/app.js:7565-7576` — handler-ul global de Escape are o listă
  hardcodată de id-uri:
  `['modal-publish','modal-preview','modal-success','modal-versions','modal-gallery','modal-instagram'].forEach(...)`
  — `modal-domain`, `modal-invoices` și `modal-delete-site` lipsesc din listă.

### D2. Re-click rapid pe "Continuă cu această adresă" poate trimite 2 cereri de publicare simultan
- Severitate: major — poate produce o cursă (race condition) la publicare/checkout dacă
  rețeaua e lentă exact în fereastra dintre click și dezactivarea butonului.
- Unde: editor → "Publică site-ul" → modal-publish, pas 1 (adresă site), utilizator deja
  autentificat.
- Pași: 1. Deschide modalul de publicare, completează adresa. 2. Interceptează
  `/api/publish` cu o întârziere artificială (rețea lentă reală ar produce aceeași
  fereastră). 3. Click pe "Continuă cu această adresă", apoi click din nou imediat
  (dublu-click / tap dublu pe mobil ar produce identic).
- Observat: butonul NU e dezactivat imediat după primul click (`isDisabled() === false`
  verificat programatic chiar după primul click) — dezactivarea (`setBtnLoading`) se
  întâmplă abia în `doActualPublish`, care e apelat DUPĂ un `await checkSlug(...)` din
  handler-ul de click (`builder/app.js:7463-7477`). Un al doilea click ajuns în acea
  fereastră pornește propriul apel independent către `doActualPublish`/`execPublish`.
  Rulare instrumentată: `/api/publish` a fost apelat de 2 ori pentru un singur "clic
  dublu" (`[DEFECT] Rapid re-clicks ... /api/publish called 2 time(s) (expected 1)`).
- Așteptat: al doilea click, oricât de rapid, să nu (mai) declanșeze o a doua cerere
  către server — de ex. un flag "publish în curs" verificat sincron la începutul
  handler-ului, înainte de orice `await`.
- Dovadă: log rulare (`wa08-phase3b-dblclick.mjs`) — `continueBtn disabled immediately
  after first click = false` + `/api/publish called 2 time(s)`.
- Indiciu cod: `builder/app.js:7461-7477` (handler `btn-publish-continue`) +
  `builder/app.js:5435-5454` (`doActualPublish` — `setBtnLoading` vine prea târziu față
  de primul `await` din handler).

### D3. Contrast insuficient pe pastila de stare a salvării ("Salvat" / "Nu s-a salvat")
- Severitate: minor (text informativ, nu o acțiune critică, dar vizibil constant cât timp
  editezi).
- Unde: bara de sus a editorului, `#save-status` (stânga butonului "Publică site-ul").
- Pași: 1. Editează orice text cât ești autentificat. 2. Așteaptă starea "Salvat" (verde)
  sau provoacă o eroare de rețea pentru starea "Nu s-a salvat" (roșu).
- Observat (măsurat cu formula WCAG din `getComputedStyle`, nu apreciat vizual):
  - Stare "Salvat": text `rgb(22,163,74)` pe fundal `rgb(220,252,231)`, 12.48px normal →
    **3.00:1** (prag necesar 4.5:1 pentru text normal <18px).
  - Stare "Nu s-a salvat" + link "Reîncearcă": text `rgb(220,38,38)` pe fundal
    `rgb(254,242,242)`, 12.48px → **4.41:1** (sub prag, dar la limită).
- Așteptat: minim 4.5:1 pentru text normal (WCAG 2.1 AA, 1.4.3).
- Dovadă: capturi `shots/wa08-netfail-01-save-error-state.png` (roșu) și
  `shots/wa08-netfail-02-save-recovered-state.png` (verde) + valorile calculate mai sus
  din `wa08-phase4-contrast-kbd.mjs` și `wa08-phase5-errorpill-contrast.mjs`.
- Indiciu cod: clasele `.save-status[data-state="saved"]` / `[data-state="error"]` din
  `builder/app.css` (culorile exacte de mai sus vin din regulile acelea).

## SUGESTII (nu sunt defecte; ar face diferența)
- S1. Fiecare încărcare a builder-ului de către un vizitator neautentificat produce o
  eroare 401 în consolă (`GET /api/me`) — de 1-4 ori pe sesiune, în funcție de câte
  ecrane vizitează. E un răspuns de stare normal (verifică dacă ești logat), dar apare ca
  "error" în DevTools și îngroapă erorile reale printre zgomot. Ar fi mai curat ca acel
  apel să fie tratat ca stare așteptată (ex. 401 ignorat explicit / non-error log) când
  userul nu e autentificat.
- S2. Toast-ul e un singur slot global (`#toast`, un singur element, `toastTimer` unic în
  `builder/app.js:143-151`) — un mesaj nou îl înlocuiește instant pe cel vechi, chiar
  dacă userul nu a apucat să-l citească. Nu e o suprapunere vizuală (deci nu bifează
  "se suprapun" din briefing), dar la acțiuni rapide consecutive (ex. salvare eșuată +
  altă acțiune imediat după) primul mesaj poate dispărea nevăzut. O coadă scurtă sau un
  minim de afișare per mesaj ar ajuta.

## VERIFICĂRI CERUTE — rezultate
1. Inventar texte (engleză rămasă / diacritice lipsă / inconsistențe / typo / trunchieri):
   NU AM GĂSIT nimic din categoriile astea în ce am acoperit (landing, topbar editor,
   drawer, toate cele 9 modale). Diacritice corecte peste tot verificat (`Șterge`,
   `Închide`, `Reîncearcă`, `Închide previzualizarea` etc.). Denumiri consecvente:
   "Poze" folosit peste tot (nu apare "Imagini" în paralel), "Publică site-ul" identic pe
   buton și în textul de succes, "Detalii" consecvent. Singurul text scurt găsit,
   `<span id="checklist-text">...</span>`, e doar un placeholder static suprascris
   instant de JS cu numărul real (ex. "25/32") — l-am văzut mereu populat corect în
   capturi, deci nu e un defect vizibil.
2. Toast-uri/mesaje provocate: CONFIRMAT — salvare reușită ("Salvat"), eroare de rețea la
   salvare ("Nu s-a salvat" + Reîncearcă), 500 simulat la publicare ("Publicarea a eșuat.
   Încearcă din nou."), eroare de încărcare șablon ("Nu am putut încărca designul.
   Încearcă din nou."). Toate clare, în română, cu acțiune de remediere unde are sens.
   Dispar singure (~3.5s) — vezi S2 pentru problema conexă (nu se suprapun, dar se pot
   înlocui prea repede).
3. Modale — Esc / click-în-afară / capcană de focus / revenire focus: 6 din 9 CONFIRMAT
   complet corecte (publish, success, preview*, versions*, gallery, instagram — *deduse
   din cod, aceeași listă ca gallery/instagram). 3 din 9 (domain, invoices, delete-site)
   INFIRMAT pentru Esc — vezi D1. Capcana de focus și revenirea focusului la elementul
   declanșator: CONFIRMAT pentru toate cele 6 testate direct (inclusiv cele 3 cu Esc
   stricat — click-în-afară și capcana funcționează perfect pe ele).
4. Tastatură completă (Tab/Shift+Tab/Enter/Space/săgeți): CONFIRMAT — se vede focusul pe
   fiecare element din topbar (0 din 20 opriri fără indicator vizual de focus), ordinea e
   logică (înapoi → cont → istoric → toggle desktop/mobil → checklist → Instagram →
   culoare → poze → detalii → HTML → ZIP → publică → câmpuri quickstart → iframe).
   Skip-link ("Sari la conținut") devine vizibil la focus — CONFIRMAT. Am editat text în
   canvas și am confirmat salvarea DOAR din tastatură (fără mouse), inclusiv persistență
   după `reload()` — CONFIRMAT.
5. Panouri editor la 1280×720: NU am găsit scroll orizontal sau elemente tăiate pe
   topbar/canvas/drawer la această rezoluție (verificat programatic
   `scrollWidth > innerWidth` + `getBoundingClientRect()` pe cele trei containere
   principale) — INFIRMAT (nu există problema la ce am verificat).
6. Stări de eroare (preview nu se încarcă / poză nu se încarcă / API 500 / loading):
   - Preview care nu se încarcă (fetch șablon abortat): CONFIRMAT feedback clar — toast
     roșu "Nu am putut încărca designul. Încearcă din nou." (am prins fereastra corectă
     de afișare — atenție, la o verificare superficială >3.5s după click, toast-ul pare
     "absent" pentru că s-a ascuns deja singur, nu pentru că lipsește).
   - Poză care nu se încarcă (`template-assets` blocat): imaginile rămân icoane sparte
     standard de browser (`naturalWidth:0`, `complete:false`), DAR au `alt` text descriptiv
     corect pe toate cele văzute — nu e un fallback vizual dedicat, dar nu e nici o gaură
     goală fără sens.
   - API 500 la publicare: CONFIRMAT — toast roșu clar "Publicarea a eșuat. Încearcă din
     nou.", userul rămâne pe pasul 1 al modalului, poate încerca din nou fără să
     reîncarce pagina.
   - Loading: există skeleton pentru preview (`#preview-skeleton`) și pentru cardurile de
     șabloane (`.card-skeleton`), plus overlay de spinner (`#preview-spinner-overlay`) —
     nu am observat pagină goală fără indicator în fluxurile testate.
7. Publică de două ori în timpul publicării: INFIRMAT pentru forma directă (butonul
   "Publică site-ul" din topbar doar deschide modalul, deci dublu-click pe el nu produce
   nimic dăunător), dar CONFIRMAT ca defect pe pasul următor, real, al fluxului — vezi D2
   (dublu-click pe "Continuă cu această adresă" poate trimite 2 cereri către
   `/api/publish`).
8. Contrast în builder: CONFIRMAT o problemă — pastila de stare a salvării, vezi D3
   (3.00:1 pe verde "Salvat", 4.41:1 pe roșu "Nu s-a salvat", ambele sub pragul de
   4.5:1). Restul măsurat (buton ghost topbar 6.33:1, "Înapoi" 7.08:1, contor checklist
   4.84:1, placeholder input 16.31:1) e peste prag — INFIRMAT pentru acele elemente.
9. Consolă (erori/warning-uri, schimbări de hash, deschidere panouri): peste tot ce am
   parcurs (landing, dashboard, editor, 9 modale, publicare completă x3, eșecuri de rețea
   simulate) singurele erori din consolă au fost 401 de la `/api/me` pentru
   utilizator neautentificat (comportament așteptat, vezi S1) și cele generate explicit
   de mine prin `page.route(...abort/500...)` pentru testele de reziliență. Nu am
   întâlnit erori JS neașteptate (`pageerror`) sau warning-uri în niciunul din fluxurile
   parcurse.
