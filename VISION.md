# Hidook Site Builder — VISION.md (sursă unică sincronizată)

**Autoritate:** acest fișier este sursa de adevăr pentru Site Builder până când owner-ul îl schimbă explicit. Orice `PRODUCT.md`, `AGENTS.md`, task Kanban, spec vechi sau comentariu care contrazice acest document este depășit.

**Sincronizat:** 2026-09-04. Bază: spec Opus 5 `t_7f6ffed8` / `OWNER-FEEDBACK-2026-08-26-SPEC.md` + deciziile owner ulterioare, inclusiv calendarul Professional nativ Hidook din 2026-09-04 (supersedează Cal.com-link-only 2026-09-01 și override-ul same-day self-hosted cal.diy), poarta comercială pentru export și Details auto-open per design nou din `00-Governance/OWNER-FEEDBACK-2026-09-02.md` și regulile noi de studio anti-buclă din `Desktop/Hermes/00-Governance/AGENCY-COMPANY-CONTRACT.md`.

## 1. Ce este produsul

Hidook Site Builder este un **website builder în browser** pentru clienți mici, care trebuie să poată construi și publica un site fără ajutorul echipei.

Un străin trebuie să poată:

1. deschide builder-ul în browser;
2. alege un șablon real;
3. edita texte, poze, culori, detalii de contact și WhatsApp;
4. vedea preview clar;
5. crea cont / intra în cont;
6. introduce card test în staging;
7. porni trialul de 14 zile;
8. avea site live imediat după card valid;
9. reveni, edita și republica;
10. anula în trial fără taxare;
11. exporta site-ul pentru self-deploy când politica comercială permite;
12. vedea linkuri/pagini legale curate.

**Telegram — ÎNGHEȚAT, în afara scopului produsului (decizie owner, 2026-09-06).** Canalul iese din produs. Codul rămâne în repo, funcțional, dar **niciun fișier Telegram nu se mai atinge** (`bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`) și constatările de audit pe Telegram sunt **amânate, nu rezolvate**. Nu se punctează la evaluarea produsului. Istoric: Telegram era acquisition/intake care deschidea **același draft**, fără checkout separat și fără deploy paralel — comportamentul acela nu s-a schimbat, doar a încetat să mai fie dezvoltat.

## 2. Model comercial curent

Decizia owner ulterioară specului Opus suprascrie lista inițială „one-time 99 USD / 30 dacă deployăm noi”. Modelul curent este:

- **Stripe subscription cu trial de 14 zile.**
- **Card obligatoriu** la începutul trialului.
- Site-ul devine **live/public imediat** după card valid.
- Dacă userul nu anulează, se taxează automat în ziua 14.
- Preț start: **99** în bucket-ul clientului: EUR pentru UE, GBP pentru UK, USD pentru restul lumii.
- Renewal: **29/an** în aceeași monedă, necondiționat.
- **Reactivare (owner decision 2026-10-05):** un site anulat se reactivează din „Site-urile mele” plătind **29** (prețul de reînnoire, cu simbolul monedei), **fără trial nou** și fără 99 — nici dacă fusese anulat în trial, înainte de prima taxare. După plată site-ul se republică imediat din ultima versiune, iar `paidUntil` = max(`paidUntil` curent, acum) + 1 an pentru un site deja taxat, respectiv acum + 1 an pentru unul anulat în trial (netaxat niciodată). Înainte de plată cardul spune prețul și data („Plătești 29€ acum. Site-ul revine online imediat și e plătit până la <dată>.”); după plată mesajul e de reactivare, nu „Trial început”.
- Nu promite hosting permanent dintr-o plată unică.
- Owner creează Stripe live Product/Prices, policy de refund/cancellation și Customer Portal în producție.
- Studio implementează test/staging/env templates/runbook până în punctul unde rămân doar secretele și producția.
- Simularea locală (`HIDOOK_TEST_PAY`, exclusă din producție) simulează colectarea cardului și trialul, nu o taxare de 99: istoricul arată trial început și prima taxare programată peste 14 zile. Anularea înainte de taxare nu creează istoric achitat; reactivarea simulată costă 29 fără trial nou și acordă numai un an de acum. Aceasta nu este dovadă de validare a unui card Stripe real. Un checkout local nu raportează publicare reușită decât după ce site-ul este efectiv live; o eroare păstrează dreptul deja acordat și permite reîncercarea din editor fără checkout nou. Dacă publicarea eșuează după acordarea dreptului, interfața spune „Publicarea nu a reușit” și păstrează explicația sigură în română și pașii de reîncercare fără plată nouă, nu pretinde că plata nu a fost confirmată.

**Confirmare owner 2026-09-27 (audit remediere):** modelul de mai sus rămâne cel curent — landing-ul (`/app/`) și restul funnel-ului (fereastră de publicare, dashboard, facturi) trebuie să arate explicit reînnoirea de **29/an**, nu „o singură plată”/„fără abonament”, și trebuie să afișeze simbolul de monedă (€/£/$) lângă preț, nu doar cifra goală. Corecția de cod (landing + `builder/app.js`) e task separat (`R-01`/`R-16`, `PLAN-AUDIT-2026-09-27.md`); acest fișier nu s-a schimbat de model, doar confirmă ce era deja scris mai sus.

## 3. Șabloane și design

**Editorul pe blocuri (decizie owner, 2026-10-28).** Site-urile noi se fac în editorul pe blocuri (`builder/blocks/`, servit la `/app/blocks/`), nu în editorul pe formulare. Clientul alege din catalog unul din 13 designuri — „De la zero” plus 12 domenii (Restaurant, Salon de frumusețe, Meserii, Servicii profesionale, Cofetărie, Cafenea și brunch, Coafură și machiaj de mireasă, Renovări interioare, Catering și evenimente, Cosmetică și estetică, Consultanță și coaching, Contabilitate) — fiecare cu pagini, texte, poze, culori și fonturi proprii. În editor scrie direct pe pagină (bold, italic, linkuri), adaugă/mută/duplică/șterge blocuri (16 tipuri, cu variante), are mai multe pagini cu antet și subsol comune, temă (culori, fonturi, colțuri), vedere calculator/telefon, previzualizare și undo/redo. Site-ul se salvează în browser și, după autentificare, în cont (`templateId: "blocks"`); publicarea folosește aceleași rute ca înainte (link pe email → adresă → trial Stripe → live), iar fiecare pagină devine un fișier HTML pe site-ul publicat, cu paginile legale, bannerul de cookie și mențiunea hidook. Formularul de contact trimite în „Mesaje” (`/api/site-messages`). Blocul Instagram se conectează prin Instafidget din panoul blocului (aceleași rute `social-feed/*`, același acord de termeni, editorul Instafidget în tab nou); pe site-ul publicat apare doar feed-ul conectat, altfel blocul lipsește cu totul (politica S111). La un design nou, editorul cere o dată, opțional, numele afacerii, telefonul și orașul (numele vine precompletat dacă a fost scris pe landing) și le pune peste datele de exemplu din tot site-ul. Înainte de publicare, fereastra „Publică” arată ce a rămas de exemplu (nume, telefon, e-mail, poze de completat, Instagram neconectat), fără să blocheze publicarea; e-mailurile de exemplu nu ajung niciodată pe site-ul publicat (regula H-01). Editorul pe formulare a fost scos din builder pe 2026-10-28 (decizie owner: site-urile făcute cu el sunt toate de test). Cele 5 șabloane de mai jos rămân doar pe server: `build.js` le randează și publică pentru site-urile deja existente, iar pozele lor sunt folosite de designurile pe blocuri. Un astfel de site apare în „Site-urile mele” cu plată, domeniu, facturi și ștergere, dar fără „Editează”.

