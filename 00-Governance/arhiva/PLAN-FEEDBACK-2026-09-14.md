# Plan — feedback din 14 septembrie (6 puncte, cu capturi)

## Suita A — Ciclul publicare / dashboard (puncte 1, 2)
**1. „Ai un proiect neterminat: Salon" după ce site-ul e plătit și live.** Bannerul de recuperare
(`builder/index.html:197`, logica în `builder/app.js` ~2037–2070) reapare pentru o ciornă care a fost deja
publicată. Ciorna locală nu e închisă/legată de site după publicare.
**2. Republicarea arată `https://atelier-ivoire.pages.dev`, deși site-ul corect e
`https://atelier-ivoire.sites.hidook.agency`.** Modalul de succes (`app.js` ~6680) afișează URL-ul primit
de la publicare, care la republicare e cel de export Cloudflare Pages. Dashboard-ul arată adresa corectă.
**Reparație:** o singură sursă pentru „adresa site-ului live", folosită peste tot (modal, copiere,
WhatsApp, dashboard); bannerul apare doar pentru o ciornă care chiar nu e publicată.

## Suita B — Textele evidențiate cu portocaliu (punct 3)
**Cauză:** evidențierea e intenționată — marchează textul care e încă **de exemplu** (numele, telefonul,
adresa, descrierea afacerii din presetul șablonului). Dar se aplică doar unei liste scurte de câmpuri
(`IDENTITY_FIELD_KEYS` în `app.js`, clasa `.hb-demo-text` în `edit-overlay.js`), iar nicăieri nu scrie ce
înseamnă. Rezultatul arată aleator.
**Reparație:** regula devine consecventă pe toate cele 5 șabloane (orice text care descrie afacerea și e
încă cel de exemplu), și se explică: o legendă scurtă în editor și un indiciu la trecerea cu mouse-ul.
Textele generice („Servicii", „Contact") nu se evidențiază — nu sunt greșite dacă rămân.

## Suita C — Calendar adevărat la alegerea datei (punct 4)
**Cauză:** widget-ul de programare afișează doar 14 zile ca butoane (`data-day-count`, maxim 21).
**Reparație:** un calendar lunar, cu navigare între luni, limitat la fereastra de programare pe care o
permite serverul; zilele fără intervale apar dezactivate.

## Suita D — Previzualizarea de pe landing nu merge pe Windows (punct 5)
**Cauză:** necunoscută încă. Pe Mac merge. Se testează pe toate motoarele de browser (Chromium, Firefox,
WebKit) și pe condițiile specifice Windows: scalare 125%/150%, bare de derulare clasice, animații oprite
din setările Windows (`prefers-reduced-motion`), Edge.
**Reparație:** după ce cauza e găsită și reprodusă, cu test care o prinde.

## Suita E — Căutarea tuturor breșelor UX/UI (punct 6)
Trei agenți de explorare, **fără reparații**, fiecare cu reproducere și dovadă pentru fiecare problemă:
editorul pe toate cele 5 șabloane; contul, plata, publicarea și dashboard-ul; site-urile publicate pe toate
browserele și lățimile, inclusiv programarea cap-coadă. Constatările devin planul valului următor.

## Reguli
- Doar local; nimic pe producție, nimic pe Stripe real.
- Fiecare reparație vine cu un test care cade dacă reparația e dată înapoi.
- Telegram nu se atinge. Deploy-ul îl face owner-ul.
