# Calitatea site-urilor publicate — raport explorare

Acoperit:
- Am publicat câte un site real pentru fiecare din cele 5 șabloane (product-menu,
  local-service, portfolio, professionals, desserdirina), folosind `presets[0].config`
  din fiecare `templates/<id>/presets.json`, prin pipeline-ul real
  `bot/webpublish.js#publishSite()` (server pornit cu `startServer({port:0})`,
  `HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`), servite la `/live/<slug>/`.
- Am navigat cu Playwright (Chromium) la 1440×900, 768×1024 și 390×844 pe fiecare
  site publicat: screenshot full-page, `document.documentElement.scrollWidth` vs
  `clientWidth`, listener pe `console`/`pageerror`/`requestfailed`.
- Am verificat: linkurile din nav (`href="#..."` → există elementul cu acel id),
  meniul hamburger (click deschidere/închidere + `aria-expanded`), cookie banner
  (`#hb-cookie-banner`/`#hb-cookie-accept`, persistență după reload, linkul „Află
  mai mult" → `cookies.html`), footer (text, linkuri hidook.tech/hidook.agency,
  contrast text/fundal calculat din `getComputedStyle`), butonul WhatsApp flotant
  (poziție + suprapunere cu iconițele sociale din footer, testat scroll-at-bottom
  înainte și după acceptarea cookie-urilor), paginile legale (`privacy.html`,
  `terms.html`, `cookies.html` — status HTTP + conținut real, nu placeholder),
  înălțimea butoanelor pe mobil (≥44px), border-radius pe CTA-urile principale,
  formularul de programare din `professionals` (completat integral și trimis prin
  `/live/`, verificat mesajul de succes).
- Pentru V3 și V6 am făcut și teste țintite suplimentare (nu doar cu presets[0]):
  am suprascris `theme.cream` cu un portocaliu aprins în config-ul portofoliului
  și am regenerat static site-ul (`buildStaticSiteTree`) ca să reproduc exact
  scenariul din feedback; la fel, am umflat `business.about` de 6x în desserdirina
  ca să testez comportamentul cardurilor la conținut real lung.
- Șabloane fără `<form>` real (product-menu, local-service, portfolio,
  desserdirina) — am verificat că linkurile tel:/wa.me sunt corect populate din
  config, în locul unui formular.

