# Raport audit end-to-end Hidook Site Builder (HEAD 2225ca7, 2026-09-06)

## 1. Verdict general

Hidook Site Builder are o fundație vizuală reală — pe capturi statice, 4 din cele 5 șabloane arată la un nivel comparabil cu o temă bună Squarespace sau Wix pentru vertical-ul ei (fotografie de calitate, tipografie îngrijită, copy românesc natural, fără urme de placeholder). Fluxul comercial de bază — alege design → editează → trial 7 zile → live → export — funcționează și a fost confirmat, repetat, de aproape toate lens-urile de audit. Problema nu e "nu arată bine", e că **aproape orice interacțiune dincolo de editarea de text simplă lovește un defect reprodus determinist**: galeria foto se rupe la click pe 2 din 5 șabloane, hero-ul dispare complet pe al treilea după orice editare, butonul universal "+ Adaugă" produce carduri goale sau corupe DOM-ul pe 2 șabloane, codul QR de WhatsApp — funcția-vedetă a produsului — nu e un cod QR valid pe niciunul dintre cele 5 șabloane, 3 din 5 șabloane nu au meniu de navigare pe mobil, calendarul nativ nu pornește pe imaginea Docker documentată pentru producție, iar un client care plătește la timp poate fi etichetat "Expirat" și împins să deschidă un al doilea abonament Stripe care se adaugă la primul, nu îl înlocuiește. La asta se adaugă un strat de hardening de producție (fără rate-limiting, fără security headers, logout care nu invalidează sesiunea, fallback de autentificare care expune token-ul de login oricui) sub nivelul minim așteptat de la orice SaaS cu bani reali în joc.

Editorul însuși are o limitare arhitecturală, nu doar bug-uri de suprafață: editarea inline funcționează prin potrivire de text (regex) peste HTML-ul deja randat, nu printr-un model de document — de-aici derivă direct bug-urile de "card gol"/"DOM corupt" de mai sus, și de-aici lipsa de undo/redo, de add/remove de secțiuni, de reordonare. E o diferență de categorie, nu de polish, față de Wix/Squarespace/Framer.

**Scor global: 4/10.** Ce desparte produsul de "top": (1) fiabilitate funcțională end-to-end pe interacțiunile de bază, nu doar pe fericitul-drum static; (2) o arhitectură de editor cu model de document real; (3) hardening de producție minim (auth, headere, rate-limit, facturare corectă pe termen lung); (4) o singură sursă de adevăr despre ce e gata și ce nu, pentru ca echipa să nu navigheze orb.

**Notă de metodologie importantă:** faza de verificare adversarială independentă a fost oprită de owner din motive de cost. Din cele 152 de constatări din acest raport, doar **3** au dovezi de verificare independentă, colectate separat de orchestrator (secțiunea 4, marcate "verificat"). Celelalte 149 sunt raportate de un singur agent de audit per zonă, cu dovezi (cod, capturi, output de comandă) dar **fără o a doua confirmare independentă**. Nu le tratăm ca zvonuri — fiecare are dovadă atașată — dar recomandăm owner-ului o trecere rapidă de re-confirmare pe cele critice înainte de a le prioritiza masiv în sprint.

## 2. Scorecard pe zone

| Zonă | Scor /10 | O propoziție |
|---|---|---|
| Șablon Restaurant (product-menu) | 4 | Design editorial reușit, dar galeria foto și listele editabile se rup, iar CTA-ul din hero e mereu transparent. |
| Șablon Meserii (local-service) | 6 | Cel mai solid din suită funcțional — dar codul QR WhatsApp nu funcționează și listele editabile sunt cod mort. |
| Șablon Salon (portfolio) | 6 | Design boutique credibil, dar lightbox rupt, fără meniu mobil și branding rezidual după redenumire. |
| Șablon Servicii profesionale (professionals) | 7 | Cel mai matur din suită — dar listele editabile corup DOM-ul și SEO tehnic (og:url, canonical, JSON-LD) lipsește. |
| Șablon Desserdirina (cofetărie) | 4 | Hero-ul dispare complet după orice editare de fundal — descalificant pentru un vertical unde fotografia e produsul. |
| Builder UX (editor/chrome) | 6 | Landing la nivel de SaaS real; editorul propriu-zis are cusături de finisaj (focus, modal, cont) care trădează un produs în lucru. |
| Backend / API | 6 | Autorizare pe resurse și escaping XSS solide; lipsesc rate-limiting, security headers și un logout care chiar funcționează. |
| Securitate | 4 | Fallback de autentificare care expune tokenul de login oricui, plus lipsurile de mai sus — găuri de bază pe care un produs comercial nu ar trebui să le aibă. |
| Plăți / comercial | 3 | Trial→live→cancel funcționează curat, dar reînnoirea automată reală duce la dublă facturare orfană și la USD implicit pentru clienți reali. |
| Deploy / infra | 3 | Fără CI/CD, fără healthcheck, bază de date pe un singur fișier JSON, imagine Docker umflată cu 140MB de dovezi QA. |
| Performanță | 4 | Cache-ul static e real și funcțional, dar zero compresie server, zero minificare, zero pipeline de imagini — click pe "Start" durează 8-12s pe rețea realistă. |
| Export / renderer | 6 | Motor de randare solid și determinist, dar un XSS stocat real în portfolio și un formular care minte vizitatorul pe exporturi self-hosted. |
| Calendar (nativ) | 4 | Motorul de rezervări e arhitectural cel mai bun lucru din tot produsul — dar nu pornește pe imaginea Docker documentată pentru producție. |
| Telegram | 5 | Infrastructură de siguranță și sesiuni serioasă, dar orice draft cade pe șablonul greșit și /sterge (GDPR) nu șterge nimic de pe disc. |
| Accesibilitate | 5 | Fundație semantică solidă (landmark-uri, alt text, label-uri), dar zero focus-trap pe modale și contraste eșuate pe 4 din 5 șabloane. |
| Documentație | 4 | VISION.md e riguros, dar se contrazice cu PROJECT_STATUS.md pe întrebarea centrală "e gata produsul?", iar comanda de test documentată nu rulează suita. |

