# Calendar nativ de programări (professionals) — raport explorare

Server local pornit cu `node --experimental-sqlite` + `HIDOOK_TEST_PAY=1` + `HIDOOK_ISOLATED_DEPLOY=1`,
`DATA_DIR` temporar, `PUBLIC_URL` setat după `listening` (pattern din `bot/test/delete-site-oracle.mjs`).
Navigare reală prin Browser pane (Chromium) + verificări directe prin API (curl) și SQLite
(`calendar-native.sqlite`) pentru a confirma exact ce s-a întâmplat la nivel de date, nu doar ce
arată ecranul. Site de test: șablon „Servicii profesionale" (professionals), slug
`cabinet-juridic-ionescuqa-cal-owner-01`, publicat cu plată offline (HIDOOK_TEST_PAY), calendar nativ
activat.

Acoperit:
- Owner: buton „Configurează calendarul" → drawer „Programări native Hidook" → toggle
  Activează/Dezactivează → publicare → apariția butonului „Programări" în dashboard.
- Owner dashboard (`/calendar-native/owner/`), toate cele 5 taburi: Programări, Disponibilitate,
  Personal, Servicii, Setări.
- Servicii: editare nume/durată/pauză + salvare; căutat buton de adăugare/ștergere serviciu (nu există).
- Disponibilitate: program săptămânal (checkbox zi + interval), salvare, mesaj de confirmare.
- Program săptămânal: supraviețuiește unei republicări după o editare de text în editor (verificat
  în UI, nu doar în cod).
- Editorul: secțiunea „Programări" (appointment) cu native booking ON și OFF — ce e vizibil/editabil
  în preview în fiecare caz.
- Republicare cu native booking ON: reflectarea în dashboard (servicii) și lipsa cardurilor de tip
  consultație în preview.
- Vizitator: `/live/<slug>/#appointment`, flux complet serviciu → zi → oră → date → confirmare.
- Email: verificat direct din `calendar_email_outbox` (subiect, body text/html, .ics, link manage).
- Link manage: afișare programare, anulare (cu `window.confirm` patch-uit din consolă, blocat de
  browser tool), verificare eliberare slot.
- Concurență: 2 cereri simultane (curl paralel) pe același slot — status „confirmed" vs „requested".
- Owner: acțiuni pe rezervarea „requested" (reprogramare, anulare) — căutat buton „Confirmă”.
- Edge cases prin API: formular gol, email invalid, slot în trecut, zi fără program, nume de 200
  caractere.
- Mobil 390×844: widgetul, selectorul de zi/oră, dimensiuni butoane (măsurate cu JS,
  `getBoundingClientRect`).
- Fără JS (Playwright, `javaScriptEnabled:false`) și bundle lent (JS activ, script-ul widgetului
  întârziat 6s) — ce vede vizitatorul.
- Verificare V1 (professionals): unde se pun orele disponibile.
- Verificare V2 (portfolio): ce există azi pentru programare online, ce ar trebui adăugat.

Neacoperit:
- Reasignare (Reatribuie) pe un tenant cu 2+ persoane/resurse reale (am confirmat doar din cod că
  butonul apare la `resources.length > 1`; nu am creat un al doilea membru de staff activ pentru o
  reasignare completă cap-coadă — timpul sesiunii nu a ajuns).
- ICS import în Calendar/Outlook real (am verificat doar conținutul .ics generat, nu deschiderea lui
  într-o aplicație de calendar).
- Retenția/anonimizarea automată a datelor (retention.js) — în afara ferestrei de testare.
- „Zile libere/excepții” (date overrides) — am văzut secțiunea în Disponibilitate dar nu am adăugat
  și verificat o excepție cap-coadă (timp).

## DEFECTE (observate, cu dovadă)

### D1. O rezervare „în așteptare” fără resursă alocată nu poate fi CONFIRMATĂ niciodată de owner pe un cabinet cu un singur specialist (cazul tipic professionals)
- Severitate: **major** (blocker pentru fluxul de business în cazul de concurență pe un slot —
  clientul pierde o programare validă fără nicio cale de recuperare din dashboard)
