# Hidook Site Builder — PROJECT_STATUS

Actualizat: 2026-09-04 (Fix leak: comentariu CSS intern cu numele de cod al template-ului "desserdirina" ajungea în HTML exportat/live pentru orice client — reparat, integrat pe main la 4578a2f)

## Status authority

Acest fișier e registrul canonic "unde suntem acum" pentru Site Builder. Se actualizează după fiecare: card Kanban `done` cu VERDICT: ACCEPT, gate de design/arhitectură închis, Decizie a owner-ului, livrare (Produsul), sau escaladare de code-review după 2 cicluri eșuate. `VISION.md` rămâne sursa de adevăr pentru CE e produsul; acest fișier spune UNDE suntem cu implementarea lui.

## Canonical workspace

- Root: `/Users/Work/Desktop/sitebuilder`
- Repo: `github.com/gorbenco03/sitebuilder` (+ remote `hidook`: `NikuX/lp-builder1-hidook-agency`, ambele pe `main`)
- VISION.md: `/Users/Work/Desktop/sitebuilder/VISION.md` (sincronizat 2026-09-01)
- AGENTS.md: `/Users/Work/Desktop/sitebuilder/AGENTS.md`
- Board Kanban: `sitebuilder`

## Fază curentă

Live / în producție. Modelul comercial (Stripe trial 7 zile, 99 EUR/GBP/USD, renewal 29/an) e activ. Nu mai e în faza de Define/Design — produsul e deja construit și livrat, lucrul curent e pe flows incrementale (Flow 2/3/4, OF-1..OF-4) văzute în Kanban.

## Ultimele evenimente (din Kanban, cele mai recente `done`)

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

## Cron activ

- `Hidook Site Builder agency supervisor` (`0fa668624ebb`) — every 30m, deliver origin
- `Sitebuilder dispatch watchdog` (`88e0c0b42953`) — every 10m, script, no-agent

## Următorul pas sigur

Continuă cu următorul flow/task ready pe boardul `sitebuilder`, conform proces descris în `AGENTS.md`.

- `t_fdd0c989` (builder-backend, running): reconciliere a 9 fișiere de test legacy per-wave care pică (`node --test bot/test/*.test.js` → tests=136 pass=105 fail=31 la 2026-09-04), inclusiv `templates-readme-commercial.test.js` care interzice explicit numirea "desserdirina" ca template aprobat — contrazice VISION.md secțiunea 3 (sincronizat 2026-09-02) care aprobă Desserdirina remake. Fiecare fișier clasificat STALE ORACLE (actualizat) sau REAL REGRESSION (reparat în produs). Nu atinge `bot/site-legal.js` sau `fullpass-63230d2.mjs`. Review independent blocat `t_eb509455` (critic-gpt) legat, se declanșează după commit.

## Neautorizat fără aprobare separată

Push la producție dincolo de worktree-uri, deploy live, DNS, Stripe live product changes, credentials.