**Compozițiile de pornire — candidat local 2026-11-05 (Flow 2, fără acceptare estetică de lansare):** primele cinci designuri din `packs.js` au ierarhii diferite, nu doar palete diferite. Restaurant deschide cu atmosfera de seară și rezervarea, iar pagina Meniu are o singură selecție cu fotografii asociate preparatelor. Salon pune un rezultat reprezentativ și două idei de culoare înaintea prețurilor; nu mai afișează recenzii sau o echipă fictivă. Meserii pune problema/telefonul/zona și două exemple ilustrative de lucrări înaintea informațiilor practice. Servicii profesionale pornește text-first cu specializarea, locul pentru identitatea reală a expertului și procesul consultației; fără portrete beauty sau calificări inventate. Cofetărie folosește numai cadre individuale existente, un detaliu de foietaj și pași numerotați fără fotografii; tarta apare o singură dată, în selecția de produse. Datele comerciale ale afacerilor, imaginile și programul sunt exemple de înlocuit, nu istoric, proiecte sau mărturii reale. Cele 17 pagini și configurațiile/blocurile de programări Salon/Professional rămân păstrate. Proba acestei etape este numai preview din catalog/editor la 1440/390; nu demonstrează publicare, repararea F07/F15 sau un calendar tranzacțional. API-ul rendererului, mențiunea hidook și modelul comercial nu se schimbă. Review-ul estetic independent rămâne obligatoriu.

**Continuarea compozițiilor — candidat local 2026-11-05, Flow 2:** cele șapte designuri din `packs-more.js` păstrează 23 de pagini, dar au structuri proprii: Cafenea pune locul și programul înaintea unei selecții scurte cafea/brunch, cu meniul complet separat; Mireasă grupează trei look-uri ilustrative cu detalii decupate din același cadru și parcurs Probă → Ziua nunții → Verifică data; Renovări separă două exemple de spațiu, fiecare cu fotografie dominantă, detalii și context fără suprafețe/durate/înainte-după inventate. Catering separă ocazia și atmosfera, detaliul alimentar, logistica și meniurile. Cosmetică distinge tratamentul, durata și consultația fără eficacitate medicală promisă; Consultanță este text-first, cu problemă concretă, metodă și identitate reală de completat; Contabilitate compară SRL/PFA prin aceleași repere și lista documentelor necesare, fără grafice sau echipă fictivă. Datele, condițiile și fotografiile sunt explicit exemple. Programările Cosmetică/Consultanță și pozițiile lor rămân neschimbate; Cafenea păstrează slotul neutru Instafidget, ascuns public când nu este conectat. Blank nu primește conținut nou.

**F10 și metadate de acțiune în același candidat:** Cafenea folosește consecvent deschidere Luni–Vineri 08:00–22:00 / weekend 09:00–23:00 și brunch Luni–Vineri 08:00–15:00 / weekend 09:00–15:00, ca program de exemplu editabil. Toate cele 13 designuri declară intenții `pack.actions` pentru CTA, fără deducție din text; rendererul separat le rezolvă spre pagini/blocuri reale și păstrează destinațiile personalizate. Patru etichete Cofetărie devin „Trimite o cerere”, spre formular, nu promit WhatsApp. Tuplurile opționale `[tip, variantă, {data, actions}]` permit date distincte per bloc repetat (overlay la primul nivel, listele se înlocuiesc); rendererul rămâne proprietate separată, fără schimbare de schemă salvată. Dovezile acestei etape sunt preview din catalog/editor, inclusiv rendererul comun citit separat pentru tupluri, nu publicare/calendar tranzacțional sau acceptare de lansare. Derivatele foto provin numai din activele existente; dosarul original al drepturilor comerciale rămâne o limită de lansare. Modelul comercial și atribuirea hidook nu se schimbă.

**Activele și formularul candidatului (reparație locală 2026-11-06):** decupajele de detaliu pentru blocuri sunt în `templates/blocks/images/`, cu miniaturi proprii și referințe `@tpl/blocks/images/`; nu sunt un al șaselea șablon în registry. Build-ul copiază separat acest spațiu în activele browserului; publicarea și ZIP-ul folosesc aceleași fotografii locale. Originalele celor cinci șabloane vechi rămân neschimbate, iar mutarea derivatelor păstrează octeții și proveniența. Toate cele 13 designuri au eticheta de pornire „Telefon” pentru formular (inclusiv Contabilitate), conform câmpului validat pentru telefon, fără migrarea etichetelor scrise de proprietar. Drepturile foto și integrarea rendererului separat rămân porți distincte.

**Localitatea în editorul pe blocuri (2026-11-05):** pasul inițial înlocuiește localitățile și zona de exemplu (inclusiv București și Ilfov) numai în câmpurile încă identice cu datele de pornire ale blocului. Formele flexionate sunt reformulate neutru („din zona Chișinău”, „în afara localității Iași”), fără a lipi sufixe de numele introdus. Textele rescrise de proprietar și URL-urile proprii nu sunt înlocuite după cuvinte. Strada de exemplu rămâne de completat și este semnalată explicit înainte de publicare, inclusiv după schimbarea orașului. Datele de contact nu sunt inventate; regula H-01 rămâne neschimbată.

**Ciornă, autentificare și recuperare în editorul pe blocuri (2026-11-06):** un design nou se salvează în browser inclusiv dacă datele inițiale sunt sărite sau formularul este gol; „salvat” apare numai după o scriere reușită. Salvarea ciornei în browser / cont nu publică modificările; fereastra Publică explică diferența. Erorile de stocare și de rețea apar în română, nu în verde, cu „Reîncearcă salvarea”; revenirea online reîncearcă sincronizarea, păstrând editările locale neprimite de cont. Ciornele de cont se afișează și se sincronizează numai după verificarea contului și a accesului la site, nu se transferă automat între conturi. La redeschidere, o ciornă locală nesincronizată se trimite automat numai dacă versiunea verificată din cont este încă baza ei confirmată; dacă este deja identică, nu se retrimite. Dacă versiunile diferă și baza nu mai corespunde (sau lipsește dintr-o ciornă veche), editorul păstrează ambele copii și cere alegerea explicită între versiunea din cont și recuperarea ciornei locale cu înlocuirea contului. Alegerea reverifică accesul și contul; o schimbare între timp cere confirmare din nou. O eroare la scrierea confirmării locale nu autorizează retrimiterea unei copii vechi peste salvarea mai nouă din cont. Din browser, baza este identificatorul imuabil al salvării din cont, nu doar conținutul ei: inclusiv o resalvare identică în alt tab cere reverificare. Serverul acceptă o salvare pentru un site existent numai dacă identificatorul de bază încă se potrivește, verificat atomic cu scrierea. Un răspuns pierdut sau incomplet oprește retrimiterile automate; editorul verifică din nou contul și păstrează editările neconfirmate pentru alegere explicită când diferă. Copiile locale sunt păstrate separat pentru fiecare cont/site, fără a fi afișate înainte de verificarea accesului. La redeschidere se citesc atât copia activă, cât și copia cont/site, chiar dacă ambele numesc același site; o eroare la una dintre scrieri nu anulează cealaltă copie reușită. Dacă există mai multe ciorne nesincronizate diferite, care nu pot fi ordonate sigur, editorul păstrează fiecare copie și cere alegerea explicită, fără a folosi ora browserului ca autoritate. Alegerea nu șterge celelalte copii: ele pot fi redeschise din „Ciorne păstrate” (în Instrumente pe telefon), cu reverificarea accesului și aceeași salvare condiționată de versiunea contului. Dacă arhivarea unei ciorne anterioare eșuează, copia activă care o păstrează nu este înlocuită. Publicarea nu ocolește o alegere nerezolvată. Autentificarea cu link local de dezvoltare spune explicit că este simulare și că nu s-a trimis email. Dialogul Design păstrează focusul, se închide cu Escape și îl întoarce la buton; înlocuirea cere confirmare explicită, separată de păstrarea site-ului actual. O imagine coruptă / imposibil de citit afișează eroare și permite alegerea altui fișier sau a unei poze din bibliotecă.

