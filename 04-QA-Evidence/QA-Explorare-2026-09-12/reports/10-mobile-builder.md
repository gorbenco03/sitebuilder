# Mobile Builder — raport explorare

Acoperit:
- Server local pornit conform patternului din `bot/test/delete-site-oracle.mjs` /
  `bot/test/wave11-mobile-investigate.mjs`: `HIDOOK_TEST_PAY=1`,
  `HIDOOK_ISOLATED_DEPLOY=1`, `DATA_DIR` temporar, `node --experimental-sqlite`.
  Niciodată `lp.hidook.agency`, niciun login real.
- Playwright cu `chromium`, context mobil real: `viewport:{390,844}`, `isMobile:true`,
  `hasTouch:true`, `deviceScaleFactor:2`, toate interacțiunile cu `.tap()`.
- Landing → cookie banner → alegere design (professionals) → editor (`#edit`),
  drawer-ul de detalii care se auto-deschide, închiderea lui.
- Toggle preview desktop/mobil (`#btn-preview-desktop` / `#btn-preview-mobile`)
  în editor — funcționează, tap înregistrat, `aria-pressed` corect.
- Re-verificare regresie topbar (fix-ul Wave 11 — `.editor-topbar-scroll`):
  0 suprapuneri, 0 butoane sub 44px la 390×844 portrait.
- Editare titlu inline (`business.name` din preview), verificat poziția față de
  o tastatură virtuală simulată (336px jos) și că scroll-ul paginii nu sare.
- Editare telefon din drawer (`#dr_contact_phone`).
- Ascundere secțiune (FAQ) din panoul „Secțiuni pagină" din drawer — panoul e
  primul din drawer, nu trebuie scroll ca să-l găsești.
- Adăugare serviciu ("+ Adaugă" inline în preview, `.pr-svc .hb-add-btn`) —
  verificat că textul noului element e sensibil ("Serviciu nou", nu gol/placeholder
  generic) și că poziția de scroll nu sare — confirmă că fix-ul din
  `audit-editor-list-add.test.js` ține și pe touch/mobil.
- Încărcare poză (hero.background) din drawer prin `setInputFiles` pe file
  chooser-ul declanșat de tap.
- Scanare `scrollWidth > clientWidth` pe document ȘI pe topbar/canvas/drawer/
  modal/sites-list, la fiecare pas major, la toate cele 3 viewporturi.
- Scanare text sub 14px (computed font-size) pe editor și dashboard.
- Publicare completă de pe telefon: modal slug → auth email → `#dev-link` →
  checkout test (`#btn-pay-publish`, `HIDOOK_TEST_PAY`) → modal succes cu URL
  live, buton Copiază, buton WhatsApp, "Înapoi la editor".
- Dashboard pe telefon: cardul site-ului (thumb + info + acțiuni), toate cele
  7 butoane posibile (Editează, Anulează, Istoric, Domeniu, Facturi, Șterge,
  Configurează calendarul — apar pentru un site professionals plătit/activ).
- Cele 4 modale din dashboard deschise și verificate pe rând: Istoric
  (`#modal-versions`), Domeniu (`#modal-domain`), Facturi (`#modal-invoices`),
  Șterge (`#modal-delete-site`) — dimensiune, închidere cu X, scroll intern.
- Rotire landscape 844×390: template picker, editor, canvas, buton Publică.
- Tabletă 768×1024: template picker, editor, editare titlu, dashboard.
- Console errors / pageerror / requestfailed capturate pe toate paginile.

Neacoperit (și de ce):
- Istoric/Facturi cu conținut real (mai multe versiuni/facturi) care ar forța
  scroll intern — contul de test avea un singur site, deci `scrollHeight ==
  clientHeight` la toate modalele; nu am putut confirma dacă scroll-ul intern
  chiar funcționează cu conținut lung.
- Celelalte 4 șabloane (product-menu, local-service, portfolio, desserdirina)
  nu au fost parcurse pas-cu-pas pe mobil — am ales `professionals` ca
  reprezentativ (are listă de servicii + secțiuni + calendar nativ). Fix-ul de
  listă verificat (`hb-add-btn`) e comun cu product-menu/portfolio conform
  `audit-editor-list-add.test.js`, dar nu am reconfirmat vizual pe telefon.
- Modalele Instagram, Galerie și Preview fullscreen nu au fost deschise pe
  mobil (timp) — presupun aceeași clasă `.modal-close` ca celelalte (verificat
  în cod, nu vizual/tactil pe fiecare).
- Nu am testat efectiv clipboard-ul butonului "Copiază" sau deschiderea reală
  a linkului WhatsApp (necesită permisiuni de browser mobil reale).
- Nu am parcurs "Configurează calendarul" → owner dashboard-ul de programări
  nativ — e o pagină separată de builder, în afara ariei mele.
