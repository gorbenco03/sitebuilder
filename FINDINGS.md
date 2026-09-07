# FINDINGS — Ștergere definitivă a unui site (nu doar anulare)

Worktree: `feat/delete-site` (off `main` @ 5f14883). Owner request: "Trebuie
să facem posibilitatea de a șterge un site, nu doar de a-l anula."

## Ce exista deja

- `POST /api/sites/:id/billing-portal` → Stripe Customer Portal → anulare
  abonament → webhook `customer.subscription.deleted` →
  `webpublish.unpublishSite()`: șterge `$DATA_DIR/published/<slug>/`, pune
  `status:'unpublished'`, `url:null`, păstrează `paid`/`paidUntil` (istoric).
  Site-ul rămâne pe dashboard, doar ca "Anulat" — exact gap-ul din cerință.
- `bot/flow.js` (Telegram, ÎNGHEȚAT — nu se atinge) are deja un precedent de
  ștergere GDPR (`/sterge`): `unpublishSite()` + `registry.updateSite(id,
  {status:'deleted', url:null})` — dar e un soft-delete, rândul de site rămâne
  în registry cu `status:'deleted'`, filtrat manual în câteva locuri
  (`server.js` liniile ~2812/2867/3314).
- `bot/calendar-native/retention.js` documentează explicit: "no hook into
  Stripe/site-deletion events (explicitly out of scope)" — deci ștergerea
  unui site NU curăța niciodată datele de calendar nativ ale acelui site.
  Acesta e motivul principal pentru care era nevoie de handler nou, nu doar
  de reutilizat fluxul GDPR din Telegram.
- `bot/domains.js` ține conexiunile de domeniu propriu într-un fișier JSON
  (`$DATA_DIR/custom-domains.json`), cheie = `siteId`. `disconnectDomainConnection`
  doar marchează `status:'disconnected'`, nu șterge rândul.

## Decizie: hard-delete pentru rândul de site + versiuni, păstrăm orders/ledger

Cerința #3 spune explicit "the registry row" ca parte din ce trebuie șters —
nu doar un flag. Am implementat `registry.deleteSite(siteId)` (SQLite + JSON,
paritate completă) care:
- șterge definitiv rândul din `sites`
- șterge toate versiunile (`versions` / ciornele) — conțin date reale de
  business (nume, telefon, poze, adresă) pe care ownerul le vrea șterse
- **păstrează** rândurile din `orders` (sume, `stripe_session_id`, monedă) —
  nu conțin conținutul site-ului, sunt istoricul financiar, iar Stripe
  rămâne sistemul de adevăr pentru plăți. Ștergerea `site_id`-ului lor ar
  rupe reconcilierea contabilă fără niciun beneficiu de confidențialitate real.
- adaugă o linie în ledger (`.ledger.jsonl`, append-only) — `event:
  'site_deleted'` cu `siteId`, `slug`, `userId`, `reason` — un audit trail
  minimal, fără conținut, exact ca restul evenimentelor de billing.

Aceasta e diferit de precedentul GDPR din Telegram (care doar marca
`status:'deleted'`), pentru că cerința explicită de aici cere ștergerea
rândului, nu doar ascunderea lui. Nu ating fluxul `/sterge` din Telegram
(bot.js/flow.js sunt înghețate) — cele două coexistă, fiecare cu propriul
handler.

## Ce se șterge la `DELETE /api/sites/:id`

1. **Fișierele publicate** — `webpublish.unpublishSite(site, {reason:
   'owner_delete'})`, idempotent, deja existent.
2. **Domeniul propriu conectat** (dacă există) — funcție nouă
   `domains.deleteDomainRecordForSite(siteId)`: best-effort detach Cloudflare/
   Vercel, apoi șterge rândul din `custom-domains.json` (nu doar
   `disconnected` — domeniul aparține unui site care nu mai există).
3. **Datele native de calendar** (dacă site-ul a avut vreodată
   `appointment.nativeBooking` activat) — funcție nouă
   `retention.eraseSiteTenantData(db, customerId, siteId)` în
   `bot/calendar-native/retention.js`: șterge rândurile tenantului
   (`customer_id=userId, site_id`) din toate cele 9 tabele native
   (settings, services, resources, service_resources, weekly_availability,
   date_overrides, bookings, email_outbox, email_audit). Motivul pentru care
   aparține de `retention.js` și nu de `engine.js`: fișierul deja documentează
   politica de retenție/ștergere GDPR pentru acest subsistem — ștergerea
   completă e o extensie firească a aceleiași responsabilități, nu o
   funcționalitate nouă și separată.
4. **Cererile locale de programare** (`$DATA_DIR/appointments/<slug>.json`,
   fluxul vechi non-native `/api/appointments`) — șters direct.