**Acces la editor de pe telefon (2026-11-05):** la lățimi sub 768px, editorul pe blocuri păstrează „Previzualizare” și „Publică” la vedere. „Instrumente” deschide designul, undo/redo și vederea calculator/telefon; „Pagini”, „Adaugă” și „Temă” deschid panouri care se pot restrânge cu aceeași filă sau cu „Înapoi la pagină”. Selectarea unui bloc închide panoul lateral și deschide setările într-o foaie deasupra paginii, cu închidere la vedere. Pagina folosește implicit vederea de telefon, fără să împartă lățimea ecranului cu bara laterală de desktop. Biblioteca foto păstrează miniaturi 4:3 și derulare proprie inclusiv în ferestre joase; nu micșorează toate imaginile ca să încapă simultan.

**Pornire cu adevărat goală și refuzul reprogramării (corecție locală de contract, 2026-11-06):** un site nou „De la zero” are exact o pagină „Acasă”, fără blocuri în corp (`blocks: []`). Antetul și subsolul comune rămân editabile, iar mențiunea hidook rămâne non-editabilă. Textele și imaginile neutre apar numai în blocurile adăugate explicit din „Adaugă”; ghidul opțional nu inserează nimic. Ciornele deja salvate, inclusiv cele cu hero/text de pornire, nu sunt migrate sau golite. La o reprogramare refuzată, mesajul exact al serverului rămâne vizibil după operațiile asincrone, lângă ultima stare cunoscută și îndrumarea de reîncărcare/contact. Un refuz de politică nu oferă alte intervale ca soluție; numai erorile de disponibilitate reîncarcă intervalele, fără să șteargă refuzul. Reîncărcarea verifică autoritatea serverului după o eroare de rețea; fereastra de anulare/reprogramare și verificările linkului nu se schimbă.

**Recunoaștere în editorul pe blocuri (2026-11-06):** catalogul Design arată toate cele 13 designuri prin același renderer și miniaturile foto generate folosite pe landing, marchează textual designul curent și oferă „Previzualizează” la dimensiune mare înainte de alegere. Înlocuirea cere în continuare confirmarea pierderii conținutului curent, explică diferența față de site-ul public și permite Anulează înainte de reload. Biblioteca și panoul Adaugă separă „Previzualizează” de „Inserează”; exemplul folosește tema curentă, iar simpla previzualizare nu inserează nimic. Inspectorul are Conținut (implicit), Aspect și Avansat, cu identitatea blocului selectat la vedere și acțiunile Duplică/Șterge separate de proprietăți. Ultimul grup folosit este o preferință a interfeței în browser, păstrată între selecții și reload, nu conținut al site-ului. „De la zero” oferă în Pagini un checklist opțional și trei idei de ordine a blocurilor, care pot fi ascunse și redeschise; bifarea sau ascunderea ghidului nu schimbă ciorna și nu adaugă blocuri automat.

**Lizibilitate pe ecrane înguste (reparație locală 2026-11-06):** identitatea blocului selectat și acțiunile lui ocupă rânduri separate în editor, inclusiv când numele se întinde pe mai multe rânduri sau pagina este scalată; niciuna nu o acoperă pe cealaltă. Toate acțiunile rămân disponibile, fără spațiere adăugată conținutului publicat; foaia de setări de pe telefon își rezervă locul în editor, astfel încât pagina să se poată derula până la controalele blocurilor de jos. Titlul „Site-urile mele” se afișează integral, fără puncte de suspensie; pe telefon, „Site nou” trece pe rând separat când este necesar.

**Recuperare integrată locală (2026-11-06):** fereastra Publică ține adresa și acțiunea principală dezactivate, cu mesaj de încărcare, până verifică și salvează ciorna, citește site-ul și contul și încarcă prețul din configurația comercială existentă. Răspunsurile unei ferestre închise, redeschise sau ale altui site nu rescriu adresa curentă și nu pornesc publicarea. O ciornă neplătită permite alegerea adresei după încărcare; un site live își păstrează adresa. Dialogul spune explicit card obligatoriu, publicare imediată, prima taxare 99 în ziua 14 și 29/an în moneda configurată; anularea distinge trialul netaxat de condițiile existente ale unui site plătit și folosește numele curent de pe card. Landing-ul califică exportul prin dreptul activ/trial/paid neexpirat și explică conectarea Instafidget și trecerea la Free cu filigran. Bara blocului selectat se încadrează pe rânduri în canvas inclusiv la 320px cu scalare, fără eliminarea acțiunilor. Textele de pornire pentru Programări sunt neutre („Vezi serviciile și programul de mai jos.”), valabile și în ZIP: calendarul live și îndrumarea statică la telefon rămân distincte, iar textele deja salvate de proprietar nu sunt rescrise. Notele de configurare nu presupun un panou în dreapta. Exemplele comerciale/foto rămân declarate ca exemple, fără justificări despre implementarea designului. Textele de pornire Mireasă, Renovări (inclusiv ambele descrieri de spațiu și FAQ despre cost/garanție) și Cosmetică descriu exemplul sau informațiile reale de completat, nu fabricarea designului. Gestionarea programărilor vorbește neutru despre echipă și regulile de programare, inclusiv când nu sunt intervale libere; nu numește orice afacere cabinet. Sunt numai corecții de formulare implicită: textele deja salvate de proprietar nu sunt rescrise, iar refuzul, reîncărcarea, tokenurile și politica de 24h rămân neschimbate. Drepturile foto (171 nerezolvate) și datele juridice finale rămân porți de producție; această recuperare nu este acceptare de lansare.

Scope-ul șabloanelor pe formulare (editorul vechi):

1. Product / menu businesses.
2. Local service / lead-gen.
3. Portfolio / beauty / events.
4. Professional services.
5. **Desserdirina remake** — fostul sample de brutărie/DESSERD din repo trebuie refăcut ca șablon aprobat, la același nivel de calitate ca celelalte. Nu este un vertical nou inventat.

Reguli:

- Produsul este în **limba română** pe suprafețele vizibile pentru client/site, cu diacritice corecte.
- Orice șablon nou real cere research-first. Desserdirina remake pornește din sample-ul existent, dar trebuie adus la calitate comercială.
- Fără AI slop: gradienturi generice, iconițe stock, chips haotice, layout evident de template.
- Fiecare șablon trebuie să conțină mențiunea non-editabilă: **`Build by hidook.tech powered by hidook.agency`**.
- Mențiunea nu se pune în `footer.note` editabil; trebuie să rămână după editări și republish.
- **Integritatea site-urilor pe blocuri (2026-11-05, implementare locală):** antetul păstrează toate linkurile de pagină vizibile și pe telefon, pe rânduri dacă nu încap (țintă minimă de 44px, focus de tastatură și pagina curentă marcate), inclusiv fără JavaScript în ZIP. Formularul public cere un telefon cu 7–15 cifre, cu `+` inițial opțional și separatori uzuali (spații, paranteze, puncte, cratime); valorile evident greșite primesc îndrumare în română și focus pe câmp înainte de trimitere sau fallback pe email. Validarea în browser nu înlocuiește validarea independentă din API, care trebuie să păstreze și contactele email ale formularelor vechi. Un loc foto necompletat arată „Imagine neadăugată”, fără URL de imagine gol; o fotografie de galerie care nu se încarcă arată „Imagine indisponibilă” când JavaScript este activ, fără a pierde referința din configurație sau a elimina pozele valide ale clientului. Lista de verificare din Publică îndrumă înlocuirea pozelor necompletate și verificarea fișierelor relative din galerie; rendererul din browser nu poate stabili dacă un asemenea fișier există.

- **Acțiuni și culori pe blocuri (2026-11-05, implementare locală):** scopul unui buton de pornire este declarat explicit în design (`pack.actions`, apoi `block.el[path].action`: meniu, programare, contact, telefon, despre sau galerie), nu dedus din numele afacerii ori din eticheta tradusă. Rendererul comun găsește pagina și secțiunea existente, folosind slugul și ID-ul reale; linkul personalizat al proprietarului are prioritate. Un telefon de exemplu nu generează un apel: se folosește formularul/contactul disponibil sau se afișează îndrumarea de configurare. O ciornă veche fără scop declarat ori o destinație eliminată arată explicit „Configurează destinația acestui buton în editor”, nu o ancoră goală funcțională în aparență; nu există migrare bazată pe etichete. Tema aleasă își păstrează suprafața de accent (inclusiv galbenul Meserii), cu text-pe-accent și accent-pentru-text derivate separat pentru fundalul solid al blocului și cardurile de programare. Pragul urmărit este 4,5:1 pentru textul de accent și etichetele de buton în stările solide normal/hover/focus, nu o certificare a textului peste fotografii sau a oricărei combinații personalizate de opacitate.

