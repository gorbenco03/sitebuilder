# Wave 8 — AUDIT-07 re-audit: logout must invalidate the session server-side

## Constatarea

Re-auditul independent a confirmat: `POST /api/auth/logout` nu exista deloc în
`bot/server.js`, iar reluarea unui cookie `hb_session` capturat înainte de
"logout" tot returna 200 la `/api/me`. Cookie-ul de sesiune este un token
HMAC stateless valabil 30 de zile — nu există nimic de revocat pe server
decât dacă serverul ține el însuși o evidență a sesiunilor emise.

## Branch-ul nefuzionat: `wt/audit-07-logout-invalidate`

Inspectat cu `git log main..wt/audit-07-logout-invalidate` și
`git diff main...wt/audit-07-logout-invalidate` înainte de a scrie orice cod.

Conținea o soluție funcțională, dar cu un defect de design: revocarea era
ținută într-un fișier JSON separat (`.revoked-sessions.json`, citit/scris cu
`fs.readFileSync`/`writeFileSync` direct din `bot/auth.js`), complet în afara
mecanismului de migrare existent (`bot/registry-schema.js` /
`bot/registry-db.js`) și a switch-ului `REGISTRY_BACKEND` (`sqlite` vs
`json`). Asta înseamnă: nicio garanție de scriere atomică sub concurență reală
(spre deosebire de tranzacțiile SQLite folosite peste tot în registry), nicio
integrare cu backup-ul bazei de pe `/data`, și duplicare de logică față de
`bot/registry-*.js`. În plus, branch-ul oferea DOAR logout pe o sesiune —
nu exista "log out everywhere", iar căutarea "adjacent surfaces" (dashboard
calendar, token magic-link) nu apărea deloc.

**Am folosit din el:** ideea de a purta un `sid` random în payload-ul
cookie-ului, semnat alături de `uid`/`exp`, ca cheie de revocare — corectă și
păstrată. **Nu am folosit:** stocarea pe fișier JSON separat, lipsa migrării
formale, și absența funcției "log out everywhere". Soluția finală e scrisă
de la zero peste `bot/registry-schema.js`/`bot/registry-sqlite.js`/
`bot/registry-json.js`, ca parte din registry-ul existent, nu în afara lui.

## Design-ul de revocare ales

**Tabel de sesiuni server-side (o "allow list", nu o "deny list")**, adăugat
prin migrarea existentă ca `SCHEMA_SQL_V2` (`bot/registry-schema.js`,
`SCHEMA_VERSION` 1 → 2):

```sql
CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    exp INTEGER NOT NULL,
    revoked_at TEXT
);
```

`signSession()` (bot/auth.js) generează acum un `sid` aleator de 16 octeți,
îl inserează ca rând nou în `sessions`, și îl include în payload-ul semnat
(`{ uid, exp, sid }`). `verifySession()` verifică suplimentar — după HMAC și
expirare — că acel rând există, nu e expirat și nu e revocat. Logout
(`POST /api/auth/logout`) marchează UN rând `revoked_at`; "log out
everywhere" (`POST /api/auth/logout-everywhere`) marchează TOATE rândurile
unui `user_id` dintr-o singură interogare.

### De ce asta, și nu alternativele din brief

- **Contor de generație per-utilizator** (mai ieftin: o singură coloană
  întreagă) — respins pentru că un logout obișnuit ar deveni automat "log out
  everywhere": produsul cere explicit ambele acțiuni ca funcții distincte
  (deconectare pe acest dispozitiv vs. deconectare peste tot), iar un contor
  simplu nu le poate separa.
- **Deny list doar cu token-uri revocate** — mai mic în cazul comun (majoritatea
  sesiunilor expiră natural, nu sunt niciodată revocate), dar tot are nevoie
  de o baleiere pentru limitarea creșterii, iar "log out everywhere" peste un
  deny list ar necesita oricum o listă separată a sid-urilor emise per
  utilizator — adică exact același tabel.
- **Tabelul de sesiuni** costă un rând per sesiune emisă (mărginit —
  `idx_sessions_exp` permite baleierea oportunistă a rândurilor expirate la
  fiecare `signSession()` nou, plus rândurile revocate rămân până expiră
  natural) și oferă ambele funcții dintr-un singur mecanism, cu o singură
  interogare indexată per cerere.

### Ce NU protejează acest design

- Un cookie replay-uit **în fereastra lui de valabilitate, încă nerevocat** —
  nu există nimic care să detecteze "două mașini diferite folosesc simultan
  același sid" fără amprentare de dispozitiv, pe care acest produs nu o
  colectează.
- **Sesiuni semnate înainte de această migrare** — un cookie fără claim-ul
  `sid` nu are rând în tabel de verificat, deci `verifySession()` îl tratează
  ca invalid (forțează o singură re-autentificare per sesiune activă, o
  singură dată, la deploy). Alternativa (a-l trata ca valid la nesfârșit)
  ar fi reintrodus exact bug-ul pe care îl reparăm.
- **Compromiterea bazei de date SQLite în sine** — cine are acces la fișier
  poate oricum citi rândurile `sessions`; asta nu e o problemă nouă introdusă
  aici (aceeași expunere hipotetică există pentru `users`, `sites`, etc.).

