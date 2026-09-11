# Registru feedback QA extern — 4 documente Word (2026-09-12)

Sursa: 4 documente Google Drive, fiecare cu text scurt + capturi. Mapare pe șabloane
făcută din capturi (nume firmă din preset, tipografie, culori).

| ID | Șablon | Zona | Feedback (parafrazat fidel) | Tip | Notă din capturi |
|----|--------|------|------------------------------|-----|------------------|
| F1 | local-service | navbar | În stânga navbar-ului, înlocuim nr. de telefon cu opțiunea de a pune denumirea companiei (se repetă mai jos) | structură/config | Captură: navbar întunecat cu telefon stânga, zonă centru, „CERE OFERTĂ" dreapta |
| F2 | local-service (toate) | design | Toate butoanele mai rotunjite, efect mai „moale" | design | — |
| F3 | local-service | design | Butonul cu nr. de telefon (sus și înainte de footer) crem/alb pentru evidențiere | design | Captură: „SUNĂ +40…" pe fundal închis, telefon galben-portocaliu |
| F4 | local-service | editor | Chip-ul „București și împrejurimi" nu poate fi personalizat, nu există opțiune de a scrie | defect editor | Captură: card „Cere o ofertă gratuită" cu 5 chip-uri; ultimul selectat |
| F5 | local-service (toate) | editor/perf | Să scoatem reîncărcarea întregii pagini când modificăm ceva; refresh doar pe secțiune | defect perf/UX | Legat de fix-ul „scroll jump" din 09-07 — de verificat dacă mai reîncarcă integral |
| F6 | local-service | galerie „Lucrări finalizate" | Opțiune de slide/carusel pentru mai multe poze | feature | — |
| F7 | local-service, portfolio, desserdirina | secțiune nouă | Când adăugăm o secțiune nouă nu putem adăuga poze; panoul Poze nu știe de secțiunea nouă | defect | Repetat în 3 documente cu „!!!" |
| F8 | portfolio | galerie | A 4-a poză se pune mai jos, în mărimea originală; carusel | defect layout | Captură „Din salon": 3 poze pe rând |
| F9 | portfolio | galerie | Mai mult spațiu între poze (pe fundal colorat arată rău), poze puțin mai mici | design | — |
| F10 | portfolio | servicii | Serviciu nou: lipsește câmpul de preț (fontul subțire, gri) și icon-ul | defect editor | Captură: „Manichiura igienica" / „Serviciu nou" fără preț, fără icon; „machiaj natural" fără preț în lista de prețuri |
| F11 | portfolio | lista de prețuri | Pe unele culori lista se pierde — chenar gri/transparent ca default | design/contrast | Captură: listă pe fundal portocaliu, text albastru-gri — contrast slab |
| F12 | portfolio | programare | Programare online: dropdown alege serviciu → meșterul → ora/data → confirmare pe email | feature | Captură inspirație: „Programare Online" cu breadcrumb Servicii > Meșter > Data și ora > Confirmare |
| F13 | portfolio, professionals | social | Nu uităm de Instagram și icon-uri de rețele | feature/design | Captură footer: „IG FB" ca text, abia vizibil pe portocaliu |
| F14 | professionals | hero | Skip la textul de sub poza principală, direct Servicii | config | — |
| F15 | toate | logo | Logo-ul încărcat: mărime standard ca să fie vizibil pe toate site-urile; denumirea text e ok, poza nu | defect | „!!!" |
| F16 | professionals | liste (servicii/pași) | Element nou: are titlu, lipsește descrierea (de două ori, pe două liste) | defect editor | Captură: „05 Rezultat garantat" fără descriere vs „03 Îndrumare…" cu descriere; „4 Venim cu un raspuns" fără text |
| F17 | professionals | card Experiență | Opțiune de a adăuga câmpuri (rânduri) în lista din Experiență | defect editor | Captură: 3 rânduri fixe |
| F18 | professionals | programări | Opțiune de a adăuga datele/orele disponibile | feature/discoverability | Captură: select Data / Ora cu 60 min — formularul local |
| F19 | professionals | contact | Îi place formularul de înregistrare (pozitiv) | — | — |
| F20 | professionals | contact | Telefon/email/rețele în „celule" dau impresia că trebuie completate; simplu, pe dreapta, aliniate cu primul rând din descriere | design | Captură: 4 casete albe cu chenar — arată ca inputuri |
| F21 | professionals | footer/contact | Rândurile aliniate — acum unul mai sus altul mai jos | design | Captură footer: 3 coloane cu top-uri diferite |
| F22 | desserdirina | layout | Suprapune cardurile Despre noi / Comandă acum, întâi Despre noi, apoi Comandă (Despre noi se extinde vertical) | design/layout | Captură: 2 carduri side-by-side, cel roz „Comandă acum" |
| F23 | desserdirina | traducere | Traducerea nu se aplică corect deloc + diferă denumirile de secțiuni | defect | Captură: comutator EN/RO lângă „Meniu" |
| F24 | desserdirina | galerie „Creațiile noastre" | Pozele aranjate frumos, dar prea multe se suprapun și își pierd rolul; altă formă de prezentare | defect layout | Captură: 5 poze suprapuse haotic |
| F25 | desserdirina | categorie nouă | Lipsește câmpul de descriere + nu se pot adăuga poze la secțiuni noi | defect editor | Captură: „Categorie nouă" — titlu și gol dedesubt |
| F26 | desserdirina | tipografie | Nu arată bine centrat | design | — |
| F27 | desserdirina | comandă | Cardul „Comandă acum" legat de meniu: alege produs, cantitate, plasează comanda online | feature | Capturi inspirație: slider invitați → kg → preț estimativ; „Alege un gust" cu felii de tort |

## Teme transversale (apar în ≥2 documente)
- T1: **Elementele adăugate de client sunt „mai sărace" decât cele din preset** — fără preț (F10), fără icon (F10), fără descriere (F16, F25), fără poze (F7, F25), rânduri fixe (F17). Apare în 4/4 documente. Cel mai probabil o singură cauză: schema de „item nou" nu replică toate câmpurile din preset.
- T2: **Galerii cu >3–4 poze se strică** (F6, F8, F9, F24) — 3/4 documente. Nevoie: grilă/carusel care scalează.
- T3: **Rețele sociale** (F13) — text în loc de icon-uri, lipsă configurare.
- T4: **Logo** (F15) — dimensiune neuniformă.
- T5: **Reîncărcare integrală la editare** (F5) — perf.
- T6: **Programare online** (F12, F18, F27) — clientul vrea flux de rezervare/comandă pe salon și cofetărie, nu doar pe professionals.