Avertizarea de destinație se aplică acțiunilor de navigare, nu etichetei „Trimite” din previzualizarea formularului: aceasta rămâne editabilă, dar inactivă; formularul publicat își păstrează butonul real de trimitere. Pe fundalul de accent, textele obișnuite nu sunt estompate prin opacitate moștenită, iar varianta încadrată păstrează aceeași suprafață de culoare, cu un contur în locul unei tente care ar micșora contrastul.

Mențiunea hidook din subsol și notele ajutătoare ale blocurilor Programări/Instagram păstrează minimum 4,5:1 pe suprafețele solide ale paletelor oferite, inclusiv cardurile deschise de programare; opacitatea lor implicită este 0,75 (1 pe blocurile cu fundal de accent). Mențiunea rămâne exactă și non-editabilă. Zilele indisponibile, dezactivate în previzualizarea calendarului, nu intră în acest prag de text activ; fotografiile, gradienturile și opacitățile personalizate nu sunt certificate prin măsurători de fundal solid.

## 4. Builder — cerințe obligatorii din specul Opus

> **Istoric (2026-10-28):** secțiunile 4.1–4.6 descriu editorul pe formulare, scos din builder pe 2026-10-28. Nu mai sunt cerințe curente; editorul pe blocuri e descris în §3.

### 4.1 Prima încărcare a șabloanelor

Defect verificat de Opus: `builder/generated/templates-data.js` era ~32 MB și bloca prima încărcare. Refresh-ul părea să repare doar din cache.

Done înseamnă:

- primul load arată cardurile de template în ≤ 3 secunde pe throttling realist;
- fără refresh manual;
- bundle split: registry ușor pentru grid, payload greu doar la Start/Preview;
- imagini template cacheabile ca fișiere reale, nu base64 uriaș în JS;
- `Cache-Control`, `ETag` / `Last-Modified`, 304 pe warm load;
- fără `readFileSync` de 32 MB per request.

### 4.2 Culori și background

Defect verificat de Opus: color picker-ul scria config, dar CSS-ul nu consuma variabilele; pe `professionals` tema nu schimba nimic vizibil.

Done înseamnă:

- `theme.primary`, `theme.cream` și variabilele echivalente sunt consumate real în toate șabloanele;
- hero background și secțiunile simple au controale reale de culoare/imagine, nu input de CSS brut;
- preview-ul și live site-ul arată aceeași schimbare;
- QA verifică pixelii, nu doar config-ul.

### 4.3 Details automat

Done înseamnă:

- Details drawer din builder se deschide automat la fiecare design nou selectat din catalog, inclusiv după ce a fost închis pe alt design;
- userul îl poate închide manual pentru designul curent;
- închiderea se ține la reload pentru designul curent, dar nu suprimă deschiderea la următoarea selecție de design;
- `<details>` relevante din șabloane care ascund conținut important sunt deschise by default unde are sens.

**Wizard de onboarding (implementat — PLAN-UX-2026-09-27 §5.1):** un vizitator la prima alegere de design vede întâi un wizard scurt, skippabil (`Sari peste`), de 2 pași — tipul afacerii (mapat la unul din cele 5 șabloane, cu ajustare liberă) și nume/telefon-WhatsApp/localitate opționale — după care editorul se deschide direct pe șablonul recomandat, deja completat prin `applyQuickstart()`; regula Details automat de mai sus rămâne neschimbată pentru orice selecție ulterioară de design, iar bara de quickstart rămâne disponibilă normal când wizard-ul e sărit sau nu completează nimic. Nu se mai arată după prima finalizare/skip (`localStorage`).

**Excepție (PLAN-UX-2026-09-27 §5.1, restul):** doar pentru designul cu care wizard-ul a fost chiar finalizat (nu sărit), Details nu se mai deschide automat — wizard-ul tocmai a colectat aceleași date — ci apare un indiciu necopleșitor în editor cu un buton care îl deschide la cerere; orice selecție ulterioară de design (și wizard-ul sărit) auto-deschide Details exact ca înainte.

**Date de contact niciodată inventate (VERIFICARE-2026-10-04 H-01):** numele afacerii nu mai generează linkuri Instagram/Facebook sau e-mail derivate din el; câmpurile sociale/e-mail rămase la valoarea demo a șablonului sunt golite (șabloanele ascund linkul gol) când wizard-ul/quickstart-ul aplică nume, telefon sau localitate și sunt scoase din orice publicare cât timp mai sunt identice cu presetul șablonului, chiar dacă numele nu a fost editat niciodată; iar checklist-ul de publicare le numește („Linkuri sociale de exemplu”, „E-mail de exemplu”, „Adresă de exemplu”) cât timp mai sunt demo. Telefonul din wizard/quickstart este validat (07xx xxx xxx, +40… sau orice număr internațional cu + / 00; mesaj inline în română la valori evident greșite) și normalizat pentru wa.me; localitatea introdusă actualizează titlul, eticheta din hero, partea de oraș din adrese, linkul Google Maps al adresei și adresa din „Unde ne găsești”. Doar orașul urmează localitatea: strada și codul poștal din adresa demo rămân cele ale șablonului (adresă hibridă) și sunt semnalate de checklist ca „Adresă de exemplu” până când proprietarul scrie adresa reală.

### 4.4 WhatsApp

Done înseamnă:

- badge-ul plutitor WhatsApp folosește icon/glyph recognoscibil, culoare WhatsApp, nu textul `WA`;
- userul introduce număr + mesaj normal în română;
- builder-ul generează `wa.me/<number>?text=<encoded>`;
- mesajul păstrează diacriticele;
- dacă nu există număr, badge-ul nu apare rupt;
- la deschiderea controlului WhatsApp, QR-ul este centrat orizontal și vertical în container; panoul din jur este chrome de produs, nu o cutie goală; mecanismul deep-link/QR rămâne neschimbat;
- nu se modifică flow-ul Telegram pentru asta; logica se portează în browser/shared.

### 4.5 Preview

Există preview-uri parțiale, dar produsul trebuie să aibă o posibilitate clară de preview pentru client.

Done minim:

- preview vizibil înainte de card/trial;
- desktop/mobile toggle funcțional;
- preview-ul reflectă text, imagini, culori, WhatsApp și legal footer;
- dacă se introduce preview shareable public, trebuie să fie tokenizat/noindex/expirabil și să nu fie confundat cu site live final;
- la ≤640px cu pointer tactil, atingerea unui text editabil din canvas deschide o foaie (bottom sheet) cu textarea, nu focalizează direct câmpul din iframe (PLAN-UX §5.4);
- la aceeași lățime/pointer, bara de unelte a editorului se restrânge la acțiunile primare (Publică, Detalii, Poze, Previzualizare) plus un meniu „Mai mult" pentru restul (Instagram, Culoare, descărcări) — desktop/tabletă/mouse păstrează toate butoanele cât timp încap; când bara nu are loc (fereastră îngustă, zoom 200%, split-screen) pierd întâi eticheta, apoi trec în „Mai mult" în ordinea priorității (Descărcări, Instagram, Adaugă o secțiune, Culoare, Poze, Detalii), măsurat live, fără suprapuneri (PLAN-UX §5.4, V-1).

### 4.6 Builder slab — standard minim

Constructorul nu trebuie să fie o formă subțire. Defectele identificate de Opus devin backlog structural:

- adăugare liberă de secțiuni: reordonarea și ascunderea există (Wave 7), toate cele 5 șabloane au o bibliotecă fixă de secțiuni opționale (vezi actualizarea 2026-09-28 de mai jos), iar catalogul „Adaugă o secțiune” există acum de capăt la capăt (T-1A/T-1B/T-1C, PLAN-UX §5.2): `schema.json` marchează orice secțiune opțională cu `addable: true` + `description` + `seed`, secțiunea rămâne ascunsă (pe pagina publicată, nu doar în editor) până e adăugată explicit din catalogul din builder, iar adăugarea aplică seed-ul doar pe câmpurile încă goale și înregistrează un pas de undo. Toate cele 5 șabloane declară blocuri addable — FAQ, Program și Unde ne găsești pe `product-menu`/`local-service`/`desserdirina`, FAQ și Unde ne găsești pe `portfolio`, Program și Unde ne găsești pe `professionals` (FAQ rămâne mereu activ pe `professionals`, nu addable); din 2026-10-05 (W-6) și „Recenzii” (toate 5) și „Echipă” (`professionals`) sunt addable, cu seed — nu mai apar ca rânduri active în „Secțiuni pagină” cât timp nu sunt adăugate. Textul de pornire al oricărei secțiuni adăugate (răspunsuri FAQ, ore, recenzii, membri) se numără ca „text de exemplu” (tentă chihlimbar în editor + rândul din lista de verificare la publicare) până îl rescrie clientul; adresa din „Unde ne găsești” pornește din `contact.address` (`seedFrom` în schema);
- undo/redo există (toolbar și Ctrl/Cmd+Z) și rezistă unui reload, unei închideri accidentale de tab și unei închideri complete a browser-ului — stocat în IndexedDB (fallback localStorage dacă IndexedDB nu e disponibil), salvat per site și per cont, cu expirare după o săptămână și șters la deconectare/deconectare-de-pe-toate-dispozitivele/ștergere cont/ștergere site (T-2, PLAN-UX-2026-09-27 §5.3);
- fără multi-page real;
- fără typography controls;
- edit mapping fragil prin regex;
- imagini base64 în config;
- SEO insuficient expus;
- form builder limitat — cele trei șabloane de mai sus au acum un formular fix (nume, telefon/email, mesaj) către `/api/site-messages`, nu un constructor de formulare.

Nu se rezolvă toate într-un singur task. Se lucrează pe flow-uri verticale verificate în browser.

**Actualizare 2026-09-28 (PLAN-UX §5.2):** toate cele 5 șabloane au o secțiune opțională „Recenzii” (2-6 testimoniale), iar `professionals` are și o secțiune opțională „Echipa”. Sunt predefinite per șablon, se editează ca liste în builder și se ascund automat când nu au conținut; din 2026-10-05 (W-6) se activează din catalogul „Adaugă o secțiune” (cu text de pornire marcat ca exemplu), nu mai apar ca rânduri active înainte să fie adăugate. Șabloanele fără formular general au primit un formular de contact. Pe site-ul publicat, mesajele ajung prin `POST /api/site-messages`, cu limită de rată și honeypot, în „Mesaje” pe cardul site-ului din dashboard, cu email către proprietar, și sunt incluse în exportul GDPR. În exportul static, formularul trimite pe WhatsApp sau pe email. La `professionals`, formularul de programare rămâne separat.

**Contact utilizabil (2026-11-06):** API-ul formularului verifică independent datele de răspuns înainte de stocare sau notificarea proprietarului: refuză contactul gol, „abc”, telefoanele evident malformate și emailurile invalide, cu eroare sigură în română. Contractul formularelor vechi păstrează alegerea email sau telefon; formularul nou pe blocuri cere telefon. Numerele românești locale rămân locale, fără separatori; numerele internaționale cu `+` / `00` (sau cod de țară fără prefix) se păstrează în format `+` și cifre, fără a pretinde verificarea titularului. Honeypot-ul, limitele de rată și accesul proprietarului la „Mesaje” rămân neschimbate.

**Actualizare 2026-09-28 (T-1B/T-1C, PLAN-UX §5.2 — bibliotecă de secțiuni addable):** toate cele 5 șabloane au primit blocuri opționale noi, fiecare în designul propriu al șablonului: „Întrebări frecvente” (listă `<details>`/`<summary>`, deschise by default — regula §4.3 — addable pe `product-menu`/`local-service`/`desserdirina`/`portfolio`; rămâne mereu activ, nu addable, pe `professionals`), „Program” (listă zi + interval orar, addable pe `product-menu`/`local-service`/`desserdirina`/`professionals`; rămâne mereu activ, nu addable, pe `portfolio`) și „Unde ne găsești” (adresă + buton „Deschide în Google Maps”, link construit client-side din adresă cu `encodeURIComponent`, fără iframe și fără script extern, addable pe toate cele 5). Sunt declarate în `schema.json` cu mecanismul `pageSections` existent, plus câmpurile de contract `addable`, `description` (o propoziție în română) și `seed` (un patch de config cu conținut realist de pornire); rămân ascunse până se aplică seed-ul, la fel ca „Recenzii” mai sus. Butonul „Adaugă o secțiune” din builder (T-1A) aplică seed-ul din catalog pe câmpurile goale ale clientului — șablon și builder sunt acum livrate împreună, clientul poate activa singur aceste blocuri din interfață.

## 5. Legal

Privacy / Cookies / Terms lipsesc ca produs complet.

Studio trebuie să construiască:

- pagină Privacy Policy generată;
- pagină Terms & Conditions generată;
- cookie banner / consent;
- footer links în fiecare șablon;
- includerea acestor pagini în export;
- placeholder-uri clare pentru datele legale.

Owner trebuie să furnizeze înainte de producție:

- nume legal companie / entitate;
- VAT/CUI/adresă;
- cine este controller/procesator;
- subprocessors: Stripe, Cloudflare, Resend, Instafidget, calendar etc.;
- retenție date;
- jurisdicție și text legal final.

Nu se livrează la clienți plătitori cu text legal inventat.

**Limitare explicită în dezvoltare (F11, 2026-11-06):** lista existentă din Publică arată permanent că paginile juridice sunt incomplete și necesită datele și aprobarea proprietarului înainte de utilizarea comercială. Toate cele trei pagini generate, inclusiv în ZIP, se identifică drept ciorne incomplete, nepregătite pentru utilizare comercială; enumeră identitatea legală/CUI/sediul, operatorul/procesatorii, retenția, subprocesorii, jurisdicția și textul final încă necesare. Numele afișat al afacerii nu confirmă identitatea legală. Placeholder-urile rămân vizibile, fără valori inventate sau pretenție de conformitate. Avertizarea nu blochează validarea locală izolată și nu modifică drepturile existente de publicare, trial sau export; nu există editor/API juridic nou. F11 este o limitare de dezvoltare cu poartă de producție la proprietar, nu livrare de conținut juridic final.

**Autoservire GDPR (owner decision 2026-09-27, implementată — R-27):** clientul autentificat găsește, din meniul de cont — din header-ul lui `#dashboard`/`#templates` — două acțiuni: **„Descarcă datele mele”** (`GET /api/me/export-data`, JSON cu profilul, toate site-urile proprii + istoricul de versiuni, comenzi/facturi, servicii și programări din calendarul nativ, niciodată datele altui client) și **„Șterge contul”** (`POST /api/me/delete-account`, confirmare explicită prin scrierea exactă a adresei de email într-un modal propriu, nu `window.confirm`). Ștergerea anulează orice abonament Stripe activ, oprește din publicare și șterge fișierele publicate ale tuturor site-urilor proprii, șterge datele calendarului nativ, ciornele/versiunile, sesiunile și link-urile de autentificare, apoi contul însuși — ireversibil. Ambele rute cer sesiune validă, sunt limitate ca rată și verifică originea cererii. Rămâne condiționat de textul legal final de mai sus (nume companie/CUI/subprocessors/jurisdicție) doar pentru paginile Privacy/Terms — nu blochează autoservirea GDPR în sine.

## 6. Export / self-deploy

Done înseamnă:

- userul poate descărca ZIP cu site static complet, din „Site-urile mele” (butonul „Descarcă ZIP” de pe cardul unui site live plătit, `GET /api/export-zip?siteId=`);
- ZIP-ul conține HTML/CSS/JS/images/legal pages/badge;
- poate fi servit de pe orice static host fără runtime Hidook;
- site-ul exportat nu face request-uri către domenii Hidook pentru a funcționa;
- exportul HTML/ZIP folosește aceeași listă explicită de drepturi ca publicarea live: numai abonament Stripe `active`, trial `trialing` sau un drept paid legacy încă valabil; `past_due`, anularea și un `paidUntil` expirat blochează exportul chiar dacă istoricul păstrează `paid=true`;
- un draft unpaid, `past_due`, anulat sau expirat primește eroare/upsell clar în română și niciun fișier;
- exportul este verificat prin unzip + static server + browser real.

## 7. Instafidget

Instafidget este produs partener conectat din Site Builder ca bonus comercial: clientul primește conectare/widget Instafidget gratuit 12 luni cu site-ul, apoi trece pe Instafidget Free cu watermark dacă nu face upgrade în Instafidget.

Reguli:

- poziția slotului o alege studio/design după ce vede pagina;
- copy-ul spune clar: **Instafidget inclus gratuit 12 luni, apoi Instafidget Free cu watermark**;
- clientul se conectează la Instafidget și își alege widget/feed acolo;
- editorul Instafidget se deschide în **tab nou în același browser**, nu popup/fereastră separată;
- dacă Instafidget nu e conectat, secțiunea publică se ascunde complet;
- nu se arată iframe mort, feed gol sau promisiune falsă.

## 8. Calendar Professional

**Override owner 2026-09-04 — NATIVE HIDOOK (LOCKED).** Supersedează atât decizia Cal.com-link-only din 2026-09-01, cât și override-ul earlier same-day (2026-09-04) pentru self-hosted cal.diy / Cal.com Platform. Calendarul Professional final este un **modul nativ Hidook construit în interiorul Site Builder** — **nu** cal.diy, **nu** Cal.com Platform, **nu** embed/integrare către un calendar third-party self-hosted.