## 3. Ce funcționează bine

- **Fluxul comercial de bază e real, nu un mockup**: alege design → editează text/poză/culoare în timp real → trial 7 zile cu card → live imediat → export HTML/ZIP funcțional standalone a fost verificat capăt-la-capăt, repetat, pe toate cele 5 șabloane, fără erori de consolă sau request-uri eșuate. Vezi `template-local-service/18-test-pay-success.png` și `template-professionals/21-live-site-desktop-fullpage.png`.
- **Trei din cele cinci șabloane (local-service, portfolio, professionals) au un nivel de design comercial credibil** — fotografie de calitate, tipografie cu personalitate, ierarhie vizuală curată, deloc "AI slop" sau layout evident de template generic. Vezi `template-local-service/21-live-site-desktop-fullpage.png`.
- **Landing page-ul builder-ului (catalogul de șabloane) arată deja ca un SaaS de nivel Wix/Squarespace** — hero cu colaj foto, bloc de preț clar, secțiune "Cum funcționează", filtre pe verticale funcționale. Vezi `builder-chrome-ux/13-template-cards-overview.png`.
- **Autorizarea pe resurse și escaping-ul XSS din motorul principal de randare sunt solide** — verificate live cu conturi reale cross-user (8 tipuri de acces testate, toate 403) și cu payload-uri XSS reale injectate prin fluxul complet publish→live (toate corect escapate, cu excepția sink-ului specific din portfolio, vezi §4).
- **Motorul calendarului nativ e arhitectural cel mai bun lucru din tot repo-ul**: index UNIQUE partial + tranzacție `BEGIN IMMEDIATE` a rezistat live la 20 de cereri simultane pe același slot (1 confirmat, 19 corect retrogradate, 0 dublu-book), iar widget-ul e onest — arată explicit "nu e o confirmare falsă" când un slot dispare între selecție și trimitere. Vezi `calendar-native/22-widget-error-slot-taken-meanwhile.png`.
- **Integrarea WhatsApp (linkul `wa.me` cu diacritice) funcționează corect end-to-end pe toate șabloanele** — doar cutia QR asociată e nefuncțională (§4).
- **Cascada de identitate la redenumirea afacerii** propagă corect noul nume în Instagram/Facebook/meta/JSON-LD pe majoritatea câmpurilor — un detaliu de produs matur, chiar dacă incomplet (vezi PORT-04, F4).
- **Persistența pe disc e scrisă corect din punct de vedere tehnic** (write atomic tmp+rename), iar magic-link-ul de autentificare e criptografic solid (token 256-biți, hash-uit, single-use, expirare 15 min).

## 4. Constatări — critical și high

Toate criticale + high, deduplicate pe defect (nu pe lens). Coloana Status arată dacă defectul are verificare independentă de orchestrator sau dacă vine dintr-un singur audit de lens.

