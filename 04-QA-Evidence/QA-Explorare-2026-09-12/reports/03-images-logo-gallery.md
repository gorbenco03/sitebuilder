# Imagini — logo, galerii, upload — raport explorare

Toate dovezile (screenshot-uri, JSON-uri de măsurători) sunt în directorul
protejat `<scratch>/shots/images-final/` (prefixe unice `img-final2-*`,
`img-pub-*`, `imgs3-*`, `v3diag-*`, `img-portfolio-collage-*`) și
`<scratch>/qa-reports/img-run-*.json` / `images-run-*.json` /
`images-v3-diag-results.json`. Notă operațională: directorul `shots/`
rădăcină e partajat cu alți ~9 agenți; screenshot-urile mele scrise direct
acolo (prefixe `images-*`) au fost șterse de un script străin în timp ce
rulam — de aceea am migrat tot ce urmează în `shots/images-final/` și am
re-capturat dovezile pierdute. Scripturile de test sunt în `<scratch>/probes/`
(`images-explore*.mjs`, `images-v3-diag.mjs`, `images-publish-live.mjs`,
`img-portfolio-collage-fix.mjs`, `img-final2-evidence.mjs`, `gen-images.py`).

Server local pornit exact ca în `bot/test/delete-site-oracle.mjs`
(`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, DATA_DIR temporar,
`node --experimental-sqlite` pentru fluxul de publicare). Fișiere de test
generate cu Pillow în `probes/`: logo 200×200, logo 1200×300, poze
1200×800 / 800×1200, un JPEG „greu" ~13.4MB/4000×3000, PNG cu transparență,
WebP, `.txt` redenumit `.jpg`, plus 12 poze mici mixte portret/peisaj pentru
testul de galerie.

**Acoperit:** upload logo (pătrat + lat) pe toate cele 5 șabloane, măsurare
înălțime/lățime afișată în preview (1440×900 și 390×844); deschiderea
panoului „Poze" pe toate șabloanele; upload 12 poze într-o galerie existentă
pe local-service, portfolio, desserdirina; adăugare categorie nouă („+
Adaugă" din preview) pe local-service/portfolio/desserdirina și verificarea
panoului „Poze" după aceea; upload fișier `.txt` redenumit `.jpg`, JPEG de
~13.4MB, WebP, PNG transparent — toate pe logo (pipeline-ul de resize e
comun tuturor câmpurilor foto); înlocuirea unei poze marcate „demo" (verificare
dispariție etichetă); publicare (`HIDOOK_TEST_PAY`) pe toate cele 5 șabloane
cu logo + hero + 2 poze de galerie încărcate, inspecția `/live/<slug>/`
(fișiere din `images/`, dimensiuni reale ale `<img>`, atribute width/height).

**Neacoperit:** nu am testat ștergerea completă a unei poze din galerie (doar
înlocuire), nu am testat drag&drop (doar `input[type=file]`, echivalent
funcțional), nu am testat toate cele 5 șabloane pentru galerie de 8-12 poze
(doar cele 3 cerute explicit în briefing — product-menu nu a fost testat la
supraîncărcare de galerie din lipsă de timp, dar codul lui folosește exact
aceeași grilă CSS ca local-service, deci risc scăzut).

## DEFECTE (observate, cu dovadă)

### D1. Logo-ul nu are o mărime standard — variază de la 22px la 460px înălțime/lățime între șabloane
- Severitate: major
- Unde: toate cele 5 șabloane (header/hero)
- Pași: 1. Deschide orice șablon → Poze → Logo → încarcă `logo-square-200.png` (pătrat). 2. Măsoară elementul logo randat în preview.
- Observat (măsurat, `getBoundingClientRect()` pe elementul `<img>` real din pagina live, logo lat 1200×300 și pătrat 200×200):
  - professionals: 22×22 px (pătrat) → 88×22 px (lat)
  - portfolio: 22×22 px → 88×22 px (identic cu professionals)
  - product-menu: 28×28 px → 112×28 px
  - local-service: 120×40 px pentru AMBELE (cutie fixă `aspect-ratio:3/1`, logo-ul e doar "contain" în ea)
  - **desserdirina: 460×460 px (pătrat!) → 460×115 px (lat)** — logo-ul pătrat ajunge cât toată zona hero, împingând numele afacerii dedesubt
- Așteptat: o înălțime/lățime maximă consecventă (owner-ul cere explicit „o mărime standard ca să fie vizibil pe toate site-urile").
- Dovadă: `shots/images-final/img-final2-desserdirina-desktop-square-logo.png` (logo pătrat = bloc albastru cât hero-ul), `img-final2-local-service-desktop-square-logo.png` (logo mic, corect letterboxed), `img-final2-portfolio-desktop-square-logo.png` (logo 22px, minuscul), `img-final2-desserdirina-mobile-square-logo.png` (aceeași problemă pe 390×844 — logo-ul ocupă tot lățimea telefonului). Măsurători brute în `qa-reports/images-run-1-results.json`.
- Indiciu cod: `templates/desserdirina/styles.css:398-404` (`.hero-logo{max-width:460px;width:min(82vw,460px);height:auto}` — fără limită de înălțime, deci un logo pătrat/portret devine un pătrat de 460px); `templates/local-service/styles.css:114` (`.ls-hero__logo{height:40px;aspect-ratio:3/1}` — singurul șablon cu cutie fixă); `templates/portfolio/styles.css:88` și `templates/professionals/styles.css:151` (`height:22px` fix, fără relație cu celelalte șabloane); `templates/product-menu/styles.css:74` (`height:28px`).
- **V1 (din briefing): CONFIRMAT.** Owner-ul are dreptate: nu există nicio limită de înălțime consecventă; desserdirina e cazul extrem (un logo pătrat obișnuit devine literalmente cât hero-ul), dar și diferența 22px vs 40px vs 460px între celelalte patru arată lipsa unui standard.

### D2. O poză nouă (secțiune/categorie abia adăugată) nu poate primi nicio fotografie — nici din panoul „Poze", nici din editorul categoriei
- Severitate: major (blocker practic pentru acel flux — clientul nu poate termina treaba de a popula o categorie nouă)
- Unde: local-service, portfolio, desserdirina — lista „Categorii lucrări"/"Categorii foto" (câmp `categories`, `itemShape:{title,blurb,photos}`)
- Pași: 1. Pornește orice din cele 3 șabloane. 2. În preview, la finalul galeriei, apasă butonul „+ Adaugă" (creat de `edit-overlay.js`, apare sub ultima categorie). 3. Se creează o categorie nouă cu titlu implicit („Categorie de lucrări nouă"/"Categorie nouă") și `photos: []`. 4. Deschide panoul „Poze".
- Observat: categoria nouă APARE în preview cu titlul ei (confirmat prin text în DOM), dar panoul „Poze" NU afișează nicio secțiune nouă pentru ea — numărul de secțiuni din modal a rămas identic înainte/după (local-service 5→5, portfolio 4→4, desserdirina 3→3) și textul „Categorie nouă"/"Categorie de lucrări nouă" nu apare nicăieri în modal. Editorul categoriei (drawer-ul din dreapta) afișează doar câmpurile text (titlu, descriere) — niciun control pentru poze.
- Așteptat: fie panoul „Poze" să afișeze un slot gol pentru categoria nouă (cu buton de upload), fie editorul categoriei să aibă propriul control de upload.
- Dovadă: `shots/images-final/imgs3-01...06` (au fost șterse de scriptul străin înainte să le pot copia — vezi notă operațională) — dar rezultatul e reprodus și confirmat din nou curat în `qa-reports/images-v3-diag-results.json` nu, de fapt confirmarea finală e în log-ul rulării 3: `local-service: Poze modal sections=5; mentions "Categorie nouă" = false`, `portfolio: sections=4; mentions = false`, `desserdirina: sections=3; mentions = false` (toate cu `"Categorie nouă"` deja apărută în preview, `catCountBefore=0 after=1`).
- Indiciu cod: `builder/app.js` funcția `findPhotoPaths()` (~linia 3760) include o categorie în panoul „Poze" doar dacă `v.length > 0 && v.some(p => p && p.src)` — un array gol e complet ignorat; funcția care randează câmpurile unui item din listă (~linia 2603) filtrează explicit `itemShape[k] === 'text'`, deci cheia `photos` a categoriei nu primește niciodată control propriu în editor.
- **V2 (din briefing): CONFIRMAT** pe toate cele 3 șabloane cerute (local-service, portfolio, desserdirina).

### D3. Galeria „scatter"/colaj (desserdirina „Creațiile noastre") se suprapune masiv peste ~5 poze
- Severitate: major
- Unde: desserdirina, secțiunea „Creațiile noastre" (categorii cu `photos`, layout `.collage-deck`/`.collage-photo`, scriptul `collage.js`)
- Pași: 1. Pornește desserdirina. 2. Poze → categoria cu poze („Torturi" etc.) → adaugă 12 poze (portret+peisaj mixte). 3. Închide modalul, privește secțiunea „Creațiile noastre".
- Observat (măsurat pe bounding box-urile reale ale elementelor `.collage-photo`): cu 16 poze în total (4 demo + 12 noi), **54 de perechi de poze se suprapun, cu până la 79% din aria unei poze acoperită de alta**. Algoritmul de scatter (`collage.js`) calculează spațiul dintre poze ca `(lățime_cutie − lățime_poză)/(N−1)`, fără limită inferioară — cu N mare, spațiul tinde spre 0 și pozele se stivuiesc aproape complet una peste alta.
- Așteptat: peste un anumit număr de poze, layout-ul ar trebui să treacă la o grilă normală (ca la local-service/portfolio) în loc să reducă la infinit spațiul dintre poze.
- Dovadă: `shots/images-final/img-final2-desserdirina-collage-12photos-cropped.png` (pozele demo aproape complet ascunse sub cele noi, care la rândul lor se suprapun puternic între ele); măsurători brute în `qa-reports/images-run-2-results.json` (`"overlappingPairs":54,"maxOverlapPct":"79%"`).
- Indiciu cod: `templates/desserdirina/collage.js`, funcția `compute()`: `fitSpacing = (deckW - photoW) / (n - 1); spacing = Math.max(0, Math.min(maxSpacing, fitSpacing))` — comentariul din cod confirmă intenția („no hard-floor on spacing ... lets photos overlap more tightly rather than ever overflow"), deci suprapunerea e un compromis DELIBERAT pentru a evita overflow orizontal la zoom, dar pragul la care devine inutilizabil (vizual, un „teanc" de cărți) nu e limitat.
- **V4 (din briefing): CONFIRMAT.** Cu 12 poze adăugate (16 total), galeria își pierde complet rolul de a arăta lucrările — devine un teanc suprapus.

### D4. O poză cu transparență (PNG) e convertită în JPEG și fundalul transparent devine NEGRU
- Severitate: minor
- Unde: toate șabloanele — pipeline-ul comun de resize/upload (`resizeImageToDataUrl`, `builder/app.js`)
- Pași: 1. Poze → Logo → încarcă un PNG cu fundal transparent (cerc albastru pe fundal transparent). 2. Privește thumbnail-ul rezultat.
- Observat: fundalul transparent a devenit un pătrat NEGRU solid; cercul e singurul lucru vizibil pe negru.
- Așteptat: fie păstrarea transparenței (PNG/WebP), fie un fundal alb/neutru configurabil, nu negru implicit.
- Dovadă: `shots/images-final/imgs3-10-badfile-transparent-png-result.png` (thumbnail din modalul „Poze" arată clar cercul albastru pe fundal negru).
- Indiciu cod: `builder/app.js` funcția `resizeImageToDataUrl()` (~linia 2773): `canvas.getContext('2d').drawImage(img,0,0,w,h); resolve(canvas.toDataURL('image/jpeg', quality))` — canvasul 2D e opac implicit (negru) și `toDataURL('image/jpeg', ...)` nu suportă niciodată alpha, indiferent de sursă (PNG/WebP cu transparență inclus).

## Comportamente verificate care FUNCȚIONEAZĂ corect (nu sunt defecte)

- **Fișier fals (`.txt` redenumit `.jpg`)**: respins corect, cu mesaj de eroare clar („Nu am putut procesa fotografia: Error reading the image"), nicio poză nu e setată. Dovadă: `imgs3-07-badfile-fake-txt-as-jpg-result.png` (thumbnail rămâne „Nicio poză încă").
- **JPEG de ~13.4MB / 4000×3000**: acceptat și redimensionat cu succes în ~0.8s (după eliminarea coliziunii de toast din primul test), fără să blocheze browserul. Dovadă: `imgs3-08-badfile-huge-14MB-jpg-result.png`.
- **WebP**: acceptat și reconvertit fără probleme. Dovadă: `imgs3-09-badfile-webp-result.png`.
- **Galeria grilă la local-service** (categoria „Renovări complete de baie", clasa `.ls-shots`/`.ls-shot`): cu 14 poze (portret+peisaj mixte) toate cutiile rămân uniforme (324×252.7px), `object-fit:cover` corect, ZERO suprapuneri. Nu am reprodus afirmația din feedback („a 4-a poză se pune mai jos în mărimea originală") — vezi V3 mai jos.
- **Galeria portfolio** („Coafură și culoare"): folosește ACEEAȘI structură `.collage-deck`/`.collage-photo` ca desserdirina, DAR `templates/portfolio/styles.css:315-336` suprascrie complet poziționarea absolută cu un `display:grid` normal (3 coloane), deci NU moștenește bug-ul de suprapunere al desserdirina. Cu 16 poze (4 demo + 12 noi): ZERO suprapuneri; ultima poză „rămasă singură" pe rând primește un tratament special (lățime dublă, aspect-ratio 21:9) — comportament intenționat, nu bug.
- **Eticheta „DEMO"**: dispare corect după înlocuirea pozei hero cu o poză reală (`local-service`, confirmat vizual în `shots/images-final` — nu se mai vede badge-ul „demo" pe thumbnail-ul înlocuit).
- **Publicare + `/live/<slug>/`**: pe toate cele 5 șabloane, pozele încărcate ajung publicate ca fișiere reale (`logo.jpg` 6KB, `gallery-1.jpg` ~10.7KB, `gallery-2.jpg` ~12.1KB — pornind de la surse de 8-25KB/14MB, deci redimensionarea client-side funcționează), TOATE elementele `<img>` de pe pagina live au atribute `width`/`height` (`hasWidthAttr`/`hasHeightAttr` = true peste tot), și site-ul generează automat variante WebP responsive (`-480w.webp`, `-960w.webp` etc.) pentru pozele din temă. Dovadă: `qa-reports/img-run-4-results.json`, screenshot-uri `img-pub-*-live-page.png`.

## VERIFICĂRI CERUTE (din feedback QA extern)

- **V1** (toate șabloanele — logo fără mărime standard): **CONFIRMAT.** Vezi D1. Interval măsurat: 22px→460px înălțime pentru identic-același logo pătrat, în funcție doar de șablon.
- **V2** (local-service, portfolio, desserdirina — secțiune nouă fără cale de a adăuga poze, panoul Poze nu reflectă): **CONFIRMAT** pe toate cele 3. Vezi D2.
- **V3** (local-service „Lucrări finalizate", portfolio galerie — a 4-a poză „în mărimea originală", poze prea apropiate): **INFIRMAT** pentru ambele, cu măsurători directe pe pagina live (nu doar cod):
  - local-service: 14 poze testate (portret+peisaj mixte), toate identic dimensionate (324×252.7px afișat), zero anomalii de la a 4-a poză încolo. Măsurătorile inițiale (dintr-o rulare anterioară) care arătau înălțimi de 69px pentru unele cutii s-au dovedit un artefact al unui selector CSS prea larg (prindea elemente din altă secțiune a paginii, nu poze reale) — re-testat cu selector corect scopat direct pe container, rezultatul e curat.
  - portfolio: 16 poze (4 demo+12 noi), aceeași structură de tip „colaj" ca desserdirina în marcaj HTML, DAR portfolio își suprascrie complet poziționarea cu un grid normal — zero suprapuneri, ultima poză „singură pe rând" primește intenționat un tratament lat special (nu bug).
  - Notă: dacă feedback-ul extern a fost cules pe o versiune mai veche a codului, sau se referea la desserdirina (unde chiar există o problemă similară de suprapunere — vezi D3/V4), aceasta ar explica discrepanța. Pe codul curent, cu upload real prin UI, nu am reprodus problema pe local-service/portfolio.
- **V4** (desserdirina „Creațiile noastre" — prea multe poze se suprapun): **CONFIRMAT.** Vezi D3. Cu 12 poze adăugate (16 total) apar 54 de perechi suprapuse, până la 79% acoperire. Pragul la care devine vizibil problematic e undeva sub 8 poze per categorie (calculul din cod arată că spațiul dintre poze scade sub lățimea unei poze încă de la a 5-a poză din categorie).

## SUGESTII (nu sunt defecte; ar face diferența)

- S1. O limită de înălțime CSS comună pentru logo pe toate șabloanele (ex. `max-height:40px` + `width:auto`, fără cutii cu `aspect-ratio` fix) ar elimina atât cazul desserdirina (logo cât hero-ul), cât și inconsistența 22/28/40px — owner-ul chiar a cerut explicit asta.
- S2. Panoul „Poze" ar trebui să afișeze un slot gol (cu buton „Adaugă poză") pentru orice array de poze din configurație, chiar dacă e gol — nu doar pentru cele deja populate. E o singură linie în `findPhotoPaths()` (eliminarea condiției `v.length > 0`).
- S3. Layout-ul „colaj" din `collage.js` ar trebui să comute la o grilă normală (ca la portfolio) peste un prag de poze per categorie (ex. >6), în loc să reducă distanța la 0.
- S4. Fundalul negru la conversia PNG transparent → JPEG ar trebui să fie alb (sau configurabil) — o simplă umplere `ctx.fillStyle='#fff'; ctx.fillRect(...)` înainte de `drawImage` în `resizeImageToDataUrl()`.