- Unde: `bot/calendar-native/owner/owner-dashboard.js`, `bot/calendar-native/engine.js`
- Pași:
  1. Doi vizitatori trimit aproape simultan o cerere pentru EXACT același interval
     (am reprodus cu 2 cereri POST paralele către `/api/calendar-native/bookings`, echivalentul
     „două tab-uri, ambele trimit”).
  2. Motorul acceptă ambele (HTTP 200): una devine `status:"confirmed"` (cu `resourceId` alocat),
     cealaltă devine `status:"requested"` cu `resourceId: null` — comportament corect și DOCUMENTAT
     onest chiar în widget: „Dacă e ocupat, cererea rămâne în așteptare — nu vei vedea niciodată
     «confirmat» pe un interval deja rezervat.” Vizitatorul vede „Cerere înregistrată”, nu o
     confirmare falsă — asta funcționează bine.
  3. Owner-ul anulează rezervarea confirmată (eliberează slotul). Rezervarea „în așteptare” rămâne
     „în așteptare” — nu se promovează automat.
  4. Owner-ul deschide dashboard-ul „Programări”: rândul „în așteptare” are DOAR „Reprogramează” și
     „Anulează”. Nu există niciun buton „Confirmă”.
  5. Owner-ul încearcă „Reprogramează” → alege chiar slotul acum liber → salvează. Rezervarea rămâne
     tot „în așteptare”, `resourceId` tot `null`.
- Observat: rezervarea rămâne permanent „în așteptare”; singurele acțiuni posibile sunt anulare sau
  mutare pe alt slot — niciodată confirmare, chiar dacă slotul e liber. Clientul care a pierdut cursa
  nu primește niciodată o programare confirmată, iar owner-ul nu are nicio unealtă din UI ca să i-o
  dea.
- Așteptat: fie promovare automată la eliberarea slotului, fie un buton „Confirmă”/„Alocă” disponibil
  și pentru rezervările fără resursă, cel puțin când tenantul are o singură resursă implicită.
- Dovadă:
  - Screenshot: `<scratch>/shots/cal-04-owner-stuck-requested.png` (rândul „Concurrent A” — „în
    așteptare”, doar Reprogramează/Anulează, deși „Concurrent B” de pe același slot e deja anulat).
  - DB: `calendar_bookings` — rândul `bk_a3e8051a865ec39992d18bab` are
    `status:"requested", resource_id:null` chiar și după reprogramare pe slotul liber.
  - Root cause în cod:
    - `bot/calendar-native/owner/owner-dashboard.js` — butonul „Confirmă” apare doar
      `if (b.status === 'requested' && b.resourceId)` (linia ~455-459).
    - Butonul „Reatribuie” apare doar `if (state.resources.length > 1)` (linia ~445) — pe un cabinet
      solo (cazul normal pentru „professionals”) acest buton nu există niciodată.
    - `bot/calendar-native/engine.js`, `confirmBookingAsOwner` (linia 1398): dacă
      `!row.resource_id`, aruncă `RESOURCE_REQUIRED` cu comentariul explicit „the owner must
      reassign it to a resource first (see reassignBookingAsOwner), which itself confirms when
      free” — dar calea de reasignare din UI nu există pentru tenantul cu o singură resursă.
  - Rezultat: pentru marea majoritate a utilizatorilor „professionals” (un singur specialist, fără
    „Personal/resurse” suplimentar), o coliziune de sloturi produce o rezervare orfană, imposibil de
    dus la bun sfârșit din dashboard.

### D2. Textul static din secțiunea de programări contrazice direct calendarul nativ de dedesubt
- Severitate: major (mesaj fals către vizitator despre cum funcționează propria rezervare)
- Unde: `templates/professionals/template.html` (secțiunea `#appointment`), câmpurile
  `appointment.title` / `appointment.intro` / FAQ din `templates/professionals/presets.json`
- Pași: 1. Activează „Programări native Hidook”. 2. Publică. 3. Deschide site-ul live, mergi la
  „Programare”.
- Observat: titlul secțiunii spune „**Solicită o programare**”, textul intro spune „**Confirmăm
  cererea** folosind datele de contact oferite; **formularul nu face o rezervare automată**” — chiar
  deasupra widgetului nativ, care spune „**Confirmarea este instant** dacă intervalul e liber.” Am
  și dus fluxul până la capăt: după trimitere apare cutia verde „**Programare confirmată**” — la doar
  câteva rânduri sub titlul care tocmai a spus vizitatorului că nu se face nicio rezervare automată.
  Mai jos, secțiunea „Întrebări frecvente” (rămasă din formularul vechi) întreabă explicit „Cererea
  confirmă automat programarea?” și răspunde „**Nu**. Înregistrăm cererea și confirmăm
  disponibilitatea înainte ca întâlnirea să devină fermă.” — fals pentru calendarul nativ, care tocmai
  a confirmat instant.
  Cauza: `appointment.title`, `appointment.intro`, `appointment.confirmationText`,
  `appointment.privacyNotice` și FAQ-ul sunt aceleași câmpuri de config folosite ȘI de formularul
  vechi (cerere manuală), ȘI de calendarul nativ (rezervare instant) — nu există text separat pentru
  cele două moduri.
