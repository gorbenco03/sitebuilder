# Hidook Site Builder — PROJECT_STATUS

Actualizat: 2026-09-05 (calendar nativ Hidook step (e) cutover staged integrat local pe main — formular legacy pentru neopt-in, widget nativ pentru Professional opt-in; fullpass defects=0/46)

## Status authority

Acest fișier e registrul canonic "unde suntem acum" pentru Site Builder. Se actualizează după fiecare: card Kanban `done` cu VERDICT: ACCEPT, gate de design/arhitectură închis, Decizie a owner-ului, livrare (Produsul), sau escaladare de code-review după 2 cicluri eșuate. `VISION.md` rămâne sursa de adevăr pentru CE e produsul; acest fișier spune UNDE suntem cu implementarea lui.

## Canonical workspace

- Root: `/Users/Work/Desktop/sitebuilder`
- Repo: `github.com/gorbenco03/sitebuilder` (+ remote `hidook`: `NikuX/lp-builder1-hidook-agency`, ambele pe `main`)
- VISION.md: `/Users/Work/Desktop/sitebuilder/VISION.md` (sincronizat 2026-09-04)
- AGENTS.md: `/Users/Work/Desktop/sitebuilder/AGENTS.md`
- Board Kanban: `sitebuilder`

## Fază curentă

Live / în producție. Modelul comercial (Stripe trial 7 zile, 99 EUR/GBP/USD, renewal 29/an) e activ. Nu mai e în faza de Define/Design — produsul e deja construit și livrat, lucrul curent e pe flows incrementale (Flow 2/3/4, OF-1..OF-4) văzute în Kanban. Calendar Professional: **țintă** modul nativ Hidook în Site Builder (override owner 2026-09-04). **Implementat pe branch calendar-v2 / main lineage:** (a)+(b) (c4406d5); **(c) part 1** widget public (92409d5); **(c) part 2** owner dashboard (5516dae); **(d) email harness** (boundary + local outbox); **(e) staged opt-in cutover** pe `wt/calendar-v2-cutover` via config `appointment.nativeBooking` (`da`/`nu`, reversibil, non-destructiv; seed la publish; manage UI token-scoped). **Default pe site-urile live** rămâne formularul local de cerere (+ link Cal.com opțional) — cutover **nu** e forțat pe flota existentă. Pilotul Railway „Hidook Calendar” (cal.diy) rămâne netulburat/nelegat.

## Ultimele evenimente (din Kanban, cele mai recente `done`)

