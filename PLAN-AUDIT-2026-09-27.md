# Plan de remediere — Audit Hidook Site Builder 2026-09-27

**Evidence root:** `04-QA-Evidence/Audit-2026-09-27-b45a3e4/`
**SHA auditat:** `b45a3e4` (HEAD la data auditului)
**Autor:** rundă de audit multi-agent (36 de lensuri: 30 inițiale + 6 cerute de criticul de completitudine), consolidată în acest plan.

---

## 1. Rezumat executiv

**Verdict general: produsul are o fundație tehnică mai solidă decât auditul din 2026-09-06** (securitate, motor de calendar, i18n de bază, export/legal sunt semnificativ mai bune), **dar patru defecte critice și un tipar de bug sistemic în `bot/server.js` rămân capabile să coste bani, date sau încredere unui client plătitor real, chiar acum.** Cel mai important: un singur bug (`bot/server.js` `handleGetSite()`, linia ~1687, alege prima versiune salvată în loc de ultima) explică simultan pierderea silențioasă a conexiunii Instagram, indicatorul greșit al calendarului din dashboard, și probabil alte cazuri de „reeditare pierde ce tocmai ai publicat” — un singur fix la un singur loc rezolvă trei constatări.

### Scor per suprafață (/10)

| Suprafață | Scor | Motiv pe scurt |
|---|---|---|
| Landing | 5 | Afirmație de preț falsă în 4 locuri, contrazisă de propria pagină de Termeni la un click distanță |
| Catalog | 7 | Funcțional, dar cold-load 2.4-3x peste ținta din VISION §4.1 (thumbnail-uri necomprimate) |
| Editor | 4 | Panoul „Detalii” blochează bara de instrumente (nu poți apăsa Publică); race condition la editare text; culori pot deveni ilizibile |
| Preview | 6 | Fidelitate editor↔live e bună; Ctrl/Cmd+A nu selectează text în iframe-ul sandbox |
| Cont | 3 | Scurgere de date cross-cont prin localStorage nescopat pe userId; zero autoservire GDPR |
| Plată/trial | 5 | Motorul de facturare (rate-limit, dunning, monede) e solid; afirmația de preț de pe landing îl contrazice |
| Publicare | 4 | Adresa (slug) aleasă explicit e ignorată silențios dacă autosave a creat deja site-ul |
| Export | 4 | ZIP/HTML cu programare nativă activă depinde silențios de originea Hidook; og:image invalid |
| Legal | 6 | Atribuire, Termeni, Cookie-uri corecte pe toate cele 5 șabloane; banner fără buton de refuz simetric |
| Șabloane | 4 | Bug critic de contrast pe „Professionals”; linkuri de navigație moarte după ascunderea unei secțiuni |
| Calendar nativ | 5 | Motor solid (race-safe, DST-safe), dar fus orar/interval nesetabile din UI și email real dezactivat silențios |
| Mobil | 4 | Ținte de atingere <44px pe tabletă; panoul „Detalii” blochează Publică și pe telefon |
| A11y | 4 | Capcană de tastatură în bannerul de cookie de pe `/app/`; focus nu revine după Escape |
| Performanță | 6 | Site-urile publicate sunt rapide (LCP ~1.9s); catalogul și UI-ul propriu al builder-ului nu sunt |
| Securitate | 5 | Bază mult mai solidă (rate-limit, headere, sesiuni, SQL parametrizat) + o scurgere critică cross-cont + validare MIME slabă la upload |
| Date | 5 | Migrațiile și backup-ul sunt solide; autosave-ul concurează cu publicările reale pentru sloturile FIFO de versiuni |
| Texte/i18n | 5 | Majoritatea corectă în română; mesaje de eroare de server rămase în engleză ajung neschimbate în UI |
| Documentație | 4 | Regexul propriului oracol anti-documente-învechite cere încă „7-day trial” în loc de 14 |

### Top 10 riscuri, în cuvinte simple

1. **Landing-ul minte despre preț.** Spune „achiți o singură dată, fără abonament”, dar produsul e un abonament Stripe care se reînnoiește anual la 29 — chiar pagina de Termeni linkuită din același footer spune adevărul. Risc de reclamații și de percepție de înșelăciune.
2. **Un client poate vedea datele afacerii altui client.** O ciornă nesalvată în cont rămâne în browser și „sare” în contul următoarei persoane care se autentifică pe același calculator/browser — inclusiv telefon, WhatsApp, adresă.
3. **Reeditarea unui site publicat poate pierde ce tocmai a fost publicat**, fără nicio eroare vizibilă — Instagram dispare de pe site-ul live, indicatorul de calendar rămâne blocat pe starea veche.
4. **Culoarea textului poate deveni ilizibilă** pe șablonul „Professionals” dacă proprietarul alege un accent deschis — și pe orice șablon dacă alege un fundal de pagină întunecat.
5. **Adresa (slug) aleasă explicit la publicare e ignorată silențios** dacă autosave-ul a creat deja site-ul sub alt nume — clientul publică fără să știe la altă adresă decât cea confirmată cu bifă verde.
6. **Nu poți apăsa butonul „Publică site-ul”** pe orice ecran ≥768px cât timp panoul „Detalii” e deschis (ceea ce se întâmplă automat la fiecare design nou) — un strat invizibil îl blochează.
7. **Un client care are deja un site plătit, live cu autosave activ, poate pierde acel conținut din istoricul de versiuni** în câteva minute de editare (10 sloturi FIFO, fără distincție draft/publicare reală).
8. **Zero autoservire GDPR** (ștergere/export date) accesibilă din produsul plătit în browser — singura implementare există în Telegram, care e înghețat.
9. **Exportul ZIP/HTML al unui site cu programare nativă activă nu funcționează independent** — depinde silențios de originea Hidook, contrar promisiunii explicite din VISION §6.
10. **Bannerul de cookie de pe `/app/` capturează tastatura** — orice utilizator de tastatură rămâne blocat în el la prima vizită, înainte să poată naviga oriunde altundeva.