- Așteptat: când `appointment.nativeBooking` e activ, titlul/intro/FAQ ar trebui să reflecte
  comportamentul real (confirmare instant), nu textul gândit pentru cererea manuală.
- Dovadă: `<scratch>/shots/cal-03-copy-contradiction.png` (titlu + intro + widget vizibile în același
  cadru) și `<scratch>/shots/cal-06-mobile-widget.png` (aceeași contradicție pe mobil).
- Indiciu cod: `templates/professionals/template.html:234-243` (`{{appointment.title}}` /
  `{{appointment.intro}}` refolosite identic în ramura `@if appointment.nativeBooking`);
  `templates/professionals/presets.json` → `appointment.confirmationText`,
  `appointment.submitLabel:"Trimite cererea"`.

### D3. Nu există nicio interfață în EDITOR pentru orele disponibile (`appointment.weekly`) sau pentru tipurile de consultație (`appointment.types`) — nici cu calendarul nativ activat, nici dezactivat
- Severitate: major (contrazice direct textul din dashboard-ul de calendar, care spune owner-ului să
  meargă în editor)
- Unde: `builder/app.js` (drawer), `templates/professionals/template.html`
- Pași: 1. Deschide editorul pe șablonul professionals, cu native booking dezactivat. 2. Derulează la
  secțiunea „Programări”. 3. Dă click pe un card de tip consultație („Consultație inițială” etc.).
  4. Activează native booking din drawer. 5. Derulează din nou la „Programări”.
- Observat:
  - Cu native booking OFF: cardurile de tip consultație sunt vizibile, dar clickul pe ele doar
    selectează radio-butonul din formularul de previzualizare — nu apare niciun contur de editare
    inline (spre deosebire de textele obișnuite din pagină, care capătă un contur punctat la click).
    Nu există niciun buton „+ Adaugă tip de consultație”.
  - Programul săptămânal (`appointment.weekly`) nu apare deloc ca text vizibil în preview — în
    `template.html:236-240` e randat într-un `<div id="pr-weekly" hidden aria-hidden="true">`, adică
    e doar o sursă de date pentru JS, niciodată văzut sau editat de owner.
  - `grep` pe `builder/app.js` pentru `appointment.weekly` și `appointment.types`: zero rezultate —
    niciun cod dedicat pentru aceste câmpuri. Tipul de schema e `"list"`, iar drawer-ul generic
    randează doar câmpuri de tip `phone/url/color/background` plus o listă mică de chei parțiale
    (`DRAWER_TYPES`, `DRAWER_KEYS_PARTIAL` — `builder/app.js:762-763`) — `appointment.weekly` și
    `appointment.types` nu se potrivesc cu niciuna.
  - Cu native booking ON: secțiunea „Programări” din preview arată DOAR titlu + intro + avertisment
    + notă de confidențialitate — nici cardurile de tip consultație, nici widgetul nativ (acesta nu
    se randează în preview-ul din editor, probabil pentru că nu are un `customerId`/`siteId` real
    încă). Deci owner-ul nu vede absolut nimic din ce configurează pentru programări cât timp
    editează.
  - În schimb, dashboard-ul de calendar spune explicit (`bot/calendar-native/owner/owner-dashboard.js`,
    tab-ul Servicii): „Le adaugi și le redenumești în editor; durata și pauza le ajustezi aici.” —
    afirmație pe care nu am putut-o confirma nicăieri în editor.
- Așteptat: fie un editor real (listă cu adaugă/șterge/redenumește) pentru tipurile de consultație și
  orele săptămânale, fie cel puțin un link direct din drawer către „Detalii → Programări” cu
  explicația exactă a ce se editează unde.
- Dovadă: observat direct în sesiune (preview-ul editorului, ambele stări on/off, capturat vizual în
  cadrul turelor de explorare); confirmare din cod prin `grep -n "appointment.weekly\|appointment.types" builder/app.js` (zero rezultate) și `templates/professionals/template.html:236-240` (`hidden aria-hidden="true"`).