- **Calendar v2 step (e) — cutover staged integrat local pe main (t_493652df / t_e22548f9 / review ACCEPT t_56a699f4, 2026-09-05):** formularul local de appointment-request rămâne activ pentru site-urile fără opt-in; Professional cu `calendarNativeEnabled` primește widget-ul nativ cu tenant izolat, booking, email local/test, manage-token cancel și dashboard owner. Conflictul de integrare cu pachetul QA step (d) a păstrat CORS/preflight și stilurile main, plus cutover/manage wiring; regula `[hidden]` force-hide pentru `.hnb__layout`, `.hnb__steps`, `.hnb__sub` și chrome-ul de rezultat rămâne, prevenind starea dublă „Se trimite” + „Programare confirmată”. Fără Stripe/DNS/secrete/cal.diy atins; suitea și fullpass au fost relansate post-merge.
- **Calendar v2 step (e) REJECT repair t_e22548f9 (builder-frontend, 2026-09-05):** pe `wt/calendar-v2-cutover` additive pe be60ac8: (1) CSS lying-CTA deja închis pe 34c0b2d — `.hnb__layout[hidden]`/`.hnb__steps[hidden]`/`.hnb__sub[hidden] { display:none !important }` (înainte doar `.hnb`/`.hnb__panel`/`.hnb__result`; `display:grid/flex` override-uia bare `[hidden]`); shot 05 re-confirmat fără „Se trimite…”; (2) E2E pe `/live/cutover-opted-in-cabinet/` (nu preview widget) — book → outbox → owner UI act → manage Ana → slot free; (3) double-book via **real product UI** (shot 15 = widget „Cerere înregistrată / în așteptare”, status `reschedule_needed`, niciodată confirmed); (4) legacy form **submit real in-browser** pe `/live/cutover-legacy-cabinet/` → POST `/api/appointments` status `requested` + shot 09 done-state. Tests 142 pass; fullpass defects=0/46. `bot/site-legal.js` + `fullpass-63230d2.mjs` neschimbate.
- **Calendar v2 step (e) REJECT remediation (t_2c564921, builder-frontend, 2026-09-05):** pe `wt/calendar-v2-cutover` additive pe 0db827d: (1) E2E pe site professionals opted-in real (`/cutover-shot/native.html`, nu preview widget) — book → RO status → email outbox harness → owner dashboard/action → manage-link → slot free → double-book `reschedule_needed` never confirmed; shots `04-QA-Evidence/Calendar-Cutover/` 01–15; (2) CSS `[hidden]` pe `.hnb__layout`/`.hnb__steps`/`.hnb__sub` (fix lying CTA „Se trimite…”); (3) `appointment.nativeApiBase` din `CALENDAR_PUBLIC_BASE_URL`/`PUBLIC_BASE_URL` + template data-api-base/asset URLs + CORS pe API public; (4) VISION §8 fără overclaim „step 5 QA/advocate complete” (independent review still required). Tests 142 pass; fullpass defects=0/46. `bot/site-legal.js` + `fullpass-63230d2.mjs` neschimbate.
- **Calendar v2 step (e) — staged opt-in cutover + native-flow QA (t_493652df, builder-frontend, 2026-09-05):** pe `wt/calendar-v2-cutover`: flag config `appointment.nativeBooking` (schema/presets professionals + `@if` render + build falsy `nu`); `bot/calendar-native/cutover.js` (preparePublishCutover seed services/weekly + inject tenant ids); manage-api + UI `/calendar-native/manage/?token=`; server routes GET/POST manage; webpublish seed on publish; oracle `bot/test/calendar-native-cutover.test.js`; QA shots `04-QA-Evidence/Calendar-Cutover/` (legacy default, opt-in widget, book RO, manage cancel frees slot); VISION §8 status = BUILT opt-in (nu default global). Legacy `/api/appointments` + form neschimbate când flag off. **Nu** forced cutover flota live, **nu** cal.diy touch. Independent review t_08a19d82 REJECTed 0db827d (preview-only E2E + lying CTA + empty api-base) → remediere t_2c564921.
- **Calendar v2 step (d) — email delivery boundary + local/test harness + retry/audit (t_ebd5150d, builder-frontend, 2026-09-05):** pe `wt/calendar-v2-email`: schema v2 `calendar_email_outbox` + `calendar_email_audit`; module `bot/calendar-native/email/` (provider boundary generic, transport `local-memory` fără secrete/wire, templates RO oneste pe stare, outbox + exponential backoff → dead_letter, scrub secrete); engine hooks pe create/cancel/confirm/reschedule; manage-link token în email visitor (hash la rest, scoped 1 booking); oracle `bot/test/calendar-native-email.test.js`; fullpass defects=0/46; `bot/site-legal.js` + `fullpass-63230d2.mjs` + legacy `/api/appointments` neschimbate. **Nu** cutover, **nu** sender producție. Review independent: t_4adbbf5d.
- **Calendar v2 step (c) part 2 — owner bookings dashboard + availability editor (t_2a215ec5, builder-frontend, 2026-09-05):** pe `wt/calendar-v2-owner-dashboard`: engine `removeDateOverride` + `rescheduleBookingAsOwner`; `bot/calendar-native/owner-api.js` (list/search bookings, weekly + blackout overrides, service duration/buffer, cancel/confirm/reschedule); static RO UI `/calendar-native/owner/` + CSS/JS 390px; server routes `/api/calendar-native/owner/*` cu `hb_session` + `customerId === session userId` + site ownership (DEMO pair only non-prod preview); oracle `bot/test/calendar-native-owner-dashboard.test.js` (tenant isolation + cancel frees slot + history kept); `check-calendar-native-owner-390.mjs` OWNER_OVERFLOW_OK; fullpass defects=0/46; site-legal.js + fullpass-63230d2.mjs neschimbate. **Nu** cutover, **nu** email, **nu** touch pe formularul local de cerere. Review independent: t_204a869a.
- **Calendar v2 step (c) part 1 — public booking widget (t_03810a59, builder-frontend, 2026-09-05):** pe `wt/calendar-v2-ui`, pe baza c4406d5: `createBooking` respinge sloturi în afara weekly/blackout/special_hours; API public tenant-scoped `GET/POST /api/calendar-native/{services,slots,bookings}`; widget static RO (`bot/calendar-native/widget/`) + preview `/calendar-native/widget/`; oracle `bot/test/calendar-native-public-widget.test.js`; fullpass defects=0/46; site-legal.js + fullpass-63230d2.mjs blob-uri neschimbate vs c4406d5. **Nu** cutover, **nu** dashboard owner, **nu** email, **nu** touch pe formularul local de cerere.
- **RO — Owner override calendar v2 2026-09-04 (docs-only, t_959ad639):** supersedează VISION.md §8 both (a) „Cal.com-link-only” (2026-09-01) and (b) the earlier same-day self-hosted cal.diy override (t_3d983be8 / 970aacb). **Text exact locked:** calendarul Professional final = **modul NATIV Hidook** built inside Site Builder — **NOT** cal.diy, **NOT** Cal.com Platform. Fiecare client Professional: availability/services/bookings izolate + dashboard privat programări; site public = calendar booking direct; primul canal notificare = **email tranzacțional** only (Telegram/WhatsApp = adaptoare later, not built/faked now). Pilotul Railway separat „Hidook Calendar” (cal.diy) rămâne **untouched/unrelated** — no delete/stop/modify, no Site Builder integration. Decizii locked în VISION §8: state machine `requested`/`confirmed` (instant confirm only if no slot conflict, else requested/needs-reschedule); slot lock via DB unique constraint and/or transactional row lock on tenant+service+slot (not optimistic-only); cancel/reschedule (owner full; visitor via email token, default ≥24h window; slot freed); timezone UTC store + owner TZ operate + visitor local display; weekly recurring availability + date blackout overrides; PII min (name/email/phone optional/note optional) + retention active+24mo then delete/anonymize; tenant key = Site Builder customer/site id; ACL dashboard owner-only, public endpoint write-mostly no cross-tenant leak; email generic provider boundary + local/test harness, retry + delivery audit without secrets; dashboard usable at 390px; public outage path = clear RO message + honest alt contact, never silent broken form; **relational production-fit store** as system of record (not mutable JSON files); staged non-destructive migration keeps local appointment-request form until native flow passes QA. **Secvență livrare:** (a) this decision packet + design canvases, (b) native calendar data model + booking engine + tenant isolation oracle, (c) public booking UI + owner dashboard + availability editor, (d) email harness + delivery audit, (e) staged cutover from legacy local-request form + full QA/advocate + proof-of-flow. **No Stripe/DNS/production secrets** in this sequence. Stare: forward-looking target în VISION.md §8; **niciun cod de produs** pe acest card. Review independent: `t_d93bd3bc` (critic-gpt).
- **Fix leak găsit direct de HQ (fără builder dedicat, remediere mecanică cu 1 linie):** `bot/site-legal.js` avea un comentariu CSS care numea explicit template-ul intern "desserdirina" într-un bloc de reguli de siguranță cookie/FAB inlinat în **fiecare** export HTML/ZIP și pe **orice** site live (indiferent de template). Un străin care descarcă export-ul sau vede page source pe site-ul lui live ar fi văzut acest nume de cod intern. Prins de oracle-ul existent `bot/test/wave11-html-export.test.js` (checkul `assertNoSecretLeak`, care includea deja `DESSERD` în lista interzisă) — testul pica de câteva zile fără să fi fost anchetat până acum. Reparat prin reformularea comentariului fără nume intern, fără schimbare de comportament/CSS. Verificat: `wave11-html-export.test.js` all passed (era 1/3 checks failing), `wave10-admin-dashboard` + `wave9-cancel-unpublish` + `pricing` all passed, oracle-ul întreg de produs `fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46` neafectat. Commit local `4578a2f` pe `main` (fără push).
- Full-pass devil's-advocate pe întreg produsul, HEAD 3099ebb / produs 5508863 (t_84f26f06, tester-qa) — stranger pass izolat pe toate cele 5 sisteme de template (professionals, local-service, portfolio, product-menu, desserdirina) + chrome builder (catalog, editor, Details auto-open, panou WhatsApp QR, câmp Cal.com) + pagini legale + banner cookie + Stripe test-mode trial/pay/export/cancel/past_due, desktop și mobile-preview 390px. Cele 3 defecte numite din runda anterioară (clip professionals, coliziune cookie/FAB portfolio, WhatsApp dublu local-service) confirmate reparate în pixeli reali. **VERDICT: ADVOCATE: LOST — zero defecte noi.** Proof-of-flow regenerat pentru acest SHA exact (OVERVIEW + 16 stills + înregistrare video continuă flow.webm/mp4) sub `04-Deliverables/Advocate-5508863/`; evidență completă sub `04-QA-Evidence/Advocate-5508863/`. Integrat pe main la 053ee43 (doar documentare/evidență, fără schimbare de produs).
- 390 mobile-preview cookie/WhatsApp collision repair (t_bb9d8a07, worktree repair-4112579-mobile-collisions, CSS-only, toate 5 sisteme) — review independent t_9b319420 (critic-gpt) inițial REJECT: fullpass-63230d2.mjs raporta defects=1 fals-pozitiv (oracle-ul clica `.whatsapp-float` ascuns pe local-service, unde CSS-ul corect ascunde float-ul în favoarea `.ls-dock__wa`). Remediere îngustă test-only t_36633555 (builder-backend): oracle-ul clică primul control WhatsApp VIZIBIL per sistem. Review independent t_6af0333a (critic-gpt) — VERDICT: ACCEPT (SHA 5508863, tree 142cb1b0, parent 44f6105 verificat; fullpass defects=0/46; mobile-chrome-390-aabb PASS; desserdirina-hero PASS; probă proprie 390px pe toate 5 sisteme — dock pe local-service, float pe restul). Fast-forward local `main`: 4112579 → 5508863 (clean tree pe fișierele merge-ului, no push); re-verificat independent pe main integrat: `FULLPASS defects=0 steps=46`.
- Devil's advocate full-pass pe 4112579 (t_bbe40180, tester-qa) — ADVOCATE: STILL STANDING. 3 defecte noi găsite la 390px mobile-preview: professionals `.pr-strip` clip ("Online și la cabinet" → "Online și la ca") sub cookie+WhatsApp, portfolio cookie card peste FAB WhatsApp (clip "EXPLOREAZĂ"), local-service două controale WhatsApp vizibile simultan pe primul ecran. Remediere t_bb9d8a07 (builder-frontend, worktree repair-4112579-mobile-collisions) dispatch — regulă CSS comună cookie/WhatsApp/FAB pe toate cele 5 sisteme + oracle pixel/AABB nou, nu patch per-template. Review independent t_9b319420 (critic-gpt) blocat corect pe builder, se declanșează după commit.
- Devil's advocate full-pass pe 28ae336 (post cookie-dock fix, t_93f3a790) a găsit un defect real invizibil pentru oracle-ul innerText: fotografia hero implicită Desserdirina afișa încă un ecuson lemn „DESSERD by Irina" (brand respins) pe primul ecran la 390px live și în editor mobile-preview-toggle. Nu a fost reparat de advocate (read-only). Remediere îngustă t_6240beda (builder-frontend): crop top-anchored pe `templates/desserdirina/images/hero.jpg`, ecuson eliminat, copy Desserdirina/RO păstrat; oracle pixel nou (Vision OCR + hash) `bot/test/desserdirina-hero-no-desserd.test.js`. Review independent tester-qa — VERDICT ACCEPT (stranger walk izolat, OCR curat pe live 390 și editor mobile-preview). Fast-forward local `main`: 28ae336 → 4112579 (clean tree pe fișierele merge-ului; re-verificat independent pe main integrat: oracle pixel OK). Card nou de advocate full-pass t_bbe40180 dispatch-at pe 4112579 pentru runda următoare de verificare a întregului produs.
- Devil's advocate full-pass pe eed3ca0 a găsit inițial 3 defecte (hero clip, titluri legal, cookie overlap) — remediere ACCEPT (t_baac3c27). Un al doilea pass advocate (a045208) a găsit coliziune vizuală card cookie peste dock telefon/WhatsApp pe toate cele 5 sisteme. Remediere t_f88ad597: card cookie mutat bottom-left, non-overlap blocat cu oracle extins + screenshots proprii. Review independent t_bb48e298 (critic-gpt, browser real, 5 sisteme × desktop+390px) — VERDICT: ACCEPT (30d055e, fullpass-63230d2 defects=0/46). Fast-forward local `main`: 70a67b0 → 30d055e (clean tree, no push). Re-verificat independent post-merge pe main integrat: `FULLPASS defects=0 steps=46`.
- Full-pass QA (b9ec4bc, 63230d2 lineage) found 8 defects in one binding walk of all 5 template systems + chrome (leftover legal placeholder copy, wrong unpaid-export toast, broken/inconsistent WhatsApp QR, topbar label clip, cookie banner overlapping CTA, professionals seed broken images, self-contradictory trial-success dialog). Repair packet t_51164c5a fixed all 8 in one round; reviewer t_d159a0b0 (critic-gpt) — VERDICT: ACCEPT (isolated clone re-run of `bot/test/fullpass-63230d2.mjs`: defects=0/46 steps). Fast-forward merged locally to `main` (b9ec4bc..eed3ca0, clean tree, no push). Re-verified independently on integrated main post-merge: same oracle → `FULLPASS defects=0 steps=46`.
- S72-v2: wave7-legal-pages test oracle fixed to accept shipped Romanian legal titles (Termeni/Confidențialitate/Cookie-uri) — ACCEPT (test-only, no product change; recovered via provider fallback after gpt-5.6-sol/openai-codex quota exhaustion on t_3dc45a42, superseded/archived)
- Flow 4 E2E: stranger reopen after Cal.com clear-republish remake — ACCEPT
- OF-2 remake R3/R4: Stripe past_due webhook → export entitlement — ACCEPT
- Flow 3 E2E: stranger reopen after OF-2 export entitlement — ACCEPT
- Flow 2 replay: OF-1/OF-3/OF-4 (og:image, Details auto-open, WhatsApp QR) — toate ACCEPT