| # | Sev. | Zonă | Titlu | Dovadă | Status | Remediere | Efort |
|---|---|---|---|---|---|---|---|
| 1 | critical | toate 5 șabloane | Codul QR de WhatsApp NU este un cod QR valid (finder pattern-uri corupte de mascare greșită) | `template-local-service/10-whatsapp-qr-panel.png` + decodare eșuată cu Apple Vision pe 5 capturi + `wa-qr-raw.svg` | **VERIFICAT** (orchestrator, independent) | Înlocuit encoder hand-rolled cu bibliotecă QR testată (ex. qrcode-generator) + oracle care decodează QR-ul | S |
| 2 | high→confirmată* | test/infra | 2 teste Playwright pică determinist pe HEAD (advocate-eed3ca0-repair, mobile-chrome-390-aabb) — dependență de Brave instalat local, glitch 0×0 pe bannerul cookie | Rulare izolată repetată, 2/2 vs 0/2 intermitent în Brave, 4/4 OK în Chromium Playwright | **VERIFICAT** (orchestrator, independent) | Pin Chromium din node_modules în toate oracle-urile; investigat glitch-ul de re-render | S/M |
| 3 | critical/high | `template:product-menu`, `template:portfolio` | Lightbox-ul galeriei foto e complet nestilizat — click pe o poză rupe layout-ul în loc să deschidă un vizualizator | `template-product-menu/36-repro-gallery-lightbox-unstyled.png`, `template-portfolio/26-live-gallery-lightbox-actual.png` | raportat de audit | Adaugă regulile CSS lipsă (`position:fixed`, `z-index`, fundal întunecat) — `collage.js` pare partajat, verifică toate șabloanele | S |
| 4 | critical/high | `frontend` (product-menu, professionals) | "+ Adaugă" pe liste creează carduri complet goale, imposibil de completat/șters din UI; pe professionals corupe și DOM-ul (butonul de adăugare ajunge grefat în interiorul noului element) | `template-product-menu/35-repro-empty-item-broken-controls.png`; cardul gol s-a văzut publicat pe site-ul live | raportat de audit | În `edit-overlay.js`, ignoră ancestori cu boundingClientRect 0×0 la localizarea containerului de item; dă text placeholder la creare | M |
| 5 | critical | template:desserdirina | Fundalul hero (poză/culoare) dispare complet pe site-ul live după orice editare — proprietate CSS invalidă | `template-desserdirina/live-desktop-1440-fullpage.png` (hero complet gol pe site-ul LIVE plătit) | raportat de audit | Fix de o linie: `background-image` → `background` în `templates/desserdirina/template.html:57` (aliniat cu celelalte 4 șabloane) | S |
| 6 | critical | template:desserdirina | Adaugă+șterge o categorie de galerie corupe pozele categoriei ORIGINALE — galeria dispare de pe site-ul live plătit | `build.js:588` avertisment silențios "@each 'photos' is not an array" | raportat de audit | Investighează `onListAdd`/`onListRemove`/`detectListGroups` pentru cazul unui item cu subcâmp array gol | M |
| 7 | critical | docs | VISION.md și PROJECT_STATUS.md se contrazic pe "Produsul e gata?" (VISION cere QA independent, PROJECT_STATUS declară deja Produsul) | `VISION.md:186,367` vs `PROJECT_STATUS.md:80-84`; `git show --stat 2225ca7` (doar PROJECT_STATUS atins) | raportat de audit | Sincronizează VISION.md în același commit care declară Produsul, sau anulează declarația până la QA real | S |
| 8 | critical | payments | `paidUntil` nu e reîmprospătat de reînnoirea automată Stripe → client activ etichetat "Expirat" → "Reînnoiește hosting" deschide un abonament NOU, orfanind primul care continuă să factureze | `payments-commercial/08-dashboard-false-expired-active-sub.png` (captură directă a bug-ului) | raportat de audit | Adaugă handler `invoice.paid`/`invoice.payment_succeeded` care extinde `paidUntil` la fiecare factură reușită | M |
| 9 | critical | frontend | Click pe "Start" pentru un template durează 7.8-11.7s pe rețea realistă — de 2.6-4x peste ținta ≤3s a produsului | `performance/perf-template-timing-corrected.json` | raportat de audit | Compresie gzip/brotli + Cache-Control pe `/api/templates` + imagini optimizate — combinate, ar tăia 4-6s | M |
| 10 | critical | template:portfolio | Stored XSS: sink-ul raw `{{& icon}}` poate fi ocolit cu `jav<TAB>ascript:` în href — `alert()` executat real în Chromium | `static-renderer-export/xss-poc-portfolio-icon-sink.html`, exploit confirmat live | raportat de audit | Normalizează URL-ul (elimină \t\r\n) înainte de verificarea blacklist + sanitizare allowlist pentru SVG | S |
| 11 | critical | template:professionals | Formularul de programare arată succes fals pe orice export self-hosted — cererea nu ajunge niciodată la proprietar (0 request-uri de rețea) | `static-renderer-export/static-export-appointment-submitted.png` | raportat de audit | Detectează lipsa unui backend Hidook viu; înlocuiește formularul cu CTA telefon/WhatsApp pe exporturi self-hosted | M |
| 12 | critical | backend (calendar) | Calendarul nativ e complet nefuncțional pe imaginea Docker de producție (Node 20, fără `node:sqlite`) | `Dockerfile:5,31`; `bot/DEPLOY.md:8`; reprodus local pe Node 22.11 și 23.1 | raportat de audit | Schimbă imaginea de bază la Node ≥22.5 LTS + flag `--experimental-sqlite`, sau amână modulul până la Node cu suport stabil | M |
| 13 | critical | telegram | `/sterge` (ștergere GDPR) NU elimină fișierele unui site plătit și publicat de pe disc — site-ul rămâne accesibil deși botul confirmă "am șters totul" | `bot/flow.js:905-914` (doar `registry.updateSite`, fără `unpublishSite`) | raportat de audit | Apelează `webpublish.unpublishSite(site)` în `handleSterge()` pentru fiecare site din `regSites` | S |
| 14 | critical | backend | Fallback de autentificare fără `RESEND_API_KEY` expune tokenul de login oricărui apelant — preluare totală de cont | curl reprodus live: `POST /api/auth/email` cu orice email → răspunde cu `devLink` conținând tokenul | raportat de audit | Condiționează `devLink` strict de `NODE_ENV !== 'production'`; în producție fără cheie → 503, nu succes simulat | S |
| 15 | critical/high | backend | "Deconectare" nu invalidează sesiunea pe server — userul rămâne autentificat 30 de zile după "logout" | `security-secrets-sweep/03-true-reload-after-logout.png` (reload complet, tot autentificat) | raportat de audit | Implementează `POST /api/auth/logout` care șterge cookie-ul (`Max-Age=0`); pe termen mediu, listă de revocare server-side | S/M |
| 16 | critical | frontend | Editorul nu are model de document — inline-edit se face prin regex text-matching peste HTML randat (`injectDataHb`) | `builder/app.js:680-737`; VISION.md §4.6 confirmă lacuna | raportat de audit | Rescrie randarea ca model de document (AST/JSON de secțiuni cu id-uri stabile), nu text-matching pe HTML final | L (rebuild) |
| 17 | high | template:product-menu | CTA principal din hero ("REZERVĂ O MASĂ") rămâne mereu transparent, indiferent de culoarea de accent | `styles.css:120-121` — regulă CSS suprascrisă de o clasă cu specificitate egală definită mai jos | raportat de audit | Scoate clasa `hero-cta` de pe CTA-ul principal sau mută regula `.pm-hero__cta--fill` după ea | S |
| 18 | high | product-menu, portfolio, professionals (3/5 șabloane) | Fără meniu de navigare pe mobil — linkurile din header dispar complet sub breakpoint, fără hamburger de rezervă | `template-product-menu/27-live-site-mobile-390.png`, `template-professionals/24-mobile-nav-links-hidden.png` | raportat de audit | Adaugă buton hamburger standard sub breakpoint, cu overlay/drawer și focus-trap | M |
| 19 | high | template:portfolio | "+ Adaugă" pentru categorii de galerie nu adaugă nimic — funcție de personalizare complet blocată | `template-portfolio/13-repeatable-category-add-btn-in-context.png` | raportat de audit | Adaugă atribute `data-hb-edit` pe elementele randate pentru fiecare categorie, ca overlay-ul să le detecteze | M |
| 20 | high | template:portfolio | Redenumirea afacerii lasă în urmă numele preset-ului ("Echipa Atelier Ivoire") — contradicție de brand pe live | `template-portfolio/22-live-site-desktop-fullpage.png` | raportat de audit | Adaugă `team.title` la lista de câmpuri cascadate la redenumire | S |
| 21 | high | template:portfolio | Preview-ul live rămâne cu culoarea veche câteva momente după schimbarea accentului, dacă a fost precedată de schimbare de poză | `template-portfolio/10-colors-after-applied.png` (buton CTA tot verde) | raportat de audit | Investighează race condition între cele două re-render-uri (upload foto vs. schimbare culoare) în iframe srcdoc | M |
| 22 | high | frontend (builder) | Bannerul de cookie al șablonului reapare vizibil în canvas la fiecare re-render complet al preview-ului | `builder-chrome-ux/10-iframe-cookie-banner-after-color-change.png` | raportat de audit | `allow-same-origin` pe sandbox-ul iframe-ului, sau injectează starea de consimțământ acceptat la fiecare re-render | S |
| 23 | high | backend (2 lens) | Zero rate-limiting pe `POST /api/auth/email` — flood, spam de emailuri, umflare nemărginită a token-store-ului | `probe-results.json` (50 cereri → 50×200, 0×429) | raportat de audit (2 surse: backend-api-security + security-secrets-sweep) | Fereastră glisantă per IP + per email (ex. 5/oră/email) reutilizând `bot/ratelimit.js` | S |
| 24 | high | backend (3 lens) | Zero security headers pe orice răspuns — CSP, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy absente | curl direct pe 5 rute testate; grep confirmă absența în `bot/server.js` | raportat de audit (3 surse: backend-api-security, deploy-infra, security-secrets-sweep) | Helper `applySecurityHeaders(res)` apelat la începutul fiecărui handler | S |
| 25 | high | backend | Fără listă de sloguri rezervate — `admin`/`api`/`app`/`www` disponibile, risc de subdomain-squatting în producție (Cloudflare) | `bot/server.js:78,619-623` — niciun grep pentru "reserved" | raportat de audit | Set de cuvinte rezervate verificat în `handleSlugCheck`/`handlePublish` | S |
| 26 | high | payments | Bucket-ul de monedă (EUR/GBP/USD) depinde exclusiv de `CF-IPCountry`, pe care ținta de deploy documentată (Railway) nu îl trimite niciodată → orice client real primește USD | `bot/pricing.js:88-132`; `bot/DEPLOY.md` (Railway fără Cloudflare în față) | raportat de audit | Documentează/impune Cloudflare orange-cloud în fața originii de producție, cu log de avertizare la boot dacă lipsește header-ul | M |
| 27 | high | payments | `past_due`/`unpaid` nu dezabonează niciodată site-ul public, iar `/admin` raportează greșit aceste site-uri ca "Unpublished" | `bot/webpublish.js:134-211`; `bot/server.js:436-484` | raportat de audit | Tratează și `unpaid`/`incomplete_expired` ca declanșatoare de unpublish, nu doar `deleted`/`canceled` | M |
| 28 | high | deploy | Imaginea Docker de producție înglobează ~140MB de dovezi QA interne, guvernanță și deliverables | `.dockerignore` incomplet; `git ls-files 04-QA-Evidence` → 361 fișiere, 107MB+ | raportat de audit | Adaugă `04-QA-Evidence`, `00-Governance`, `04-Deliverables`, `OWNER-*.md` în `.dockerignore` | S |
| 29 | high (rebuild) | backend | Baza de date e un singur fișier JSON, citit+rescris integral sincron la fiecare mutație, fără backup documentat | `bot/registry.js:22-37,245-285` | raportat de audit (2 surse: backend-api-security BE-05 medium, deploy-infra DI-02 high) | Termen scurt: job de backup extern. Termen mediu: migrare la SQLite pe volum | L |
| 30 | high | deploy | Fără CI/CD și fără healthcheck la nivel de platformă | `railway.json` fără `healthcheckPath`; fără `.github/` | raportat de audit | GitHub Actions minim (`node --test`) + `healthcheckPath: "/health"` în railway.json | M |
| 31 | high | docs | Comanda de test documentată (`node bot/test/*.test.js`, fără `--test`) nu rulează suita — doar primul fișier | `README.md:85-89`, `AGENTS.md:39`, `LAUNCH.md:39`; reprodus mecanic | raportat de audit | Corectează cele 3 referințe + script npm `"test": "node --test bot/test/*.test.js"` | S |
| 32 | high | docs (calendar) | PRODUCT.md nu menționează deloc calendarul nativ — descrie doar fluxul Cal.com vechi | `PRODUCT.md:52` vs `bot/calendar-native/` (modul complet) | raportat de audit | Rescrie secțiunea din PRODUCT.md ca să reflecte booking-ul nativ opt-in | M |
| 33 | high | docs | VISION.md, sursa de adevăr declarată, e invizibil din README.md și din toate docs-urile operator-facing | grep VISION: README/LAUNCH/GO-LIVE/CLOUDFLARE-DEPLOY/bot README/bot DEPLOY/templates README = 0 | raportat de audit | Adaugă VISION.md ca prim rând în tabelul "Docs map" din README.md | S |
| 34 | high (rebuild) | docs (calendar) | OWNER-CALENDAR-CAL-DIY.md descrie o arhitectură suprascrisă de două ori ca "Chosen path", fără banner de deprecare | `OWNER-CALENDAR-CAL-DIY.md:7` vs `VISION.md:184-188` | raportat de audit | Arhivează documentul cu banner "SUPERSEDAT — vezi VISION.md §8" | M |
| 35 | high | performance | Fără pipeline de optimizare a imaginilor — JPEG needitate, fără width/height/srcset/WebP, servite la 3.7-7.5x rezoluția afișată | `perf.json` (naturalWidth 1280 vs displayWidth 341); CLS 0.20 | raportat de audit | Pipeline de build: 2-3 dimensiuni per imagine + WebP cu fallback + `width`/`height`/`loading` din schema | M |
| 36 | high | backend | Serverul Node nu comprimă niciodată răspunsurile — zero gzip/brotli, confirmat cu curl | `Content-Length: 167742` fără `Content-Encoding`, cu `Accept-Encoding: gzip` trimis | raportat de audit | `zlib.gzipSync`/brotli în `sendCachedFile()`/`serveLive()`/`sendJson()`, condiționat de Accept-Encoding | S |
| 37 | high | backend (export) | `og:image`/`twitter:image` sunt căi relative pe site-ul LIVE publicat — preview-ul de distribuire (WhatsApp/Facebook/X) nu se încarcă | `static-renderer-export/live-page-source.html:11` | raportat de audit (dup. cu prof-04, medium, aceeași cauză) | Setează `cfg.seo.ogImage` absolut la publicare, înainte de `build()` | S |
| 38 | high | frontend (export) | Redenumirea afacerii corupe silențios `seo.jsonLd` printr-o înlocuire de text neescapată JSON — datele structurate dispar fără avertisment | `builder/app.js:181-287` (cascadă text-replace pe JSON serializat) | raportat de audit | Parsează JSON înainte de cascadă, înlocuiește valorile ca obiect, apoi re-serializează | S |
| 39 | high | calendar | Vizitatorul nu poate reprograma prin linkul de gestionare — doar anula; contravine deciziei owner-locked din VISION §8 | `bot/calendar-native/manage-api.js:100-105` (doar `cancelByToken`) | raportat de audit | Adaugă `rescheduleByToken()` scopat la booking-ul rezolvat prin token | M |
| 40 | high | calendar | Fără nicio implementare a retenției PII de 24 luni / dreptului la ștergere — doar documentat, zero cod | grep "retention\|purge\|GDPR" pe `bot/calendar-native/` → 0 rezultate | raportat de audit | Job periodic care anonimizează bookingurile mai vechi de 24 luni | M |
| 41 | high | telegram | Telegram nu întreabă niciodată tipul afacerii — orice draft cade pe șablonul "Restaurant", chiar și pentru un salon; selectorul de șablon există deja construit (`bot/template-steps.js`) dar nu e importat nicăieri | `telegram-intake/02-editor-opened.png` (badge "Restaurant" pe un salon) | raportat de audit | Cablează `bot/template-steps.js` în `flow.js` — soluția există deja, doar neconectată | M |
| 42 | high | frontend (a11y) | Niciun modal din builder nu capturează focusul (fără focus-trap real) — Tab iese din dialog spre editorul din spate | Verificat live: 12-15 Tab-uri după deschiderea `#modal-publish` | raportat de audit | Focus-trap standard: interceptează Tab/Shift+Tab, calculează primul/ultimul element focusabil din containerul dialogului | S |
| 43 | high/medium | frontend | `#modal-instagram` nu se închide cu tasta Escape | `builder/app.js` — array de Escape fără `modal-instagram` | raportat de audit (2 surse: a11y A11Y-02 high, builder-chrome-ux F2 medium) | Adaugă `'modal-instagram'` în array-ul din handler-ul de Escape | S |
| 44 | high (rebuild) | frontend (strategie) | Fără add/remove/reorder de SECȚIUNI — doar add/remove de itemi în liste fixe | `templates/professionals/schema.json` (12 secțiuni fixe, fără `removable`) | raportat de audit | Model de secțiuni cu `type`/`order`/`removable`, apoi bibliotecă de blocuri reutilizabile | L |
| 45 | high/medium (rebuild) | frontend (strategie) | Fără undo/redo în întregul builder | grep "undo\|redo" → 0 rezultate | raportat de audit (2 surse: product-strategy PS-03 high, builder-chrome-ux F7 medium) | Stack de undo/redo la nivel de config, cu Ctrl+Z/Ctrl+Shift+Z | M |
| 46 | high (rebuild) | strategie | Doar 5 șabloane fixe, fără piață/bibliotecă de blocuri reutilizabile | `templates/registry.json` (5 intrări, fiecare independentă) | raportat de audit | Nu 100 de șabloane manuale — arhitectură pe blocuri reutilizabile cross-vertical | L |
| 47 | high (rebuild) | strategie/deploy | Fără domeniu custom self-serve — doar concierge manual prin contact | `bot/webpublish.js:1033-1040`; `PRODUCT.md:11` | raportat de audit | Flux self-serve: CNAME/TXT afișate, verificare propagare, SSL automat (Cloudflare API deja integrat) | M |