Neacoperit:
- Nu am testat exportul ZIP de auto-hosting (`site-export.js`'s zip) în sine —
  doar `buildStaticSiteTree` pentru probele DOM/contrast; comportamentul de output
  e identic (aceeași funcție e apelată de ambele căi).
- Nu am testat calendarul nativ de programări dincolo de fluxul happy-path (nu am
  încercat sloturi ocupate/indisponibile, fus orar, dublă rezervare) — nu era în
  scope-ul explicit al listei de verificări cerute, iar `pr-appt-form` a mers din
  prima încercare.
- Nu am testat cu imagini reale încărcate de utilizator (am publicat cu
  `images: []`, deci pozele vin din `templates/<id>/images/*` — cele din preset).
  Un set de imagini cu raport de aspect neobișnuit ar putea da rezultate diferite
  la `object-fit`/`aspect-ratio` față de ce am văzut eu.
- Nu am testat toate cele 3 preset-uri per șablon, doar `presets[0]` (conform
  cerinței din briefing), cu excepția testelor țintite V3/V6 unde am modificat
  manual config-ul ca să reproduc explicit scenariile din feedback.

## DEFECTE (observate, cu dovadă)

### D1. Prețurile din portofoliu devin ilizibile pe un fundal de temă personalizat (ex. portocaliu)
- Severitate: major
- Unde: `portfolio`, secțiunea „Servicii" (`.pf-price`), oriunde clientul schimbă
  `theme.cream` (fundalul principal) într-o culoare saturată
- Pași: 1. Am luat config-ul din `presets[0]` al portofoliului. 2. Am suprascris
  `theme.cream` = `#e8720c` (portocaliu), am regenerat site-ul static cu
  `buildStaticSiteTree`. 3. Am deschis `#services` și am măsurat contrastul
  liniuței punctate (`.pf-price__dots`), separatorului (`.pf-price__row` border)
  și textului de preț (`.pf-price__val`) față de noul fundal.
- Observat: fundalul secțiunii devine `rgb(232, 114, 12)`; separatorul dintre
  denumire și preț (`rgba(42, 51, 64, 0.1)`) are contrast **1.15:1** față de
  fundal (practic invizibil); prețul propriu-zis (`--mute`, `rgba(42,51,64,0.74)`)
  are **2.97:1** (sub pragul WCAG AA de 4.5:1 pentru text normal); chiar și
  numele serviciului (culoare solidă `rgb(42,51,64)`) ajunge la doar **4.16:1**,
  sub prag. Vizual: linia punctată dintre nume și preț dispare aproape complet,
  iar prețul e vizibil mai șters decât numele.
- Așteptat: culorile de separator/preț din `.pf-price` ar trebui derivate din
  `--paper`/`theme.cream` (contrast calculat), nu fixate la o valoare hardcodată
  gândită doar pentru fundalurile neutre implicite (paper/snow/blush) — exact ce
  spune și comentariul din `styles.css:14-20` despre `--mute` ("against the light
  section backgrounds it's used on (paper/snow/blush)").
- Dovadă: `shots/portfolio-orange-theme-pricelist.png`; valori măsurate mai sus.
- Indiciu cod: `templates/portfolio/styles.css:20` (`--mute`), `:397-398`
  (`.pf-price__dots`, `.pf-price__val`).

### D2. Cele două carduri „Despre noi" / „Comandă acum" din desserdirina lasă spațiu gol mare când Despre noi e lung
- Severitate: major
- Unde: `desserdirina`, ≥992px lățime (`.content-wrapper` grid 2 coloane,
  `align-items: stretch`)
- Pași: 1. Am publicat cu `presets[0]` (conținut scurt) — deja vizibil un gol
  de-al câtorva sute de px sub cardul roz „Comandă acum" la 1440px. 2. Am umflat
  `business.about` de 6× (303 → 1823 caractere) și am regenerat static site-ul.
  3. Am comparat înălțimile celor două carduri.
- Observat: chiar cu conținutul din preset, cardul „Comandă acum" are un gol vizibil
  în partea de jos (vezi `shots/pub-desserdirina-desktop.png`, zona roz goală sub
  adresă). Cu „Despre noi" umflat, ambele carduri sunt forțate la **1665px**
  înălțime (identic, din `align-items: stretch`), deși „Comandă acum" are conținut
  pentru mult mai puțin spațiu — vezi `shots/desserdirina-longabout-cards.png`:
  cardul din dreapta are ~1100px de spațiu roz complet gol sub ultimul rând de
  contact.
- Așteptat: exact ce a cerut clientul — cardurile să fie suprapuse (stivuite
  vertical, Despre noi primul, apoi Comandă acum) în loc de grid pe 2 coloane cu
  stretch, ca să nu mai depindă unul de înălțimea celuilalt. (Ordinea DOM e deja
  corectă: `about-card` vine înaintea lui `contact-card` în `template.html`.)
- Dovadă: `shots/pub-desserdirina-desktop.png`, `shots/desserdirina-longabout-cards.png`;
  măsurători: `aboutHeight === contactHeight === 1665.09px` (din
  `getBoundingClientRect`) după umflarea textului.
- Indiciu cod: `templates/desserdirina/styles.css:566-576` — comentariul din cod
  chiar documentează comportamentul: "align-items:stretch still makes the
  about/contact cards share the tallest height, any language." Media query care
  le stivuiește există deja, dar abia sub 992px (`:1733`).

### D3. Cookie banner-ul (înainte de acceptare) acoperă iconițele Instagram/Facebook din footer pe mobil
- Severitate: minor
- Unde: `desserdirina` (probabil și celelalte șabloane cu footer social + cookie
  banner jos-stânga), 390×844, înainte de a apăsa „Acceptă"
- Pași: 1. Am deschis site-ul publicat pe mobil, fără să accept cookie-urile.
  2. Am scrollat la finalul paginii. 3. Am citit `getBoundingClientRect()` pentru
  `#hb-cookie-banner` și pentru linkurile `footer a[href*="instagram"/"facebook"]`.
- Observat: banner-ul ocupă `left:8 → right:296, top:722 → bottom:836`; iconițele
  Instagram/Facebook sunt la `left:147-243, top:772-812` — complet în interiorul
  dreptunghiului banner-ului (`z-index:40`, deasupra footer-ului). Practic,
  vizitatorul nu poate da click pe Instagram/Facebook din footer până nu
  închide/acceptă banner-ul.
- Așteptat: banner-ul de cookie-uri să nu blocheze un element de navigare permanent
  din footer, sau footer-ul să aibă suficient spațiu jos (`--hb-cookie-clearance`)
  ca iconițele sociale să rămână accesibile.
- Dovadă: `shots/pub-desserdirina-mobile-scrolled-bottom.png` (iconițele nu se văd
  deloc — sunt sub banner); coordonate măsurate mai sus.
- Indiciu cod: `bot/site-legal.js` (regulile `--hb-cookie-clearance` par să
  crească spațiul doar pentru `.scroll-indicator`/`.pf-hint`/`.ls-scroll`, nu și
  pentru footer-ul cu social icons).

### D4. Textul „Build by hidook.tech powered by hidook.agency" din footer are contrast sub prag pe local-service
- Severitate: minor
- Unde: `local-service`, footer (`.hb-built-by`), toate lățimile
- Pași: măsurat `getComputedStyle` pe `.hb-built-by` (culoare text) și pe fundalul
  footer-ului (`.ls-foot`, `font-size: 12px`).
- Observat: text `rgba(15, 23, 32, 0.5)` pe fundal `rgb(238, 241, 244)` →
  contrast **3.33:1**, sub pragul WCAG AA de 4.5:1 pentru text normal (12px, nu e
  text mare). Pentru comparație: product-menu 4.62:1, portfolio 5.15:1,
  professionals 4.97:1, desserdirina 17.4:1 — toate celelalte trec pragul.
- Așteptat: opacitate mai mare pe `.hb-built-by` în local-service, la fel ca
  restul șabloanelor (deja rezolvat, judecând după comentariul din portfolio's
  `--mute`, într-un singur șablon).
- Dovadă: calcul contrast (compus alpha peste fundal) — valorile de mai sus.
- Indiciu cod: `templates/local-service/styles.css` (`.ls-foot`, `.hb-built-by`
  moștenește `color: var(--mute)` sau echivalent la 0.5 opacitate).

### D5. Rândul cu linkurile legale din footer-ul professionals nu e aliniat cu restul rândului
- Severitate: minor
- Unde: `professionals`, footer (`.pr-foot__inner`), 1440×900
- Pași: am citit `getBoundingClientRect().top` pentru fiecare element de pe
  „rândul" footer-ului (nume business, copyright, nav legal-links).
- Observat: `business.name`/copyright sunt la `top: 757.86px`, dar
  `<nav class="hb-legal-links">` (Confidențialitate/Termeni/Cookie-uri) e la
  `top: 768.25px` — o diferență de **~10.4px**, vizibilă la zoom (vezi
  screenshot: linkurile legale par „coborâte" față de textul din stânga).
- Așteptat: toate elementele de pe același rând vizual din footer aliniate pe
  aceeași linie de bază.
- Dovadă: `shots/professionals-footer-section.png`; valorile `top` de mai sus.
- Indiciu cod: `templates/professionals/styles.css` (`.pr-foot__inner`,
  `.hb-legal-links` — probabil `align-items` sau `line-height`/`padding`
  diferit față de `.pr-copy`).

## SUGESTII (nu sunt defecte; ar face diferența)

- S1. Patru din cinci șabloane (product-menu, local-service, portfolio,
  desserdirina) nu au niciun `<form>` de contact/cerere ofertă pe site — doar
  linkuri `tel:`/`wa.me`/`mailto:`. Doar `professionals` are un formular real
  de programare (testat, funcționează end-to-end, fără erori). Dacă un client
  vrea explicit „formular de contact" pe alt șablon decât professionals, nu
  există azi — merită clarificat dacă e intenționat sau o lacună de acoperit.
- S2. `local-service` și `desserdirina` nu au deloc `<nav>`/meniu de navigare
  (nici desktop, nici hamburger pe mobil) — sunt pagini single-scroll cu doar un
  buton CTA. Pare intenționat (dock sticky pentru local-service), dar merită
  confirmat cu clientul că e comportamentul dorit, nu o omisiune.
- S3. Contrastul iconiței WhatsApp (alb pe verde `#25D366`) e 1.98:1 în toate
  cele 5 șabloane — sub pragul de 3:1 pentru componente UI grafice (WCAG 1.4.11).
  E branding-ul oficial WhatsApp, deci probabil acceptabil, dar l-am notat fiindcă
  apare identic peste tot.

## VERIFICĂRI CERUTE

- **V1** (local-service): „Butoanele toate le putem face mai rotunjite" —
  **CONFIRMAT parțial, cu date concrete pe toate 5 șabloanele**. Border-radius
  măsurat pe CTA-ul principal din fiecare șablon: product-menu **4px**,
  local-service **6px**, portfolio **980px** (pilulă complet rotunjită),
  professionals **4px**, desserdirina **40px**. local-service (6px) și mai ales
  product-menu/professionals (4px) au colțuri vizibil mai puțin rotunjite decât
  portfolio/desserdirina — deci cererea e valabilă cel puțin pentru acele 3
  șabloane, nu doar local-service. Dovadă: `results.json` (câmpul `borderRadius`
  per buton, viewport desktop).

- **V2** (local-service): „Butonul cu telefon (sus și înainte de footer) să fie
  crem/alb pentru evidențiere" — **CONFIRMAT**. Telefonul din bara de sus
  (`.ls-util__phone`) e text alb simplu, fără fundal/bordură, pe fond bleumarin
  `rgb(15,23,32)` — se contopește cu bara, spre deosebire de „Cere ofertă" de
  lângă el, care e buton plin albastru (`rgb(11,61,145)`). Telefonul de dinainte
  de footer (`.ls-btn.ls-btn--ghost`, „Sună · +40 721 234 567") e un buton
  „ghost" (fundal transparent, bordură albă subțire, text alb) — nu crem/plin.
  Dock-ul sticky de jos (`.ls-dock__call`) e de asemenea albastru plin, nu crem.
  Niciuna din cele 3 apariții ale telefonului nu e crem/alb plin ca să iasă în
  evidență — cererea clientului e corectă. Dovadă:
  `results.json` (culori `.ls-util__phone`, `.ls-btn--ghost`, `.ls-dock__call`).

- **V3** (portfolio): „Lista de prețuri pe unele culori se poate pierde —
  chenar gri/transparent ca default" — **CONFIRMAT, cu test dedicat**. Pe
  fundalul din `presets[0]` (verde-crem neutru) contrastul e OK (rowBorder vizibil
  slab dar prezent). Pe un fundal portocaliu (simulat prin `theme.cream`,
  câmp configurabil de client), separatorul punctat ajunge la **1.15:1** contrast
  (aproape invizibil) și prețul la **2.97:1** (sub AA). Vezi D1 mai sus pentru
  detalii complete și screenshot.

- **V4** (professionals): „Toate rândurile ar fi bine aliniate, acum un rând mai
  sus altul mai jos" — **CONFIRMAT, minor**. În footer, linkurile legale
  (Confidențialitate/Termeni/Cookie-uri) sunt cu ~10.4px mai jos decât numele
  business-ului/copyright de pe același rând vizual (vezi D5). În secțiunea de
  contact, cele 4 rânduri (telefon/email/WhatsApp/adresă) sunt însă corect aliniate
  între ele (listă verticală simplă, fiecare card cu aceeași lățime/stânga) — nu
  am găsit dezaliniere acolo.

- **V5** (desserdirina): „Nu arată bine deloc dacă lăsăm centrat scrisul" —
  **CONFIRMAT ca observație de fapt** (textul E centrat azi în hero și footer,
  clientul deja știe că nu-i place efectul). Elemente centrate găsite: `<h1>`
  „Desserdirina" + tagline-ul din hero; TOT footer-ul — adresă, `© 2026...`,
  linkurile legale, „Build by hidook.tech powered by hidook.agency", și
  linkurile Instagram/Facebook. Vezi `shots/pub-desserdirina-desktop.png` — pe
  ecran lat, footer-ul centrat lasă marje inegale/text „plutind" în mijloc, ceea
  ce probabil declanșează observația clientului. Nu pot evalua „arată bine/rău"
  ca judecată subiectivă, dar pot confirma faptul obiectiv: da, sunt centrate.

- **V6** (desserdirina): „Cardurile Despre noi / Comandă acum să fie suprapuse
  (stivuite), întâi Despre noi apoi Comandă acum" — **CONFIRMAT, cu test
  dedicat (conținut 6× mai lung)**. Ordinea DOM e deja corectă (Despre noi
  înaintea lui Comandă acum). Problema reală e layout-ul: la ≥992px sunt puse
  în grid pe 2 coloane cu `align-items: stretch`, deci cardul mai scurt e forțat
  la înălțimea celui lung, lăsând spațiu gol mare (vezi D2 — până la ~1100px gol
  în testul cu text lung, vizibil chiar și cu conținutul normal din preset). Sub
  992px sunt deja stivuite corect (confirmat vizual la 768px, `pub-desserdirina-tablet.png`).

- **V7** (desserdirina): „WhatsApp flotant acoperă iconițele Instagram/Facebook
  din footer" — **INFIRMAT, cu observație conexă**. La 390×844, scrollat până
  jos, atât înainte cât și după acceptarea cookie-urilor, butonul WhatsApp
  (`left:300-360`) și iconițele Facebook/Instagram (`left:147-243`) au un gol de
  ~57px între ele — nu se suprapun (vezi
  `shots/pub-desserdirina-mobile-afteraccept-bottom.png`). Ce am găsit în schimb:
  **înainte** de a accepta cookie-urile, banner-ul de consimțământ (nu butonul
  WhatsApp) acoperă complet iconițele — vezi D3. Posibil ca în screenshot-ul QA
  extern citat în briefing să fi fost surprins exact acest moment (banner
  vizibil) și confundat cu WhatsApp, sau o lățime de ecran diferită de 390px la
  care golul se închide — nu am reprodus suprapunerea directă cu WhatsApp la
  niciuna din cele 3 lățimi testate.

## Rezultate generale (fără defecte găsite)

- Zero erori console/`pageerror`/`requestfailed` pe niciuna din cele 5 site-uri
  publicate, la niciuna din cele 3 lățimi (`probes/console-issues.json` — gol).
- Zero scroll orizontal (`scrollWidth > clientWidth`) pe toate 5×3 combinații.
- Toate linkurile din nav (`href="#..."`) rezolvă către un element existent, pe
  toate șabloanele care au navigare (product-menu, portfolio, professionals).
- Meniul hamburger (product-menu, portfolio, professionals) se deschide și se
  închide corect, `aria-expanded` se actualizează corect.
- Cookie banner: apare, „Acceptă" îl închide, rămâne închis după reload
  (persistă în localStorage), linkul „Află mai mult" duce corect la
  `cookies.html`.
- Toate cele 3 pagini legale (`privacy.html`, `terms.html`, `cookies.html`)
  există (HTTP 200) pe toate cele 5 site-uri, cu conținut real (1300-1900
  caractere, personalizat cu numele afacerii — nu placeholder generic).
- Toate butoanele/linkurile principale măsurate pe mobil (390px) au ≥44px
  înălțime (44-52px) — niciun buton sub prag găsit.
- Formularul de programare din `professionals` funcționează integral prin
  `/live/`: select-uri de dată/oră populate (15 date, 8 sloturi), completare,
  trimitere → mesaj de succes cu numele serviciului și data/ora corecte, zero
  erori de consolă.
- Footer-ul „Build by hidook.tech powered by hidook.agency" are linkuri corecte
  către `hidook.tech`/`hidook.agency` pe toate cele 5 șabloane.
