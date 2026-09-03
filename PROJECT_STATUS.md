# Hidook Site Builder — PROJECT_STATUS

Actualizat: 2026-09-04 (cookie-vs-dock collision fix integrat local pe main)

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

## Neautorizat fără aprobare separată

Push la producție dincolo de worktree-uri, deploy live, DNS, Stripe live product changes, credentials.