*Rândul #2 e prezentat separat de restul, cu titlu de constatare high pe testare/infra — nu se leagă de un `uid` de lens, e propriu verificării independente a orchestratorului.

### Constatări medii (compact)

| # | Zonă | Titlu | Efort |
|---|---|---|---|
| 1 | product-menu, local-service | Câmpuri Instagram/URL duplicate, ne-sincronizate în drawer | S |
| 2 | local-service | Add/remove serviciu, portofoliu, certificare — mecanism complet neconectat în UI (dead code) | L |
| 3 | professionals, export | JSON-LD LocalBusiness nu se generează la publicare prin builder web; canonical/og:url lipsesc peste tot | M |
| 4 | desserdirina | Galerie fără titlu, minusculă în layout chiar necoruptă | S |
| 5 | desserdirina | Descarcă HTML/ZIP nu produc nimic la primul click imediat după live | S |
| 6 | builder | Eroare de autentificare generică ascunde mesajul specific trimis de server | S |
| 7 | builder | Niciun acces la cont (deconectare/proiecte) din interiorul editorului | M |
| 8 | builder | Două tab-uri suprascriu silențios același draft, fără avertisment | M |
| 9 | payments | Mesaje de eroare în engleză la checkout/billing indisponibil | S |
| 10 | payments | Fără colectare TVA la Checkout (`automatic_tax` absent), nemenționat în runbook | S |
| 11 | payments | `invoice.payment_failed` netratat — abonament past_due rămâne live fără notificare | M |
| 12 | backend | Nicio invalidare reală de sesiune — cookie semnat HMAC nerevocabil înainte de 30 zile | M |
| 13 | deploy | Apeluri fetch către Cloudflare/Vercel/Netlify fără timeout explicit | S |
| 14 | deploy | Site plătit cu deploy eșuat (needs-retry) fără buton de acțiune pe dashboard | S |
| 15 | deploy | `ALLOW_FREE_PUBLISH` fără gardă de producție în cod | S |
| 16 | deploy | `.dockerignore` nu exclude `.worktrees/` | S |
| 17 | docs | Numărul de șabloane variază între docs (3, 4, 5) | S |
| 18 | docs | `bot/web.js` (entry point real de producție) nu apare în niciun doc | S |
| 19 | docs | Lipsesc ARCHITECTURE.md, CHANGELOG, LICENSE, runbook backup/restore | M |
| 20 | docs | VISION.md se contrazice intern: §8 (calendar LOCKED) vs §11 Flow 4 (cere Cal.com) | S |
| 21 | performance | Zero minificare pe tot pipeline-ul de build (app.js 167.7KB, app.css 48.6KB) | S |
| 22 | performance | `GET /api/templates` (115KB) fără Cache-Control/ETag deloc | S |
| 23 | performance | LCP 6.8s / CLS 0.17-0.20 pe site live publicat (rezervă de metodologie) | M |
| 24 | export | Niciun site (live sau ZIP) nu include robots.txt/sitemap.xml | S |
| 25 | calendar | Fără staff/resursă multiplă — un singur calendar comun per site | L |
| 26 | calendar | Lacune vs Calendly/Cal.com: fără reminder, .ics, sync Google/Outlook | L |
| 27 | telegram | Mesaj de rate-limit în engleză, singura rupere a regulii "100% RO" | S |
| 28 | telegram | Moderare imagini dezactivată silențios cu `AI_PROVIDER=openai` | M |
| 29 | telegram | Cod legacy Stripe/Revolut din Telegram încă în producție (risc sesiuni-zombie) | M |
| 30 | a11y | desserdirina: scroll orizontal la zoom 200% (galerie foto) | M |
| 31 | a11y | Linkuri sociale "IG"/"FB" sub 24×24px (local-service) | S |
| 32 | a11y | Contrast insuficient pe culori de brand (local-service) | S |
| 33 | strategie | Fără control de tipografie/fonturi pentru client | S |
| 34 | strategie | Fără multi-page real — fiecare șablon e o singură pagină cu ancore | L |
| 35 | strategie | Fără generare/asistență AI la creare site | M |
| 36 | strategie | Fără analytics, sitemap.xml/robots.txt indexabil | S |
| 37 | strategie | Fără form-builder pentru lead-forms custom | M |
| 38 | strategie | Imagini stocate base64 în config, nu ca fișiere/CDN | M |
| 39 | strategie/legal | Două bannere de cookie diferite observate în aceeași sesiune | S |
| 40 | security | CORS deschis + fără rate-limit pe `/api/calendar-native/*` | M |
| 41 | security | Desserdirina încarcă fonturi Google necondiționat de consimțământ | S |
| 42 | security | 358MB+ PNG-uri/video de QA commise în git (.git = 282MB) | M |