- Indiciu cod: `builder/app.js:762-763` (`DRAWER_TYPES`, `DRAWER_KEYS_PARTIAL`),
  `bot/calendar-native/owner/owner-dashboard.js:757-761` (comentariul + textul „Le adaugi și le
  redenumești în editor”).

### D4. Fără JavaScript (sau cât timp bundle-ul widgetului se încarcă), vizitatorul vede un gol complet, fără niciun mesaj
- Severitate: minor→major (nu blochează site-ul, dar lasă vizitatorul fără nicio explicație într-o
  zonă critică de business — pierdere de clienți pe conexiuni lente sau cu JS blocat)
- Unde: `templates/professionals/template.html`, `#hnb-root`
- Pași: 1. Deschide site-ul live cu JavaScript dezactivat (Playwright,
  `javaScriptEnabled:false`) sau cu scriptul widgetului artificial întârziat 6s.
- Observat: secțiunea arată titlul, intro, avertismentul de confidențialitate, nota de
  confidențialitate — apoi TRECE DIRECT la „Întrebări frecvente”. Zona unde ar trebui să fie
  calendarul (`#hnb-root`) e goală, fără text, fără schelet de încărcare, fără mesaj „se încarcă” sau
  „activează JavaScript pentru a te programa”. Identic în ambele scenarii (fără JS, și cu JS dar
  bundle lent).
- Așteptat: cel puțin un `<noscript>` cu mesaj + o cale alternativă (telefon/WhatsApp, care de altfel
  există deja pe pagină, dar nu e menționată aici), plus un schelet vizual („se încarcă
  programările…”) cât timp scriptul nu a rulat încă.
- Dovadă: `<scratch>/shots/cal-07-nojs-desktop.png` (fără JS — gol complet între privacy notice și
  FAQ) și `<scratch>/shots/cal-08-slowbundle-midload.png` (JS activ, bundle întârziat 6s, captură la
  1.5s — același gol).
- Indiciu cod: `templates/professionals/template.html:248-266` — `<div id="hnb-root" ...></div>` fără
  niciun conținut inițial/fallback; `<noscript>` din `<head>` (linia 56-58) tratează doar animația de
  reveal CSS, nu are legătură cu calendarul.

## SUGESTII (nu sunt defecte; ar face diferența)

- S1. Serverul acceptă un nume de vizitator de 200+ caractere prin API direct, deși widget-ul propriu
  limitează câmpul la `maxlength="80"` în HTML. Nu e exploatabil grav (necesită ocolirea UI-ului),
  dar ar merita aceeași limită și pe server, ca strat suplimentar de igienă a datelor
  (`bot/calendar-native/public-api.js` / `engine.js`, comparat cu
  `bot/calendar-native/widget/public-booking-widget.js:416`).
- S2. La reprogramarea din dashboard a unei rezervări „în așteptare” pe același interval (fără nicio
  schimbare reală), s-a trimis din nou un email „Cerere de programare înregistrată” — al doilea, deși
  nimic nu s-a schimbat pentru vizitator în afară de un „updated_at”. Merită verificat dacă
  reprogramarea pe un interval identic ar trebui să tacă.
- S3. Legătura „Deschide programările” din drawer-ul editorului apare DOAR după ce site-ul e deja
  publicat și plătit (`currentSitePaid`). Înainte de prima publicare, owner-ul care tocmai a activat
  „Programări native Hidook” nu are niciun indiciu vizual în editor despre UNDE va găsi calendarul
  după publicare — hint-ul text explică CE face funcția, dar nu spune „după ce publici, vei găsi
  butonul Programări în Proiectele tale”. Un rând de o linie ar închide golul de comunicare confirmat
  la D3.
- S4. Header-ul mobil (390px) trunchiază numele afacerii fără elipsă vizibilă
  („Cabinet Juridic Iones” tăiat brusc) — cosmetic, în afara zonei calendarului propriu-zis, notat
  în trecere.

## VERIFICĂRI CERUTE

### V1 (professionals): „Aici adăugăm opțiune de adăugare a datelor/orelor disponibile” — există în EDITOR un loc unde clientul își pune orele disponibile?

**INFIRMAT** (parțial — funcția există, dar NU în editor).