- N-am rulat `npm test` (interzis explicit).
- N-am atins `bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`.

## DEFECTE (observate, cu dovadă)

### D1. Butonul X de închidere e sub pragul de 44px pe TOATE modalele, fără alternativă de "tap-outside"
- Severitate: major (sistemic — afectează fiecare din cele 9 modale ale
  aplicației; nu blochează complet, dar e greu de nimerit cu degetul, iar
  pentru Domeniu/Facturi/Istoric/Șterge e SINGURA cale de închidere pe telefon)
- Unde: `.modal-close` (clasă comună, fără override pe mobil) — testat
  concret pe `#btn-close-success`, `#btn-close-versions`, `#btn-close-domain`,
  `#btn-close-invoices`, `#btn-close-delete-site`; aceeași clasă e folosită și
  de `#btn-close-publish`, `#btn-close-preview`, `#btn-close-gallery`,
  `#btn-close-instagram` (verificat în cod, nu măsurat individual).
- Pași: 1. Publică un site de pe telefon → modalul de succes. 2. Din
  dashboard, deschide Istoric / Domeniu / Facturi / Șterge pe rând.
- Observat: X-ul măsoară 27×28px (`getBoundingClientRect`) de fiecare dată.
  Tap-ul pe backdrop (în afara casetei modalului) NU închide modalul — am
  verificat codul (`openModal`/`closeModal` în `builder/app.js:197-230`): nu
  există niciun listener de click pe `.modal-overlay`/backdrop. Singura
  alternativă e tasta Escape, inutilă pe o tastatură virtuală de telefon.
- Așteptat: minim 44×44px pe orice control tactil, sau un backdrop tap-to-close
  ca rezervă.
- Dovadă: `shots/17-portrait-publish-success.png`, `shots/20-portrait-modal-istoric.png`,
  `shots/21-portrait-modal-domeniu.png`, `shots/22-portrait-modal-facturi.png`,
  `shots/23-portrait-modal-sterge.png` + valori măsurate în
  `qa-reports/10-mobile-builder-findings.json` (arie `tap-targets`, "close (X) button size 27x28px" ×5).
- Indiciu cod: `builder/app.css:2077-2090` (`.modal-close` — fără `min-width`/
  `min-height`, fără media query mobil); `builder/app.js:197-230`
  (`openModal`/`closeModal` — fără listener pe backdrop).

### D2. Butonul "Elimină/Adaugă" pentru ascunderea unei secțiuni e sub 44px înălțime
- Severitate: minor
- Unde: drawer „Detalii site" → panoul „Secțiuni pagină" → `.hb-secrow__btn--wide`
  (testat pe secțiunea "Întrebări frecvente", șablon professionals).
- Pași: 1. Deschide drawer-ul. 2. Găsește rândul unei secțiuni eliminabile.
  3. Apasă "Elimină".
- Observat: 64×30px măsurat. Funcțional merge (secțiunea se ascunde corect,
  eticheta devine "Ascunsă" și butonul devine "Adaugă"), dar sub pragul tactil.
- Așteptat: ≥44px înălțime.
- Dovadă: `shots/10-portrait-section-hidden-faq.png`; măsurătoare în
  `10-mobile-builder-findings.json` ("section hide button \"Elimină\" size 64x30px").
- Indiciu cod: `.hb-secrow__btn` — căutare rapidă în `builder/app.css` nu a găsit
  o regulă `min-height` pentru această clasă.

### D3. Butonul "+ Adaugă" pentru elemente repetabile (servicii) e sub 44px înălțime
- Severitate: minor
- Unde: preview inline, `.pr-svc .hb-add-btn` (șablon professionals; aceeași
  clasă e comună cu product-menu/portfolio conform `audit-editor-list-add.test.js`).
- Pași: 1. În editor, scroll la lista de servicii. 2. Apasă "+ Adaugă".
- Observat: 91×34px măsurat. Funcțional corect — adaugă exact un item nou cu
  text sensibil ("Serviciu nou"), fără să sară scroll-ul.
- Așteptat: ≥44px înălțime.
- Dovadă: `shots/11-portrait-service-added.png`; măsurătoare "+ Adaugă" service
  button size 91x34px în findings.json.

### D4. Câmpul de telefon din drawer e cu 4px sub pragul de 44px
- Severitate: minor
- Unde: drawer „Detalii site" → „Contact și locație" → `#dr_contact_phone`.
- Observat: 40px înălțime măsurată. Funcțional corect (valoarea se salvează),
  câmpul rămâne deasupra liniei tastaturii virtuale simulate (bottom=485 vs
  keyboard-top=508).
- Așteptat: ≥44px.
- Dovadă: `shots/09-portrait-phone-edited.png`; "phone input height=40px" în findings.json.