### Constatări low / info (doar numărate, cu exemple)

- **backend** (9): loguri cu email în clar, coduri HTTP inconsistente (400 vs 403), funcție duplicată `serveCalendarNativeManage`, CORS reflectat pe calendar-native, `.worktrees/` 6.4GB local.
- **deploy** (6): Node fără pin de versiune, Dockerfile rulează ca root fără HEALTHCHECK, doc CLOUDFLARE-DEPLOY stale, 26MB imagini duplicate în `builder/generated`.
- **docs** (2): PROJECT_STATUS amestecă status durabil cu zgomot de orchestrare AI, 5 fișiere untracked la root nerezolvate definitiv.
- **frontend** (13): paywall vizual "spălat" la apariție, fără indicator de autosave, fără onboarding contextual, `aria-describedby` referă ID inexistent, butoane topbar sub 44×44px.
- **legal** (1): pagini legale cu text vizibil `[PLACEHOLDER: ...]` pe orice site publicat azi.
- **payments** (1): mesaj "Ai deja un site neplătit" înșelător pentru un fost client plătitor.
- **telegram** (4): erori JS brute expuse userului RO, ~250 linii de cod AI mort, retenție PII permanentă neatinsă de `/sterge`.
- **șabloane** (9, per-șablon): dropdown "Limba site-ului" cu o singură opțiune (3 șabloane), câmpuri URL randate ca textarea, ZIP cu imagini nefolosite din alte preset-uri, câmp schema `icon` mort.