---

## 2. Metodă și acoperire

**Lensuri rulate (36):** journey-stranger, landing, catalog-firstrun, editor-text-images, theme-typography, sections-structure, whatsapp-contact, preview-fidelity, auth-account, billing-trial, publish-live, export, legal-cookies-attribution, tpl-menu-service, tpl-portfolio-pro-desserd, calendar-native, instafidget-social, builder-mobile, a11y, performance, api-security, data-integrity, copy-i18n, docs-consistency, test-health, edge-errors, ux-benchmark, owner-dashboard, images-media, visual-design, gap-drawer-backdrop-audit, gap-custom-domain-selfserve-depth, gap-cross-account-draft-leak-depth, gap-pricing-display-consistency-live, gap-csrf-poc, gap-gdpr-data-rights-reachability.

**Ce s-a verificat adversarial:** toate cele 4 constatări critice au fost re-derivate independent de două ori (nu doar re-citite din raportul lensului original — un al doilea agent a reprodus mecanismul de la zero, cu propriul script/browser). Majoritatea celor 25 de constatări high au primit cel puțin o verificare independentă suplimentară; câteva (journey-stranger#4, calendar-native#1/#2, builder-mobile#1, docs-consistency#2) au o singură verificare înregistrată. Constatările medium/low au rămas la o singură trecere (status `neverificat` în tabelul canonic) — nu au fost respinse, doar nu au primit al doilea pass adversarial din bugetul acestei runde.

**Ce a fost infirmat (refuted):** niciuna. Toate cele 41 de verdicte ale verificatorilor au ieșit „confirmat” — un rezultat suspect de uniform: verificatorii au fost probabil îngăduitori, așa că „confirmat” aici înseamnă „reprodus de un al doilea agent”, nu „imposibil de contestat”. Contrapondere: cele 4 critice au fost re-verificate direct în cod de orchestrator (`bot/server.js:1687` + `ORDER BY seq ASC` în `bot/registry-sqlite.js:342`; `doLogout()` din `builder/app.js:6774` nu șterge `hb.draft.v1`; `templates/professionals/styles.css:13` `--ink: var(--color-primary-dark)`; `builder/index.html:236-332` „achiți o singură dată”) — toate patru se confirmă. Viteza catalogului a fost re-măsurată pe mașina liberă (load 2,6 pe 11 nuclee), fiindcă lensurile au măsurat sub încărcare mare: pe Fast-3G (1,6 Mbps, 150 ms) + CPU 4x, prima poză de card apare la ~7,6 s și `load` la ~9,8 s, stabil pe 6 rulări — deci constatarea nu e un artefact al încărcării.

**Goluri oneste de acoperire** (din notele proprii ale lensurilor):
- Niciun Stripe Checkout real (test-mode) nu a putut fi deschis — cheie CLI expirată, fără `STRIPE_SECRET_KEY` — confirmarea vizuală a promo-code-ului pe pagina hosted Stripe rămâne neverificată (`gap-pricing-display-consistency-live#3`).
- Fără DNS/TLS real, fără dispozitiv fizic (telefon/tabletă), fără alt browser în afară de Chromium/Brave.
- Fără scanner automat de accesibilitate (axe-core absent din `node_modules`) — verificările a11y au fost manuale.
- Export testat end-to-end doar pentru 2 din 5 șabloane (professionals, product-menu); celelalte 3 doar verificate că răspund 200.
- Fișierele Telegram (`bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`) nu au fost atinse — înghețate per decizie owner.
- Nicio livrare reală de email (transport local/memory peste tot, per regulile auditului).
- A doua/a treia variantă de preset per șablon confirmată needen din UI, dar nu s-a testat un flux alternativ de alegere a presetului (nu există).

---

## 3. Constatări critice și high

| ID | Titlu | Suprafață | Stare | Efort | Dovadă (extras) |
|---|---|---|---|---|---|
| **landing#1** | Landing spune „o singură plată”, produsul e abonament cu reînnoire 29/an | Landing, footer, Termeni | confirmat | S | `landing/01-landing-hero-desktop.png`, `landing/05-footer-desktop.png` |
| **gap-cross-account-draft-leak-depth#1** | Draft nesalvat „sare” din contul A în contul B prin localStorage nescopat | Editor, cont | confirmat | M | `gap-cross-account-draft-leak-depth/network-capture.json` |
| **theme-typography#1** | Text ilizibil pe „Professionals” când textul urmează culoarea accent (contrast 1.33:1) | Editor, șablon professionals | confirmat | S | `theme-typography/contrast-dump.json` |
| **instafidget-social#1** | Reeditarea unui site publicat pierde Instagram; republicarea îl șterge de pe site-ul live | Editor, Instafidget, publish-live | confirmat (known) | S | `instafidget-social/stale-version-regression/*.png` |
| gap-drawer-backdrop-audit#1 | `#drawer-overlay` acoperă toată bara de instrumente ≥768px (z-index 450>200) | Editor topbar | confirmat | S | `gap-drawer-backdrop-audit/matrix-results.json` |
| calendar-native#3 | Indicatorul Programări din dashboard rămâne blocat pe starea veche după republicare | Dashboard, calendar nativ | confirmat (known) | S | `owner-dashboard/03-professionals-card-calendar-on.png` |
| export#1 | Export ZIP/HTML cu programare nativă activă depinde de originea Hidook | Export | confirmat | M | `export/script1-result.json` |
| a11y#1 | Capcană de tastatură în bannerul de cookie de pe `/app/` la prima vizită | Landing, a11y | confirmat | M | `a11y/02-after-4-tabs-stuck-in-cookie-banner.png` |
| gap-drawer-backdrop-audit#3 | Bara de quickstart + badge WhatsApp nu sunt protejate de suprapunerea panoului | Editor | confirmat | M | `gap-drawer-backdrop-audit/07,13-*.png` |
| data-integrity#2 | Autosave inserează versiuni noi, concurează cu publicările reale pentru cele 10 sloturi FIFO | Date, publicare | confirmat | M | `data-integrity/version-staleness-results.json` |
| copy-i18n#3 | Mesaje de eroare server rămase în engleză ajung neschimbate în UI RO | Texte/i18n | confirmat (known) | M | `edge-errors/03-save-pill-after-draft-500.png` |
| edge-errors#2 | Emoji tăiat la limita de caractere corupe textul cu U+FFFD pe site-ul live | Editor, edge-errors | confirmat | S | `edge-errors/01-tagline-after-emoji-straddle-maxlen.png` |
| journey-stranger#4 | Verificarea link-ului magic în același tab pierde progresul publicării, fără indiciu | Publicare, auth | confirmat | M | `journey-stranger/repro-auth-same-tab/02-*.png` |
| editor-text-images#1 | Editarea numelui afacerii poate șterge o editare concurentă pe alt câmp (race ~300ms) | Editor | confirmat | M | `editor-text-images/01-03-*.png` |
| editor-text-images#2 | Slug ales explicit la publicare e ignorat silențios dacă autosave a creat deja site-ul | Publicare | confirmat | M | rețea capturată live, `bot/server.js:3690` |
| theme-typography#2 | Fundal de pagină ales de client poate face textul ilizibil pe toate cele 5 șabloane | Șabloane, editor | confirmat | M | `theme-typography/01-03-*.png` |
| sections-structure#1 | Ascunderea unei secțiuni lasă linkuri moarte în navigație + CTA principal | Șabloane | confirmat | M | `sections-structure/07,08-*.png` |
| whatsapp-contact#1 | Număr WhatsApp în format local (0 fără prefix țară) produce link wa.me invalid | WhatsApp, contact | confirmat | S | `whatsapp-contact/05-defect-leading-zero-local-format.png` |
| preview-fidelity#2 | Ctrl/Cmd+A nu selectează text în câmpurile editabile din preview (iframe sandbox) | Preview, editor | confirmat | S | `preview-fidelity/01,02-*.png` |
| auth-account#3 | Fără setări de cont / autoservire GDPR (ștergere, export date) în produsul browser | Cont, legal | confirmat | M | `auth-account/06-account-menu-open-userb.png` |
| calendar-native#1 | Fus orar, interval sloturi, fereastră anulare nesetabile din nicio interfață | Calendar nativ | confirmat | S | `calendar-native/11,16-*.png` |
| calendar-native#2 | Livrare reală de email pentru calendar dezactivată silențios în producție | Calendar nativ | confirmat | M | `bot/calendar-native/email/provider.js:118-140` |
| builder-mobile#1 | Aproape toate butoanele topbar sub 44×44px pe tabletă tactilă reală (768px) | Mobil, editor | confirmat | S | `builder-mobile/04-editor-topbar-tablet-768.png` |
| docs-consistency#2 | Oracolul anti-documente-învechite cere el însuși „7-day trial” în loc de 14 | Documentație | confirmat | S | `git show 2f1bb95 -- bot/test/flow4-*.test.js` |
| test-health#1 | Oracolul regresiei fix-ului de iframe Chrome (b45a3e4) e roșu din cauza propriului mock | Test-health | confirmat | S | `test-health/rerun-flow1-*.log` |
| owner-dashboard#4 | Site Anulat, hosting neexpirat, fără buton de reactivare pe card | Dashboard | confirmat | S | `owner-dashboard/04-after-anuleaza-billing-portal.png` |
| images-media#1 | og:image/twitter:image invalid (blob base64 ~147KB) în HTML descărcat | Export, imagini | confirmat | S | `images-media/export-html-inline-image-analysis.json` |
| gap-drawer-backdrop-audit#2 | Pe telefon (390px), deschiderea manuală a panoului reproduce blocarea Publică | Mobil, editor | confirmat | S | `gap-drawer-backdrop-audit/phone-manual-open-followup/*` |
| gap-custom-domain-selfserve-depth#1 | canonical/og:url rămân pe domeniul vechi la schimbarea domeniului custom | Domenii, SEO | confirmat | S | `gap-custom-domain-selfserve-depth/raw-checks.json` |

---

## 4. Plan de remediere în valuri

**Notă de metodă:** `builder/app.js` și `bot/server.js` sunt fișiere-monolit atinse de zeci de constatări. Ca să respect regula „niciun fișier partajat între două task-uri din același val”, task-urile care ating aceste două fișiere sunt grupate — un singur task „proprietar” per fișier fierbinte, per val. Asta produce câteva task-uri mai mari și mixte tematic (ex. R-07 grupează editor + setări calendar), dar garantează zero conflict de fișier în interiorul unui val. Verificat explicit mai jos la fiecare val.

### Val 0 — blocaje comerciale/legale + pierdere/scurgere de date (3 task-uri)

| | R-01 | R-02 | R-03 |
|---|---|---|---|
| **Titlu** | Onestitate preț pe landing | Izolare draft/sesiune per cont | Integritate versiuni site |
| **Constatări** | landing#1 | gap-cross-account-draft-leak-depth#1 | instafidget-social#1, calendar-native#3, editor-text-images#2, data-integrity#2, data-integrity#3 |
| **Fișiere exclusive** | `builder/index.html` | `builder/app.js` | `bot/server.js`, `bot/registry-sqlite.js`, `bot/registry-json.js` |
| **Acceptare** | Vizitator nou pe `/app/` — hero, proof-row, „Cum funcționează”, footer spun toate „99 după trial, apoi reînnoire anuală 29 dacă nu anulezi”, identic cu `terms.html`. Oracol Playwright care citește textul celor 4 zone și îl compară cu `GET /api/config`. Docs: verifică VISION.md §2/PRODUCT.md rămân sincronizate (deja sunt). | Cont B, tab nou, niciodată folosit — deschide `/app/#edit` direct — nu vede nicio dată din contul A. Oracol: 2 conturi reale, verifică draft A nu apare la B nici înainte, nici după login/logout. | Publică → editează de 2 ori → GET `/api/sites/:id` întoarce ultima versiune, nu prima. Publică cu slug ales explicit → site-ul apare la acel slug. 12 autosave-uri succesive pe un site publicat → publicarea reală nu e evacuată din FIFO. Oracol Playwright pe cele 3 scenarii, capturi denumite din acțiune. |
| **Docs de actualizat** | — (copy nu schimbă modelul comercial, doar îl reflectă corect) | — | — |
| **Efort** | S | M | M |
| **Dependențe** | poartă owner (§5) | — | — |

**R-04 (validare upload + gardă CSRF) a fost mutat în Val 3:** constatările lui sunt medium/low (nu blocaje), iar garda CSRF se pune în `requireAuth()` din `bot/server.js`, fișier deținut în Val 0 de R-03.

**Poartă owner pentru R-01:** vezi secțiunea 5 — există o alegere comercială reală aici, nu doar o corecție de copy.

### Val 1 — flux esențial (core journey) (9 task-uri)

| | R-05 | R-06 | R-07 | R-08 | R-26 |
|---|---|---|---|---|---|
| **Titlu** | Capcana de tastatură din bannerul de cookie + erori de server în română | Panoul „Detalii” blochează bara de instrumente | Corecții editor (`app.js`) | Ctrl/Cmd+A în preview + mock de test stricat | Setările calendarului în dashboard |
| **Constatări** | a11y#1, copy-i18n#3 (partea server) | gap-drawer-backdrop-audit#1, #2, #3 | journey-stranger#4, editor-text-images#1, whatsapp-contact#1, theme-typography#2 (garda de contrast din selectorul de culoare), owner-dashboard#4 | preview-fidelity#2, test-health#1, edge-errors#2 | calendar-native#1 |
| **Fișiere exclusive** | `builder/index.html`, `bot/server.js` | `builder/app.css` | `builder/app.js` | `builder/edit-overlay.js`, `bot/test/flow1-catalog-preview-completion.test.js` | `bot/calendar-native/owner/owner-dashboard.js`, `bot/calendar-native/owner-api.js` |
| **Acceptare** | Tab la prima vizită pe `/app/` NU rămâne blocat în bannerul de cookie; focusul poate ieși din el. Mesajele de eroare de server care ajung în UI sunt în română („Site not found.”, „Access denied.”, validări poze/slug). | La orice lățime ≥768px, cu panoul deschis (auto sau manual), un click real pe „Publică site-ul” publică — nu închide doar panoul. Testat și la 390px (deschidere manuală). | Reluarea publicării după autentificare în același tab arată un banner clar. Editare nume afacere + alt câmp în <300 ms → ambele persistă. Număr WhatsApp „0721...” → link wa.me valid cu prefix de țară sau avertisment clar. Selectorul „Fundal pagină” avertizează/corectează când textul devine ilizibil. Un site Anulat cu hosting încă valabil are pe card butonul „Reactivează site-ul” (→ `POST /api/sites/:id/checkout`). | Triple-click sau Ctrl/Cmd+A selectează textul din câmpul editabil al preview-ului. `node --experimental-sqlite --test bot/test/flow1-*.test.js` trece. Un emoji tăiat la limita de caractere nu mai lasă un surogat singur (U+FFFD) pe site-ul live. | Fus orar, pasul intervalelor, fereastra de anulare și pauza implicită se setează din tab-ul Setări al dashboard-ului de programări și se reflectă în widget-ul public. Dacă e nevoie de o rută nouă în `bot/server.js`, rulează după integrarea R-05 (secvențial, nu în paralel). |
| **Docs de actualizat** | — | — | — | — | VISION §8 dacă se schimbă ce poate configura proprietarul |
| **Efort** | M | S/M | M | S | S/M |
| **Dependențe** | — | — | — | — | R-05 doar dacă atinge `bot/server.js` |

| | R-09 | R-10 | R-11 | R-12 |
|---|---|---|---|---|
| **Titlu** | Export independent de originea Hidook | Email real pentru calendarul nativ | Oracol trial 7→14 zile + docs sincronizate | Șabloane: contrast text + linkuri moarte după ascunderea unei secțiuni |
| **Constatări** | export#1 | calendar-native#2 | docs-consistency#2, legal-cookies-attribution#2 | theme-typography#1, theme-typography#2 (partea de șablon), sections-structure#1 |
| **Fișiere exclusive** | `bot/site-export.js`, `bot/calendar-native/cutover.js` | `bot/calendar-native/email/provider.js`, `bot/email.js`, `bot/calendar-native/widget/public-booking-widget.js` | `bot/test/flow4-stale-commercial-docs.test.js`, `VISION.md`, `README.md`, `GO-LIVE.md`, `LAUNCH.md`, `bot/README.md`, `bot/DEPLOY.md`, `CLOUDFLARE-DEPLOY.md`, `ARCHITECTURE.md`, `PROJECT_STATUS.md` | `build.js`, `templates/*/template.html`, `templates/*/styles.css` (toate cele 5 șabloane) |
| **Acceptare** | Export ZIP/HTML cu `appointment.nativeBooking` activ, servit static (fără cod Hidook), nu face niciun request către un host Hidook. Oracol: unzip + server static + Chromium, zero request extern. | `CALENDAR_EMAIL_TRANSPORT=resend` trimite email real (adaptor Resend, cheie din `RESEND_API_KEY` deja existentă). Fallback: manage-link vizibil pe ecranul de succes al widget-ului. | `node --experimental-sqlite --test bot/test/flow4-*.test.js` eșuează dacă apare „7-day trial”/„day 7” lângă „subscription”. VISION.md și toate fișierele din `DOC_RELS` extins spun „14 zile”. | `--ink` pe professionals folosește același calcul pre-paint de contrast ca `--cta-ink` (scriptul din `template.html`), iar textul de pe orice „Fundal pagină” rămâne ≥4.5:1 pe toate cele 5 șabloane, măsurat pe `/live/<slug>/`. Ascunderea unei secțiuni elimină și linkul de navigație/CTA corespunzător. Comentariile din fișierele de șablon rămân scurte (se livrează clientului — AGENTS.md). |
| **Docs de actualizat** | VISION §6 rămâne corect (deja promite asta) — doar codul se aliniază | — | Chiar acest task ESTE actualizarea de docs | — |
| **Efort** | M | M | S | M/L |
| **Dependențe** | — | — | — | Site-urile deja live trebuie republicate ca să primească fixul (poartă owner §5) |

**Verificare exclusivitate Val 1:** `builder/index.html` + `bot/server.js` doar R-05; `builder/app.css` doar R-06; `builder/app.js` doar R-07; `builder/edit-overlay.js` doar R-08; `bot/calendar-native/owner/*` + `owner-api.js` doar R-26; `bot/site-export.js` + `cutover.js` doar R-09; `bot/calendar-native/email/*`, `bot/email.js`, widget-ul public doar R-10; fișierele `.md` doar R-11; `build.js` + `templates/*/template.html` + `templates/*/styles.css` doar R-12. Fără suprapuneri. Autoservirea GDPR (auth-account#3) a fost scoasă din R-05: are nevoie simultan de `builder/app.js`, `builder/index.html` și `bot/server.js` și e blocată de o decizie owner — vezi R-27 în Val 4.

### Val 2 — UX major (7 task-uri)

| | R-13 | R-14 | R-15 | R-16 |
|---|---|---|---|---|
| **Titlu** | Ținte de atingere <44px pe tabletă | og:image invalid în export | SEO rămâne pe domeniul vechi la schimbarea domeniului | builder/app.js: preț inconsistent + GIF animat devine static + terminologie „proiect”→„site” |
| **Constatări** | builder-mobile#1 | images-media#1 | gap-custom-domain-selfserve-depth#1 | gap-pricing-display-consistency-live#1, gap-pricing-display-consistency-live#2, images-media#3, copy-i18n#1 (partea app.js) |
| **Fișiere exclusive** | `builder/app.css` | `bot/site-export.js` | `bot/domains.js` | `builder/app.js` |
| **Acceptare** | Pe tabletă tactilă reală (768px, `pointer:coarse`), toate controalele topbar/panou ating 44×44px. | `<meta property="og:image">` din export e un URL absolut, nu un `data:` URI de 147KB. Testat cu un share-debugger real sau echivalent. | Schimbarea domeniului conectat actualizează imediat canonical/og:url/robots.txt/sitemap.xml (fallback la origine sigură), nu doar la verificarea DNS reușită. | Prețul 99/29 apare identic (cu sau fără simbol monedă, decizie owner — vezi §5) pe landing, modal-publish, modal-success, card dashboard, Facturi. Upload GIF animat păstrează animația sau avertizează explicit. „Proiectele mele”→„Site-urile mele” peste tot în app.js. |
| **Docs de actualizat** | — | — | — | Dacă owner alege politica de preț „plain” pentru tot funnel-ul (vs doar landing), notează decizia în PRODUCT.md |
| **Efort** | S | S | S | S |
| **Dependențe** | — | — | Rulează după R-09 (Val 1) dacă ating cod comun de origine publicată — verificat: nu ating, fișiere diferite | Poartă owner pe politica de preț (§5) înainte de a începe |

| | R-17 | R-18 | R-19 |
|---|---|---|---|
| **Titlu** | Thumbnail-uri catalog necomprimate (cold-load 7-9s) | Cookie banner acoperă footer legal pe mobil + terminologie în index.html | Mesaj de blocare la ștergere trimite spre secțiune inexistentă |
| **Constatări** | catalog-firstrun#1 | landing#2, copy-i18n#1 (partea index.html) | copy-i18n#2 |
| **Fișiere exclusive** | `scripts/build-builder.js` | `builder/index.html` | `bot/server.js` |
| **Acceptare** | Cold-load catalog pe throttling Fast-3G arată fotografiile complete în ≤3s (per VISION §4.1), thumbnail-uri redimensionate ~800px + recompresie JPEG. Bază de comparație re-măsurată pe mașina liberă: prima poză ~7,6 s, `load` ~9,8 s, ~1,4 MB. | Linkurile Termeni/Confidențialitate/Cookie-uri rămân clickabile la 390px cu bannerul vizibil. „Proiectele mele”→„Site-urile mele” în tab-ul de navigare/titlu. | Textul spune exact controlul real („Apasă «Anulează» pe acest site”), nu o secțiune „Facturare” inexistentă. |
| **Efort** | M | S | S |

**Verificare exclusivitate Val 2:** `builder/app.css` doar R-13; `bot/site-export.js` doar R-14 (val diferit de R-09 din Val 1, ok — reutilizare cross-val e permisă); `bot/domains.js` doar R-15; `builder/app.js` doar R-16; `scripts/build-builder.js` doar R-17; `builder/index.html` doar R-18; `bot/server.js` doar R-19. Fără suprapuneri.

### Val 3 — polish/backlog + securitate de adâncime (7 task-uri)

| | R-20 | R-21 | R-22 |
|---|---|---|---|
| **Titlu** | Documentație tehnică sincronizată | Oracole de test reparate | A11y + robustețe pe site-urile publicate |
| **Constatări** | docs-consistency#3, docs-consistency#4, docs-consistency#5 | test-health#2, test-health#3 | a11y#3, whatsapp-contact#3, images-media#6 |
| **Fișiere exclusive** | `ARCHITECTURE.md`, `PROJECT_STATUS.md`, `CHANGELOG.md` | `bot/test/flow3-legal-export.test.js`, `bot/test/suite4-modal-contract.test.js` | `templates/*/template.html`, `templates/*/script.js` (toate cele 5 șabloane) |
| **Acceptare** | Docblock-ul de rute din `bot/server.js` (doar citit, nu editat aici — se documentează în ARCHITECTURE.md) listează domenii custom + facturi. PROJECT_STATUS.md și CHANGELOG.md reflectă ultimele ~3 săptămâni de valuri. | `loadPlaywright()` din flow3 folosește același fallback cu 3 căi ca suite4/advocate. suite4 nu (mai) e roșu sub sarcină completă (timeout mărit sau retry). | Skip-link pe toate cele 5 șabloane publicate. Modalul QR WhatsApp mută focusul + focus-trap la deschidere. `<img>` cu `onerror` la fallback neutru. |
| **Efort** | S | S | S/M |

| | R-23 | R-24 | R-25 |
|---|---|---|---|
| **Titlu** | Corecții mici de editor | Font neutilizat eliminat din exportul desserdirina | JSON-LD cu domeniu fals „.example” |
| **Constatări** | a11y#2, builder-mobile#2, edge-errors#4, images-media#4, instafidget-social#3, instafidget-social#4 | performance#3 | tpl-portfolio-pro-desserd#1 |
| **Fișiere exclusive** | `builder/app.js` | `templates/desserdirina/styles.css`, `scripts/build-builder.js` | `templates/portfolio/presets.json`, `templates/local-service/presets.json` |
| **Acceptare** | Focus revine la `#btn-open-drawer` după Escape. Câmpul slug e auto-selectat la focus. Verificare slug eșuată la rețea arată stare distinctă de „valid”. SVG logo rămâne vectorial (nu rasterizat). Status Instafidget nu mai arată text stale/invizibil. | `montserrat-300-*.woff2` (103KB) eliminat din `templates/desserdirina/fonts/` — nefolosit de niciun `font-weight:300` din CSS. | `seo.jsonLd.url` reflectă adresa reală publicată, nu `https://<slug>.example`. |
| **Efort** | S | S | S |

| | R-04 (mutat din Val 0) |
|---|---|
| **Titlu** | Validare upload pe octeți + gardă CSRF proprie |
| **Constatări** | api-security#1, gap-csrf-poc#1 |
| **Fișiere exclusive** | `bot/server.js`, `bot/webpublish.js`, `bot/auth.js` |
| **Acceptare** | Upload de „imagine” cu octeți non-imagine → respins sau re-encodat, nu servit public. Cerere cross-site (alt `Origin`) pe billing-portal/domain/delete → 403 explicit din cod, nu doar din SameSite implicit. `parseJson()` cere `Content-Type: application/json`. |
| **Efort** | S/M |

**Verificare exclusivitate Val 3:** `ARCHITECTURE.md`/`PROJECT_STATUS.md`/`CHANGELOG.md` doar R-20; fișierele de test doar R-21; `templates/*/template.html`+`script.js` doar R-22; `builder/app.js` doar R-23 (val diferit de R-07/R-16, ok); `templates/desserdirina/styles.css` doar R-24 (diferit de `template.html`/`script.js` din R-22); `templates/*/presets.json` doar R-25; `bot/server.js` + `bot/webpublish.js` + `bot/auth.js` doar R-04. Fără suprapuneri.

### Val 4 — după porțile owner (1 task)

| | R-27 |
|---|---|
| **Titlu** | Autoservire GDPR în cont: descarcă datele mele / șterge contul |
| **Constatări** | auth-account#3, auth-account#4 (deconectarea de pe toate dispozitivele accesibilă și din dashboard) |
| **Fișiere exclusive** | `builder/app.js`, `builder/index.html`, `bot/server.js`, plus fișiere noi dacă e nevoie |
| **Acceptare** | Un client autentificat găsește „Descarcă datele mele” și „Șterge contul” în meniul contului, pornind din dashboard, fără să știe vreo rută; exportul conține site-urile, versiunile și rezervările proprii; ștergerea cere confirmare explicită, oprește abonamentul în mod onest și retrage site-ul live. Oracol Playwright cu două conturi (A nu vede și nu poate șterge nimic din B). |
| **Docs de actualizat** | VISION §5 / PRODUCT.md — ce drepturi GDPR are clientul în produs |
| **Efort** | M/L |
| **Dependențe** | Decizia owner despre scop (§5) + text legal final; rulează după integrarea valurilor 1–3 ca să poată deține singur cele trei fișiere mari |

**Restul constatărilor medium/low neincluse mai sus** sunt în secțiunea 7 (Backlog) — nu au fost forțate într-un task de val ca să nu îngroașe artificial grid-ul de fișiere de mai sus, dar niciuna nu e pierdută.

---

## 5. Porți owner — ce decide/face doar owner-ul

- **R-01 (onestitate preț landing):** textul actual vine din trei cereri explicite ale owner-ului din 2026-09-15/16 (`194eb08`, `c121df3`, `76a35b0`), deci nu e o greșeală de implementare pe care studioul o poate „repara” singur. Alegerea este între (a) rescrie copy-ul ca să reflecte reînnoirea anuală de 29 (efort mic, recomandat) sau (b) elimină efectiv reînnoirea din model dacă owner-ul chiar vrea plată unică reală (necesită sincronizare Stripe + VISION.md + PRODUCT.md + server.js — efort mare). **Aceasta e o decizie comercială, nu doar de copy.**
- **R-16 (politica de preț „plain” vs „cu simbol”):** dacă „99 fără simbol de valută” (decizie owner 2026-09-16) era gândită doar pentru landing sau pentru tot funnel-ul (modal-publish, success, dashboard, facturi). Fără această decizie, R-16 nu poate ști ce să unifice.
- **Stripe live / promo codes reale:** `gap-pricing-display-consistency-live#3` nu a putut fi verificat vizual în Stripe Checkout hosted — necesită owner cu o cheie Stripe test reală, în afara regulilor acestui audit.
- **DNS/TLS real pentru domenii custom:** verificarea completă a `gap-custom-domain-selfserve-depth#1` în producție reală (nu doar stub Cloudflare) e o poartă owner (DNS live).
- **Republicarea site-urilor live existente** după fixurile de contrast (theme-typography#1/#2) și linkuri moarte (sections-structure#1): aceste fixuri nu se aplică retroactiv unui site deja publicat până nu e republicat — owner-ul decide dacă/când anunță clienții existenți să republice, sau dacă studioul rulează un republish în lot.
- **Text legal final** (nume companie, CUI/VAT, subprocessors, jurisdicție) — VISION §5 spune explicit „nu se livrează la clienți plătitori cu text legal inventat”; owner-ul trebuie să furnizeze aceste date înainte ca R-27 (GDPR) sau orice altă schimbare de text legal să fie considerată completă în producție.
- **Scop GDPR (R-27):** cât de departe merge autoservirea (doar export, sau și ștergere completă cu efect ireversibil) — decizie de risc/legal a owner-ului.

---

## 6. Amânate

- **Tot ce ține de Telegram** (`bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`) — înghețat per decizie owner 2026-09-06, confirmat în VISION.md §1 și AGENTS.md. Nicio constatare din acest audit nu a atins aceste fișiere.
- **Backlog structural cunoscut și acceptat, nu regresie:** lipsa typography controls (theme-typography#4), lipsa multi-page real (sections-structure#3) — ambele documentate explicit ca backlog în VISION.md §4.6, „nu se rezolvă toate într-un singur task”.
- **Politica bannerului de cookie** (`legal-cookies-attribution#4` — fără buton de refuz la fel de vizibil ca „Acceptă”) — decizie de politică legală (relabelare ca notificare simplă vs. focus-trap + refuz simetric), nu doar tehnică; amânat pentru poarta owner de la §5.
- **A doua/a treia variantă de preset per șablon** (`tpl-portfolio-pro-desserd#2`) — conținut de calitate comercială deja existent, dar needen din UI; decizie de produs (adaugă selector de stil vs. elimină presetele needen), nu urgent.
- **Doi oracoli Playwright/Brave neportabili** (`advocate-eed3ca0-repair.test.js`, `mobile-chrome-390-aabb.test.js`) — cunoscut gap non-portabil per AGENTS.md, nu de urmărit ca regresie.

---

## 7. Backlog medium/low (neincluse în val) — grupate pe suprafață

**Landing:** `landing#3` — click pe logo/„Designuri” din poziție derulată nu duce înapoi la hero.

**Legal/cookies:** `legal-cookies-attribution#2` — VISION.md liniile 19/32/35 încă spun „7 zile”/„ziua 7” (parte din R-11, dar VISION.md nu era în `DOC_RELS` original — verifică la implementare); `legal-cookies-attribution#4` — bannerul de cookie fără buton de refuz simetric (vezi §6).

**Șabloane:** `tpl-portfolio-pro-desserd#2` — al 2-lea/3-lea preset per șablon needen din UI; `theme-typography#3` — fără buton „Resetează la culorile implicite”; `theme-typography#4` — fără typography controls (backlog cunoscut); `sections-structure#2` — fără secțiune de testimoniale/recenzii pe niciun șablon; `sections-structure#3` — fără multi-page real (backlog cunoscut); `sections-structure#4` — 4 din 5 șabloane fără formular de contact generic (doar WhatsApp/tel/mailto).

**Cont/auth:** `auth-account#2` — ecranul „Link trimis” fără buton de retrimitere/schimbare adresă; `auth-account#4` — „Deconectare de pe toate dispozitivele” reachable doar din editor, nu din dashboard.

**Editor:** `journey-stranger#2` — toast de succes rămâne peste conținut relevant câteva secunde; `edge-errors#3` — la zoom 200%, iconițele din stânga topbar se suprapun; `editor-text-images#3` — buton „Înlocuiește fotografia” vizibil doar la hover (alternativă accesibilă există în modalul „Poze”).

**Imagini/media:** `images-media#5` — o poză HEIC (formatul implicit de pe iPhone) eșuează la upload cu un mesaj jumătate română, jumătate engleză; `images-media#2` — aceeași fotografie înglobată de mai multe ori în export HTML (~40% risipă); `images-media#7` — fără unealtă de crop/focal point.

**Vizual/design:** `visual-design#2` — bara de instrumente devine doar-iconițe cu „⋮” ambiguu pentru „Detalii” la 1440px cu panoul deschis; `visual-design#3` — iconițe emoji în stările goale, inconsecvente cu restul UI; `visual-design#5` — butonul „Șterge” (ireversibil) arată identic cu acțiuni sigure în dashboard.

**Mobil:** `builder-mobile#3` — comutatorul „Mobil” îngustează canvas-ul sub modul implicit pe telefon real 390px; `builder-mobile#4` — excepția de auto-open pe telefon nu e documentată în VISION/PRODUCT.

**Publicare/live:** `publish-live#3` — slug malformat arată JSON brut englezesc în loc de pagina 404 în română.

**Export:** `export#2` — eroare „no draft to download” în engleză (practic inaccesibilă prin UI normal).

**Plată/preț:** `gap-pricing-display-consistency-live#3` — blocaj de mediu, nu defect (fără cheie Stripe test reală disponibilă acestui audit).

**Texte/copy:** `copy-i18n#4` — format dată inconsecvent între cardul de site (lună completă) și Facturi (lună prescurtată).

**Securitate:** notă reziduală din `api-security#1`/`gap-csrf-poc#1` (acoperite de task-ul R-04, mutat în Val 3) — nimic suplimentar rămas neacoperit.

---

## 8. Anexă — index id → evidence paths

Toate căile sunt relative la `04-QA-Evidence/Audit-2026-09-27-b45a3e4/`.

| ID | Evidence (director/fișiere principale) |
|---|---|
| landing#1, landing#2, landing#3 | `landing/` |
| gap-cross-account-draft-leak-depth#1 | `gap-cross-account-draft-leak-depth/` |
| theme-typography#1..#4 | `theme-typography/` |
| instafidget-social#1, #3, #4 | `instafidget-social/` |
| gap-drawer-backdrop-audit#1..#3 | `gap-drawer-backdrop-audit/` |
| calendar-native#1..#3 | `calendar-native/` |
| export#1, #2 | `export/` |
| a11y#1..#3 | `a11y/` |
| data-integrity#2, #3 | `data-integrity/` |
| copy-i18n#1..#4 | `copy-i18n/`, `edge-errors/` (03) |
| edge-errors#2..#4 | `edge-errors/` |
| journey-stranger#2, #4 | `journey-stranger/`, `ux-benchmark/` |
| editor-text-images#1..#3 | `editor-text-images/` |
| sections-structure#1..#4 | `sections-structure/` |
| whatsapp-contact#1, #3 | `whatsapp-contact/` |
| preview-fidelity#2 | `preview-fidelity/` |
| auth-account#2..#4 | `auth-account/` |
| builder-mobile#1..#4 | `builder-mobile/` |
| docs-consistency#2..#5 | `docs-consistency/`, `git show 2f1bb95` |
| test-health#1..#3 | `test-health/` |
| owner-dashboard#4 | `owner-dashboard/` |
| images-media#1..#7 (inclusiv #5 HEIC) | `images-media/` |
| gap-custom-domain-selfserve-depth#1 | `gap-custom-domain-selfserve-depth/` |
| gap-pricing-display-consistency-live#1..#3 | `gap-pricing-display-consistency-live/` |
| gap-csrf-poc#1 | `gap-csrf-poc/` |
| api-security#1 | `api-security/` |
| visual-design#2, #3, #5 | `visual-design/` |
| tpl-portfolio-pro-desserd#1, #2 | `tpl-portfolio-pro-desserd/` |
| catalog-firstrun#1 | `catalog-firstrun/` |
| performance#2, #3 | `performance/` |

---

*Plan generat din constatările canonice ale rundei de audit din 2026-09-27 (SHA `b45a3e4`). Task-urile R-01…R-25 sunt gata de dispatch ca valuri de agenți Sonnet, câte un val (≤10 task-uri) o dată, cu worktree/branch separat per task, per regula din AGENTS.md.*

---

## 9. Decizii owner (2026-09-27) și ordinea de execuție

**Decizii:**
- **R-01:** landing-ul arată din nou reînnoirea de **29/an** și nu mai spune „o singură plată”.
- **R-01 / R-16:** simbolul de monedă revine peste tot (landing, fereastra de publicare, dashboard, facturi).
- **R-27:** GDPR complet: descărcarea datelor **și** ștergerea completă a contului.
- **Stripe și DNS reale:** verificate de owner; porțile respective sunt închise.
- **Republicarea site-urilor live:** nu e nevoie, nu există încă clienți.

**Ordinea de execuție.** Task-urile sunt regrupate în runde după fișierele modificate. Două task-uri din aceeași rundă nu ating același fișier, cu o singură excepție: R-01 modifică doar zona de formatare a prețului din `builder/app.js` (~6480–6560), departe de zonele lui R-02. Numerotarea R-xx rămâne cea din §4.

| Rundă | Task-uri |
|---|---|
| 1 | R-01, R-02, R-03, R-06, R-08, R-09, R-10, R-11, R-12, R-26 |
| 2 | R-05, R-07, R-13, R-14, R-15, R-17, R-20, R-21, R-22, R-25 |
| 3 | R-16 + R-23 (un singur task pe `builder/app.js`), R-18, R-04 + R-19 (un singur task pe `bot/server.js`), R-24 |
| 4 | R-27 |