- Orele disponibile se pun EXCLUSIV în dashboard-ul de programări
  (`/calendar-native/owner/` → tab „Disponibilitate”), NU în editorul de site. Acolo interfața e
  bună: checkbox pe zi + interval oră, salvare cu mesaj clar, confirmat că supraviețuiește unei
  republicări ulterioare a site-ului (verificat live: am setat Marți 14:00–19:00 din dashboard, am
  republicat site-ul după o modificare de text în editor, iar programul a rămas 14:00–19:00 — bug-ul
  vechi din `waveD-calendar-survives-republish.test.js` pare corect rezolvat).
- În EDITOR nu există absolut nimic legat de ore disponibile: câmpul de schema
  `appointment.weekly` nu e randat nicăieri vizibil/editabil (vezi D3). Singurul lucru din editor
  legat de calendar e panoul „Programări native Hidook” cu switch-ul Activează/Dezactivează — clar
  scris, cu explicație bună — dar acesta DOAR pornește/oprește funcția, nu spune unde se pun orele.
  Link-ul „Deschide programările” care ar duce owner-ul la locul corect apare DOAR după ce site-ul
  e deja publicat și plătit (vezi S3) — înainte de asta, un owner care tocmai a activat funcția nu
  are niciun indiciu din editor despre ce trebuie să facă în continuare.
- Concluzie: nu e clar din editor că orele trebuie puse în altă parte (dashboard), pentru că editorul
  nu menționează deloc acest pas până la prima publicare.

### V2 (portfolio): „programare online: dropdown alege serviciu → meșterul → ora/data → confirmare pe email” — există pe portfolio? Ce ar lipsi?

**INFIRMAT** (nu există azi) — dar arhitectura nu e o barieră reală.

- Pe șablonul portfolio (salon), azi există DOAR un buton/link WhatsApp
  (`templates/portfolio/schema.json`: `contact.whatsapp`, `labels.bookingEyebrow`,
  `labels.navBooking` — toate WhatsApp, niciun câmp `appointment.*`). Niciun formular, niciun
  calendar, nimic online.
- Confirmat din cod că backend-ul calendarului NU e legat de templateId „professionals” — e condus
  strict de configul site-ului:
  - `bot/webpublish.js:1812` pornește cutover-ul dacă `cutover.configHasNativeBooking(cfgCopy)`,
    indiferent de șablon.
  - `bot/calendar-native/cutover.js` citește generic `config.appointment.*` (types, weekly,
    timezone etc.) — nu verifică templateId nicăieri.
  - Motorul are deja suport complet pentru mai mulți „meșteri”: tab „Personal” în dashboard
    (`bot/calendar-native/owner-api.js` — resurse, `calendar_resources`), iar widgetul are deja un
    selector „Oricine disponibil” + un chip per persoană, ascuns automat când sunt sub 2 resurse
    (`public-booking-widget.js:326-352`, comentat explicit „Wave 7 (audit #25) — resource picker
    chips”). Deci exact fluxul cerut — serviciu → meșterul → oră/dată → confirmare email — e deja
    construit în motor și în widget, doar nu e cablat pe portfolio.
  - Singurul lucru specific „professionals” e cablajul de PREZENTARE: markup-ul de montare a
    widgetului (`data-hidook-cal-native` + `#hnb-root`) există DOAR în
    `templates/professionals/template.html`; `grep` pe `templates/*/template.html` confirmă zero
    potriviri în celelalte 4 șabloane, portfolio inclus.
- Ce ar lipsi concret ca să meargă și pe portfolio:
  1. O secțiune `appointment` în `templates/portfolio/schema.json` (poate copiată/adaptată din
     professionals, eventual redenumind labelurile pentru „salon”/„meșter” în loc de
     „cabinet”/„consultație”).
  2. Markup-ul de montare a widgetului (blocul `#hnb-root` + `<link>`/`<script>` către
     `calendar-native/widget/*`) în `templates/portfolio/template.html`, similar cu
     `templates/professionals/template.html:246-266`.
  3. Panoul „Programări native Hidook” din `builder/app.js` (`buildNativeBookingPanel`) se activează
     deja automat pentru orice șablon al cărui schema conține câmpul `appointment.nativeBooking`
     (`builder/app.js:3231`) — deci pasul 1 de mai sus e suficient ca panoul să apară și pentru
     portfolio, fără cod nou în builder.
  - Nu e nevoie de nicio schimbare în motorul de calendar (`engine.js`, `owner-api.js`,
    `public-api.js`) — acestea sunt deja agnostice de șablon.