## 5. Cele 5 șabloane — verdict per șablon

**Restaurant (product-menu) — scor 4/10, improve.** Tipografie serif elegantă și copy cald, dar galeria foto se rupe la click (lightbox nestilizat) și lista de specialități produce carduri goale publicate live. CTA-ul principal din hero e mereu transparent. Fără meniu mobil. *(design: bun · funcțional: rupt pe 2 interacțiuni cheie · RO: curat · mobil: header fără navigare)*

**Meserii (local-service) — scor 6/10, improve.** Cel mai solid funcțional din suită — export, plăți, legal, responsive toate curate, zero erori de consolă. Dar funcția QR WhatsApp nu produce un cod scanabil pe niciun telefon, iar mecanismul de add/remove pentru servicii e complet neconectat în UI. *(design: foarte bun · funcțional: solid cu 2 lacune clare · RO: natural · mobil: fără overflow, bară sticky corectă)*

**Salon (portfolio) — scor 6/10, improve.** Design boutique credibil cu diacritice perfect păstrate, dar lightbox complet nestilizat, buton de adăugare categorie mort, fără meniu mobil, și un rezidual de branding ("Echipa Atelier Ivoire") care contrazice numele afacerii pe pagina live. *(design: bun, editorial · funcțional: 3 defecte reale · RO: complet · mobil: fără nav, dar fără overflow)*

**Servicii profesionale (professionals) — scor 7/10, improve.** Cel mai matur din suită — editare inline pe 93 de noduri, formular de programare funcțional, WhatsApp cu QR local. Dar lista de servicii corupe DOM-ul la adăugare, iar SEO tehnic (og:url, canonical, JSON-LD) lipsește complet pe fluxul web. *(design: calm, premium · funcțional: solid cu bug de listă · RO: complet · mobil: fără meniu de navigare)*

**Cofetărie (desserdirina) — scor 4/10, improve.** Cel mai fragil din suită: orice editare a fundalului hero (poză SAU culoare) lasă site-ul live plătit cu un hero complet gol — descalificant pentru un vertical unde fotografia e produsul. Add+remove pe o categorie de galerie corupe pozele categoriei originale. Restul infrastructurii (plată, export, legal, WhatsApp) e curat. *(design: potențial bun, dar nedemonstrat din cauza bug-urilor · funcțional: 2 defecte critice pe exact primele acțiuni ale unui proprietar · RO: complet · mobil: pagină unică fără overflow, dar hero gol)*