### D5. La rotire landscape (844×390), indicatorul de checklist se suprapune vizual cu iconița de cont
- Severitate: minor (doar vizual — tap-ul pe cont funcționează corect, verificat)
- Unde: editor topbar, orientare landscape telefon (844×390).
- Pași: 1. Deschide editorul la 844×390 (landscape). 2. Închide drawer-ul.
  3. Privește colțul din stânga sus al topbar-ului.
- Observat: `#checklist-indicator` are caseta (106.9,3.5)–(180.4,47.5),
  `#btn-account-menu` are caseta (157.7,11.5)–(185.7,39.5) — se suprapun pe o
  zonă de ~23×28px (măsurat cu `getBoundingClientRect`, confirmat cu un test
  separat de coliziune). Vizual, chenarul galben al bulinei "35/40" trece
  peste iconița rotundă de cont. Am verificat funcțional: `tap()` pe
  `#btn-account-menu` tot deschide meniul de cont corect — deci e o coliziune
  vizuală (cosmetică), nu un blocaj funcțional.
- Așteptat: casetele elementelor din topbar să nu se intersecteze deloc,
  indiferent de orientare (era exact regresia pe care fix-ul Wave 11 o rezolva
  la 390×844 portrait, dar pare să nu fi fost testată explicit la lățimea
  landscape de 844px, peste pragul de 640px unde rail-ul de scroll devine
  no-op).
- Dovadă: `shots/26-landscape-editor-drawer-closed.png`,
  `shots/31-landscape-topbar-overlap-zoom.png` (zoom 4× pe zona de coliziune).

## SUGESTII (nu sunt defecte; ar face diferența)
- S1. Canvas-ul de editare în landscape 844×390 are doar ~245px înălțime utilă
  (topbar + checklist banner ocupă restul) — editarea cere mult scroll pe
  verticală; la portrait canvas-ul are 575px. Merită un mod "landscape compact"
  care ascunde banner-ul de checklist opțional.
- S2. Câteva texte secundare de sub 14px pe dashboard/editor (linkuri nav
  12.8px, "Salvat" 12.48px, badge-uri de status 11.52px, linia de hosting/trial
  12.48px) — probabil intenționat ca ierarhie vizuală, dar merită verificat cu
  un test real pe telefon dacă rămân lizibile (WCAG recomandă 14px+ pentru text
  funcțional, nu doar decorativ).
- S3. `.modal-close` ar beneficia de un `min-width:44px; min-height:44px` la
  breakpoint-ul mobil deja existent în `app.css` (linia ~560 are exact acest
  pattern pentru alte butoane) — fix mic, impact mare (D1 e cel mai răspândit
  defect găsit).

## VERIFICĂRI CERUTE
Briefing-ul ariei mele nu conține o listă separată de „VERIFICĂRI CERUTE" — vezi
secțiunea DEFECTE de mai sus pentru fiecare element din lista de pași (1–8) a
briefing-ului comun, mapat explicit:
1. Landing→design→editor: CONFIRMAT, funcționează; toggle preview/editare
   (`#btn-preview-desktop`/`#btn-preview-mobile`) CONFIRMAT funcțional.
2. Editare titlu/telefon/serviciu nou/poză/ascundere secțiune: toate
   CONFIRMATE ca funcționale; 4 din 5 controale sub pragul de 44px (D2, D3, D4;
   titlul editat inline nu are propriul buton, deci nu se aplică).
3. Dashboard mobil (carduri, butoane pe rând propriu, modale): CONFIRMAT —
   butoanele stau pe rând propriu sub 420px (fix-ul recent ține), toate
   modalele (Șterge, Domeniu, Facturi, Istoric) încap în ecran și se închid,
   dar cu X-ul sub prag (D1).
4. Publicare de pe telefon (slug, checkout test, mesaj succes): CONFIRMAT
   end-to-end, fără erori, modalele încap în 390px.
5. Overflow orizontal / text sub 14px / butoane suprapuse: NU am găsit niciun
   `scrollWidth > clientWidth` (document sau panouri) la niciun viewport;
   text sub 14px găsit dar doar pe conținut secundar (S2); suprapunere de
   butoane găsită doar în landscape (D5), nu în portrait.
6. Rotire 844×390: CONFIRMAT utilizabil, cu suprapunere vizuală minoră (D5) și
   canvas foarte comprimat pe verticală (S1).
7. Tabletă 768×1024: CONFIRMAT — niciun overflow, editare titlu funcțională,
   dashboard fără probleme vizibile.
8. Console errors: singura eroare observată constant e `401` pe `GET /api/me`
   înainte de login — verificat separat că nu e specifică mobilului (apare
   identic la orice viewport, e un ping de sesiune normal, nu un defect).