## Ultimul eveniment integrat (2026-09-05, HQ)

Calendar v2 step (c) part 2 (owner bookings dashboard + availability editor, t_2a215ec5 / review ACCEPT t_204a869a, SHA 5516dae) fast-forward integrat pe `main` local (main ahead 8, fără push). Verificat independent post-merge pe main integrat: `calendar-native-owner-dashboard.test.js` + `calendar-native-public-widget.test.js` + `calendar-native-tenant-isolation.test.js` pass 4/4; `fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`. Dashboard-ul owner rămâne o cale separată/nouă — formularul local de appointment-request (s70) e neschimbat și încă live. Fără Stripe/DNS/secrete/cal.diy atins. În paralel: worker `builder-spark` pe cardul S-legacy G3 a rămas blocat >20 min fără heartbeat de progres real (doar heartbeat-uri fără note) — reclaim manual + redispatch, run nou pornit. Worker `builder-backend` pe G1 a crash-uit de 2 ori consecutiv (`pid not alive`) fără nicio schimbare pe worktree — reassign + redispatch, run nou pornit.

## Notă operațională 2026-09-05 11:02 (HQ, fără impact produs)

`t_d240c9be` (S-legacy G3) rămăsese blocat pe `builder-spark` după 4 protocol_violation-uri consecutive (rc=0 fără kanban_complete/kanban_block) — reasignat pe `builder-grok`, dispatch manual, run nou confirmat activ (pid live) fără protocol_violation nou. `t_a8a026c4` (S-legacy G1) continuă pe `builder-backend`, al 8-lea run activ (anterioarele: 3× crash pid-not-alive, 3× protocol_violation rc=0 — cauză probabilă rate-limit HTTP 429 pe openai-codex, profilul `builder-backend` rulează concurent și pe boardul LMS separat consumând aceeași cotă); run curent confirmat activ, fără artefact nou de produs comis încă. Ambele worktree-uri conțin doar bytes din HEAD `cc716ce`/`3a6d92f`/`d64533f` (docs) — niciun defect de produs, doar reconciliere de oracle-uri legacy stale.

## Cron activ

- `Hidook Site Builder agency supervisor` (`0fa668624ebb`) — every 30m, deliver origin
- `Sitebuilder dispatch watchdog` (`88e0c0b42953`) — every 10m, script, no-agent

## Notă operațională 2026-09-04 19:37 (HQ, fără impact produs)

`t_7b6facca` (S-legacy reconcile: 22 fișiere oracle stale) a epuizat bugetul de iterații (543 evenimente, compactat de 3 ori) fără nicio schimbare de bytes pe HEAD `cc716ce` — închis ca `OPERATIONAL FAILURE; NOT semantic candidate/ACCEPT`, worktree curățat de artefacte laterale (cookie-banner.css/js, cookies/privacy/terms.html, .hermes/test-failure-logs — generate accidental de rularea testelor, nu produs). Review-ul asociat `t_a1fa2f82` blocat/superseded (nu avea ce revizui). Înlocuit cu **7 carduri micro-slice** (grup de 1-6 fișiere fiecare, aceeași bază `cc716ce`, builder-backend + critic-gpt read-only, aceleași reguli: nu atinge `bot/site-legal.js`/`fullpass-63230d2.mjs`, commit local fără push): G1 flow2 (5 fișiere), G2 flow4 (2), G3 sNN advocate/qa-fail chain (6), G4 s3/s48 design-system+editor (2), G5 s51/s53 renewal+placeholders (2), G6 s54/s55 photos (2), G7 s56/s58/builder-editor (3). G1 rulează acum; restul în coadă (cap 1/profil pe builder-backend, se promovează automat).

## Următorul pas sigur

După step (d) email harness pe `wt/calendar-v2-email` + review ACCEPT: pasul (e) cutover staged de la formularul local de cerere + QA/advocate full + proof-of-flow — **fără** cal.diy, **fără** Stripe/DNS/secrete producție până la owner gate. Nu reînvia carduri CalDiy arhivate ca path de produs.

- Continuă și cu următorul flow/task ready pe boardul `sitebuilder`, conform proces din `AGENTS.md`.
- `t_fdd0c989` (builder-backend): reconciliere oracle-uri legacy per-wave (inclusiv `templates-readme-commercial` vs Desserdirina aprobată în VISION §3) — track separat; nu atinge `bot/site-legal.js` sau `fullpass-63230d2.mjs`.

## Notă operațională 2026-09-05 12:05 (HQ, fără impact produs)

`t_a8a026c4` (S-legacy G1) a acumulat 7 run-uri eșuate consecutive pe `builder-backend` (crash pid-not-alive de 4 ori, protocol_violation rc=0 de 3 ori) — worktree conținea doar bytes din HEAD-ul de bază, niciun defect de produs, cauză operațională (probabil rate-limit openai-codex, profil partajat cu boardul LMS). Reasignat pe `builder-grok`, dispatch confirmat, run nou activ. `t_ebd5150d` (Calendar v2 step (d): email delivery boundary) rulează normal pe `builder-frontend` de la 11:57, heartbeat-uri regulate, review-ul `t_4adbbf5d` (critic-gpt) așteaptă în coadă.

## Ultimul eveniment integrat (2026-09-05 12:30, HQ)