Niciun șablon nu se califică pentru "rebuild de la zero" — toate au bug-uri cu fix punctual (1 linie CSS pentru desserdirina, o funcție de container pentru product-menu/professionals), nu defecte de arhitectură. Arhitectura care TREBUIE refăcută e cea a editorului (§6), nu a șabloanelor individuale.

## 6. Ce trebuie REFĂCUT (rebuild)

- **Modelul de editare al editorului** (PS-01): inline-edit prin regex text-matching peste HTML randat e cauza directă a bug-urilor "card gol"/"DOM corupt" de pe 2 șabloane și a imposibilității de a avea undo/redo sau secțiuni reordonabile. De ce: e o limitare structurală, nu un bug de suprafață — orice UI nou construit deasupra ei moștenește fragilitatea. Cum: model de document (AST/JSON de secțiuni cu id-uri stabile per nod), generat server-side la randare, nu dedus din HTML final. Efort: L.
- **Persistența pe fișier JSON monolitic** (BE-05/DI-02): `.registry.json` citit+rescris integral sincron la fiecare mutație nu scalează dincolo de câteva sute de site-uri și n-are backup documentat. De ce: e un risc de pierdere de date, nu doar de performanță. Cum: migrare la SQLite pe volum persistent (Railway) cu tranzacții reale. Efort: L.
- **Documentul OWNER-CALENDAR-CAL-DIY.md** și, mai general, structura de documentație operațională: descrie o arhitectură suprascrisă de două ori fără niciun banner de deprecare — riscă să inducă în eroare pe oricine îl citește azi. Cum: arhivare cu banner explicit + un singur punct de intrare (README → VISION.md) pentru "care e arhitectura curentă". Efort: M.
- **Doar 5 șabloane fixe, fără bibliotecă de blocuri** (PS-06): nu construi 100 de șabloane manual — investește în blocuri reutilizabile (variante de hero, grid de servicii, testimoniale) combinabile cross-vertical. Efort: L, dar e fundația pentru orice extindere reală a catalogului.
- **Domeniu custom self-serve** (PS-08): concierge manual nu scalează dincolo de zeci de clienți. Cum: flux self-serve cu CNAME/TXT afișate + verificare propagare + SSL automat (Cloudflare API deja integrat pentru deploy, doar extins). Efort: M.

## 7. Ce trebuie ÎMBUNĂTĂȚIT (improve)

Prioritizat după impact/efort (S = fix rapid, impact mare):

- **Bug-urile funcționale reproduse pe șabloane** (lightbox nestilizat, hero desserdirina, CTA transparent, meniu mobil lipsă, XSS portfolio, formular fals-succes pe export) — toate sunt fixuri de efort S-M, punctuale, cu remediere exactă indicată în §4. Acestea ar trebui să fie primul sprint, înainte de orice altă lucrare — sunt lucrurile pe care primul client plătitor le va lovi imediat.
- **Hardening de producție minim**: security headers, rate-limiting pe auth, logout funcțional, listă de sloguri rezervate — toate S, toate cu remediere de o funcție/helper. Fără cost de arhitectură, impact mare pe securitate reală.
- **Corectitudinea facturării pe termen lung** (PC-01, PC-02, PC-03): handler pentru reînnoire automată Stripe, verificare Cloudflare-în-față pentru monedă corectă, enforcement real pe `past_due`/`unpaid`. Efort M fiecare, dar critic — e vorba de bani reali de clienți reali.
- **Calendarul nativ pe imaginea de producție reală** (CAL-001): schimbare de imagine Docker + flag, sau amânare documentată a feature-ului până la suport stabil. Fără acest fix, tot efortul arhitectural bun din motor e irosit.
- **Telegram → șablon corect**: soluția (`bot/template-steps.js`) există deja, doar trebuie conectată în `flow.js`. Cel mai bun raport efort/impact din tot raportul.
- **Accesibilitate**: focus-trap pe modale + Escape pe Instagram modal + contrast pe local-service — toate S, ridică imediat conformitatea WCAG AA de bază.
- **SEO tehnic pe fluxul web** (og:image absolut, canonical/og:url, JSON-LD generat automat, robots.txt/sitemap.xml) — S-M fiecare, impact direct pe indexare și pe preview-urile de distribuire (WhatsApp/Facebook).

## 8. Ce se păstrează (keep)

- Motorul calendarului nativ (concurență, izolare tenant, onestitate anti-fals-confirmat) — arhitectural cel mai matur cod din tot produsul.
- Escaping-ul XSS și autorizarea pe resurse din motorul principal de randare/API (cu excepția celor 2 defecte punctuale din §4).
- Fluxul comercial de bază trial→live→cancel și export ZIP portabil, fără lock-in de platformă.
- Landing page-ul builder-ului (catalogul) — deja la nivelul vizual cerut de owner.
- Fundația semantică de accesibilitate (landmark-uri, alt text, label-uri corecte).
- Gate-ul de siguranță AI din Telegram (anti-prompt-injection) și persistența de sesiuni.
- Design-ul static al șabloanelor local-service, portfolio și professionals.
- Adaptorul de deploy Cloudflare Pages (rezolvă corect capcane reale: coliziune subdomeniu, `proxied:false`).

## 9. Foaie de parcurs spre "constructor de site-uri de top"

**0-4 săptămâni (quick wins, impact mare/efort mic):**
- Fix-uri punctuale pe cele 6 bug-uri critice de șablon (lightbox×2, hero desserdirina, XSS portfolio, formular fals-succes, CTA transparent) — S-M fiecare.
- Hardening minim: security headers, rate-limiting auth, logout funcțional, sloguri rezervate — toate S.
- Fix calendar Docker (Node image + flag) — M, dar blocant pentru orice client care vrea programări.
- Conectează selectorul de șablon Telegram (`template-steps.js`) — M.
- Sincronizează VISION.md ↔ PROJECT_STATUS.md; corectează comanda de test documentată — S.
- Compresie gzip/brotli pe server + Cache-Control pe `/api/templates` — S, impact direct pe cei 8-12s de la click pe "Start".

