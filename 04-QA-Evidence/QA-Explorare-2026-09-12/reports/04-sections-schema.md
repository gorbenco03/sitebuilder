# Secțiuni, câmpuri, „Detalii" — raport explorare (toate cele 5 șabloane)

Acoperit:
- Instanță locală pornită după modelul din `bot/test/delete-site-oracle.mjs` (DATA_DIR temporar,
  `HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, `NODE_ENV=test`), Playwright/Chromium 1440×900,
  fără login (nu e necesar pentru editor — doar pentru publicare reală).
- Citit integral `schema.json` + `presets.json` pentru toate cele 5 șabloane
  (local-service, professionals, portfolio, product-menu, desserdirina) și `builder/app.js` +
  `builder/edit-overlay.js` ca să înțeleg mecanismul real: câmpurile apar editabil fie în
  panoul „Detalii" (`[data-field-key]`, doar tipurile phone/url/color/background + câteva chei
  parțiale ca whatsapp/instagram.url/facebook.url/seo./lang), fie inline direct în preview
  (`[data-hb-edit="cale.config"]`, click-to-edit contenteditable).
- Pentru fiecare șablon: am deschis editorul cu preset-ul implicit, am extras automat lista de
  câmpuri din Detalii, lista de câmpuri editabile inline din preview, și conținutul panoului
  „Secțiuni pagină" (etichetă, blocat/nu, ascuns/nu, butoane disponibile).
- Am testat reordonare (↑/↓), ascundere („Elimină") și restaurare („Adaugă") pe o secțiune reală
  (Servicii, local-service) — confirmat că se reflectă corect și imediat în preview.
- Am rulat cele 6 verificări cerute (V1–V6) prin editare inline directă (click, select-all,
  scriere/ștergere) pe câmpurile relevante din fiecare șablon, cu capturi înainte/după.
- Am golit un câmp obligatoriu (`business.name`, local-service) și am urmărit: starea din
  hero, checklistul „X/22", și încercarea de publicare.
- Am verificat checklistul „Mai lipsesc" (pastila din topbar) și am dat click pe o intrare
  pentru un câmp care nu are nicio reprezentare vizuală în preview.
- Am căutat text hardcodat în `template.html` (nu vine din `{{...}}`) pentru fiecare șablon.

Neacoperit:
- Nu am parcurs fluxul complet de publicare pe fiecare verificare (doar o dată, pentru testul
  de câmp obligatoriu gol) — pentru restul m-am bazat pe combinația editor live + `@if`-urile
  din `template.html` (build.js respectă aceleași condiții la randare server-side), exact cum
  indică briefing-ul zonei.
- Calendarul nativ de programări (`appointment.nativeBooking`, professionals) nu a fost
  activat/testat live — necesită mai multă infrastructură (modulul de calendar); semnalez doar
  un indiciu de cod (text hardcodat), nu un defect confirmat live.
- Nu am investigat cele ~40 de mesaje de consolă/erori colectate în trecerea generică prin cele
  5 șabloane — nu preau legate de zona Secțiuni/Detalii (posibil embed-uri Instagram fără rețea)
  și le las în afara scopului ca să nu depășesc aria mea.
- Nu am testat la 390×844 — diferențele găsite (chips, bloc contact, checklist) nu par să
  depindă de breakpoint; am rămas la 1440×900 din motive de timp.
- Nu am testat butoanele „Descarcă HTML"/„Descarcă ZIP" — în afara ariei mele.

## Ce se poate face cu structura site-ului (răspuns la item #1)

Panoul „Secțiuni pagină" din Detalii (`buildPageSectionsPanel`, `builder/app.js:3117`) oferă
**exact trei acțiuni**, pe **lista fixă** de secțiuni declarată în `templates/<t>/schema.json →
pageSections`:
- reordonare cu ↑/↓ (funcționează, testat live pe local-service: Servicii mutat cu o poziție
  mai jos, reflectat corect în preview — `sec-sections-after-move-down.png`)
- ascundere/„Elimină" (funcționează live — `sec-sections-after-hide-services.png`)
- restaurare/„Adaugă" (readuce secțiunea EXACT unde era în lista canonică, nu unde fusese
  mutată manual — testat, corect pentru acest caz simplu)

**Nu există nicio opțiune de a adăuga un tip de secțiune nou** (un bloc nou, o secțiune custom).
Am căutat orice urmă de „add block/section library" în `builder/app.js`, `builder/app.css`,
`builder/index.html` — nimic. „Adaugă" din panou înseamnă strict „arată la loc secțiunea
ascunsă anterior", nu „creează una nouă". Secțiunile disponibile pe fiecare șablon (fix, din
`pageSections`):

| Șablon | Secțiuni fixe (obligatorii cu ✱) |
|---|---|
| local-service | Despre+contact✱, Servicii, Cum lucrăm, De ce noi, Galerie, Instagram, Bandă finală contact✱ |
| professionals | Servicii, Cum lucrezi, Despre/credențiale✱, Programări, Întrebări, Instagram, Contact✱ |
| portfolio | Galerie, Despre noi✱, Servicii și prețuri, Program, Echipă, Instagram, Programări și contact✱ |
| product-menu | Despre+meniu✱, Contact✱, Galerie, Instagram |
| desserdirina | Despre noi✱, Contact✱, Galerie, Instagram |

Nicăieri nu poți adăuga o secțiune care nu e deja în listă (ex. nu poți adăuga „Recenzii" pe
local-service dacă nu există în schema lui).

## Tabel câmp vizibil → editabil, per șablon (extras automat din editor)

Legenda: **inline** = editabil direct în preview (click pe text); **Detalii** = editabil din
panoul lateral; **NU** = nicio suprafață de editare găsită.

### local-service
| Ce vezi în preview | Editabil? |
|---|---|
| Nume firmă, slogan, ani experiență, proiecte, zonă | DA — inline |
| Telefon afișat (navbar, hero, CTA, dock sticky) | DA — inline (`contact.phoneDisplay`), telefon real (`tel:`) — Detalii |
| Servicii (etichetă text) | DA — inline |
| **Icon serviciu** (emoji) | **NU** — există în schema (`services[].icon`) și în preset, dar nu apare în lista de câmpuri editabile inline nici în Detalii |
| Puncte „De ce noi" (titlu+text) | DA — inline |
| Categorii portofoliu (titlu, descriere, caption poze) | DA — inline |
| Certificări | NU apar deloc în lista inline (listă de tip `itemShape: "text"` simplu — verificat: nu are element `[data-hb-edit]` propriu; posibil editabile doar prin modalul „Poze"/listă generică, nu am găsit dovadă că se pot edita din preview) |
| Titlu pagină browser / descriere Google | **NU — nicăieri** (vezi D1) |
| Telefon/WhatsApp/Instagram/Facebook/adresă (secțiune contact) | DA — Detalii (linkuri), eticheta afișată — inline |
| Footer (adresă, an, notă) | DA — inline |
| „Build by hidook.tech" | **NU — hardcodat** (D10) |
| Culori temă | DA — dar NU din Detalii, dintr-un popover separat de culoare din topbar |
| Font | **NU — nicăieri, pe niciun șablon** |

### professionals
| Ce vezi | Editabil? |
|---|---|
| Nume, slogan, despre | DA — inline |
| Chip-uri „Avocat — ... / Română, engleză... / Online și la cabinet" | DA — inline, 3 câmpuri text separate (vezi V3) |
| Text sub slogan (lede) | DA — inline, opțional (vezi V2) |
| Servicii (nume+descriere) | DA — inline |
| Pași proces | DA — inline |
| Credențiale | DA — inline |
| Întrebări frecvente | DA — inline |
| Programări (titluri, tipuri, program săptămânal etc.) | DA — inline pentru texte; link Cal.com — Detalii |
| Telefon/email/WhatsApp/adresă (contact) | DA — inline pt. etichetă afișată, Detalii pt. link |
| Titlu pagină / descriere Google | **NU — nicăieri** |

### portfolio
| Ce vezi | Editabil? |
|---|---|
| Nume, slogan, despre | DA — inline |
| Servicii **+ preț** | DA — inline (`services[].label`, `services[].price`) |
| **Icon serviciu** | **NU** (schema are `itemShape.icon`, dar nu apare în lista inline) |
| Prețuri (`pricing[]`, 10 rânduri) | DA — inline |
| Program (schedule) | DA — inline |
| Echipă (nume, rol, bio) | DA — inline |
| Titlu pagină / descriere Google | **NU — nicăieri** |
| IG/FB în footer | Link — Detalii; **fără iconițe reale**, doar text „IG"/„FB" (D8) |

### product-menu
| Ce vezi | Editabil? |
|---|---|
| Nume, slogan, despre | DA — inline |
| Meniu bilingv (categorii + feluri, EN și RO) | DA — inline, ambele liste |
| Servicii (etichetă) | DA — inline; icon — **NU** |
| Titlu pagină / descriere Google | **NU — nicăieri** |
| IG/FB footer | Link — Detalii; **fără iconițe**, doar „IG"/„FB" |

### desserdirina
| Ce vezi | Editabil? |
|---|---|
| Nume, slogan, despre | DA — inline |
| Meniu bilingv EN/RO | DA — inline |
| Contact (telefon, WhatsApp, Instagram, Facebook, adresă) | DA — inline etichetă, Detalii link; **iconițe reale prezente** (singurul șablon cu iconițe SVG complete pt. contact) |
| Titlu pagină / descriere Google | **NU — nicăieri** |
| „Fotografii" (eticheta galeriei) | **NU — hardcodat** literal în `template.html:221`, nu vine din config |

## „Detalii" — ce conține și ce nu are efect vizibil

„Detalii" pe orice șablon conține DOAR: „Secțiuni pagină" (reorder/hide), un panou special
pentru `appointment.nativeBooking` (doar professionals), și restul câmpurilor de tip
phone/url/color(non-temă)/background + câteva chei parțiale (whatsapp, instagram.url,
facebook.url, addressHref, seo., jsonLd, canonical, **lang**, ogImage) — restul (nume, texte,
liste) se editează inline în preview, NU din Detalii. Secțiunea de business („Despre afacere")
în Detalii conține practic un singur câmp real: selectorul „Limba site-ului", care are **o
singură opțiune posibilă: „Română"** — deci nu servește la nimic (nu poți alege altă limbă din
el, pe niciun șablon).

Codul din `builder/app.js:3330` calculează o listă `seoFields` (comentariu: „SEO section:
always add as collapsible at the bottom") dar **nu o folosește niciodată** — variabilă moartă,
nicio secțiune SEO nu se randează vreodată în Detalii, pe niciun șablon.

## Golire câmp obligatoriu (item #5 din briefing) — funcționează corect

Am golit `business.name` (obligatoriu) pe local-service prin editare inline (click, select-all,
delete) și am urmărit efectul:
- În preview: titlul din hero (`.ls-hero__name`) rămâne în DOM dar gol, colapsează la 0px
  înălțime — nu apare niciun text placeholder derutant, dar site-ul rămâne temporar „fără nume"
  vizibil (navbar-ul arată doar telefonul). Nu e un defect, e comportamentul așteptat pentru un
  câmp gol.
- Checklistul scade corect: `22/22` (fals — vezi mai jos) → `15/22` după golire, deci detectează
  corect regresia.
- La click pe „Publică site-ul" cu numele gol: **modalul de publicare NU se deschide**; apare în
  schimb un banner roșu, clar, în partea de sus a preview-ului: „Completează mai întâi: Numele
  firmei sau al meseriei" — validare corectă, mesaj în română, ușor de înțeles.
- Aceasta e o parte a produsului care funcționează bine — nu am găsit niciun defect la golirea
  unui câmp obligatoriu.
- Dovadă: `shots/sec-empty-required-before.png`, `shots/sec-empty-required-after-clear.png`,
  `shots/sec-empty-required-publish-attempt.png` (banner-ul roșu de validare).

## DEFECTE (observate, cu dovadă)

### D1. Titlul paginii (browser/SEO) și descrierea Google nu pot fi editate NICĂIERI
- Severitate: **major**
- Unde: toate cele 5 șabloane — câmpurile `business.title` și `business.metaDescription`
  (ambele `required: true` în schema.json)
- Pași: 1. Deschide orice șablon nou. 2. Deschide „Detalii". 3. Caută un câmp „Titlu pagină" sau
  legat de Google. 4. Caută în preview orice text clickabil legat de titlul paginii.
- Observat: „Detalii" → grupul „Despre afacere" conține DOAR „Limba site-ului"
  (`local-service-drawer-body.txt`, capturat integral din DOM). Niciun input pentru
  `business.title`/`business.metaDescription`. În preview, aceste câmpuri nu apar vizual
  nicăieri (sunt doar în `<title>` și `<meta name="description">`, invizibile), deci nici acolo
  nu pot fi editate. Cauza din cod: `isDrawerField()` (`builder/app.js:794`) le exclude (tipul
  lor e text/textarea, nu e în `DRAWER_TYPES` și cheia nu se potrivește cu niciun pattern din
  `DRAWER_KEYS_PARTIAL`); iar `seoFields` (linia 3330) e calculat dar niciodată folosit —
  secțiunea SEO promisă în comentariu nu există deloc.
- Așteptat: un client trebuie să poată schimba titlul din tab-ul browserului și textul care
  apare pe Google pentru propria afacere.
- Dovadă: `/qa-reports/../probes/sec-local-service-drawer-body.txt` (textul complet al Detalii,
  fără nicio mențiune de „titlu" sau „browser"); `check-title-field.mjs` → `"hasTitleWord":
  false`.
- Indiciu cod: `builder/app.js:762-799` (`DRAWER_TYPES`, `isDrawerField`), `builder/app.js:3330`
  (`seoFields`, calculat și abandonat), `builder/app.js:843-854` (`IDENTITY_FIELD_KEYS` — ambele
  câmpuri sunt totuși forțate ca „trebuie schimbate genuin" în checklist, deci produsul ȘTIE că
  sunt importante, dar nu oferă UI pentru ele).

### D2. Checklist-ul „Mai lipsesc" duce la un click mort pentru exact aceste 2 câmpuri
- Severitate: minor (consecință directă a D1, dar UX confuz separat)
- Unde: pastila „X/22" din topbar → meniul „Mai lipsesc"
- Pași: 1. Site nou, local-service. 2. Click pe pastila checklist. 3. Apar 7 câmpuri lipsă,
  inclusiv „Titlu pagină pentru browser (bara de sus)". 4. Click pe acel item.
- Observat: nimic vizibil nu se întâmplă — nu se deschide Detalii
  (`drawerOpenedForTitle: false`), scroll-ul din preview nu se schimbă (`beforeScroll: 0,
  afterScroll: 0`), focus-ul rămâne pe `<body>` din iframe (`anyFocusedInIframe: "BODY.ls-body
  hb-cookie-open"`).
- Așteptat: click-ul ar trebui să te ducă exact la câmp (asta face pentru restul câmpurilor
  lipsă, care sunt fie în Detalii, fie inline).
- Dovadă: `shots/sec-checklist-menu-local-service.png`, `shots/sec-checklist-title-click-result.png`,
  `probes/sec-targeted-results.json` → `checklist_titleClick_result`.
- Indiciu cod: `builder/app.js:1157-1165` (`goToChecklistField` → `sendFocusFieldToIframe` →
  `builder/app.js:2249-2253`, trimite mesaj `highlight` fără să verifice dacă elementul există).

### D3. „Icon" la servicii — câmp declarat în schema, dar fără nicio suprafață de editare
- Severitate: minor
- Unde: local-service, portfolio, product-menu (toate au `services[].icon` în
  `schema.json → itemShape`)
- Pași: 1. Deschide oricare din cele 3 șabloane. 2. Verifică lista de câmpuri editabile inline
  pe fiecare serviciu.
- Observat: apar `services.N.label` (și `services.N.price` pe portfolio), niciodată
  `services.N.icon`. Toate preset-urile livrează `"icon": ""` pentru fiecare serviciu — icon-ul
  nu a fost niciodată populat și nu poate fi populat din UI.
- Așteptat: fie câmpul se elimină din schema (dacă nu mai e folosit), fie i se dă o suprafață de
  editare (emoji picker sau text simplu).
- Dovadă: `probes/sec-generic-pass.json` → `editableInPreview` pentru local-service/portfolio/
  product-menu (lipsă completă a oricărei chei `*.icon`); `templates/portfolio/schema.json:290`,
  `templates/local-service/presets.json` (fiecare `"icon": ""`).

### D4. local-service: nu există opțiune „nume firmă în loc de telefon" în navbar (V1)
- Severitate: major (cerință explicită de client, confirmată imposibilă)
- Unde: local-service, bara utilitară din header (`.ls-util`)
- Pași: 1. Deschide local-service. 2. Caută în Detalii sau inline vreo opțiune de a arăta
  numele firmei în stânga barei de sus, în loc de telefon.
- Observat: bara conține fix 3 lucruri, necondiționale ca alegere: telefon (`contact.phone` /
  `phoneDisplay`), zonă (`business.zone`), buton CTA. Nu există niciun câmp „arată numele în loc
  de telefon". Singura variantă tehnică e să suprascrii manual textul telefonului
  (`contact.phoneDisplay`) cu numele firmei — am testat live: acceptă orice text
  (`"Renovări Casa Nord SRL"` a înlocuit `"+40 721 234 567"` vizual), DAR elementul rămâne un
  link `<a href="tel:{{contact.phone}}">` — deci clientul „ascunde" telefonul doar aparent,
  linkul de apel tot există dedesubt cu numărul vechi, iar dacă golește și `contact.phone`,
  link-ul devine `tel:` gol (nefuncțional, fără avertisment).
- Așteptat: fie o opțiune reală „arată numele firmei" (cum a cerut clientul), fie cel puțin ca
  acest hack să nu lase un link `tel:` orfan/rupt.
- Dovadă: `shots/sec-v1-navbar-before.png` (bara originală, doar telefon+zonă+CTA),
  `shots/sec-v1-navbar-after-hack.png` (după suprascriere), `probes/sec-targeted-results.json`
  → `v1_navUtilEditablePaths: ["contact.phoneDisplay","business.zone",
  "hero.ctaLabel"]` (niciun `business.name`).
- Indiciu cod: `templates/local-service/template.html:63-73`.

### D5. professionals: chip-urile din hero și banda de credibilitate se pot desincroniza vizual
- Severitate: minor
- Unde: professionals — `.pr-hero__meta`/`.pr-kicker` (în cardul hero) vs. `.pr-strip` (banda
  imediat sub hero) — ambele randează ACELEAȘI 3 câmpuri (`business.profession`,
  `business.languages`, `business.modes`)
- Pași: 1. Deschide professionals. 2. Golește pe rând cele 3 câmpuri din cardul hero (click pe
  text, select all, delete). 3. Compară cardul hero cu banda de dedesubt.
- Observat: după golirea tuturor celor 3 câmpuri din cardul hero, banda `.pr-strip` continuă să
  arate textul vechi, neschimbat: `"Avocat — drept civil și comercial\nRomână, engleză și
  spaniolă\nOnline și la cabinet"` — identic înainte și după toate cele 3 editări. De asemenea,
  în cardul hero rămâne un caracter „·" orfan (separator static din template, nu e parte din
  editarea de text) — vizibil ca un punct singuratic sub butoanele CTA.