Integrat local pe `main` (fast-forward + 7 merge-uri non-conflictuale, fără push): **Calendar v2 step (d) email delivery** (t_ebd5150d/t_4adbbf5d, ACCEPT, SHA 249038f — generic `EmailTransport` + harness local, copy RO honest pe stare, outbox cu retry/dead-letter, token vizitator single-booking-scoped) și cele **7 carduri S-legacy oracle reconcile G1–G7** (toate ACCEPT independent, fiecare scope exact pe fișiere de test disjuncte, `bot/site-legal.js`/`fullpass-63230d2.mjs` neatinse în toate): G1 flow2 (371f1ae), G2 flow4 (5a7474e), G3 sNN advocate/qa-fail (4afa3dd), G4 s3/s48 design-editor (3d5b921), G5 s51/s53 renewal/placeholders (384988f), G6 s54/s55 photos (d6b1e7c), G7 s56/s58/builder-editor (e6eb576). Re-verificat independent pe main integrat: `node --test bot/test/*.test.js` → 141 teste, 140 pass / 1 fail (singurul fail e `flow2-template-e2e-oracle.test.js`, gol de mediu preexistent — lipsește pachetul `playwright`, confirmat că lipsea și la părintele 4c920c4, nicio regresie de la merge); `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`; `calendar-native-*.test.js` 5/5 pass. `git diff --check` curat pe range. `main` ahead 24, fără push. Boardul `sitebuilder` e acum gol (0 ready/running/blocked reale, doar `t_a1fa2f82` blocat superseded fără candidat de revizuit). **Restant identificat pentru infra:** `playwright` lipsește din mediul local — necesar pentru a rula complet suita de teste E2E de produs; de instalat o singură dată (npm install, fără cost/secret), nu e blocaj de produs.

## Neautorizat fără aprobare separată

Push la producție dincolo de worktree-uri, deploy live, DNS, Stripe live product changes, credentials, modificare/integrare pilot Railway „Hidook Calendar” (cal.diy).

## PRODUSUL declarat — 2026-09-05 — **RETRAS 2026-09-06**

Owner a declarat Produsul la commit `884ce76` pe `main` (calendar nativ pașii a–e, ACCEPT chain, fullpass defects=0/46). Push efectuat pe ambele remote (`origin`, `hidook`) la cererea explicită a owner-ului.

**Retras după auditul end-to-end comandat de owner (2026-09-06, HEAD 2225ca7):** 17 agenți paraleli au deschis produsul ca un străin (browser real, chei de test, nu doar `fullpass-63230d2.mjs`) pe toate cele 5 șabloane + chrome + backend + plăți + calendar + Telegram + a11y + docs. Scor global **4/10**. Raport complet: `04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md` (+ `verdicts.json` per constatare). Defecte critice care invalidează declarația anterioară — fullpass-ul de 46 de pași NU acoperea aceste zone:

1. **Cont oricui poate fi preluat** — fallback-ul de autentificare fără `RESEND_API_KEY` răspunde cu token-ul de login în clar oricărui apel `POST /api/auth/email`.
2. **Facturare dublă orfană** — `paidUntil` nu e reîmprospătat la reînnoirea automată Stripe reală; clientul activ e etichetat "Expirat" și dashboard-ul îl împinge să deschidă un al doilea abonament peste primul.
3. **Codul QR WhatsApp (funcția-vedetă) nu e un cod QR valid pe niciunul din cele 5 șabloane** — verificat independent cu decodare Apple Vision, eșuată pe toate 5.
4. **Calendarul nativ nu pornește pe imaginea Docker documentată pentru producție** (Node 20, fără `node:sqlite`) — motorul de rezervări e cel mai bun cod din produs, dar mort la deploy real.
5. **`/sterge` (GDPR) nu șterge site-ul plătit de pe disc** — botul confirmă "am șters", site-ul rămâne live.
6. Plus: galerie foto ruptă pe 2/5 șabloane, hero dispare la orice editare pe desserdirina, "+ Adaugă" corupe DOM pe 2 șabloane, XSS stocat real în portfolio, zero rate-limiting/security headers/logout funcțional, 3/5 șabloane fără meniu mobil, monedă greșită dacă originea Railway nu stă în spatele Cloudflare.

**Cauză reală:** `fullpass-63230d2.mjs` (46 de pași, oracle de regresie folosit la fiecare ACCEPT) verifică fluxul comercial happy-path pe pixeli fixați, nu interacțiuni reale de proprietar (adăugare item, editare fundal, reîncărcare pagină după logout, reînnoire reală Stripe, decodare QR fizică). Fiecare ACCEPT anterior a fost real față de propriul scope îngust — dar scope-ul îngust nu acoperea produsul întreg. Nota de metodologie a auditului: faza de verificare adversarială independentă a fost oprită de owner din motive de cost — doar 3 din 152 constatări au a doua confirmare independentă (QR, 2 teste flaky, murdărire git); restul au dovadă (cod/captură/output) dar dintr-un singur lens.

**Acțiune:** Produsul rămâne **live** (nu s-a oprit/retras din producție — nicio acțiune destructivă), dar declarația de "gata" e retrasă până la un nou fullpass real care acoperă interacțiunile de mai sus. Remediere prioritizată: securitate + bani + funcția-vedetă (QR) + calendar Docker + GDPR delete întâi (0-4 săptămâni per foaia de parcurs din raport §9), apoi restul defectelor critice/high pe șabloane, apoi hardening. Fără Stripe live/DNS/secrete producție atinse de remediere.

## Remediere audit — progres (2026-09-06)

Integrat local pe `main` (ahead 6, fără push), verificat independent post-merge (`node --test bot/test/*.test.js` 143 pass / 2 fail preexistente flaky Brave — confirmate identice pe baza `675bc4a`, nicio regresie nouă; `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`; `git diff --check` curat pe range):

- **Finding #14 (critical, cont oricui poate fi preluat)** — SEC-01: `POST /api/auth/email` fără `RESEND_API_KEY` în producție nu mai întoarce token-ul de login (`devLink`) în clar; producție fără provider → `{ok:true, sent:false}` fără token, log de eroare. ACCEPT independent (53f2a74), merge 1f04860.
- **Finding #8 (critical, facturare dublă orfană)** — PC-01: reînnoirea automată reală Stripe (`invoice.payment_succeeded`/`invoice.paid`) extinde acum `paidUntil` idempotent, reactivează site-ul dacă era expirat; corectat ulterior (remediere v2, ACCEPT e284e57) să NU extindă un `paidUntil` deja neexpirat în primul an (ar fi dat ~24 luni de hosting pentru un ciclu de 12 luni). Merge 1f0effd.
- **Finding #1 (critical, VERIFICAT independent, codul QR WhatsApp nu e valid)** — QR-01 dispatch-at (`t_9e49cb76`, builder-backend, worktree `qr-01-whatsapp-qr`): înlocuiește encoder-ul QR hand-rolled duplicat pe toate cele 5 șabloane cu unul corect + oracle care decodează efectiv QR-ul generat (nu doar verificare vizuală). Review independent blocat pregătit (`t_b2c81f5a`).

