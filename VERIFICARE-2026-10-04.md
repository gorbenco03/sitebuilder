# Verificare finală Hidook Site Builder — 2026-10-04 (HEAD 43f31b8)

Dovezi: `04-QA-Evidence/Verify-2026-10-04-43f31b8/` (câte un director per lentilă, cu `oracle-log.json` / `findings.json`). Nicio constatare nu a fost respinsă la verificare. „Confirmat" = reprodus independent la HEAD pe un server izolat; „neverificat" = raportat de lentilă cu captură, dar fără a doua reproducere.

## 1. Verdict în 5 rânduri

1. **Nu e gata pentru clienți reali în starea actuală.** Parcursul principal (landing, wizard, editor, publicare, plată de test, site live, dashboard, export, ștergere cont) funcționează end-to-end pe telefon, pe 5 șabloane, la contact/mesaje, editor, a11y, layout, erori și securitate (`journeyWorks: true`).
2. **Două lentile au `journeyWorks: false`: journey-desktop și billing-account**, pentru același motiv: ramura Anulează, apoi Reactivează încasează 29€, lasă site-ul offline (404) și spune „Trial început".
3. **Alte trei probleme high** pot strica prima impresie sau datele clientului: linkuri sociale și e-mail inventate publicate live, butonul de plată tăiat pe telefon, ciorna veche din browser care rescrie serverul după Restabilește.
4. **Din punct de vedere al securității**: IDOR, CSRF pe rutele cu stare, XSS stocat și upload-uri nu au dat ieșiri de date; rămân o injecție CSS prin `theme.*` (medium) și logout fără verificare CSRF (medium, doar delogare forțată).
5. **Restul** (~80 de probleme medium/low) sunt UX, copy și accesibilitate. Nu blochează lansarea, dar `theme.*` și textele de anulare trebuie reparate rapid.

## 2. Probleme critice / high

