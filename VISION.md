# Hidook Site Builder — Document de Viziune (sursă unică de adevăr)

**Citește acest document ÎNAINTE de a declara orice livrare "gata". Dacă produsul contrazice ceva de aici, nu e gata, indiferent ce spun testele.**

Ultima actualizare: 2026-08-26 (owner decision round — trial model + pricing). Owner: Gorbenco Kirill. Autoritate produs: `PRODUCT.md` (decizii owner 2026-08-20, suprascrise unde intră în conflict cu acest update) + `AGENTS.md`.

## Ce este Site Builder (esența)

Un website builder simplu, vândut global, prin browser. **Nu** un bot de Telegram cu deploy fals. Un STRĂIN trebuie să poată: deschide builder-ul → aleagă un design → înlocuiască text/imagini → preview → login → introducă cardul → aibă un site live pe HTTPS imediat (trial) → revină, editeze, re-publice → fie taxat automat după 7 zile dacă nu anulează. Fără ajutorul echipei, fără explicații.

## Regula de aur (non-negociabilă) — ACTUALIZATĂ 2026-08-26

**Trial gratuit de 7 zile, card obligatoriu la înscriere, taxare automată în ziua 7 dacă nu se anulează.** Site-ul devine live/public IMEDIAT la începutul trial-ului — NU mai există "plată înainte de publicare". Regula veche ("dacă cineva poate vedea site-ul live fără să fi plătit, produsul e greșit") e ABROGATĂ — un site aflat în trial e vizibil public prin design, asta e modelul.

Ce rămâne non-negociabil sub noul model:
- Fără card valid la înscriere → fără site live. Nu există trial fără card.
- Ziua 7: dacă userul nu a anulat, cardul e taxat automat (Stripe subscription, `trial_period_days: 7`), nu manual, nu "îi trimitem un email și așteptăm".
- Userul poate anula oricând în cele 7 zile fără să fie taxat. Ce se întâmplă cu site-ul la anulare (rămâne live degradat / cade / grace period) e de specificat explicit în implementare — nu lăsa comportament neclar.
- Produsul comercial rămâne **browser builder** (cont, editor, card, trial, publish automat, edit, taxare automată, renew). Telegram e doar acquisition/intake care deschide ACELAȘI draft — nu un al doilea checkout, nu o mașină de stări de deploy separată.

## Comercial — ACTUALIZAT 2026-08-26

- Preț: **99** în moneda locală a clientului — EUR (UE), GBP (UK), USD (restul lumii). (Corecție de la 100 → 99, aceleași 3 bucket-uri de monedă, nu o singură monedă globală.)
- Model de plată: **abonament Stripe cu trial de 7 zile**, nu one-time payment. Cardul se ia la înscriere, prima taxare e în ziua 7.
- Include: builder + site live imediat (din prima zi de trial) + hosting gestionat pe subdomeniul agenției + editare self-service + SEO/contact de bază + istoric versiuni
- Reînnoire: **29**/an în aceeași monedă, necondiționat (nu variază după cine face deploy-ul).
- NU promite hosting permanent dintr-o singură plată.

## Design

Client a respins look-ul generat curent pentru template-ul de brutărie inițial ("Desserdirina"/DESSERD) — dar NU vrea să fie abandonat, vrea remake la același nivel ca celelalte sisteme. **Patru sisteme aprobate + Desserdirina remake = cinci**, nu trei:
1. Produs / meniu (business-uri cu produse/meniuri)
2. Servicii locale / lead-gen
3. Portofoliu / beauty / evenimente
4. Servicii profesionale (professionals)
5. Desserdirina — remake al fostului sample de brutărie respins, adus la același nivel de calitate (theming, i18n, badge) ca celelalte patru, nu un al șaselea vertical nou cercetat de la zero.

Cercetare via Awwwards/Firecrawl → DESIGN.md pentru orice sistem NOU (nu se aplică remake-ului Desserdirina, care pornește din ce există deja). Fără AI slop (gradient-uri generice, iconițe stoc, layout template evident). Public țintă include profesioniști + are nevoie de calendar (vezi Calendar mai jos). Nu deranja clientul pentru palete sau slice-uri de template.

## Calendar (plan Professional)

Owner a ales opțiunea **C: Hidook găzduiește o instanță proprie de [cal.diy](https://github.com/calcom/cal.diy)** (fork MIT al Cal.com) pentru clienții de pe planul Professional. Licență verificată: MIT, verde. Efort real: e o a doua aplicație (Next.js/TypeScript + Postgres/Prisma), nu o librărie — infra, migrări, backup, GDPR pentru datele de programare sunt în plus față de stack-ul zero-dep actual. Owner-gated pe cheltuiala de hosting/DNS finală; planul de integrare e treabă de studio.

## Instafidget (graniță de scope)

Alt echipă, altă responsabilitate. Site Builder ține doar un slot neutru `socialFeed` + fallback galerie statică. Fără API/UI/billing Instafidget în acest produs. Instagram live apare DOAR când Instafidget e conectat — altfel se ascunde complet, nu se arată gol/spart.

Bonus Site Builder → Instafidget: 1 widget gratuit 12 luni, apoi trece pe Free + watermark.

## Gates ale owner-ului (NU implementa producție pentru astea)

Stripe producție, Cloudflare/DNS pentru hidook.agency, sender de email de producție, entitate legală/text TVA. Echipa livrează local/staging cu Stripe test și deploy izolat/fake — asta e în scope. Deploy fake NU e călătoria reală a clientului și nu se raportează ca „gata".

## Checklist anti-fals-pozitiv (verifică fizic, în browser real) — ACTUALIZAT 2026-08-26

- [ ] Fără card valid introdus, userul NU poate porni trial-ul și NU are site live
- [ ] Cu card valid, site-ul devine live IMEDIAT la începutul trial-ului (nu mai există gate de plată-înainte-de-publish)
- [ ] Ziua 7 din trial: dacă userul nu a anulat, cardul e taxat automat, fără intervenție manuală
- [ ] Userul poate anula în interiorul celor 7 zile fără să fie taxat, iar comportamentul site-ului post-anulare e cel specificat (nu nedefinit)
- [ ] Fluxul complet builder→card→trial live HTTPS→edit→auto-charge ziua 7→renew merge de la un capăt la altul, fără cod
- [ ] Prețul afișat corespunde monedei clientului (EUR/GBP/USD) corect, la 99 nu 100
- [ ] Design-ul folosit e unul din cele 5 sisteme aprobate (product-menu, local-service, portfolio, professionals, Desserdirina remake) — nu template-ul DESSERD original respins nefinit
- [ ] Slotul social e neutru/ascuns dacă Instafidget nu e conectat — nu gol, nu spart
- [ ] Telegram deschide EXACT același draft ca browser-ul, nu un flux paralel

## Repo & reguli tehnice

`/Users/Work/Desktop/sitebuilder` — `github.com/gorbenco03/sitebuilder`. Un task = un worktree/branch. Fără force-push/reset/merge pe main decât integrator după `VERDICT: ACCEPT`. Fără push la producție, fără DNS live, fără charge-uri reale fără aprobare explicită owner.