**1-3 luni (fundație):**
- Handler Stripe pentru reînnoire automată + fix monedă (Cloudflare-în-față) + enforcement `past_due` — M fiecare, elimină riscul de dublă facturare și USD implicit.
- Pipeline de imagini (resize + WebP + width/height) — M, taie CLS și LCP semnificativ.
- Meniu mobil pe cele 3 șabloane afectate + focus-trap pe modale — M.
- Migrare persistență la SQLite pe volum — L, dar necesară înainte de orice creștere de volum.
- CI/CD minim + healthcheck Railway — M.
- SEO tehnic complet (canonical, og:url absolut, JSON-LD auto, sitemap/robots) pe fluxul web — M.

**3-6 luni (diferențiere reală):**
- Model de document real pentru editor (înlocuiește regex text-matching) — L, deblochează undo/redo, secțiuni reordonabile, add/remove de blocuri.
- Bibliotecă de blocuri reutilizabile cross-vertical, în loc de 5 șabloane monolitice — L.
- Domeniu custom self-serve — M.
- Staff/resurse multiple + reminder-uri + .ics pe calendarul nativ (paritate parțială cu Calendly) — L.

**Comparație cu competitorii** (din lens-ul product-strategy): față de Wix/Squarespace (100+ șabloane, canvas drag&drop, undo/redo, domeniu custom self-serve) și Framer/Durable (generare AI din descriere), Hidook e azi la o fracțiune din suprafața funcțională așteptată — dar are un unghi de diferențiere real (WhatsApp-first, calendar de programări inclus nativ, RO nativ cu diacritice, preț sub jumătate din Wix Business calculat anual) pe care niciunul dintre marii competitori nu îl oferă din cutie pentru piața RO/UE de afaceri mici. Recomandarea explicită a lens-ului: nu tăia Telegram/Instafidget (cost redus, diferențiatoare), dar nu le mai da inginerie până când fundația editorului (§6) e rezolvată — orice UI nou construit deasupra regex-matching-ului actual e teren nisipos.

## 10. Ce NU s-a putut verifica și riscuri reziduale

Agregat din toate lens-urile, cele mai relevante lacune:

- **Nimic testat cu chei reale** (Stripe live, Resend, Cloudflare/Vercel/Netlify, Telegram) — toate fluxurile au folosit flag-uri de test izolate (`HIDOOK_TEST_PAY`, `HIDOOK_ISOLATED_DEPLOY`, `#dev-link`), conform regulilor de audit. Comportamentul real de producție (compresie/cache la edge Cloudflare, retry/dunning real Stripe, livrare reală de email) rămâne neconfirmat direct.
- **`docker build` nu a putut fi rulat** (daemon inaccesibil în mediul de audit) — concluziile despre CAL-001 și DI-01 vin din inspecție statică + reproducere locală a comportamentului Node/SQLite, nu dintr-un build efectiv al imaginii de producție.
- **Niciun scanner automat (axe-core, Lighthouse oficial)** — verificările de accesibilitate și performanță au fost construite manual în Playwright, echivalente ca prag dar posibil incomplete față de un audit de unealtă dedicată.
- **Niciun test pe browser real / device fizic** — tot auditul a rulat pe Chromium/Playwright emulat (390px pentru mobil); comportamentul real pe iOS Safari/Android Chrome fizic, inclusiv scanarea fizică a codului QR cu un telefon, rămâne neverificat direct (deși decodarea eșuată cu Apple Vision e o dovadă independentă puternică pentru QR).
- **Trafic la scară** (mii de site-uri/useri, sarcină susținută pe server) — toate concluziile de scalabilitate (registry JSON, memory) sunt extrapolate din teste la scară mică.
- **Conectare reală Instagram/Instafidget** și billing portal Stripe real — doar stările inițiale/eroare au fost testate.

**Risc rezidual principal:** cele 149 din 152 de constatări nu au a doua confirmare independentă. Recomandăm owner-ului o trecere de re-confirmare rapidă (30-60 min, doar pe cele 16 critice din §4) înainte de a bloca orice decizie majoră de business pe acest raport.

## 11. Metodologie

Auditul a folosit 17 agenți paraleli ("lens"), fiecare cu acces la un server Node izolat (`HIDOOK_TEST_PAY=1`, `HIDOOK_ISOLATED_DEPLOY=1`, `NODE_ENV=test`, `DATA_DIR` temporar, fără chei reale) și un harness Playwright comun. Fiecare lens a acoperit o zonă: cele 5 șabloane individual (template-product-menu, template-local-service, template-portfolio, template-professionals, template-desserdirina), builder-chrome-ux, backend-api-security, payments-commercial, deploy-infra, docs-consistency, performance, static-renderer-export, calendar-native, telegram-intake, a11y, product-strategy, security-secrets-sweep. Fiecare a produs propriul `findings.json` + capturi de ecran cu `oracle-log.json` (sha256, timestamp, URL) în `04-QA-Evidence/Audit-2026-09-06-2225ca7/<lens>/`.

**Faza de verificare adversarială independentă a fost oprită de owner din motive de cost.** Doar 3 constatări (QR invalid pe toate 5 șabloanele, 2 teste Playwright care pică determinist, murdărirea arborelui git la rularea testelor) au dovezi de verificare colectate separat de orchestrator, cu unelte independente de lens-ul original (detector de coduri de bare Apple Vision pentru QR, rulare izolată repetată pentru teste). Toate celelalte 149 sunt raportate de un singur agent per zonă — au dovadă atașată (cod, capturi, output de comandă), dar fără o a doua confirmare.

Dovezile complete pentru fiecare constatare sunt în `04-QA-Evidence/Audit-2026-09-06-2225ca7/<lens>/findings.json` (descriere, dovadă, pași de reproducere, remediere) și în capturile `NN-*.png` + `oracle-log.json` din același director. Lista compactă a tuturor celor 152 de constatări, cu status de verificare per item, e în `verdicts.json` din același director.
