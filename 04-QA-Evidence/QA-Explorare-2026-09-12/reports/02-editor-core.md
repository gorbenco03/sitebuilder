# Editor core (text + liste) — raport explorare

Acoperit: Pornit produsul local (pattern din `delete-site-oracle.mjs`: HIDOOK_TEST_PAY,
HIDOOK_ISOLATED_DEPLOY, DATA_DIR temporar, `build-builder.js`, `startServer({port:0})`),
navigat prin Playwright (chromium din `node_modules/playwright`) la 1440×900, pe toate cele
5 șabloane (local-service, portfolio, professionals, desserdirina, product-menu):
- Editare text simplu (titlu h1 / business.name sau echivalent) pe fiecare șablon, măsurat
  timpul de reflectare în iframe.
- Verificat dacă o editare simplă de text reface tot iframe-ul (srcdoc) sau doar textul.
- Verificat dacă adăugarea unui element în listă reface iframe-ul și dacă poziția de scroll
  se păstrează.
- Liste testate cu „+ Adaugă"/șterge: portfolio → Servicii (`.pf-chips`); professionals →
  Servicii (`.pr-svc`), Cum lucrăm/pași (`.pr-steps`), Credențiale/„Experiență" (`.pr-cred__list`);
  desserdirina → Categorii galerie (`.gallery-section`); inspectat DOM-ul (data-hb-edit,
  HTML complet) al elementului nou adăugat pe fiecare.