## Suprafețe adiacente verificate

- **Dashboard-ul de calendar al proprietarului** (`/api/calendar-native/owner/*`)
  folosește exact același `requireAuth()` → `getAuth().getSessionUserId()`
  din `bot/server.js` ca `/api/me` — nicio logică de sesiune separată. Fix-ul
  central în `bot/auth.js` îl acoperă automat; verificat explicit cu un test
  (`wave8-logout-invalidate.test.js`) care reia cookie-ul revocat împotriva
  `/api/calendar-native/owner/bookings` și așteaptă 401.
- **Token-ul magic-link** (`registry.createLoginToken`/`consumeLoginToken`)
  era deja cu o singură folosire (`used` flag) și cu TTL de 15 minute —
  independent de sesiuni, nu a necesitat nicio schimbare. Rămâne un canal
  separat de "log out everywhere": dacă cineva suspectează că email-ul i-a
  fost citit, un link nefolosit e oricum inutil unui atacator fără să știe
  parola de recuperare — dar sesiunile deja active rămân vulnerabile fără
  "log out everywhere", motiv pentru care acea funcție există acum.

## O regresie descoperită și reparată în timpul lucrului

Adăugarea unui buton nou (ascuns, `display:none` cât timp utilizatorul nu e
autentificat) în `#account-menu` a făcut ca
`bot/test/wave5-builder-account-menu.test.js` să pice determinist — de două
ori la rând — DOAR quando rulat în suita completă (nu izolat, nu în
combinație cu alte 1-2 fișiere). Root cause: `openModal()` în
`builder/app.js` muta focus-ul în modal printr-un `requestAnimationFrame`
amânat; sub presiune de CPU (suita completă rulează ~40 de teste Playwright),
prima apăsare de Tab din test putea ajunge înaintea acelui frame, caz în care
Tab-ul nativ al browser-ului (nu handler-ul modalului, care nu se declanșează
când focus-ul e încă în afara subarborelui modalului) decidea următorul
element focusabil din pagină — dependent de restul DOM-ului. Rezolvat făcând
mutarea focus-ului sincronă (fără `requestAnimationFrame`), eliminând cursa
complet. Verificat cu 2 rulări complete consecutive ale suitei după fix:
315 pass / 2 fail de fiecare dată (aceleași 2 eșecuri cunoscute dinainte).

## Teste (verificate roșii înainte de fix, verzi după)

- `bot/test/wave8-logout-invalidate.test.js` — capturează un cookie, cere
  logout, dovedește că vechiul cookie e refuzat pe `/api/me` ȘI pe
  dashboard-ul de calendar; o sesiune nouă a aceluiași utilizator rămâne
  validă (logout-ul nu e global din greșeală).
- `bot/test/wave8-logout-everywhere.test.js` — două sesiuni simulând două
  dispozitive; `logout-everywhere` de pe unul revocă AMBELE, dar nu atinge
  sesiunea unui alt utilizator; o sesiune nouă după aceea funcționează.
- `bot/test/wave8-logout-migration.test.js` — seed manual al unei baze SQLite
  în forma veche (v1, fără tabelul `sessions`), migrare, verificare că
  user/site vechi sunt intacte + tabelul de sesiuni funcționează; plus
  aceeași verificare pentru backend-ul JSON (`.registry.json` vechi, fără
  cheia `sessions`).

Dovezi brute (roșu-înainte / verde-după) în acest folder:
`before-red*.txt`, `after-green*.txt`, `full-suite-after.txt`.

## Numărătoare teste (`node --experimental-sqlite --test bot/test/*.test.js`)

| | teste | trec | pică |
|---|---|---|---|
| Înainte (main, `68c9dc8`) | 314 | 312 | 2 (flow3-legal-export, wave5-builder-undo-redo — cunoscute) |
| După (3 fișiere noi wave8-logout-*) | 317 | 315 | 2 (aceleași 2, verificat pe 2 rulări complete consecutive) |

Nicio a treia eșec introdusă.

## Fișiere atinse

- `bot/registry-schema.js` — `SCHEMA_SQL_V2` (tabelul `sessions`), `SCHEMA_VERSION` 2
- `bot/registry-db.js` — pasul explicit de migrare v1 → v2
- `bot/registry-sqlite.js` — `createSession`, `isSessionValid`, `revokeSession`, `revokeAllSessionsForUser`
- `bot/registry-json.js` — aceleași 4 funcții, paritate cu backend-ul SQLite
- `bot/auth.js` — `sid` în payload, `verifySession` verifică revocarea, `buildClearSessionCookie`, `getSessionCookieValue`, `revokeSession`, `revokeAllSessionsForUser`
- `bot/server.js` — `POST /api/auth/logout`, `POST /api/auth/logout-everywhere`
- `builder/index.html` — buton nou "Deconectare de pe toate dispozitivele" în meniul de cont
- `builder/app.js` — `doLogoutEverywhere()`, wiring buton, `updateUserUI` arată/ascunde noul buton, fix-ul de focus sincron în `openModal()`
- `bot/test/wave8-logout-invalidate.test.js`, `wave8-logout-everywhere.test.js`, `wave8-logout-migration.test.js` — noi