Rămân din raport (netratate încă, ordine sugerată din §9 al raportului): calendar nativ nemobil pe imaginea Docker de producție (finding #4/#12), `/sterge` GDPR nu șterge site-ul de pe disc (finding #5/#13, **dispatch-at acum**, vezi mai jos), lipsă rate-limiting + security headers + logout funcțional (findings #14b/#23/#24/#15), plus restul defectelor critice/high per șablon (galerie/lightbox, hero desserdirina, "+ Adaugă" corupe DOM, XSS portfolio, meniu mobil lipsă pe 3/5).

## Ultimul eveniment integrat (2026-09-06 08:14, HQ)

**QR-01 integrat local pe `main`** (t_9e49cb76/t_b2c81f5a ACCEPT, SHA `c9a6373`, merge `e488096`, main ahead 9, fără push): encoder QR hand-rolled duplicat pe toate cele 5 șabloane înlocuit cu unul corect; oracle nou decodează efectiv QR-ul generat (nu doar verificare vizuală) via Apple Vision. Verificat independent post-merge: `node bot/test/qr-01-whatsapp-qr-valid.test.js` PASS pe toate 5; `node --test bot/test/*.test.js` → 143 pass / 2 fail (exact cele 2 preexistente flaky, nicio regresie nouă); `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`. Aceasta închide **finding #1 (critical, VERIFICAT independent)** din audit — funcția-vedetă WhatsApp QR e acum un cod QR real. Curățare worktree: fișiere laterale generate accidental de rulări de test anterioare (cookie-banner.css/js, cookies/privacy/terms.html rădăcină) șterse — nu erau produs, doar artefacte de test.

**Dispatch nou:** `t_d151412c` (builder-backend, worktree `audit-05-sterge-unpublish`) — finding #13 (critical): `/sterge` (GDPR) din Telegram bot confirmă ștergerea dar nu apelează `webpublish.unpublishSite()`, site-ul plătit rămâne live pe disc. Review independent blocat pregătit: `t_04712b63`.

## Ultimul eveniment integrat (2026-09-06 09:10, HQ)

**AUDIT-05 integrat local pe `main`** (t_d151412c/t_04712b63 ACCEPT, SHA `0f042fd`, merge `c5f818f`, main ahead 12, fără push): `handleSterge()` apelează acum `webpublish.unpublishSite()` pentru fiecare site deținut înainte de `registry.updateSite()` — GDPR delete elimină efectiv site-ul plătit de pe disc, nu doar înregistrarea. Verificat independent post-merge: `node --test bot/test/*.test.js` → 144 pass / 2 fail (exact cele 2 flaky preexistente, nicio regresie nouă); `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`; `git diff --check` curat pe range. Aceasta închide **finding #13 (critical)** din audit. Worktree curățat de PNG-uri/artefacte regenerate de rulările de test (nu produs).

**Dispatch nou (3 workeri activi în paralel):**
- `t_e7e92cff` (critic-1, review) — XSS-01 portfolio icon href sanitize fix (t_c502c30c, ACCEPT candidat SHA `4aa8eed`) — finding #10 critical, sink SVG normalizat contra bypass tab/CR/entity-reference + allowlist.
- `t_fd1feeb0` (builder-backend, worktree `audit-06-desserdirina-hero-bg`) — finding #5 critical: hero background dispare pe desserdirina după orice editare (`background-image` invalid vs `background` shorthand folosit corect de celelalte 4 șabloane).
- `t_7ed5d1d5` (builder-frontend, worktree `audit-07-logout-invalidate`) — finding #15 critical/high: logout nu invalidează sesiunea server-side, cookie-ul vechi rămâne valid până la 30 zile.

Rămân netratate din audit (ordine sugerată din §9): #14b security headers, #23 rate-limiting `/api/auth/email`, #8 monedă USD fără Cloudflare în față pe Railway, #1 lightbox galerie rupt (2 șabloane), #4 "+ Adaugă" carduri goale/DOM corupt (2 șabloane), plus restul high-urilor pe șabloane individuale. Board rămâne activ, cap 1/profil, se promovează automat pe ACCEPT.


## Ultimul eveniment integrat (2026-09-06, val de remediere audit — 8 branch-uri)

**8 branch-uri de remediere a auditului integrate local pe `main`** (merge-uri `c12d3bd`..`00edfbc`, fără push). Lucrate în paralel de 8 agenți Sonnet cu proprietate exclusivă pe fișiere, ca să nu intre peste branch-urile deja în zbor ale boardului. Fiecare fix are oracle propriu, verificat roșu înainte și verde după, plus capturi înainte/după în `04-QA-Evidence/Audit-Fixes-2026-09-06/` (80 de capturi).

**Ce s-a închis din audit:**
- **PORT-01 / PM-01 (critical):** lightbox-ul galeriei era complet nestilizat pe Salon și Restaurant (`position:static`, sub footer) — click pe o poză rupea pagina în loc să deschidă vizualizatorul. Reguli CSS adăugate, modelate pe implementarea funcțională din desserdirina/local-service, adaptate paletei fiecărui șablon.
- **PM-02 / prof-01 / prof-02 (critical/high):** cauza rădăcină a cardurilor goale — `findListItemContainer()` alegea primul strămoș care conținea câmpurile itemului, care pentru un item cu un singur câmp text era ambalajul interior, nu cardul. De aici butonul „×" inaccesibil (container 0x0) și butonul „+ Adaugă" grefat înăuntrul cardului nou. Reparat prin urcarea containerului până la ultimul strămoș exclusiv al itemului.
- **PORT-02 (high):** categoriile de galerie pe Salon sunt ascunse condiționat (`@if title`), deci un item nou creat cu toate câmpurile goale nu randa niciun nod editabil. Reparat în `onListAdd` prin seed cu text real, românesc, per vertical. Descoperit pe drum și corectat: `onListAdd` scria literalmente `New section`/`New item`, două texte pe care `fullpass-63230d2.mjs` le listează ca text de fabrică interzis. Partea engleză a meniului bilingv păstrează intenționat wording englezesc, conform `s63-owner-builder-gaps.test.js`.
- **F2 (critical):** formularul de programare de pe Professionals afișa succes fals pe orice export self-hosted — cauza era condiționarea trimiterii pe potrivirea căii `/live/<slug>/`, pe care un export nu o are niciodată. Acum orice origine `http(s)` încearcă trimiterea reală; la eșec apare o stare onestă în română, cu telefonul și WhatsApp-ul afacerii, fără să ascundă formularul.
- **PM-03 (high):** CTA-ul din hero pe Restaurant rămânea transparent — coliziune de specificitate, rezolvată prin scoaterea clasei redundante `hero-cta`.
- **PM-04 / PORT-03 / prof-03 (high):** meniu mobil inexistent pe 3 din 5 șabloane. Hamburger accesibil adăugat pe fiecare: `aria-expanded`, `aria-controls`, operabil cu tastatura, Escape închide și readuce focusul, ținte de minim 44x44px.
- **A11Y-01 / A11Y-02 (high):** niciun modal din builder nu captura focusul (Tab ieșea în editorul din spate pe 13-14 din 15 apăsări) și `#modal-instagram` nu se închidea cu Escape. Focus trap adăugat în `openModal`/`closeModal`, deci acoperă toate cele 6 modale dintr-un punct.
- **F4 / PORT-04 (high):** cascada de redenumire făcea înlocuire de text peste `seo.jsonLd` serializat, deci un nume cu ghilimele sau backslash spărgea JSON-ul și site-ul live rămânea cu `<script type="application/ld+json">` gol. Acum se parsează, se rescriu valorile ca obiect, se re-serializează. `team.title` adăugat în cascadă, deci nu mai rămâne „Echipa Atelier Ivoire" pe site după redenumire.
- **BE-01 / BE-02 / BE-04 / PERF-03 (high):** rate-limit pe `POST /api/auth/email` (5/email, 20/IP pe oră, mesaj RO cu `Retry-After`); headere de securitate pe toate rutele, cu CSP separat pentru `/app/` (păstrează `unsafe-eval`, necesar pentru încărcarea lazy a șabloanelor prin `new Function`) și unul mai permisiv pentru site-urile publicate; listă de sloguri rezervate (`admin`/`api`/`app`/`www`); compresie gzip (`app.js` 167KB → 43KB, verificat că decomprimă identic).
- **PC-02 / PC-03 / F3 (high):** bucketul de monedă cădea pe USD pentru orice client real, pentru că depindea exclusiv de `CF-IPCountry`, pe care Railway nu îl trimite — adăugat fallback pe `Accept-Language` plus avertisment la boot în producție când headerul lipsește; `unpaid` și `incomplete_expired` dezabonează acum site-ul, nu doar `canceled`/`deleted`; `og:image`/`twitter:image` devin absolute la publicare, deci previzualizarea la distribuire se încarcă.

**Regresii prinse la integrare și reparate (nu de agenții care le-au cauzat, ci la verificarea pe arborele complet):**
- `wave11-html-export` pica: `unpaid` trecut pe calea de dezabonare nu mai sincroniza câmpul legacy `subscriptionStatus`, care înainte era scris pe calea normală. Reparat la cauză în `unpublishSite()`, niciun test slăbit.
- `qr-01-whatsapp-qr-valid` se bloca: oracle-ul aștepta primul `a[href*="wa.me"]` din pagină, iar noul buton WhatsApp din panoul de eroare al formularului (ascuns corect până la un eșec) ajunsese primul în DOM. Selectorul cere acum primul control **vizibil** — aceeași clasă de defect corectată anterior pe oracle-ul de 390px.
- `flow2-professional-appointment-ro` fixa cuvânt cu cuvânt vechiul mesaj de eroare, înlocuit de copy-ul onest livrat acum. Literalul așteptat actualizat, aserțiunea rămâne la fel de strictă.
- `s63-owner-builder-gaps` blochează `New section`/`New item` ca implicite pentru `menu.en`. Contradicție reală între două oracle-uri din repo, invizibilă până acum pentru că niciun test nu apăsa butonul de adăugare. Rezolvată în favoarea ambelor: engleză pe partea engleză, română pe partea română.

**Verificat independent post-merge pe `main` integrat** (worktree curat, nu arborele de lucru): `node --test bot/test/*.test.js` → **154 teste, 152 pass, 2 fail** — exact cele 2 flaky preexistente (`advocate-eed3ca0-repair`, `mobile-chrome-390-aabb`, ambele hardcodate pe Brave dintr-o cale specifică mașinii), identic cu starea de pe `main` înainte de val, nicio regresie nouă. `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`. 12 fișiere de test noi sau actualizate.

**Hazard operațional descoperit, de scris ca regulă:** `git stash` folosește un ref partajat (`refs/stash`) între toate worktree-urile aceluiași repo, nu unul per worktree. Cu 8 agenți lucrând simultan, patru și-au luat munca unul altuia la `stash pop`. Niciunul n-a pierdut nimic — au etichetat munca străină `RECOVERED-NOT-MINE` și și-au reconstruit-o pe a lor — dar stiva de stash conține încă intrări reziduale din acest val. **Recomandare pentru `AGENTS.md`:** niciun agent care lucrează într-un worktree partajat nu folosește `git stash` pentru comparații înainte/după; se folosesc copii de fișiere (`git show HEAD:<path> > tmp`) sau `git checkout -- <path>` țintit.

**Neatins deliberat:** cele 3 branch-uri deja în zbor pe board (`xss-01-portfolio-icon`, `audit-06-desserdirina-hero-bg`, `audit-07-logout-invalidate`) — nu s-a lucrat pe fișierele lor, ca să nu apară conflicte de integrare. **Telegram (`bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`) e înghețat prin decizie explicită a owner-ului din 2026-09-06** — canalul urmează să iasă din produs, deci constatările de audit pe Telegram rămân amânate, nu rezolvate.

**Rămân netratate din audit, în ordinea recomandată:** calendarul nativ care nu pornește pe imaginea Docker de producție (Node 20 fără `node:sqlite`); primul load al unui șablon la 8-12s față de ținta de 3s; fonturile Google încărcate fără consimțământ pe desserdirina (expunere GDPR reală în UE); emailul scris în clar în loguri la fiecare autentificare; CORS deschis fără rate-limit pe `/api/calendar-native/*`; `invoice.payment_failed` netratat; etichetele greșite din `/admin` pentru `past_due`/`unpaid` (descrise exact în raportul agentului comercial, în `bot/server.js:423-486`); registry-ul pe un singur fișier JSON; 358MB de capturi QA comise în git.

## Ultimul eveniment integrat (2026-09-06, valurile 4-8 + re-audit independent)

**80 de commit-uri locale pe `main`, fără push.** Suita: **330/331**, singurul eșec fiind
`flow3-legal-export`, oracle-ul deliberat specific Brave, roșu și la începutul zilei. Suita a
crescut de la 172 la 331 de teste.

### Re-auditul independent — scoruri măsurate

Cinci lentile, fiecare reproducând în browser real sau pe suprafața HTTP reală, fiecare cu o
listă explicită a ce **nu** a apucat să acopere. Rapoartele: `04-QA-Evidence/Reaudit-2026-09-06/`.

| Zonă | Audit 2225ca7 | Re-audit |
|---|---|---|
| Performanță | 4 | **9** |
| local-service | 6 | **9** |
| product-menu | 4 | **8** |
| Builder UX | 6 | **8** |
| Backend | 6 | **7** |
| Export/renderer | 6 | **7** |
| Documentație | 4 | **6** |
| Deploy/infra | 3 | **6** |
| Accesibilitate | 5 | **6** |
| Plăți | 3 | **5** |
| Securitate | 4 | **5** |

Performanța: **1,35–2,36s** de la click pe „Start" la editor funcțional, față de 7,8–11,7s la
audit și o țintă de 3s. LCP 2,1s, CLS 0.

**Notă de onestitate:** desserdirina (4), portfolio (6) și professionals (7) au fost punctate
**înainte** de valul care le-a reparat defectele. Nu au fost re-măsurate; nu li se atribuie
scoruri noi aici.

### Ce a demonstrat re-auditul

**Patru constatări raportate ca reparate nu erau.** XSS-ul din sink-ul de iconițe (spart printr-un
bypass cu entități denumite la o oră după fixul din aceeași zi — al treilea fix pe același loc,
rezolvat acum prin **listă albă de scheme** în loc de listă neagră); `POST /api/auth/logout` care
nu exista deloc; garda contra dublei facturări, prezentă pe calea butonului de reînnoire și absentă
pe calea de republicare; țintele de atingere de 24px, reparate în CSS-ul unui șablon în loc de
componenta partajată.

**Patru funcționalități plătite, inaccesibile oricărui client:** calendarul nativ (patru valuri de
lucru, niciun comutator și niciun panou), domeniul custom, istoricul de facturi, starea de plată
eșuată. Două dintre ele livrate în aceeași zi. Toate cu suita verde, pentru că testele apelau API-ul.
Regula scrisă în `AGENTS.md`.

### Defecte latente găsite la integrare, nu de agentul care scria codul

- **Selectorul cu prefix de text** din `edit-overlay.js`: `[data-hb-edit^="pricing.1"]` prinde și
  `pricing.10`. Orice listă, pe orice șablon, se strica la al unsprezecelea element. Portfolio
  livrează exact 10 rânduri de preț, deci acolo a devenit vizibil primul.
- **Injecția scriptului de preview** folosea `replace('</body>')` — prima potrivire. Un comentariu
  care cita eticheta a capturat injecția și a omorât **întregul editor inline** pe professionals,
  fără niciun log.
- **1244 de linii de encoder QR mort** pe toate cele 5 șabloane, livrate pe fiecare site publicat.
- **Republicarea ștergea tăcut domeniul custom** din canonical, og:url, robots.txt și sitemap.xml.
- **Linkul de anulare din emailurile de rezervare** pleca spre `http://127.0.0.1:0`. Confirmat viu
  în producție: `PUBLIC_URL` e setat, `CALENDAR_PUBLIC_BASE_URL` nu.
- **`GO-LIVE.md` cerea backup la `.registry.json`**, fișier șters de migrarea pe SQLite.
- **Un oracle care pica mereu** (`wave5-builder-undo-redo`, selector greșit) a fost înregistrat de
  trei valuri ca „instabilitate cunoscută". Un test care pică mereu îi învață pe oameni să-l ignore.

### Producție, citită din serviciul viu

Workspace `My Projects`, proiect `grateful-fascination`, serviciu `lp-builder1-hidook-agency`.
Build **Dockerfile**. `DATA_DIR=/data` pe volum montat. `PUBLIC_URL=https://lp.hidook.agency`.
`DEPLOY_PROVIDER=cloudflare`. Ultimul deploy: **2026-09-05 23:54** — producția rulează codul de
dinaintea acestei zile. Detalii în `ARCHITECTURE.md` §10b.

### Curățenie

213 → 31 worktree-uri, **39 GB recuperați**, după verificarea celor 20 de branch-uri nemerge-uite,
care au fost păstrate. Regula de ordine e în `AGENTS.md`.

### Ce rămâne pentru 9/10

1. Re-audit al zonelor reparate după măsurătoare: desserdirina, portfolio, professionals, securitate, plăți.
2. Securitate: rate-limiting ocolibil prin `X-Forwarded-For` (fără listă de proxy de încredere); CSP permisiv pe site-urile publicate.
3. Plăți: TVA rămâne oprit până la configurarea Stripe Tax în Dashboard; patru întrebări pentru contabil în `OWNER-STRIPE-TRIAL.md`.
4. Un deploy. Nimic din ziua asta nu a ajuns la clienți.

## Ultimul eveniment integrat (2026-09-06, valul 3 de remediere audit — 12 agenți)

**12 branch-uri integrate local pe `main`** (`8b82280`..`5a2e0f1`, fără push). Agenți Sonnet în
worktree-uri izolate, proprietate exclusivă pe fișiere. Suita: **245/247**, singurul eșec fiind
`flow3-legal-export`, oracle-ul deliberat specific Brave, preexistent la `2225ca7`.

**Ce s-a închis:** SEO tehnic complet pe fluxul web (canonical, og:url absolut, JSON-LD,
robots.txt, sitemap.xml, pe live ȘI pe export); timeout pe fiecare apel către provideri;
`invoice.payment_failed` cablat; erori de plată în română; undo/redo cu plafon de 40 pași sau 15MB;
avertisment la două tab-uri; acces la cont din editor; fonturi self-hostate pe desserdirina (GDPR,
OFL 1.1, zero cereri către Google dovedit); remindere de programare, `.ics` conform RFC 5545,
fereastră de preaviz; backup/restore SQLite **dovedit prin distrugerea bazei și restaurarea ei**;
`/health/ready` care chiar verifică dependențele; ARCHITECTURE.md, BACKUP-RESTORE.md, CHANGELOG,
LICENSE; CLS 0,18 → 0 pe Restaurant și 0,019 → 0 pe Profesionale; contrast AA și ținte de atingere
pe toate șabloanele.

**Defecte găsite la integrare, absente din rapoartele agenților:**

- **XSS-ul din constatarea #10 era raportat închis și nu era.** Cinci variante obfuscate
  (`jav<TAB>ascript:`, CR, LF, `&#106;`, `&#x6a;`) executau în Chromium prin fluxul real de
  publicare. Filtrul verifica textul sursă; browserul execută textul normalizat. Reparat în
  motorul partajat, verificat izolat cu apărarea din client dezactivată.
- **Editorul inline era complet mort pe Profesionale.** `renderPreview` injecta overlay-ul cu
  `html.replace('</body>', ...)`, care înlocuiește prima apariție; un comentariu care explica un
  fix cita eticheta, iar tot editorul a fost injectat în interiorul comentariului. Niciun log,
  niciun simptom care să arate cauza. Injecția de mai jos, pentru paginile legale, folosea deja
  `lastIndexOf` cu un comentariu care descria exact acest pericol — nimeni nu generalizase.
- **1244 de linii de encoder QR mort** pe toate cele 5 șabloane: valul QR a adăugat suprascrierea
  cu biblioteca MIT, dar n-a șters encoderul cu tipare de detecție corupte, care se livra în
  continuare pe fiecare site publicat.
- **85 de fotografii** coborâte sub pragul de calitate de valul de performanță, nu una singură
  (oracle-ul se oprea la primul eșec).
- **`fonts/` nu ajungea pe site-ul publicat**: ambele bucle de copiere tratau doar `images/`, deci
  fixul GDPR ar fi livrat reguli `@font-face` fără fișiere, tăcut.
- **Câmpurile de eșec la plată erau acceptate și aruncate** de lista albă din `updateSite`.
- **`GO-LIVE.md` cerea backup la `.registry.json`**, fișier care nu mai există după migrarea pe
  SQLite — cine urma runbook-ul pierdea totul la restaurare.

**Oracle-uri care se auto-invalidau la merge:** opt verificări „roșu-înainte" citeau versiunea
veche prin `git show HEAD`. După integrare HEAD devine codul reparat, deci picau pentru motivul
greșit. Fixate pe commit-ul de bază, cu suprascriere din mediu. Unul dintre ele — cel care apăra
constatarea critică #6 — **nu rula deloc**: extrăgea funcții din `builder/app.js` într-un sandbox
căruia îi lipseau dependențe noi, deci toate cele 5 verificări cădeau cu `ReferenceError`, nu cu
o aserțiune.

**Descoperire:** constatarea critică #6 nu mai e reproductibilă nici cu schema veche — `onListAdd`
a fost întărit independent între timp. Normalizarea cheii și acea întărire sunt acum două apărări
independente; aserțiunea a fost inversată ca să fixeze exact asta.

**Atribuire corectată:** CLS-ul de 0,20/0,17 din raport venea dintr-o singură măsurătoare pe un
site Restaurant, generalizată la tot produsul. Pe Meserii era deja practic zero înainte de orice
schimbare. Numărul era real, atribuirea nu.

## Ultimul eveniment integrat (2026-09-06, valul 2 de remediere audit + reconciliere)

**5 branch-uri de val 2 + plasa de siguranță pentru stocare, integrate local pe `main`** (fără push).
Aceeași metodă ca la valul 1: agenți Sonnet în worktree-uri separate, proprietate exclusivă pe
fișiere, oracle propriu per fix verificat roșu-înainte / verde-după. De data asta li s-a interzis
explicit `git stash`, după coliziunile din valul 1.

**Ce s-a închis:**
- **CAL-001 (critical):** calendarul nativ nu putea porni pe imaginea de producție. `node:sqlite`
  lipsește pe Node 20 și pe 22.11, e disponibil nativ pe 22.20. Dockerfile pinuit pe
  `node:22.20.0-alpine` cu `NODE_OPTIONS=--experimental-sqlite` ca plasă. Dovedit rulând serverul
  real pe binarul respectiv, nu prin presupunere.
- **DI-01 / DI-03:** contextul de build scăzut cu 423 de fișiere și 138MB (dovezi QA, guvernanță,
  deliverables, `.worktrees`); `healthcheckPath` în railway.json; workflow GitHub Actions care
  rulează suita, fără `|| true` global.
- **CAL-002 / CAL-003:** vizitatorul poate reprograma prin linkul din email, cu aceleași garanții
  de slot ca la rezervare (refuz înainte de orice scriere dacă slotul e prins, rezervarea existentă
  dovedit neatinsă); retenție PII la 24 de luni, idempotentă, plus ștergere anticipată la cererea
  proprietarului. Cele două rute au fost montate ulterior în `bot/server.js` de integrator.
- **SEC-05 / BE-11 / BE-07 / BE-09 / BE-10 / PC-03(admin) / PERF-05:** CORS restrâns pe endpoint-urile
  publice de calendar plus rate-limit real; email mascat în loguri (prefix + domeniu + hash pentru
  corelare); coduri HTTP corecte pe „nu e situl tău”; funcție duplicată eliminată; etichete oneste
  în `/admin`; ETag + revalidare pe `/api/templates`.
- **DSD-02 (critical):** cauza rădăcină era un nume de cheie divergent — `templates/desserdirina/schema.json`
  folosește `itemSchema`, celelalte patru `itemShape`. `onListAdd` citea doar `itemShape`, deci
  elementul nou se crea ca string gol, nu primea `data-hb-edit`, iar butonul „×" rămânea legat de
  categoria 0. Clientul credea că șterge cardul gol și ștergea categoria reală cu pozele ei.
  **De curățat separat:** normalizarea cheii în schema desserdirina, ținută atunci de alt branch.
- **Banner cookie în canvas + PORT-05:** consimțământul din previzualizare se ține acum între
  re-renderuri prin postMessage (iframe-ul e sandbox fără `allow-same-origin`, deci `localStorage`
  eșua tăcut la fiecare `srcdoc` nou); randările se serializează, eliminând cursa dintre schimbarea
  de poză și cea de culoare (`overlapCount` 2 → 0).
- **Documentație:** comanda de test corectată în 3 locuri + script `npm test`; VISION.md adăugat ca
  sursă de adevăr în README și în docs-urile operaționale; PRODUCT.md descrie calendarul nativ;
  OWNER-CALENDAR-CAL-DIY.md marcat SUPERSEDAT; pasul lipsă `npm run build:app` adăugat în onboarding
  — fără el serverul răspunde 200 cu shell-ul SPA și catalogul eșuează tăcut, blocajul real pe care
  îl lovea oricine urma documentația.
- **Finding #2 din audit (infrastructură de test):** șase oracle-uri hardcodau calea Brave a acestei
  mașini. Pinuite pe Chromium-ul din `node_modules`, Brave devine opt-in prin `HIDOOK_BROWSER_PATH`.
  Două teste purtate ca „fragile cunoscute” trec acum curat.

**Coliziuni de comportament prinse doar la integrare** (fiecare agent avea dreptate separat):
- Runda 2 a dat `/api/templates` un flux ETag care scria răspunsul singur și ocolea compresia
  adăugată de runda 1 — cel mai mare JSON al produsului rămânea singurul necomprimat. Reunificat.
- Cele două runde au citit PC-03 diferit: una „zero aplicare” (a făcut `unpaid` să dezaboneze),
  cealaltă „zero vizibilitate” (a reparat etichetele `/admin`, cu test care cerea ca `unpaid` să
  rămână live). **Comportament stabilit:** `past_due` ține site-ul live cât Stripe reîncearcă;
  `unpaid` și `incomplete_expired` sunt terminale și dezabonează. Scenariul rundei 2 folosește acum
  `past_due`; aplicarea pentru `unpaid` rămâne acoperită de `audit-payments-publish.test.js`.

**Verificat independent post-merge pe `main` integrat** (worktree curat): `node --test bot/test/*.test.js`
→ **168 teste, 167 pass, 1 fail**; `node bot/test/fullpass-63230d2.mjs` → `FULLPASS defects=0 steps=46`.
Singurul eșec e `flow3-legal-export.test.js`, oracle **intenționat** specific Brave (verifică
`data:text/html target=_blank`): 2 din 4 verificări Brave pică așteptând bannerul de consimțământ,
pe care Brave 150 îl randează intermitent la 0x0 pe al doilea șablon deschis într-o sesiune.
Reprodus identic la `2225ca7`, deci preexistent. Afectează previzualizarea din editor, nu
site-urile publicate. Evoluție: 140/142 la audit → 152/154 după valul 1 → **167/168** acum.

**Corecție la raportul de audit:** constatarea **PS-01 (critical)** — „editorul nu are model de
document, inline-edit prin regex" — a fost **INFIRMATĂ**. `injectDataHb()` e cod mort, neapelat
nicăieri; calea vie e `renderPreview(..., {editMode:true})`, care emite `data-hb-edit` la randare,
din token, cu calea exactă. Probă empirică: 99 de noduri editabile pe professionals, inclusiv valori
sub 3 caractere și pur numerice (pe care regex-ul le sărea explicit) și toate aparițiile textelor
duplicate. Agentul confirmase încrucișat cu VISION §4.6, care era stale — două surse învechite care
se confirmă reciproc produc încredere falsă. Detalii în `04-QA-Evidence/Audit-2026-09-06-2225ca7/CORECTII.md`.
Consecință: nu se reconstruiește editorul; se construiesc funcționalitățile care chiar lipsesc
(undo/redo, secțiuni adăugabile/ștergibile/reordonabile). Decizie owner 2026-09-06.

**Defecte latente descoperite de plasa de siguranță**, absente din audit, reproduse independent:
- `createSite` cu slug explicit **nu verifică unicitatea** — două site-uri pot lua aceeași adresă
  publică. Azi apărat doar de apelanții din `bot/server.js`; `bot/flow.js` nu verifică.
- `addMonthsIso` pe o dată neparsabilă **cade tăcut pe „acum"** și acordă un an de drept comercial,
  în loc să refuze.
- `claimStripeEvent` cu id gol sau absent **întoarce mereu `true`** și nu înregistrează nimic, deci
  idempotența webhook-urilor se dezactivează tăcut pentru evenimente malformate.
Plus: `updateSite` acceptă și persistă orice cheie străină; `kind` necunoscut la comandă devine tăcut
`publish`. Toate fixate ca atare în `bot/test/registry-characterization.test.js` (158 aserțiuni,
9/10 mutanți prinși) și de reparat în etapa 2 a stocării, ca schimbări explicite de comportament.

**Telegram rămâne înghețat** prin decizia owner-ului din 2026-09-06 — niciun fișier atins în acest val.

---

## Noaptea 2026-09-06 → 07 — Valul B: aspect, accesibilitate, secțiuni

Obiectivul owner-ului: constructorul să arate și să se simtă de nivel top, gata de push dimineața.

### Ce s-a reparat, cu măsurători

**Contrastul eroului peste fotografia proprietarului.** Trei șabloane pun text alb direct pe o poză
și se bazează pe un văl de gradient. Un văl potrivit pe poza din depozit nu e o garanție de contrast
— e un pariu pe acea poză, iar editorul îl invită pe proprietar s-o înlocuiască pe primul ecran.
Măsurat pe pixeli randați, în spatele glifelor:

| | înainte | după |
|---|---|---|
| portfolio, poza proprie | **1,94:1** (p10) | 7,20:1 |
| portfolio, poză deschisă | 1,40:1 | 5,28:1 |
| local-service, poza proprie | 10,08:1 | 15,97:1 |
| local-service, poză deschisă | **1,84:1** | 7,98:1 |

Pragul WCAG 1.4.3 pentru text de mărimea asta e 3:1. **portfolio pica pe fotografia din propriul
depozit** — prin două audituri, o notă de 6/10 și un oracol de contrast care eșantiona o zonă mai
întunecată a aceluiași erou și trecea. Reparat prin greutatea vălului existent, nu printr-un scrim
pe blocul de text: acela măsura impecabil și arăta ca un dreptunghi negru lipit pe poză.
`waveB-hero-contrast-any-photo` măsoară ambele condiții și ține `professionals` ca martor pozitiv.

**Ținte de atingere.** Fiecare șablon avea între 11 și 19 elemente interactive sub 44px, iar câteva
sub pragul de conformitate: linkurile din bara de navigație randau **17px înălțime** — text fără
padding — sub minimul de 24×24 din WCAG 2.5.8 (nivel AA), pe navigația principală a site-ului unui
client plătitor. Butonul de consimțământ măsura 83×33 pe telefon și era vopsit în verdele WhatsApp,
împrumutat de la butonul de chat din colțul opus, pe orice paletă. Acum 24px podea dură pentru orice
țintă de sine stătătoare, 44px pentru navigație și butoanele de acțiune. Linkurile inline într-o
frază sunt lăsate în pace — 2.5.8 le exceptează, iar încadrarea lor ar rupe paragraful.

*Corecție proprie:* am scris inițial că 44px e minimul din WCAG 2.5.8. Nu e — 2.5.8 e nivel AA la
24×24, iar 44×44 e 2.5.5, nivel AAA (și cifra din ghidurile iOS/Android). Reparația rămâne validă,
formularea a fost corectată în cod și în oracol.

**Secțiuni de pagină pe toate cele cinci șabloane.** Funcționalitatea era construită complet — motor,
panou în sertar, metadate în schemă — și accesibilă pe **un singur** șablon din cinci. Celelalte patru
nu aveau `id` pe secțiunile de nivel superior. Două au cerut restructurare reală: `reorderSections()`
refuză să reordoneze dacă găsește conținut între secțiuni (altfel l-ar șterge tăcut), deci markup-ul
unui `<div>` învelitor era destul ca funcționalitatea să fie moartă în liniște.

**Editorul pe telefon.** Prima oară când cineva l-a condus la 390×844 cu atingeri reale: butoanele
barei se suprapuneau peste cele din stânga, iar o apăsare pe comutatorul de previzualizare **expira
după 30 de secunde** fiindcă un `<svg>` suprapus îi înghițea evenimentul. Pe un telefon adevărat,
asta e un client care apasă și nu se întâmplă nimic.

**Professionals pe mobil.** Bannerul de cookie-uri acoperea ultima linie a eroului. Prima încercare
— degajarea partajată — a mutat cutia cu 0px. Măsurătoarea a explicat de ce: degajarea funcționează
adăugând spațiu *sub* copy, ceea ce ridică textul doar la eroii care își centrează conținutul.
Acesta e ancorat sus și mai înalt decât ecranul. Cauza reală era `padding-top: 5rem` de desktop,
purtat neschimbat pe un ecran de 678px.

### Lecții care merită păstrate

- Un oracol care își verifică propriul RED citind `git show HEAD:` e verde exact o dată: în arborele
  în care a fost scris. La primul commit, HEAD devine noua versiune și RED-ul se inversează. Se
  fixează un SHA.
- Comentariile din `COOKIE_BANNER_CSS` se livrează **verbatim pe fiecare site publicat**. Un cuvânt
  dintr-un comentariu despre culoarea unui buton a picat un contract de conținut pe previzualizare.
  Explicațiile stau în modul, nu în șirul livrat.
- Cromul editorului nu are voie să re-așeze tăcut ceea ce previzualizează: înălțimea iframe-ului
  *este* viewport-ul în care se așază site-ul generat, deci un padding pe canvas mută în sus tot ce
  e fixat de jos.