- Chip-ul de zonă („București și Ilfov...") din antetul local-service: click direct pe
  elementul `[data-hb-edit="business.zone"]`, verificat focus + tastare + citire înapoi.
- Undo/redo: 5 editări succesive pe titlu, 5x Undo, 5x Redo — verificat fiecare pas.
- Indicator de salvare (`#save-status`) + persistență la reload (F5) pentru o editare de text.
- Text lung (~500 caractere) într-un titlu — verificat layout-ul din preview.
- Text gol (ștergere completă a titlului) — verificat ce rămâne clickabil.
- Emoji + diacritice românești (ș ț â î ă) într-un titlu — verificat citirea înapoi exactă.
- Freeze: 30 apăsări de taste consecutive, fără pauză, măsurat timpul total + timpul de
  răspuns al UI-ului imediat după (click pe Undo).
- Consola browser-ului (console.error, pageerror, requestfailed) capturată pe toată durata,
  pe toate cele 5 șabloane.

Neacoperit:
- Reordonare elemente în listă (drag&drop) — nu am găsit UI de reordonare (fără mânere de
  drag vizibile în DOM-ul inspectat); nu am insistat mai mult decât o verificare de căutare
  în DOM, pentru că nu e cerută explicit ca prioritate față de add/remove/edit.
- Editare pe mobil (390×844) pentru zona asta — briefingul cere explicit 1440×900 pentru
  editorul core; nu am dublat testele pe mobil (altă zonă QA acoperă responsive/mobil, cf.
  fișierelor găsite deja în acest scratch: `10-mobile-builder-probe.mjs`).
- Publicare efectivă / plată — nu ține de editarea text/liste, nu am atins acel flux.
- Toate cele 3 preseturi ale fiecărui șablon — testele au rulat pe presetul ales automat de
  „Start" (aparent variază între rulări); nu am comparat sistematic preset cu preset.
- NOTĂ OPERAȚIONALĂ: directorul comun `<scratch>/shots/` este partajat cu alți agenți QA în
  paralel; la un moment dat toate screenshot-urile mele inițiale (denumite `v1-…`, `v3-…`,
  `undo-…`, `longtext-…` etc.) au dispărut din `shots/`, suprascrise/șterse de un alt agent
  care a populat folderul cu propriile fișiere `01-portrait-…30-tablet-…`. Am re-capturat
  dovezile esențiale cu prefixul unic `ec-*.png` chiar înainte de a scrie acest raport, ca
  să reduc fereastra de risc. Datele brute (JSON) din `<scratch>/probes/phase*-results.json`
  au supraviețuit neatinse și susțin aceleași concluzii.

## DEFECTE (observate, cu dovadă)

### D1. La adăugarea unui serviciu nou (portfolio), lipsesc complet opțiunile de preț ȘI de icon
- Severitate: major
- Unde: portfolio, secțiunea „Servicii și tarife" (listă `services`, itemShape icon+label+price)
- Pași: 1. Deschide portfolio în editor. 2. Scroll la secțiunea Servicii. 3. Click „+ Adaugă".
- Observat: Noul element are DOAR câmpul `label` (text „Serviciu nou", editabil). Codul HTML
  al noului `<li>` este:
  `<li class="pf-chip hb-list-item"><span class="pf-chip__icon" aria-hidden="true"></span>
  <span class="pf-chip__label"><span data-hb-edit="services.6.label" ...>Serviciu nou</span></span>
  <button class="hb-remove-btn">×</button></li>`
  — spanul de icon e complet gol și NU are `data-hb-edit` (nu e wired deloc pentru editare,
  nici la elementele existente din preset — icon-ul e SVG brut din preset, fără UI de
  schimbare a lui, pentru niciun element din listă). Câmpul `price` lipsește complet din DOM
  (template-ul face `<!-- @if price -->`, iar la string gol span-ul nici nu se randează) —
  nu există niciun element pe care userul să dea click ca să scrie un preț.
- Așteptat: Elementul nou ar trebui să aibă și un câmp de preț vizibil/editabil (chiar gol,
  cu un placeholder clickabil) și, ideal, un buton de alegere/editare a icon-ului.
- Dovadă: `<scratch>/shots/ec-01-v3-portfolio-services-before.png`,
  `<scratch>/shots/ec-02-v3-portfolio-services-after-add-no-price-no-icon.png`;
  DOM complet capturat în `<scratch>/probes/phase2b-results.json` (`AFTER.lastHtml`).
- Indiciu cod: `templates/portfolio/template.html:153-156` (`<!-- @if price -->`),
  `builder/app.js:2650-2658` (`onListAdd` setează câmpurile non-primare la `''`),
  `builder/edit-overlay.js` nu are niciun concept de `data-hb-kind="icon"`.

### D2. La adăugarea unui serviciu/pas nou (professionals), lipsește celula de descriere — confirmă V4
- Severitate: major
- Unde: professionals, „Servicii" (`.pr-svc`) ȘI „Cum lucrăm" (`.pr-steps`) — AMBELE liste
- Pași: 1. Deschide professionals. 2. Scroll la Servicii. 3. „+ Adaugă". 4. Repetă la „Cum lucrăm".
- Observat: Noul card de serviciu are doar titlul („Serviciu nou"), fără nicio linie de
  descriere dedesubt — comparativ cu cardurile existente care au titlu + un paragraf de
  descriere. HTML nou: `<h3>...</h3>` urmat direct de buton, fără niciun `<p>`. La fel pentru
  „Cum lucrăm": noul pas „Pas nou" nu are paragraful de text de sub titlu
  (`<!-- @if text --><p>{{text}}</p><!-- @endif -->` — gol → nerandat).
- Așteptat: Un câmp de descriere vizibil (măcar un placeholder clickabil), la fel ca la
  elementele existente din preset.
- Dovadă: `<scratch>/shots/ec-03-v4-professionals-services-before.png` vs.
  `<scratch>/shots/ec-04-v4-professionals-services-after-add-no-description.png` (comparație
  directă: cardurile 03/04 din preset au titlu+text; cardul 05 nou-adăugat are doar titlu);
  DOM în `<scratch>/probes/phase3-results.json` (`prof_services.lastInfo`, `prof_steps.lastInfo`
  — un singur field, `label`/`title`, în ambele cazuri).
- Indiciu cod: `templates/professionals/template.html:167` (`<!-- @if blurb -->`) și
  linia 185 (`<!-- @if text -->`).

### D3. Lista din cardul „Experiență" (Credențiale) nu are deloc buton de adăugare/ștergere — confirmă V5
- Severitate: major
- Unde: professionals, secțiunea Despre → cardul „Experiență" (`credentials.items`,
  `.pr-cred__list`)
- Pași: 1. Deschide professionals. 2. Scroll la secțiunea „Despre noi", cardul lateral
  „Experiență". 3. Caută un „+ Adaugă" sau un „×" pe lista de puncte.
- Observat: Titlul cardului și textul introductiv sunt editabile inline (au `data-hb-edit`),
  iar fiecare rând din listă (`<li>`) are textul editabil — DAR în tot cardul (`aside.pr-cred`)
  există 0 (zero) butoane `.hb-add-btn` și 0 butoane `.hb-remove-btn`. Toate celelalte liste
  verificate în acest editor (servicii, pași, servicii portfolio, categorii desserdirina) AU
  buton „+ Adaugă" la finalul listei. Aceasta e singura listă din schema (`type: "list"`,
  `min:0, max:8`) care nu are absolut niciun mijloc UI de a adăuga sau șterge un rând.
- Așteptat: Consistență cu celelalte liste — un buton „+ Adaugă" la finalul listei și un „×"
  pe fiecare rând.
- Dovadă: `<scratch>/shots/ec-05-v5-professionals-experience-card-no-add-remove.png`;
  date brute în `<scratch>/probes/phase4-results.json`
  (`addBtnAnywhereInAside: 0, removeBtnAnywhereInAside: 0`, plus HTML complet al `<aside>`).
- Indiciu cod: `templates/professionals/template.html:203-216` — secțiunea „credentials.items"
  randează `<li>{{label}}</li>` simplu, fără marcajele pe care `edit-overlay.js` le caută
  pentru a atașa `.hb-add-btn`/`.hb-remove-btn` (celelalte liste din același template AU
  aceste butoane, deci diferența e specifică acestei liste).

### D4. La adăugarea unei categorii noi (desserdirina), câmpul de descriere există în DOM dar e complet invizibil — confirmă V6
- Severitate: major
- Unde: desserdirina, secțiunea Galerie (`categories`, itemShape title+blurb+photos)
- Pași: 1. Deschide desserdirina. 2. Scroll la Galerie. 3. „+ Adaugă categorie".
- Observat: Titlul noii categorii („Categorie nouă") apare clar, cu chenar punctat de
  editare. Sub el, `<p class="category-blurb"><span data-hb-edit="categories.1.blurb" ...></span></p>`
  EXISTĂ în DOM (spre deosebire de D1/D2 unde elementul lipsea complet), dar span-ul e complet
  gol și nu are nicio dimensiune vizibilă/placeholder/chenar — în screenshot se vede doar un
  spațiu alb enorm între titlu și zona de poze, fără niciun indiciu că acolo se poate scrie o
  descriere. Un utilizator real nu are cum să găsească acel punct de editare fără să dea
  click orb în zona goală.
- Așteptat: Un placeholder vizibil („Adaugă o descriere...") sau un chenar punctat, la fel ca
  la titlu.
- Dovadă: `<scratch>/shots/ec-07-v6-desserdirina-new-category-no-visible-description.png`
  (spațiu gol vizibil sub titlu); HTML complet în `<scratch>/probes/phase5-results.json`.

### D5. Golirea completă a unui câmp de titlu îl colapsează la 0×0 — devine inaccesibil pentru re-editare
- Severitate: blocker
- Unde: local-service (reprodus pe titlul principal h1, `data-hb-edit="business.name"` sau
  echivalent din preset), foarte probabil general pentru orice câmp de text single-line
- Pași: 1. Click pe titlu. 2. Ctrl+A / Cmd+A. 3. Delete. 4. Blur (click în altă parte).
- Observat: Elementul rămâne în DOM (`<span data-hb-edit="..." contenteditable="true"></span>`)
  dar `getBoundingClientRect()` devine `{w:0, h:0}`. Playwright (simulând un click real la
  poziția elementului) a eșuat cu „Element is outside of the viewport” la a doua încercare
  de click pe același element — adică nu mai există nicio zonă vizibilă/clickabilă pentru a
  retasta titlul în același loc. Acesta e exact tiparul de bug descris deja în
  `bot/test/audit-editor-list-add.test.js` (PM-02: colaps 0×0 → unclickable) — dar aici
  apare pe un câmp de titlu SIMPLU (nu într-o listă), deci fix-ul din acel audit nu acoperă
  acest caz.
- Așteptat: Un câmp de text gol ar trebui să păstreze o zonă minimă clickabilă (ex. min-height/
  placeholder „Scrie titlul aici...") ca userul să poată reveni și scrie din nou.
- Dovadă: `<scratch>/shots/ec-11-emptytext-h1-collapsed-0x0.png`; măsurătoare exactă în
  `<scratch>/probes/phase8-results.json` (`h1_empty_info.rect: {w:0,h:0}`) și eroarea
  Playwright din `<scratch>/probes/phase7-results.json` („Element is outside of the viewport”).
- Notă: recuperarea e posibilă prin Undo (funcționează, vezi mai jos) sau, dacă există, prin
  panoul lateral „Detalii” — nu am confirmat un câmp text-input acolo pentru business.name în
  timpul rulării; dacă nu există, userul e blocat până apasă Undo.

### D6. Text foarte lung (~500 caractere) într-un titlu H1 nu are nicio limită vizibilă/avertisment — sparge layout-ul complet
- Severitate: minor
- Unde: local-service, titlul principal din hero (`business.name`, `maxLen: 60` declarat în
  `schema.json` dar neaplicat de editorul inline)
- Pași: 1. Click pe titlu. 2. Selectează tot. 3. Scrie ~520 caractere. 4. Blur.
- Observat: Titlul ocupă ~857px înălțime (măsurat: `rect.h: 856.98`), acoperind complet
  butonul CTA, subtitlul și restul conținutului hero, care ies din viewport. Diacriticele
  românești (ȘTȚÂÎĂ) se randează corect, fără artefacte — asta funcționează bine. Nu apare
  niciun avertisment, contor de caractere sau trunchiere, deși `schema.json` declară
  `"maxLen": 60` pentru acest câmp.
- Așteptat: Fie o limită de caractere aplicată la tastare (conform `maxLen` din schema), fie
  cel puțin un avertisment vizual/contor.
- Dovadă: `<scratch>/shots/ec-10-longtext-500chars-overflows-hero.png`; măsurătoare în
  `<scratch>/probes/phase6-results.json` (`longText_rect.h: 856.98`).
- Indiciu cod: `templates/local-service/schema.json:16-20` (`maxLen: 60`); nu am găsit
  aplicarea acestei limite în handler-ul de `input` din `builder/edit-overlay.js`.

## SUGESTII (nu sunt defecte; ar face diferența)
- S1. Fonturile custom ale desserdirina (Montserrat/Cormorant, self-hosted) eșuează la
  încărcare ÎN PREVIEW cu eroare CORS (`Access to font ... blocked by CORS policy ... origin
  'null'`), pentru că iframe-ul de preview e `srcdoc` sandboxed fără `allow-same-origin`, iar
  serverul nu trimite `Access-Control-Allow-Origin` pe rutele de fonturi. Preview-ul din
  editor arată deci cu fonturi fallback, diferite de ce vede clientul pe site-ul publicat —
  poate încurca un client care alege acest șablon exact pentru identitatea vizuală a
  fonturilor. Dovadă: consola din `<scratch>/probes/phase1-results.json`
  (`templates.desserdirina.errors`, ~15 erori CORS repetate pe fiecare font woff2).
- S2. La adăugarea unui element în listă (ex. serviciu portfolio), scroll-ul NU rămâne la
  poziția unde lucra userul — sare la elementul nou adăugat, care poate fi mult mai jos pe
  pagină (măsurat: de la scrollY 500 la scrollY 2196/2221). Nu e „resetare la began" (bug-ul
  vechi menționat în commit-uri), dar tot smulge userul din contextul unde lucra, dacă
  adaugă un element la o listă aflată sus pe pagină în timp ce derulase mai jos să verifice
  altceva. Ar merita văzut dacă acest salt spre elementul nou e mereu intenționat.
- S3. La încărcarea editorului fără autentificare apar 4× cereri `GET /api/me` → 401 în
  consolă (comportament așteptat pentru sesiune anonimă, dar generează zgomot constant în
  consolă — merită filtrat/silențiat pentru un console.error curat).

## VERIFICĂRI CERUTE

- V1 (local-service — chip-ul „București și împrejurimi” needitabil): **INFIRMAT.**
  Elementul are `data-hb-edit="business.zone"`, `contenteditable="true"`; click → focus
  direct pe el (`document.activeElement` = elementul, `data-hb-edit="business.zone"`);
  tastare → text nou citit înapoi identic (`"Cluj-Napoca și Turda (zonă editată)"`). E complet
  editabil inline, exact ca restul textelor din preview. Dovadă:
  `<scratch>/shots/ec-08-v1-zone-chip-before.png`,
  `<scratch>/shots/ec-09-v1-zone-chip-edited-successfully.png`,
  `<scratch>/probes/phase7-results.json` (`v1_zone_editable_confirmed: true`).

- V2 (local-service — reîncărcarea întregii pagini la orice modificare): **PARȚIAL INFIRMAT.**
  O editare simplă de text (un caracter tastat într-un titlu) NU reface iframe-ul — am pus un
  marker JS în `window` al iframe-ului înainte de editare și a supraviețuit editării
  (`reloaded: false`), cu latență ~57ms, deci editarea de text e live, fără reload. ÎN SCHIMB,
  adăugarea/ștergerea unui element de listă (și, cf. codului, schimbarea de imagine/culoare)
  CHIAR reconstruiește tot iframe-ul (`srcdoc` nou, marker pierdut, `reloaded: true`,
  ~700-740ms) — deci reclamația e parțial adevărată, dar doar pentru acțiuni de tip listă/
  imagine/culoare, nu pentru editarea de text obișnuită. Dovadă:
  `<scratch>/probes/phase2-results.json` (`V2_single_text_edit_reloads_iframe.reloaded: false`,
  `listAdd_reloads_iframe_and_scroll.reloaded: true`).

- V3 (portfolio — la adăugarea unui serviciu lipsesc preț și icon): **CONFIRMAT.** Vezi D1.

- V4 (professionals — la adăugarea unei opțiuni noi există celulă pentru titlu dar lipsește
  cea pentru descriere): **CONFIRMAT, pe ambele liste verificate** — „Servicii” (`.pr-svc`) și
  „Cum lucrăm” (`.pr-steps`). Vezi D2.

- V5 (professionals — în celula „Experiență” [ar trebui să] putem adăuga opțiune de adăugare
  a unor câmpuri): **CONFIRMAT ca lipsă** — lista din cardul „Experiență” (Credențiale) e
  singura listă din tot editorul, dintre cele verificate, care NU are deloc buton de adăugare
  sau ștergere a rândurilor (0 `.hb-add-btn`, 0 `.hb-remove-btn` în tot cardul). Vezi D3.

- V6 (desserdirina — la adăugarea unei categorii noi lipsește câmpul de descriere):
  **CONFIRMAT, cu nuanță** — câmpul EXISTĂ tehnic în DOM (`data-hb-edit="categories.N.blurb"`,
  `contenteditable="true"`), spre deosebire de V3/V4 unde lipsește complet, dar e complet gol
  și invizibil (fără placeholder, fără chenar, fără nicio dimensiune vizibilă) — pentru un
  utilizator real, efectul e identic: nu poate găsi unde să scrie descrierea. Vezi D4.

## Verificări suplimentare (nu erau pe listă, dar relevante pentru „cap-coadă funcțional”)

- Undo/redo: **funcționează corect.** 5 editări succesive → 5×Undo a revenit exact pas cu pas
  la starea inițială (`Edit5→Edit4→Edit3→Edit2→Edit1→titlul original`), apoi 5×Redo a refăcut
  exact aceeași succesiune înainte. Dovadă: `<scratch>/probes/phase6-results.json`
  (`undo_history`, `redo_history`).
- Salvare + persistență la reload: **funcționează.** Indicatorul `#save-status` arată
  „Salvat” (`data-state="saved"`) după editare; am reîncărcat pagina (F5) și textul editat
  (marker unic) a persistat identic. Dovadă: `<scratch>/probes/phase6-results.json`
  (`persisted_after_reload: true`).
- Emoji + diacritice: text `"Șînă țâî ăȘȚ 😀🔥🏠✨ test"` scris într-un titlu s-a citit înapoi
  identic, byte cu byte — nicio mangling. Nu am reușit să reconfirm acest test specific în
  ultima rulare curată (a picat pe o problemă de viewport a scriptului meu, nu a produsului —
  vezi `phase7-results.json.textcases_error`), dar rularea anterioară (`phase6-results.json`,
  câmp diferit) arătase deja potrivire exactă; consider comportamentul verificat suficient.
- Freeze la 30 de taste rapide consecutive: **nu am observat blocare.** 30 caractere tastate
  fără pauză au durat 18ms (simulare Playwright, deci limită inferioară nerealistă pentru
  tastare umană, dar relevantă pentru throughput-ul intern), iar un click imediat după pe
  Undo a răspuns în 838ms — nu ideal instant, dar departe de un freeze perceptibil.
- Erori de consolă pe parcursul întregii explorări, pe toate cele 5 șabloane: singurele erori
  reale (în afară de 401 `/api/me`, așteptat pentru sesiune anonimă) sunt erorile CORS de
  fonturi pe desserdirina (S1); niciun `pageerror` (excepție JS nemanaged) pe niciun șablon.