| ID | Titlu | Suprafață | Stare verificare | Ce trebuie făcut |
|---|---|---|---|---|
| C-01 (journey-desktop#1, journey-phone#1, billing-account#1, errors-copy#1) | Reactivarea unui site anulat încasează 29€ (renewal), site-ul rămâne offline (404) și „Anulat", toast „Trial început"; `paidUntil` se stivuiește cu încă un an (2027 devine 2028) | Site-urile mele > Anulează > Reactivează site-ul | **Confirmat** pe 4 lentile, desktop și telefon, trial și după taxare | În `bot/webpublish.js:2539-2573` tratează `unpublished` ca `expired` pe ramura renewal: republică ultima versiune, setează live, nu stivui `paidUntil`. Toast separat pentru reactivare. Decizie de produs: 29€ sau 99€/trial nou (vezi M-billing#4). Oracol Playwright cancel, apoi reactivate, apoi `/live` 200. |
| H-01 (journey-desktop#2, templates-live#2) | Site-ul live conține linkuri Instagram/Facebook și e-mail inventate din numele afacerii (ex. `instagram.com/salon.aurora`, `contact@atelierverdesrl.ro`), plus adresă demo hibridă. Checklist-ul nu semnalează | Wizard/editare nume afacere, apoi /live (4 șabloane social; professionals mailto) | **Confirmat** | `cascadeBusinessNameIdentity` (`builder/app.js:454`) să golească sau să marcheze demo câmpurile sociale/e-mail în loc să le inventeze. Adaugă-le în checklist. Oracol: după wizard, live-ul nu conține handle-uri derivate din nume. |
| H-02 (journey-phone#2, billing-account#2) | Butonul „Adaugă un card — 99€ după trialul de 14 zile" e tăiat pe telefon (390/375/360) | Modal succes, `#btn-pay-publish` | **Confirmat** (scrollWidth 314 > 302 la 390) | `white-space: normal` și text centrat, sau etichetă scurtă. Verificare `scrollWidth <= clientWidth` la 360/390 în oracolul de modale. |
| H-03 (editor-integrity#1) | Editează după Restabilește (sau după editare pe alt dispozitiv) încarcă versiunea veche din browser, arată bannerul fals „deschis în altă filă" și rescrie draftul de pe server. Următoarea publicare pierde restabilirea | Istoric, Restabilește, apoi Editează; același cont pe 2 browsere | **Confirmat** (ambele variante) | În `loadSiteForEdit` / `ensureDraftBoundToPaidSite` șterge sau suprascrie scope-ul local `site:<id>` cu configul serverului înainte de primul `saveDraft`. Merge-ul pe file doar când celălalt TAB_ID e activ acum (`builder/app.js:6925-6940`, `10679-10686`). |

## 3. Probleme medium / low (un rând fiecare, grupate pe suprafață)

Notă: toate sunt „neverificat" (fără a doua reproducere), cu excepția celor marcate [conf.].

### Wizard și editor (text, câmpuri, salvare)
- M: Wizardul acceptă telefoane invalide („07123" devine wa.me/407123) și le publică; checklist-ul le bifează (journey-desktop#3).
- M: Localitatea din wizard nu rescrie eticheta hero „RESTAURANT · BUCUREȘTI", handle-ul Instagram, codurile poștale, `addressHref` (linkul Maps rămâne pe București) (phone#10, templates-live#3, desktop#2).
- M: Secțiunile adăugate (FAQ, Program, Unde ne găsești) ajung live cu conținut inventat, nemarcat ca demo; Program contrazice orarul real [conf.] (templates-live#1).
- M: „Recenzii" (toate) și „Echipă" (professionals) apar active în „Secțiuni pagină" dar nu există în pagină și nu pot fi adăugate (templates-live#4).
- M: Foaia de editare text pe telefon nu are `maxlength` și nici contor; textul peste limită se taie în tăcere (editor-integrity#4).
- M: Slug-ul propus la publicare e cel demo (`casa-nord`) pentru clientul deja autentificat; cardul și confirmarea de ștergere folosesc numele demo (editor-integrity#2, #3).
- M: Istoric versiuni: 4 până la 10 rânduri aproape identice după o publicare, fără insignă „Live", cu autosave-urile ca versiuni; dată en-GB (desktop#5, phone#13, editor#5, errors#17, layout#6).
- M: Erori la salvare: pastila „Nu s-a salvat" iese din ecran pe telefon (errors-copy#3); motivul doar în `title`, fără reluare automată la revenirea online (errors#4); „Salvat" afișat cu sesiune expirată (errors#6).
- L: Contor N/24 nemodificat după poza hero (editor#6); pânza nu se repictează după merge între file (editor#7); filă veche „Nu s-a salvat" după login B (editor#8); contor 43/45 vs 50 blocuri demo (desktop#9); Detalii se deschide derulat cu focus pe SEO (desktop#7, layout#8); „Rezolvă" poză duce la câmp „Poză adăugată" fals (desktop#8); previzualizarea din catalog fără „Începe cu acest design" (desktop#14); toast peste banner (desktop#18, layout#12).
- L: Mesaje de upload poze dublate/confuze, avertisment GIF/SVG afișat ca eroare (errors#12); adrese rezervate lipsă (login, billing, hidook…) (errors#13).

### Editor: bara de sus, layout responsive, tactil
- M: Telefon 420-440px: „Publică site-ul" acoperă numele șablonului și comutatorul desktop/mobil [conf.] (layout#1).
- M: 320/360/375px: Publică peste comutatorul device, cont peste undo (layout#2); 700-768px autentificat: pastila Salvat tăiată, Mai mult sub Publică (layout#4).
- M: Meniurile „Mai mult" și cont (z 320/600) sub sertarul Detalii (z 450/460): neclicabile cât Detalii e deschis, inclusiv Descarcă datele mele / Șterge contul (layout#3, billing#7).
- M: Banner quickstart „Nu acum" suprapus peste câmpuri/text pe telefon (layout#5, phone#11).
- M: Pe telefon „Publică" e doar o săgeată de download, fără etichetă; rail-ul taie „Detalii"/„Mai mult" (phone#3, #4, layout#9).
- M: Input-uri sub 16px (slug, e-mail, Detalii, quickstart): zoom la focus pe iOS (phone#5).
- M: Ținte tactile sub 44px: ștergere poză cu `opacity:0` pe touch (invizibilă!), ↑/↓ secțiuni, „Înlocuiește fotografia", buline culoare, meniu cont 32px (phone#7, #8, billing#11).
- M: Meniul contului din dashboard iese din ecran pe 390px, pagina se lărgește la 417px (phone#6).
- L: Legendă „text de exemplu" doar un pătrat portocaliu (desktop#10, layout#7); banner quickstart 3 rânduri la 700-768 (layout#11); landscape 844x390 lasă 43% pentru canvas (phone#15); banner cookie al site-ului acoperă canvasul în editor (phone#14); linkul WhatsApp din Detalii iese din ecran (phone#12); valori în afara token-urilor (layout#10); „Text greu de citit" pe paletele implicite Restaurant 2,0:1 / Desserdirina 3,2:1 / Salon 4,4:1 (desktop#17, phone#9, a11y#10, mutate: medium la phone).

### Site publicat (/live)
- M: Hero professionals rupt pe desktop (spațiu de 74px, „spaniolă" cade pe rând nou) (templates-live#5).
- M: Salon: h1 și buton lipite de marginea stângă la 1280-1920 (desktop#4).
- M: Contrast linkuri legale în subsol 3,6-3,9:1 (Restaurant, Meserii, Salon) (a11y#7); X-ul QR WhatsApp 36px, 18x30 la Desserdirina (a11y#8).
- L: Hero se umflă cu 120-300px cât e cookie banner deschis (templates-live#6); „Limba meniului" 3,35:1 (#7); FAQ cu țintă 26px (#8); wordmark tăiat la 390 (#9); „Deschide în Google Maps" cu `href="#"` fără JS (#10).

### Formular de contact și Mesaje
- M: Formularul (3 din 5 șabloane) ascunde mesajul de limită și spune „te redirecționăm la WhatsApp" la orice eroare, cu `window.open` asincron (contact#1).
- M: Portfolio/professionals: validarea și confirmarea nu sunt anunțate cititoarelor de ecran, focusul se pierde (contact#2, a11y#9).
- M: Butoane „Adaugă", „Marchează citit", „Șterge" fără nume unic; focus pe body după acțiune; ștergere fără confirmare (a11y#2, #3, contact#4).
- M: După „Anulează" butonul Mesaje dispare, deși mesajele rămân stocate (billing#3).
- L: Nume lung fără spații tăiat în modal (contact#3); modalul nu spune pentru ce site e, fără oră (contact#5); formular din ZIP: text de eșec la fiecare trimitere, README tăcut (contact#6, desktop#13); `/api/site-messages` acceptă non-string (contact#7).

### Facturare, cont, text juridic
- M: Anulare în trial, apoi reactivare = nou trial gratuit la nesfârșit; butonul rămâne „Adaugă un card" (billing#4, decizie de produs).
- M: Pornirea altui design suprascrie în tăcere ciorna neplătită existentă; la publicare cu ciornă existentă doar un toast roșu (billing#5, #6).
- M: Privacy/Terms nu menționează „Descarcă datele mele" și „Șterge contul" (billing#8; regula docs-stay-current).
- L: Text „iese din vânzare" / „rambursare" în trial, în modalele de anulare și ștergere (desktop#6, billing#9, errors#10); câmp de confirmare lipit de buton la ștergere (billing#10, phone#16); U+2011 în numele cardului vs. cerut la ștergere, buton dezactivat fără explicație (errors#9, medium); formatul prețului diferă și lipsește „apoi 29€/an" (billing#12); pagini juridice marcate „nu este text juridic final" (desktop#16); „Reîncearcă" dublat în mesajele offline (errors#2, medium); `/api/config` picat arată „$29" (errors#11); Stripe Checkout cu denumiri englezești și fără `locale` (errors#14); avertisment export înainte de refuzul „activează trialul" (errors#15); terminologie inconsecventă (errors#16); mesaje export neautentificat (desktop#15); cardul arată slug în loc de nume, Șterge cel mai proeminent (desktop#12); modal succes cu aspect de eroare (roz/roșu) (desktop#11).

### Sesiune expirată / erori de rețea
- M: Dashboard cu sesiune expirată: „Autentificare necesară." fără cale de conectare (errors#7); bannerul de reautentificare acoperit de Detalii (errors#5).
- L: Dashboard spune „sesiune expirată" când ești doar offline (errors#8).

### Accesibilitate (tastatură, cititor de ecran)
- M: Esc în popover Culoare și meniuri pierde focusul pe body (a11y#1); pasul 1 la 2 din publicare și „Link trimis" fără focus/anunț (a11y#4); 61 de zone contenteditable fără rol/nume (a11y#5); „Trimite pe WhatsApp" alb pe verde 1,98:1 (a11y#6).
- L: Meniul contului fără săgeți, `aria-haspopup`; X Detalii 34px; `document.title` fix; cookie banner lasă focusul pe body; wizard fără `autocomplete`; „Restaurant Restaurant" dublat (a11y#11 până la #15).

### Securitate
- M: `theme.primary/cream/primaryDark/primaryLight` nevalidate ca hex, injectează CSS în `<style>` pe toate 5 șabloanele (security#2).
- M: `POST /api/auth/logout` fără verificare CSRF Origin/Referer (doar delogare forțată) (security#1).
- L: 403 vs 404 inconsistent pe `calendar-native/owner/*`, fără scurgere de date (security#3).

## 4. Ce s-a verificat și ce nu

| Lentilă | `journeyWorks` | Acoperit | Neacoperit / limite |
|---|---|---|---|
| journey-desktop | **false** (C-01) | Parcurs complet 1440x900: landing, wizard, editor, publicare, plată de test, live, dashboard (Istoric, Domeniu, Facturi, Mesaje), export, anulare/reactivare/ștergere, GDPR, legal | Stripe real, calendar nativ, domeniu propriu, parcurs complet doar pe portfolio (restul doar product-menu) |
| journey-phone | true (cu C-01 pe ramura post-anulare) | 390x844 cu touch, 5 șabloane, wizard, bottom-sheet, publicare, plată, live, dashboard, landscape; 0 erori de consolă | Tastatura reală iOS/Android (risc neconfirmat: foaia de text e `position:fixed` fără `visualViewport`), telefoane <390px |
| templates-live | true | 5 șabloane: publicare, adăugare/eliminare secțiuni, republicare, live la 390 și 1440; overflow, skip link, cookie, atribuire, linkuri moarte, contrast | Calendar nativ, Instafidget, export, GDPR |
| contact-messages | true | 5 șabloane: formular, honeypot, rate limit, inbox, XSS, ZIP din `file://`, izolare între conturi | E-mailul de notificare către owner (fără RESEND), anulare/expirare, livrare WhatsApp/mailto reală |
| billing-account | **false** (C-01) | Prețuri EUR/USD/GBP, anulare/reactivare (trial și după taxare), ștergere site/cont, logout global, GDPR; telefon 360-390 | Reînnoire pentru site expirat, dunning, Stripe portal/Checkout real; `HIDOOK_TEST_PAY` patch-uit în proces pentru a emite `no_payment_required` |
| editor-integrity | true (cu H-03) | Undo/redo, istoric persistent, două file, logout curăță datele, slug, emoji la limită | Export, GDPR, domeniu, calendar |
| a11y-keyboard | true | Tastatură pe toate modalele și 5 site-uri, la 1440/768/390, contrast măsurat | **Cititor de ecran real**, Instafidget, calendar owner, meniul Mai mult de pe telefon |
| layout-responsive | true | Bara editorului 320 până la 1920 + zoom 200%, toate modalele, audit token-uri | Landing, Telegram, plăți reale |
| errors-copy | true | ~29 scripturi: erori 4xx/5xx/offline, upload-uri, export, domeniu, GDPR, scan de engleză | Stripe, DNS, e-mail reale |
| security-regress | true | CSRF pe toate rutele, IDOR (~30 endpoint-uri, 2 conturi), upload, XSS pe 5 șabloane, injecție `theme.*` | Doar server izolat, fără Stripe/e-mail reale |

**Goluri sincere pentru toate lentilele:** niciun Stripe real (checkout, portal, webhook cu semnătură reală), niciun e-mail real (magic link prin dev-link, notificări owner netestate), niciun DNS/domeniu propriu conectat, doar Chromium (fără Safari/Firefox, fără dispozitive fizice), fără cititor de ecran real, calendar nativ neexercitat în dashboard. Artefacte de test excluse: „Achitat" la trial simulat, `data-site-messages-api` gol fără `PUBLIC_URL`, JSON 404 pe /live anulat.

**Greutate dovezi:** evidența e untracked (journey-desktop ~44 MB, errors-copy ~61 MB, plus restul). Conform politicii din AGENTS.md: nu se comite brută; păstrați doar `findings.json` și câteva capturi mici ca dovadă pentru C-01 / H-01 / H-02 / H-03, arhivați sau ștergeți restul.

## 5. Recomandare

**Înainte de primii clienți (blocante):**
1. C-01 reactivare (cod + oracol cancel/reactivate/live). Decideți întâi prețul: 29€ renewal vs. 99€/trial nou, și dacă trialul se acordă o singură dată.
2. H-01 handle-uri sociale/e-mail inventate, plus orașul rescris complet (`addressHref`, eyebrow, handle).
3. H-02 butonul de plată tăiat pe telefon (fix CSS de o linie).
4. H-03 ciorna locală veche după Restabilește / alt dispozitiv.
5. `theme.*` validat ca hex în `build.js` (fix mic, închide injecția CSS).
6. Texte de anulare (fără „iese din vânzare", varianta trial vs plătit) și actualizarea Privacy/Terms pentru export/ștergere cont (regula docs-stay-current).
7. Meniurile Mai mult / cont sub sertarul Detalii (blochează „Șterge contul"/„Descarcă datele" cât Detalii e deschis) și bara de sus pe 320-440px (publicarea acoperă comutatorul).
8. Textele demo din secțiunile adăugate (FAQ, Program, Unde ne găsești) să intre în `computeDemoTextPaths` și în checklist; telefon invalid în wizard.

**Poate aștepta (după lansarea soft):** istoricul versiunilor (doar publicări + insignă Live), ținte tactile și font 16px, contrast (paleta implicită, linkuri legale, WhatsApp), anunțuri și focus pentru cititor de ecran, `theme`-uri/token-uri cosmetice, copy de erori offline, Stripe Checkout în română, `POST /api/auth/logout` cu CSRF, uniformizare 403/404, confirmare la ștergerea mesajelor, curățarea ZIP-ului de export (imagini nefolosite), pagini juridice finale aprobate de owner (înainte de lansare publică, nu înainte de primii clienți de test).

**Înainte de lansarea publică largă:** o rundă cu Stripe real în mod test (checkout, webhook semnat, portal), e-mail real (magic link, notificări), un domeniu propriu conectat, plus o verificare manuală pe iPhone/Android pentru tastatura virtuală și foaia de editare text.
