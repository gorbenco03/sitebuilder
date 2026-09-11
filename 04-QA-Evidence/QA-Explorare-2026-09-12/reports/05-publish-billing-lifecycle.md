# Publish → Billing → Lifecycle — raport explorare

Acoperit:
- Publicare site nou (professionals + portfolio + local-service), modal adresă/slug, la 1440×900.
- Validare slug live în `#modal-publish`: spații, diacritice, majuscule, prea scurt (<3), cuvânt rezervat ("www"), slug valid.
- Autentificare cu magic link de dev (`#dev-link`) → CTA plată (`#btn-pay-publish`, HIDOOK_TEST_PAY=1) → succes → `/live/<slug>/`.
- Conținutul modalului de succes și textul de pe site-ul live încărcat într-un tab nou.
- Republicare: editare câmp (`#dr_business_name`) din Detalii → click „Publică site-ul" din nou, de două ori (o dată din stare „proaspăt plătit", o dată printr-un al doilea ciclu edit+republish), verificând dacă apare din nou modalul de adresă/slug și dacă live reflectă editarea.
- Dashboard („Proiectele mele"): am deschis fiecare buton de pe cardul unui site — Editează, Anulează, Istoric, Domeniu, Facturi, Șterge, Configurează calendarul — atât pe un site creat prin flux real (checkout complet), cât și (pentru comparație) pe unul seedat direct în registry.
- Anulare abonament (`Anulează`) pe un site activ plătit: verificat efectul pe `/live/<slug>/` (răspuns HTTP), pe rândul din registry și pe butoanele rămase pe card.
- Ștergere: nume greșit în confirmare (buton dezactivat), nume corect (ștergere reușită, card dispare, rând din registry șters, folder publicat șters de pe disc); refuz cu abonament activ (fără anulare în prealabil) — mesaj citit direct din UI.
- Al doilea site neplătit: am creat două site-uri neplătite consecutive cu ACELAȘI utilizator/sesiune și am urmărit exact răspunsul HTTP al `/api/publish` pentru amândouă (reprodus de 3 ori, în rulări server separate, cu date proaspete de fiecare dată).
- Istoric versiuni: pe un site real publicat + republicat de două ori — verificat lista de versiuni și click pe „Restabilește".
- Facturi: pe un site din flux real de checkout de test (trial), verificat sumele și data.
- Domeniu propriu: citit textul integral din modalul „Domeniul tău propriu".
- Layout mobil (390×844) pentru cardul din dashboard: măsurat înălțimea/lățimea fiecărui buton.
- Consolă și rețea: ascultat `console`, `pageerror`, `requestfailed`, răspunsuri HTTP ≥400 pe parcursul tuturor pașilor de mai sus.

Neacoperit:
- Refuzul de ștergere pentru „programări viitoare confirmate" (FUTURE_BOOKINGS) — necesită să inserez o rezervare validă direct în baza de date a calendarului nativ (`bot/calendar-native`), ceea ce nu am apucat să configurez; codul confirmă însă mesajul (`bot/server.js:1716-1723`, „Anulează sau finalizează programările din Programări înainte de ștergere…").
- Fluxul complet de conectare a unui domeniu propriu (verificare DNS reală, stare „conectat") — am citit doar textul inițial al modalului, nu am simulat un provider DNS extern.
- Reactivare după anulare — nu există niciun buton „Reactivează" pe cardul anulat (doar Editează/Istoric/Facturi/Șterge); nu am găsit un flux alternativ de reactivare în UI, dar nu am verificat exhaustiv (de ex. dacă „Editează" + „Publică" din nou reface abonamentul — probabil da, pe baza codului `directRepublish`/`canStartRenewalCheckout`, dar nu am parcurs-o efectiv cu checkout nou).
- Testare pe 390×844 a întregului flux de publicare (doar dashboard-ul a fost verificat pe mobil; modalul de adresă/slug și checkout-ul au fost testate doar la 1440×900).

## DEFECTE (observate, cu dovadă)

### D1. Al doilea site neplătit NU este refuzat — limita „un singur site neplătit" e ocolibilă din UI
- Severitate: blocker
- Unde: fluxul „Alege un design" → „Publică site-ul" → „Continuă", pentru un utilizator care are deja un draft neplătit.
- Pași:
  1. Autentificat ca `pbl-drafts@example.com`, pornesc un design „portfolio", dau slug, „Continuă", login cu magic link → ajung la CTA-ul de plată („Adaugă un card — începe trialul de 7 zile — 99€"). NU plătesc.
  2. Revin la catalogul de șabloane, pornesc un al doilea design „local-service", dau alt slug, „Continuă".
  3. Aștept răspunsul.
- Observat: al doilea draft ajunge și el la exact același CTA de plată, fără niciun mesaj de refuz. Am capturat direct răspunsul HTTP al `POST /api/publish` pentru ambele apeluri: primul → `200 {"site":{"id":"...","slug":"atelier-ivoire","status":"draft","paid":false},"paymentUrl":"/app/#test-checkout=..."}`, al doilea → tot `200`, cu un site NOU (`id` diferit, `slug":"renovari-casa-nord"`, `status":"draft","paid":false`). Interogând direct registry-ul după test, ambele site-uri (draft, neplătite) apar sub ACELAȘI `userId`. Reprodus identic de 3 ori, în 3 rulări de server separate (baze de date proaspete de fiecare dată).
- Așteptat: al doilea apel `/api/publish` ar trebui să întoarcă `409` cu mesajul „Ai deja un site neplătit. Plătește-l sau șterge-l înainte să creezi altul." — exact mesajul definit în cod, dar care nu apare niciodată în acest scenariu.
- Dovadă:
  - Screenshot: `shots/pbl-10-draft1-unpaid-cta.png` (primul draft, la CTA de plată)
  - Screenshot: `shots/pbl-11-draft2-also-reaches-cta.png` (al doilea draft, ACELAȘI CTA, fără refuz)
  - Log JSON complet cu ambele răspunsuri HTTP: `probes/pbl-recapture-log.json` (secțiunea „draft2-result", câmpul `netLog`)
  - Reprodus independent de 2 ori suplimentar în `probes/lifecycle-part4.json` și `probes/run6.log` (script separat, `probes/unpaid-draft-check.mjs`), cu userId identic pentru ambele site-uri confirmat direct din registry.
- Indiciu cod: `bot/server.js:3568-3579` — verificarea „Max 1 unpaid site per user" (`existing = await reg.listSites(userId); ... if (unpaid.length > 0) return 409`) există și, testată izolat cu `registry.listSites()` pe date reale, se comportă corect (vezi diagnosticul manual din sesiune). În fluxul real prin server însă, la al doilea apel `/api/publish` din aceeași sesiune autentificată, verificarea nu blochează cererea — cauza exactă (posibil o problemă de timing/citire în jurul autentificării sau al reîncărcării sesiunii) nu a fost identificată cu certitudine; comportamentul observat este însă solid și reproductibil.
- Impact pentru client: un utilizator poate acumula la nesfârșit site-uri „ciornă" neplătite, fiecare cu propriul checkout de test pornit — exact scenariul de abuz pe care verificarea din cod spune că îl previne.

### D2. Mesajul de succes la republicare spune din nou „Trial de 7 zile început", deși nu e un trial nou
- Severitate: minor
- Unde: editor, `#btn-publish` pe un site deja plătit/live, după o editare.
- Pași: 1. Publică un site (trial pornit). 2. Închide modalul de succes. 3. Editează un câmp (ex. numele afacerii) din Detalii. 4. Apasă din nou „Publică site-ul".
- Observat: apare din nou exact modalul „✓ Site-ul tău e live — trial de 7 zile început", cu același link.
- Așteptat: la o republicare a unui site deja activ (nu la prima publicare), mesajul ar trebui să spună ceva de tipul „Modificările au fost publicate" — nu să sugereze că a pornit un trial nou / un nou ciclu de facturare.
- Dovadă: `shots/pbl-keep-81-after-second-republish.png`.
- Indiciu cod: `builder/app.js` — modalul de succes (`#modal-success-title` cu textul fix „Site-ul tău e live — trial de 7 zile început") pare reutilizat și pentru calea `directRepublish` din `bot/server.js:3631-3633`, fără text distinct pentru re-editare vs. prima publicare.

### D3. Mesajul serverului pentru un slug rezervat ("reserved") e înlocuit cu textul generic „deja folosit"
- Severitate: minor
- Unde: `#modal-publish`, câmpul de slug, la tastarea unui cuvânt rezervat (ex. „www").
- Pași: 1. În modalul de adresă, scrie „www". 2. Așteaptă verificarea (debounce ~550ms).
- Observat: eroarea afișată este „Această adresă este deja folosită. Încearcă alta." — exact ca la un slug efectiv luat de alt site.
- Așteptat: server-ul are deja un mesaj distinct și mai corect pentru acest caz („Această adresă este rezervată de platformă. Alege alta.", `bot/server.js:1374`), dar clientul îl ignoră și afișează mereu mesajul generic de coliziune.
- Dovadă: `shots/pbl-02-slug-reserved-www.png`; text capturat live: `{"typed":"www","errText":"Această adresă este deja folosită. Încearcă alta."}` (`probes/pbl-recapture-log.json`).
- Indiciu cod: `builder/app.js` funcția `checkSlug()` — pe ramura `else` (not available) folosește mereu `PUBLISH_SLUG_COLLISION_MESSAGE`, indiferent de `data.error` întors de `/api/slug-check`.

## SUGESTII (nu sunt defecte; ar face diferența)
- S1. Slug-urile cu spații/diacritice/majuscule (ex. „Café Deluxe", „MareCafe") sunt normalizate silențios (fără niciun mesaj), iar câmpul e rescris cu versiunea curată doar după debounce. Un utilizator care tastează repede „Café Deluxe" nu vede nicio explicație de ce adresa afișată devine „cafe-deluxe" — un mic text de tip „Adresele web nu pot avea spații/diacritice — am simplificat-o pentru tine" ar elimina confuzia, mai ales pe mobil unde preview-ul e mic.
- S2. Pe cardul din dashboard, linkul cu URL-ul complet al site-ului live are o zonă de click de doar 19px înălțime (măsurat la 390×844) — sub pragul uzual de 44px pentru țintă tactilă. Nu blochează nimic (nu e acțiune critică), dar e greu de atins exact pe telefon.
- S3. Toate celelalte butoane de pe card (Editează, Anulează, Istoric, Domeniu, Facturi, Șterge, Configurează calendarul) au exact 44px înălțime pe mobil — corect dimensionate.

## VERIFICĂRI CERUTE — rezultate

1. **Publică site nou, modal adresă/slug, slug invalid/valid** — CONFIRMAT parțial: modalul funcționează, slug valid trece corect; mesajele de eroare sunt clare DOAR pentru „prea scurt" și „deja folosit/rezervat" (vezi D3 pentru nuanța rezervat-vs-luat); pentru spații/diacritice/majuscule nu există mesaj — normalizare silențioasă (S1).
2. **Checkout de test → trial → site live, client vede clar că e live, linkul funcționează** — CONFIRMAT. Modalul de succes e clar („Site-ul tău e live — trial de 7 zile început", link direct, buton Copiază, buton WhatsApp). Linkul `/live/<slug>/` funcționează imediat (HTTP 200, conținutul șablonului randat corect). Screenshot: `pbl-06-checkout-success.png`, `pbl-07-live-site.png`.
3. **Republicare: nu se cere alt slug; modificarea apare pe live; timp/cache** — CONFIRMAT că NU se cere alt slug (click pe „Publică" pe un site deja plătit republică direct, fără modalul de adresă). Modificarea (un marker text unic într-un câmp) a apărut pe `/live/<slug>/` în sub 2 secunde la prima verificare, fără cache stale observat. Vezi însă D2 pentru mesajul de succes înșelător la republicare.
4. **Fiecare buton de pe card** — CONFIRMAT prezente și funcționale pentru un site publicat prin fluxul real: Editează (redeschide editorul cu preview vizibil), Anulează (declanșează flux de anulare), Istoric (listează versiuni reale + „Restabilește" funcțional, vezi mai jos), Domeniu (modal cu instrucțiuni clare, vezi punctul 10), Facturi (arată suma corectă, vezi punctul 9), Șterge (flux de confirmare funcțional), Configurează calendarul (apare doar pe professionals, cum e de așteptat). Nu am găsit text „undefined"/„NaN"/„Invalid Date"/engleză pe niciunul dintre aceste ecrane pentru un site din flux real. (Notă: pe un site „seedat" direct în bază de date, ocolind fluxul UI normal, butonul Editează și Configurează calendarul nu au funcționat — dar asta reflectă lipsa de config din seed-ul de test, nu un defect de produs; confirmat separat pe un site din flux real, unde ambele au funcționat corect.)
5. **Anulare → dispare de pe live; ce rămâne pe card; reactivare** — CONFIRMAT parțial. După „Anulează": `/live/<slug>/` întoarce HTTP 404 imediat; rândul din registry trece în `status:"unpublished"`; pe card rămân doar Editează/Istoric/Facturi/Șterge (Anulează, Domeniu, Configurează calendarul dispar corect). NU AM GĂSIT niciun buton de reactivare vizibil pe cardul anulat — neconfirmat exhaustiv dacă „Editează"+„Publică" din nou reface abonamentul, cod sugerează că da (`canStartRenewalCheckout`) dar n-am parcurs efectiv un nou checkout din acest punct.
6. **Ștergere: flux complet + refuzuri** — CONFIRMAT pentru: nume greșit → buton dezactivat; nume corect → ștergere reușită (card dispare, rând din registry șters, folder publicat șters de pe disc); refuz cu abonament activ → mesaj clar afișat live: „Site-ul are un abonament activ. Anulează-l din Facturare (butonul „Anulează") înainte de ștergere — altfel clienți care au plătit ar rămâne fără site." (`pbl-keep-84-delete-modal-active-sub-refused.png`). NU AM PUTUT verifica live refuzul pentru „programări viitoare" (necesită date de calendar nativ pe care nu am apucat să le configurez) — confirmat doar din cod (`bot/server.js:1716-1723`, mesaj RO clar).
7. **Site neplătit (ciornă); al doilea site neplătit refuzat?** — INFIRMAT. Vezi D1: al doilea site neplătit NU este refuzat, contrar mesajului definit în cod și contrar comportamentului așteptat descris în briefing.
8. **Istoric versiuni: există, se poate reveni** — CONFIRMAT. Pe un site real publicat + editat + republicat, „Istoric" arată 4 versiuni cu dată/oră reale („Versiunea 1"..„Versiunea 4"), fiecare cu buton „Restabilește" funcțional (click → toast „Versiunea a fost restabilită."). Screenshot: `pbl-keep-90-istoric-real-fixed.png`, `pbl-keep-91-after-rollback.png`.
9. **Facturi: ce arată pentru un trial; cifrele au sens** — CONFIRMAT. Pentru un site din checkout de test (trial), „Facturi" arată: „12 sept. 2026 — Publicare (primul an) — 99,00 EUR". Suma (99€) și moneda (EUR, cf. bucketing implicit RO în mediu izolat) corespund modelului de preț din produs (99 apoi 29/an). Data e corectă (data rulării testului). Nu apare nicio linie „NaN"/„undefined".
10. **Domeniu propriu: instrucțiuni inteligibile pentru non-programator** — CONFIRMAT, textul e clar și evită jargonul: „Conectează un domeniu pe care îl deții deja (ex: afacereamea.ro) direct la site-ul tău Hidook — fără concierge, fără să cumperi un domeniu nou aici." + câmp cu hint „Introdu domeniul pe care îl deții deja la alt furnizor — nu este nevoie să-l cumperi de la Hidook." Nu am putut testa pasul următor (înregistrări DNS reale, verificare) fără un domeniu real.
11. **Consolă și rețea: cereri 4xx/5xx** — CONFIRMAT fără erori neașteptate pe fluxul principal (publicare, checkout, dashboard, anulare, ștergere). Singurele răspunsuri ≥400 observate au fost `401` pe `/api/me` înainte de autentificare (comportament normal, nu e o eroare de produs) și `409`/`422`/`404` returnate intenționat de server la validări (slug rezervat, nume greșit la ștergere) — toate gestionate corect în UI. Nu am observat request-uri eșuate (`requestfailed`) sau erori JS necaptate (`pageerror`) pe parcursul pașilor testați.
