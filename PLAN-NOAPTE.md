# Plan de noapte — 2026-09-06 → 07

Obiectivul owner-ului: **un constructor de site-uri de nivel top — frumos, intuitiv,
prietenos.** Dimineața trebuie doar să dea push și deploy.

## Unde suntem la pornire

- Suita: 330+/331 (singurul roșu e `flow3-legal-export`, oracle deliberat pe Brave)
- `FULLPASS defects=0 steps=46` — fluxul complet client funcționează
- Producția rulează deja codul de azi; migrarea JSON→SQLite a reușit
- Scoruri re-audit: performanță 9, Meserii 9, Restaurant 8, Builder UX 8,
  backend 7, export 7, docs 6, deploy 6, accesibilitate 6, plăți 5, securitate 5
- Desserdirina: 4 → 7 după curățarea fotografiilor cu watermark străin

## Ce desparte produsul de „top"

Nu bug-uri. Trei lucruri:

1. **Aspectul.** Salon 6/10 și Profesionale 7/10 arată încă a șablon. Bara e în
   același repo: Meserii a luat 9.
2. **Intuiția.** Nimeni n-a auditat vreodată cum arată și cum se simte *editorul*
   în sine. Primul minut al unui om nou nu e proiectat.
3. **Încrederea.** Securitate 5 și plăți 5 sunt sub pragul la care un produs care
   ia bani reali poate sta liniștit.

## Valuri

### Valul A — aspect și încredere (pornit)
- Salon (`portfolio`) 6 → 9: tratamentul aplicat la desserdirina
- Profesionale 7 → 9
- Securitate 5 → 8: `X-Forwarded-For` fără listă de proxy de încredere,
  CSP permisiv pe site-urile publicate
- Plăți 5 → 8: notificări reale pe eșec de plată, calea de activare TVA

### Valul B — editorul ca produs
- Designul vizual al editorului însuși, auditat și dus la același nivel
- Tipografie: perechi curate, fonturi self-hostate (repornit după eroare de filtrare)
- Primul minut: stări goale, microcopy, ce vede un om care n-a mai văzut produsul
- Editare de pe telefon

### Valul C — verificare
- Audit independent proaspăt pe tot ce s-a schimbat
- `FULLPASS` + suita completă
- `main` verde, gata de push

## Reguli pentru fiecare agent

- Scrie raportul devreme și fă commit pe parcurs — trei agenți au murit azi cu
  tot ce descoperiseră în memorie
- Fără delegare
- Roșu-înainte/verde-după pentru fiecare schimbare
- Telegram înghețat: `bot/bot.js`, `bot/flow.js`, `bot/ai.js`, `bot/template-steps.js`
- Fără `git stash` — ref partajat între worktree-uri
- Româna cu diacritice; zero dependențe noi
- Niciodată eticheta de închidere `body` într-un comentariu HTML
- O funcționalitate nu e gata până când clientul poate ajunge la ea