Stare: **BUILT ca opt-in per-site (2026-09-05) — nu default global. Step (e) cod + repair REJECT t_e22548f9: E2E pe `/live/<slug>/` professionals opted-in (nu preview widget), CTA post-submit fără „Se trimite…” stale (CSS `.hnb__layout[hidden]` force-hide), outbox email + owner dashboard UI act + manage-link + double-book pe UI real (status `reschedule_needed` / „Cerere înregistrată”, niciodată confirmed) + legacy form submit in-browser pe site non-opted-in (`/api/appointments` requested) — dovezi `04-QA-Evidence/Calendar-Cutover/`, `nativeApiBase` din env + CORS pe API public. Independent QA/advocate pe acest SHA încă necesar înainte de a marca step 5 „QA/advocate complete”.** Pașii (a)+(b)+(c)+(d)+(e) sunt pe linia calendar nativ: model SQLite tenant-keyed + booking engine + oracle de izolare; widget public de booking; dashboard owner + editor availability; email (boundary provider + transport local/memory pentru teste, `CALENDAR_EMAIL_TRANSPORT=resend` cu `RESEND_API_KEY` armează livrare reală în producție — reutilizează integrarea Resend din `bot/email.js`; neconfigurat în producție se loghează clar, niciodată silențios; ecranul de succes al widget-ului afișează și linkul de gestionare, ca fallback; outbox queued/sent/failed/suppressed/dead_letter, retry backoff, copy RO onest, token manage); **cutover staged (e)** prin flag-ul de config `appointment.nativeBooking` (`da` / `nu`, reversibil, non-destructiv). Default pe site-urile Professional rămâne formularul local de cerere — **linkul Cal.com opțional din Detalii a fost eliminat din produs pe 2026-09-12** (decizie owner explicită, vezi corecția de mai jos, secțiunea „Commercial E2E + calendar/LP readiness"); un site vechi salvat cu valoarea completată nu crapă la republicare, valoarea rămâne pur și simplu orfană în config. Opt-in la publicare injectează tenant ids (`nativeCustomerId` / `nativeSiteId` din site.userId + site.id), seed-uiește servicii/weekly din config appointment, montează widget-ul nativ pe `#appointment`, și setează `nativeApiBase` din `CALENDAR_PUBLIC_BASE_URL` / `PUBLIC_BASE_URL` / `PUBLIC_URL` (gol = same-origin pe host-ul bot). **Publicare statică:** export Cloudflare/Vercel/Netlify are nevoie de originea bot în `data-api-base`; `PUBLIC_URL` — singura dintre cele trei pe care producția o setează efectiv — e acum în lanț, după ce un publish real pe `pages.dev` a livrat `data-api-base=""` și widget-ul nu a pornit niciodată (Pages răspunde la `/calendar-native/widget/*` cu propriul `index.html`, 200 `text/html`, deci nimic nu eșuează vizibil). Cu base setat, API public reflectă CORS Origin; fără niciunul, publicarea loghează `calendar.native_api_base.unconfigured` la nivel error. Opt-out (gol/`nu`) restaurează formularul local; rezervările native **nu** se șterg. Manage-link visitor: `GET/POST /api/calendar-native/manage*` + UI `/calendar-native/manage/?token=` (token unic, unguessable, single-booking; cancel eliberează slotul). **Nu** este încă singura/opțiunea default pe toate site-urile live — cutover forțat pe flota existentă rămâne out of scope până la decizie owner.

**Editorul pe blocuri (2026-10-28):** pe site-urile noi calendarul nativ se pornește cu blocul **„Programări online”**. Proprietarul își scrie serviciile (nume + durată) și zilele/orele direct în panoul blocului, ca pe orice alt conținut; la publicare calendarul preia exact serviciile și programul din bloc, iar pe site apare widget-ul nativ în culorile site-ului. Programările, zilele libere, personalul și setările se văd din butonul „Programări” de pe cardul site-ului; programul săptămânal și serviciile se schimbă doar din editor, ca să existe un singur loc pentru ele. ZIP-ul descărcat nu sună niciodată acasă: arată serviciile, orele și telefonul. Detalii în `PRODUCT.md`.

Pilotul Railway separat „Hidook Calendar” (cal.diy self-hosted) rămâne **netulburat și nelegat** de Site Builder: nu se șterge, nu se oprește, nu se modifică din acest track, și **nu** se construiește nicio integrare Site Builder → acel pilot. Este un experiment separat, irelevant pentru arhitectura de mai jos.

**Reparație locală de pornire concurentă (2026-11-06):** conexiunea SQLite instalează același `busy_timeout = 5000` înainte de configurarea WAL, nu după; astfel și pornirea așteaptă un writer existent. Nu se adaugă retry și nu se schimbă schema, tranzacțiile, regulile de rezervare sau timpul de așteptare existent. Validarea include lock de pornire controlat și 20 de conexiuni concurente pentru 5 resurse, cu exact 5 confirmări, 15 cereri nealocate și zero suprapuneri; aceasta nu este acceptare de lansare.

### Ce primește fiecare client Professional (țintă)

- disponibilitate izolată, servicii, rezervări și un **dashboard privat de programări** (doar owner-ul autentificat al site-ului);
- pe site-ul public: un **calendar de booking direct** (nu link extern, nu iframe third-party);
- primul canal de notificare: **email tranzacțional** only. Telegram opt-in și WhatsApp / Meta Cloud API sunt adaptoare ulterioare — **nu** se construiesc și **nu** se fake-uiesc acum.

### Decizii owner-locked (2026-09-04) — obligatorii la implementare

**State machine booking**

- stări minime: `requested` și `confirmed` (plus `cancelled` / `reschedule_needed` pe lifecycle);
- default: **confirmare instant** doar când slotul e liber (fără conflict); dacă există conflict de slot, booking-ul rămâne `requested` / `reschedule_needed` — **nu** se confirmă peste un slot ocupat;
- visitorul și owner-ul văd starea reală; niciodată „confirmat” fals.

**Blocare slot / race prevention**

- sistemul de record previne double-book prin **constraint unic la nivel de DB** și/sau **lock tranzacțional pe (tenant/site + service + slot)**;
- optimistic-only (check-then-write fără lock/unique) este **interzis** ca singură apărare.

**Anulare / reprogramare**

- **Owner** (autentificat): poate anula sau reprograma orice booking al site-ului său;
- **Visitor**: poate anula/reprograma doar cu token-ul de gestionare primit pe email, în fereastra de timp configurată de owner (default produs: cu cel puțin 24h înainte de startul slotului; owner poate strânge, nu lărgi peste un plafon rezonabil documentat la implementare);
- la anulare/reprogramare validă, slotul se **eliberează** imediat pentru alți visitors; starea anterioară rămâne auditată (nu se șterge istoricul brut fără politică de retenție).
- Dacă anularea este refuzată (inclusiv în ultimele 24h) sau răspunsul eșuează după încărcarea validă, pagina de gestionare păstrează ultima stare reală, data și serviciul, arată refuzul/nesiguranța fără succes inventat și oferă reîncărcarea stării plus îndrumare spre contactul cabinetului de pe site-ul unde s-a făcut programarea. Reîncărcarea reușită înlocuiește starea veche cu cea returnată de server; un link invalid la prima deschidere rămâne eroare generică, fără detalii ale rezervării.

**Timezone**

- stocare canonică: **UTC**;
- timezone-ul de operare al site-ului = timezone-ul owner-ului (setat o dată în setările calendarului);
- widget-ul afișează ca oră principală ora owner-ului; dacă offset-ul UTC al browserului visitorului diferă de offset-ul owner-ului la data selectată, apare o notă și, lângă fiecare slot, ora locală a visitorului ca linie secundară (comparație pe offset, nu pe nume IANA — ex. Europe/Bucharest vs Europe/Chisinau nu declanșează nota); confirmările email includ atât ora owner cât și, unde e util, echivalentul local al visitorului;
- fără ambiguitate DST: conversiile trec mereu prin UTC.

**Availability / holiday / blackout**

- model: **disponibilitate săptămânală recurentă** (ex. Lu–Vi 09:00–17:00 pe timezone owner) + **override-uri pe dată** (blackout / holiday / ore speciale pe o zi calendaristică);
- blackout-urile câștigă în fața recurentului; un slot generat trebuie să respecte ambele straturi + durata serviciului + buffer-ul configurat.

**Date personale — minimizare și retenție**

- PII visitor stocat per booking: **nume, email, telefon (opțional), notă scurtă (opțional)** — nimic în plus (fără adresă, CNP, fișiere, tracking third-party);
- retenție default: păstrate cât timp contul Professional e activ + **24 luni** după anularea abonamentului / ștergerea site-ului, apoi ștergere sau anonimizare; owner poate cere ștergere anticipată (drept de ștergere);
- nu se loghează body-uri complete de email cu PII în plain text lung-lived fără need-to-know.

**Tenant boundaries**

- cheie de izolare = **Site Builder customer id + site id**;
- datele unui Professional **nu** sunt query-abile de alt Professional (nici prin API public, nici prin dashboard, nici prin job-uri interne fără scope de tenant);
- oracle de izolare tenant e obligatoriu înainte de cutover.

**Access control**

- dashboard availability / bookings: **doar** owner-ul autentificat al acelui site;
- endpoint-ul public de booking este **write-mostly** (citește doar sloturi libere agregate pentru acel site; creează booking); **nu** expune lista de bookings, PII al altor visitors, availability raw a altor tenanți, sau id-uri interne străine;
- token-urile de anulare/reprogramare visitor sunt unice, unguessable, și scoped la un singur booking.

**Email delivery**

- interfață generică de provider (boundary): implementare reală + **harness local/test** care nu trimite pe fir și nu cere secrete de producție;
- retry policy documentată (ex. backoff exponențial, N încercări, apoi dead-letter auditat);
- status de livrare (queued / sent / failed / suppressed) stocat și auditat **fără** a expune API keys, SMTP passwords sau secrets în UI, export HTML, sau loguri publice;
- niciun sender real de producție și niciun secret live pe acest track până la owner gate separat.

**Dashboard mobile**

- dashboard-ul owner de programări / availability trebuie să fie **util și lizibil la 390px** lățime (mobile-first; fără controale tăiate, fără tabele care forțează scroll orizontal pe acțiunile critice).

**Outage / error path (site public)**

- dacă backend-ul de booking e down, timeout, sau returnează eroare: site-ul public arată un **mesaj clar în română** că programările online sunt temporar indisponibile + cale alternativă onestă (ex. contact WhatsApp/telefon din Detalii, dacă există) — **niciodată** un formular tăcut stricat, spinner infinit, sau submit care pretinde succes;
- fallback-ul nu inventează confirmări.

**System of record + migrare staged**

- system of record pentru bookings / availability / services = **magazin relațional production-fit** (nu fișiere JSON mutabile ca sursă de adevăr);
- migrarea este **staged și non-destructivă**: formularul local de cerere de programare (comportamentul curent) rămâne neschimbat până când flow-ul nativ trece QA/advocate; **fără** migrare distructivă, **fără** regressie a comportamentului curent înainte de cutover explicit;
- cutover per site doar după oracle verde + dovezi de flow.

### Ce NU face acest track

- integrare Site Builder → cal.diy / Cal.com Platform / pilotul Railway „Hidook Calendar”;
- Telegram / WhatsApp ca canal de notificare booking (mai târziu);
- Stripe/DNS/secrete de producție în secvența de mai jos.

### Secvență de livrare (inițiativă fresh)

1. ~~acest decision packet + design canvases~~ — done (c4406d5 lineage);
2. ~~model de date nativ + booking engine + oracle de izolare tenant~~ — done (c4406d5 lineage);
3. ~~UI public de booking + dashboard owner + editor de availability~~ — public widget + owner dashboard pe cale nativă (2026-09-05);
4. ~~email harness + audit de livrare~~ — done (local/memory provider boundary; fără sender producție);
5. cutover staged de la formularul local de cerere — **cod opt-in per-site** via `appointment.nativeBooking` (default = legacy form; reversibil; seed la publish; manage-token visitor; `nativeApiBase` din env + CORS pe API public pentru export static). Dovezi repair REJECT pe `/live/<slug>/` opted-in + legacy submit real: `04-QA-Evidence/Calendar-Cutover/` (book, email-outbox, owner-dashboard, owner-action, visitor-manage-link, slot-freed, double-book-rejected pe UI real, legacy-form-submitted; CTA post-submit curat). **Independent QA/advocate pe SHA-ul remedierii** încă necesar înainte de a bifa „step 5 QA/advocate complete”. Nu e default global / forțat pe flota live.

## 9. Landing page Site Builder

LP-ul trebuie adaptat la brandul hidook.agency și la research bun de landing pages.

**Aspect ales (decizie owner 2026-10-29, direcția A „Atelier”):** fond crem `#F4EFE6`, cerneală `#1A1714`, un singur accent vermilion (`#B83D1B`; `#FF7A50` pe panourile închise), titluri Bricolage Grotesque, text Schibsted Grotesk. Același aspect îl au „Site-urile mele”, paginile legale ale builderului și interfața editorului pe blocuri (fără albastru). Cardul unui site pe blocuri se identifică prin numele actual al afacerii din antetul salvat, nu prin numele inițial al designului; adresa publică rămâne separată. Dacă numele lipsește ori e încă „Numele afacerii”, precum și pentru site-urile vechi, se păstrează numele proiectului sau adresa ca reper. Dialogul de domeniu explică în română obișnuită conectarea domeniului deja deținut și pașii de la furnizor, fără jargon intern. Landing-ul are, în ordine: hero cu câmpul „Cum se numește afacerea ta?” (numele apare pe loc în designurile din pagină și ajunge precompletat în editor), o demonstrație interactivă delimitată explicit ca exemplu Salon (selectezi titlul, îl rescrii, vezi rezultatul pe telefon cu rendererul real, fără autoplay sau salvarea unei ciorne), catalogul de 13 designuri cu trei exemple inițiale (De la zero, Restaurant, Salon), buton explicit pentru afișarea tuturor/restrângere și filtre numite familii cu număr de rezultate, „Cum funcționează”, „Ce primești”, banda de preț, întrebări frecvente și subsolul închis la culoare. La extindere, restrângere și filtrare, controlul activ rămâne focalizat și vizibil sub antetul fix, cu contextul catalogului păstrat prin repoziționare imediată, fără animație inclusiv la mișcare redusă. Prețul și FAQ au și linkuri directe lângă câmpul de nume și sub catalog, fără parcurgerea tuturor cardurilor. Bannerul de stocare păstrează textul, acțiunile și semantica de consimțământ, într-o formă mai compactă. Antetul are, cât timp clientul nu e autentificat, butonul „Intră în cont” (cerere owner 2026-11-06): deschide aceeași fereastră cu link pe email și duce apoi în „Site-urile mele”; dispare când sesiunea e activă.

Reguli:

- nu ghici culorile hidook.agency;
- LP-ul așteaptă hex-urile exacte / brand tokens sau acces la sursa de brand;
- Mobbin MCP poate fi folosit pentru research dacă owner îl conectează, dar nu este blocker pentru research web normal;
- copy-ul LP citește pricing din config; nu hardcodează prețuri vechi.

## 10. Owner gates

Owner face doar pașii imposibili fără el:

- Stripe live Product/Prices/Customer Portal;
- DNS / Cloudflare live pentru hidook.agency;
- email sender production;
- date legale/VAT/jurisdicție;
- brand tokens exacte hidook.agency;
- orice deploy/push/producție/charge real.

Studio nu cere aceste lucruri până când tot ce se putea construi/testa local/staging este gata.

## 11. Plan de lucru sincronizat — fără buclă infinită

Task-urile vechi bazate pe specuri depășite se opresc. De acum se lucrează numai pe aceste flow-uri verticale:

### Flow 1 — Foundation / primul load + theming

Include: item 9 + item 11 + oracle de performanță.

Acceptare:

- bundle split + cache headers;
- first-load ≤ 3 secunde pe throttling realist;
- culorile schimbă vizibil fiecare template;
- test mecanic + browser evidence.

### Flow 2 — Template pass RO / Details / WhatsApp / Badge / Desserdirina

Include: item 1 + 2 + 5 + 10 + 12 + Instafidget slot messaging.

Acceptare:

- toate șabloanele în română;
- Desserdirina remake apare ca șablon real;
- badge Hidook prezent și non-editabil;
- Details auto-open la fiecare design nou selectat;
- WhatsApp badge + mesaj custom; QR-ul din panou este centrat, iar panoul arată ca un produs finit;
- imaginea pentru distribuire socială se alege automat din fotografia de deschidere sau dintr-o fotografie existentă; clientul nu completează un URL `og:image`;
- Instafidget menționat ca inclus gratuit 12 luni, apoi Free cu watermark;
- verificare în browser pe preview și live/test publish.

### Flow 3 — Legal + export

Include: Privacy, Cookies, Terms, export ZIP/self-deploy.

Acceptare:

- pagini și banner generate cu placeholder legal clar;
- export ZIP complet;
- export HTML/ZIP disponibil numai pentru abonament `active`, trial `trialing` sau drept paid legacy neexpirat; unpaid, `past_due`, anulat și `paidUntil` expirat nu descarcă fișiere;
- unzip + static serve + browser real;
- niciun link legal mort.

### Flow 4 — Commercial E2E + calendar/LP readiness

Include: trial/card/live/cancel/renew; calendarul Professional per decizia owner-locked din §8 (modul nativ Hidook, opt-in per site); LP hidook.agency când există brand tokens.

> **Corecție 2026-09-06 (audit medium #20 — VISION se contrazice intern):**
> versiunea inițială a acestei secțiuni ("Include: ... linkul Cal.com deținut
> de client pentru Professional...") trata Cal.com ca o a doua opțiune
> co-egală de arhitectură de calendar, scrisă înainte de override-ul owner
> din §8 (2026-09-04, LOCKED: modul **nativ** Hidook — **nu** cal.diy, **nu**
> Cal.com Platform, **nu** embed/integrare third-party). Citită separat de
> §8, acea formulare contrazicea decizia mai nouă. Rezolvat în favoarea §8,
> care e decizia owner-locked ulterioară: acceptance criteria de mai jos
> descrie arhitectura curentă corect. Textul vechi nu se șterge silențios —
> rămâne mai jos, marcat explicit **SUPERSEDAT**, pentru că (verificat în cod,
> `templates/professionals/schema.json:455-456` și
> `bot/calendar-native/cutover.js:126`) produsul chiar păstrează un câmp real
> "link Cal.com de programări (opțional)" pentru site-urile care nu optează
> în calendarul nativ — dar acela e un simplu link extern ales și găzduit de
> client, afișat de Hidook la fel ca un număr de telefon, **nu** o
> integrare/arhitectură de calendar construită de Hidook. Nu contravine §8.

> **Corecție 2026-09-12 (decizie owner explicită — Cal.com iese din produs):**
> nota de mai sus (2026-09-06) descria corect starea de atunci — câmpul chiar
> exista. Owner-ul a decis explicit: „la noi nu mai există Cal.com, noi avem
> calendarul nostru." Câmpul `appointment.bookingUrl` e scos din schema,
> preseturile și template-ul `templates/professionals/` și din drawer;
> calendarul nativ Hidook (`appointment.nativeBooking`, §8) rămâne singura
> cale de programare online, cu formularul local de cerere ca fallback când
> nativul e oprit. Un site publicat anterior cu valoarea completată nu
> crapă la republicare — valoarea rămâne orfană în config, dar nu se mai
> randează nicăieri. Bulletul de mai jos e actualizat să reflecte asta;
> istoricul SUPERSEDAT de mai sus și cel din bullet rămân neșterse.

Acceptare:

- card test → trial live imediat;
- cancel trial → comportament clar;
- renewal 29/an reflectat corect;
- clientul Professional fie optează în calendarul nativ Hidook
  (`appointment.nativeBooking`, §8) și booking-ul se face direct pe site-ul
  public — aceasta e arhitectura de calendar a produsului, per decizia
  owner-locked §8 — fie, dacă nu optează, formularul local de cerere rămâne
  singurul fallback disponibil (linkul extern Cal.com opțional a fost
  eliminat din produs pe 2026-09-12, decizie owner — vezi corecția de mai
  sus), nu ca arhitectură de calendar a produsului
  *(text original SUPERSEDAT, păstrat pentru istoric: "fie — dacă nu
  optează — poate lipi un link Cal.com valid, iar site-ul public deschide
  rezervarea în tab nou; formularul local de cerere rămâne fallback-ul când
  niciuna nu e configurată" — formularea trata Cal.com ca opțiune co-egală de
  arhitectură, ceea ce contrazicea §8; comportamentul real al linkului nu
  s-a schimbat, doar cadrul în care e descris)*;
- LP nu intră până nu există brand tokens.

## 12. Reguli pentru studio

- Nu se mai creează micro-slice-uri pe istoricul vechi.
- Fiecare task nou citează flow-ul din acest VISION.
- Dacă o problemă revine de două ori, se construiește oracle/script/runbook, nu încă o regulă în task.
- Task body se scrie fresh din acest document, nu din lanțul de failuri vechi.
- QA/devil’s advocate deschid browser real și salvează screenshots în `04-QA-Evidence/`.
- Owner primește cel mult un taste checkpoint pe flow; owner nu face QA.
- Nu se declară **Produsul** până când toate flow-urile cerute pentru launch trec QA + advocate fără defect vizibil.

## 13. Artefacte canonice

- Spec Opus complet: `00-Governance/OWNER-FEEDBACK-2026-08-26-SPEC.md`.
- Contract companie: `../Hermes/00-Governance/AGENCY-COMPANY-CONTRACT.md`.
- Acest fișier: `VISION.md` — sursa operațională curentă.