5. **Rândul din registry + versiunile (ciornele)** — `registry.deleteSite`.
6. **NU se șterg**: `orders` (istoric financiar), liniile din `.ledger.jsonl`
   (audit trail append-only, niciodată rescris) — vezi motivarea de mai sus.

## Reguli de refuz (constrângerea #2)

Blocare explicită, cu mesaj în română, `409` + `code` distinct — nu ștergere
silențioasă și nu ștergere forțată:

- **Abonament plătit activ** (`hasActiveCommercialEntitlement(site)` — aceeași
  funcție deja folosită pentru rollback/renewal) → `code: 'ACTIVE_SUBSCRIPTION'`.
  Motiv: dacă am șterge site-ul cât abonamentul e activ, Stripe ar continua
  să factureze un site care nu mai există — owner-ul trebuie să anuleze
  întâi din Facturare (`Anulează` → portal Stripe, deja existent), apoi să
  șteargă. Nu am ales varianta "anulăm automat abonamentul din spate" pentru
  că schimbarea stării de billing e o acțiune separată cu consecințe (Stripe
  Customer Portal e deja fluxul dedicat pentru asta) și pentru că ownerul
  trebuie să vadă explicit cele două acțiuni distincte (bani vs. date).
- **Programări viitoare confirmate/în așteptare** — interoghez
  `calendar-native` (bookings cu `status IN ('requested','confirmed')` și
  `start_utc` în viitor pentru tenantul acelui site) → `code:
  'FUTURE_BOOKINGS'`, mesajul include numărul. Motiv explicit din cerință:
  "A booking a visitor made and will turn up for is real" — vizitatorul ar
  ajunge la o adresă/site care nu mai există. Am ales blocare (nu
  auto-anulare a programărilor), pentru că anularea lor fără să anunțe
  vizitatorii ar fi tot un fel de "ștergere silențioasă" a unui angajament
  luat față de o terță parte care nu e ownerul.

Nu blochez pe programări TRECUTE (istoric) — acelea nu mai au un vizitator
care așteaptă ceva.

## Confirmare (constrângerea #1)

Server: `DELETE /api/sites/:id` cere în body `{ confirmName }`, comparat
exact (trim, case-sensitive) cu `site.projectName || site.slug`. Nepotrivire
→ `422 CONFIRM_MISMATCH`, niciodată ștergere parțială.

UI: buton nou "Șterge" (roșu, `.btn-danger`) pe fiecare card din dashboard,
deschide un modal nou (`#modal-delete-site`) care cere să tastezi exact
numele site-ului afișat, cu un `<input>` dedicat; butonul de confirmare
rămâne dezactivat până la potrivirea exactă (verificare și pe client, ca
buton disabled, ȘI pe server, ca sursă de adevăr reală — clientul e doar UX).

## Autorizare server-side (constrângerea #4)

`handleDeleteSite` verifică `requireAuth` → `userId`, apoi
`site.userId !== userId` → `403`, la fel ca toate celelalte rute
`/api/sites/:id/*` existente (`resolveOwnedSite` pattern). Clientul trimite
doar `id` (din URL) + `confirmName` (text liber verificat server-side) —
niciun alt câmp de la client nu decide ce se șterge.

## Idempotență (constrângerea #5)

- Site inexistent (deja șters, sau id greșit) → `200 {ok:true,
  alreadyDeleted:true}`, nu 404/500 — a doua apăsare pe Delete (dublu-click,
  retry de rețea) nu trebuie să pice.
- Site cu `status:'deleted'` deja (nu ar trebui să mai existe după hard
  delete, dar las verificarea pentru siguranță/compatibilitate cu alte căi
  care ar putea seta acest status) → același răspuns idempotent.
- Fiecare pas de curățare (`unpublishSite`, domeniu, calendar, fișier
  appointments) e învelit în `try/catch` separat și loghează, dar nu oprește
  restul — o resursă parțial deja curățată dintr-o rulare anterioară
  eșuată nu blochează ștergerea rândului final din registry.

## Ce ATINGE și ce NU

Atinge: `bot/server.js`, `bot/domains.js`, `bot/calendar-native/retention.js`,
`bot/registry-sqlite.js`, `bot/registry-json.js`, `builder/index.html`,
`builder/app.js`, `builder/app.css`.

NU atinge: `bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`
(înghețate), `templates/*/template.html`, `templates/*/styles.css` (ship
verbatim către clienți).

## Dovezi (se completează pe măsură ce rulez)

- Oracle Playwright RED→GREEN: `bot/test/delete-site-oracle.mjs`
- Teste unitare noi: `bot/test/delete-site.test.js`
- `node --experimental-sqlite --test bot/test/*.test.js` — rezultat: TBD
- `node --experimental-sqlite bot/test/fullpass-63230d2.mjs` — rezultat: TBD
- Screenshot-uri 1440x900 și 390x844 ale fluxului de confirmare — TBD