- Așteptat: fie cele 2 zone să rămână sincronizate live, fie (mai simplu) să nu existe duplicare
  a acelorași 3 informații în 2 locuri diferite ale paginii.
- Dovadă: `shots/sec-v3-hero-after-emptying-all-chips.png` (se vede punctul „·" orfan
  sub butoane), `probes/sec-targeted-results.json` →
  `v3_stripAfterEmptying_business.profession/languages/modes` (toate identice cu
  `v3_stripBefore`).
- Indiciu cod: `templates/professionals/template.html:121-134` (hero) vs. `:143-157` (strip);
  `builder/app.js:2509` (comentariu explicit: „No re-render for ordinary text — already visible
  in contenteditable" — un al doilea element legat de aceeași cheie nu e niciodată atins).

### D6. professionals: caseta de contact arată ca niște inputuri needing completare (V5)
- Severitate: major (confirmă direct feedback-ul extern al clientului)
- Unde: professionals, secțiunea Contact, `.pr-contact__row`
- Pași: 1. Deschide professionals, mergi la secțiunea Contact.
- Observat, măsurat din CSS calculat: fiecare rând (telefon, email, WhatsApp, adresă) e un
  bloc cu `border: 1px solid rgba(20,18,15,0.12)`, `background: rgb(251,249,245)` (aproape alb,
  diferit de fundalul paginii), `padding: 13.6px 16px` — exact aspectul unui câmp de formular
  needing completare. Niciun rând nu are iconiță (`hasSvgIcon: false, hasIconSpan: false` pentru
  toate cele 4 rânduri) care să clarifice ce reprezintă fiecare — doar text simplu (telefon,
  email, „WhatsApp", adresă).
- Așteptat: fie eliminarea bordurii/fundalului tip-input, fie adăugarea de iconițe (telefon,
  email, WhatsApp, hartă) ca la desserdirina.
- Dovadă: `shots/sec-v5-professionals-contact-block.png`, `probes/sec-targeted-results.json` →
  `v4v5_professionalsContactRows` (4 rânduri, toate cu aceeași bordură/fundal/padding, niciuna
  cu iconiță).
- Indiciu cod: `templates/professionals/styles.css:892-914` (`.pr-contact__row`).

### D7. portfolio & product-menu: linkurile Instagram/Facebook din footer sunt text, nu iconițe (V4)
- Severitate: minor
- Unde: portfolio și product-menu, footer
- Pași: 1. Deschide oricare din cele 2 șabloane, derulează la footer.
- Observat: linkurile au `aria-label="Instagram"`/`"Facebook"` dar conțin literalmente textul
  „IG"/„FB" ca tot conținutul vizibil — `hasSvg: false` pentru ambele, pe ambele șabloane.
  Contrastează cu desserdirina, care are iconițe SVG reale atât în footer cât și în caseta de
  contact (`contact-icon phone/whatsapp/instagram/facebook/location`, cu `background-image`
  SVG per fiecare rețea).
- Așteptat: iconițe reale (ca la desserdirina), nu abrevieri text.
- Dovadă: `shots/sec-v4-portfolio-footer-social.png`, `shots/sec-v4-product-menu-footer-social.png`,
  `shots/sec-v4-desserdirina-contact-icons.png` (comparație), `probes/sec-targeted-results.json` →
  `v4_footerSocial_portfolio`, `v4_footerSocial_product-menu`, `v4_desserdirina_contactIcons`.
- Indiciu cod: `templates/portfolio/template.html:299-303`,
  `templates/product-menu/template.html:289-293` vs.
  `templates/desserdirina/styles.css:789-807`.

### D8. desserdirina: „traducerea" EN/RO nu traduce aproape nimic, iar EN e tot în română (V6)
- Severitate: major (confirmă exact feedback-ul extern)
- Unde: desserdirina, singurul control de limbă de pe site — butoanele „EN"/„RO" din interiorul
  blocului Meniu (`.menu-lang-btn`)
- Pași: 1. Deschide desserdirina. 2. Notează textul din Despre, Contact, Instagram, footer,
  hero. 3. Click pe „EN" (în interiorul secțiunii Meniu). 4. Compară.
- Observat, măsurat automat înainte/după: `htmlLang` se schimbă corect `ro → en`, DAR
  identic, cuvânt cu cuvânt, rămân: titlul secțiunii Despre („Despre noi"), textul Despre
  (paragraful întreg în română), titlul și textul din Contact („Comandă acum" / „Comandă prin
  WhatsApp..."), titlul galeriei („Galeria noastră"), eticheta „Fotografii", tagline-ul din hero,
  textul butonului CTA, eticheta „Derulează". Singurul lucru care se schimbă e panoul de
  categorii din Meniu — iar chiar și acolo, varianta „EN" conține cuvinte tot în română:
  categoriile „Torturi" și „Plăcinte", felurile „Tort de morcovi", „Tort Oreo", „Pandispan
  Victoria", „Tort de ciocolată" (verificat direct din `presets.json`, ambele preset-uri
  livrate: `menu.en[0].category = "Torturi"`, etc.). Nu există niciun alt control de limbă pe
  toată pagina (`v6_allLangLikeControlsOnPage` conține doar cele 2 butoane EN/RO din Meniu).
  Suplimentar, mecanismul de traducere per-câmp există în `template.html` (atribute
  `data-en`/`data-ro` condiționate de câmpuri gen `business.taglineRo`), dar **niciunul din
  aceste câmpuri „Ro" nu apare în `schema.json`** — deci nici măcar dacă clientul ar vrea, nu
  are cum să completeze o variantă engleză reală pentru tagline/despre/contact din UI.
- Așteptat: fie un comutator de limbă real, la nivel de site, fie eliminarea completă a acestui
  buton mislabeled dacă traduce doar meniul — iar conținutul „EN" al meniului ar trebui să fie
  în engleză.
- Dovadă: `shots/sec-v6-menu-before-en.png`, `shots/sec-v6-menu-after-en.png`,
  `probes/sec-targeted-results.json` → `v6_before`/`v6_after` (identice pe toate câmpurile în afară
  de meniu și `htmlLang`); `templates/desserdirina/presets.json:101-157` (menu.en conține
  cuvinte românești).
- Indiciu cod: `templates/desserdirina/script.js:120-144` (`apply(lang)`),
  `templates/desserdirina/schema.json` (lipsă completă a câmpurilor `*Ro`).

### D9. Hardcodat pe toate cele 5 șabloane: linia de footer „Build by hidook.tech"
- Severitate: minor
- Unde: footer, toate șabloanele
- Pași: 1. Deschide oricare șablon. 2. Derulează la footer. 3. Caută în Detalii/inline vreo
  opțiune de a edita/ascunde acest text.
- Observat: `<p class="hb-built-by">Build by <a href="https://hidook.tech">hidook.tech</a>
  powered by <a href="https://hidook.agency">hidook.agency</a></p>` — text identic, literal, în
  toate cele 5 `template.html`, fără nicio corespondență în `schema.json`. Nu apare în lista de
  câmpuri editabile inline pe niciun șablon.
- Așteptat: dacă e o cerință de business (branding obligatoriu în footer), ok — dar merită
  documentat undeva explicit ca „nu se poate elimina", ca să nu pară o scăpare la fiecare
  raportare QA.
- Dovadă: `grep -rn "hb-built-by" templates/*/template.html` → prezent identic în toate cele 5;
  absent din toate cele 5 `schema.json`.

## SUGESTII (nu sunt defecte; ar face diferența)
- S1. Adaugă o secțiune reală „SEO" în Detalii pentru `business.title`/`business.metaDescription`
  — codul deja are `seoFields` calculat, doar nefolosit (`builder/app.js:3330`); ar rezolva D1 și
  D2 dintr-o mișcare relativ mică.
- S2. Iconițe reale (SVG) pentru Instagram/Facebook pe portfolio, product-menu și professionals —
  desserdirina are deja implementarea de referință (`.contact-icon.*` în CSS), doar de portat.
- S3. Elimină bordura/fundalul tip-input de pe `.pr-contact__row` (professionals) sau adaugă
  iconițe, ca rândurile de contact să nu mai pară un formular gol.
- S4. Pe professionals, fie renunță la duplicarea profession/languages/modes în 2 locuri
  (hero + strip), fie sincronizează-le live (ambele `[data-hb-edit]` cu aceeași cale ar trebui
  actualizate simultan la editare inline).
- S5. Pe desserdirina: fie fă din butoanele EN/RO un comutator real de limbă pentru tot site-ul
  (title/despre/contact/footer), fie relabelează-l clar ca „Limbă meniu" vizibil (nu doar ca
  aria-label) ca să nu inducă în eroare clientul că a tradus site-ul.
- S6. Traduce corect conținutul „EN" al meniului desserdirina (momentan identic cu „RO" pe
  jumătate din feluri).
- S7. Adaugă un control real pentru font (chiar și 2-3 combinații), acum nu există pe niciun
  șablon.

## VERIFICĂRI CERUTE

- **V1 (local-service navbar telefon → nume firmă)**: **INFIRMAT**. Nu există opțiune dedicată;
  bara arată fix telefon+zonă+CTA. Singura variantă e suprascrierea manuală a textului
  telefonului, care lasă un link `tel:` incoerent. Dovadă: D4 de mai sus.
- **V2 (skip text sub poza principală → direct Servicii, professionals)**: **CONFIRMAT**.
  `hero.qualifier` (textul „lede" de sub slogan) e opțional și se poate goli inline; la golire,
  paragraful colapsează vizual la 0 înălțime (rămâne un nod gol în DOM-ul editorului până la un
  re-render complet, dar fără impact vizual) și dispare complet din HTML-ul publicat (`@if
  hero.qualifier` în `template.html:125-127`). Dovadă: `shots/sec-v2-hero-after-empty-lede.png`.
- **V3 (chip-uri professionals editabile/câte/ștergibile)**: **CONFIRMAT**, cu nuanță. Sunt
  exact 3 câmpuri text separate (`business.profession`, `business.languages`, `business.modes`),
  nu o listă — fiecare editabil individual și golibil pentru a elimina acel chip din afișare.
  Nu poți avea mai mult de 3 sau construi altele noi. Defect asociat: D5 (duplicare
  desincronizată hero-card vs. bandă de sub hero).
- **V4 (Instagram/icons pe portfolio + professionals)**: **PARȚIAL / INFIRMAT pe cele mai multe**.
  desserdirina are iconițe SVG reale peste tot (contact + footer). portfolio și product-menu au
  DOAR text „IG"/„FB" în footer, fără iconițe. professionals nu are nicio iconiță ȘI nicio
  abreviere — doar text simplu. Deci cererea „adăugăm icons de rețele" NU e satisfăcută pe
  portfolio, product-menu sau professionals. Dovadă: D6, D7.
- **V5 (bloc contact professionals arată ca inputuri)**: **CONFIRMAT**, cu măsurători exacte
  (bordură 1px, fundal aproape alb, padding ~14×16px, identic pe toate cele 4 rânduri, fără
  iconițe). Dovadă: D6.
- **V6 (desserdirina traducere)**: **CONFIRMAT** integral feedback-ul. Traducerea nu se aplică
  practic deloc (doar `<html lang>` + categoriile de meniu se schimbă), iar chiar și acolo
  conținutul „EN" e parțial tot în română. Lista exactă a textelor care rămân identice la
  „EN": titlul și textul secțiunii Despre, titlul și intro-ul din Contact, titlul galeriei,
  eticheta „Fotografii", tagline-ul din hero, textul butonului CTA, eticheta „Derulează",
  etichetele de contact (telefon/WhatsApp/Instagram/Facebook), tot footerul. Dovadă: D8.
