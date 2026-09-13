# Plan — feedback din 13 septembrie (10 puncte, cu capturi)

Fiecare punct e verificat în cod înainte de plan. Punctele cu aceeași cauză sunt grupate într-o singură suită,
ca să nu reparăm același defect de patru ori în patru locuri.

## Suita A — Traducerea nu primește elementele noi (puncte 1, 9)
**Cauză:** `menu.ro` și `menu.en` sunt două liste complet independente în schema (product-menu, desserdirina).
`onListAdd()` din `builder/app.js` adaugă doar în lista limbii pe care o editezi.
**Reparație:** listele-pereche pe limbă rămân aliniate structural. Adaugi/ștergi/muți în RO → același lucru în EN,
pe același index, și invers. Câmpurile care nu țin de limbă (preț, poze) sunt comune. Textul din limba cealaltă
preia textul tău până îl traduci; din momentul în care l-ai scris separat, nu mai e suprascris.

## Suita B — Butoanele de contact care nu se pot modifica (puncte 2, 6, 8, 10)
**Cauză:** adresa se randează ca `{{& contact.address}}` (HTML brut, pentru rânduri multiple), iar un token brut
nu primește marcajul de editare. „București și împrejurimi" (renovări) și „Strada Icoanei…" / „Strada Academiei…"
sunt exact adresa. „WhatsApp" e `{{labels.whatsapp}}`, care nu e declarat în schema.
**Reparație:** adresa editabilă direct pe pagină pe cele 4 șabloane, păstrând rândurile multiple; eticheta
WhatsApp declarată și editabilă; verificat că fiecare buton de contact vizibil se poate modifica.

## Suita C — Galeria salonului: a 4-a, a 5-a poză ies uriașe (punct 3)
**Cauză:** regula `.collage-deck > :nth-child(3n+1):last-child { grid-column: span 6; aspect-ratio: 21/9 }` —
ultima poză rămasă singură pe rând e întinsă pe toată lățimea.
**Reparație:** toate pozele rămân la aceeași dimensiune; peste un număr de poze, rândul devine carusel orizontal.

## Suita D — Echipa: poza unui specialist nou nu merge (punct 4)
**Cauză:** în `portfolio/schema.json`, `team.members[].photo` e declarat `"text"`, nu imagine. Deci panoul „Poze"
nu vede echipa, iar un membru nou randează `<img src="">` — pictograma de imagine spartă din captură.
**Reparație:** poza declarată ca imagine, loc de poză cu click în editor, echipa apare în panoul „Poze".

## Suita E — „Programează-te online" fără formular (punct 5)
**Cauză:** titlul și textul spun „online, confirmare pe email" și atunci când calendarul nativ nu e activat —
caz în care se afișează doar butonul de WhatsApp. Aceeași formă de defect reparată deja pe professionals (M14).
**Reparație:** textul spune adevărul în ambele moduri; în editor, un indiciu care arată unde se activează
programările online.

## Suita F — Lista de date/ore din calendar nu se citește (punct 7)
**Cauză:** meniul derulant nativ al `<select>` moștenește textul deschis al temei închise, pe fundalul alb al
sistemului.
**Reparație:** opțiunile au text închis pe fundal deschis, lizibile pe orice temă.

## Reguli
- Fiecare reparație vine cu un test care cade dacă reparația e dată înapoi.
- Site-urile publicate trebuie să rămână corecte; unde se schimbă HTML-ul publicat, se spune explicit.
- Telegram nu se atinge. Deploy-ul îl face owner-ul.
