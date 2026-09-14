# Evidence index — explore-account (2026-09-14)

Nicio captură .png nu a fost persistată pe disc (explorare interactivă prin panoul de browser al
agentului, nu prin script Playwright separat) — png-urile sunt oricum ignorate de `.gitignore`
(`04-QA-Evidence/**/*.png`). Evidența de mai jos e text/JSON, capturat direct din DOM/`fetch`/network
în timpul explorării, verbatim.

## F1 — Preview modal blocat

Stare inițială după deschidere (imediat):
```
iframe count in modal-preview-body: 1
{ src: "", srcdocLen: 110902, ariaBusy: "true",
  className: "preview-iframe preview-iframe--modal preview-iframe--loading" }
```

După 1.5s + 3s + 3s (total ~7.5s de la deschidere), aceeași verificare:
```
{ ariaBusy: "true",
  className: "preview-iframe preview-iframe--modal preview-iframe--loading",
  previewReady: "false" }
```

Listener de control atașat înainte de al doilea click:
```js
window.__hbMsgLog = [];
window.addEventListener('message', e => window.__hbMsgLog.push({data: e.data}));
```
După redeschiderea modalului și 4s de așteptare:
```
window.__hbMsgLog → "[]"   // niciun mesaj primit, inclusiv semnalul hb-preview-ready
```

Test de control — `postMessage` dintr-un iframe sandboxed minim, în același tab, ACELAȘI mediu de
testare:
```html
<iframe sandbox="allow-scripts" srcdoc="<script>parent.postMessage({hb:'ping'},'*')</script>"></iframe>
```
rezultat: `"received: {\"hb\":\"ping\"}"` — deci mediul de testare NU blochează postMessage din
iframe-uri sandboxed; problema e specifică conținutului/mecanismului real.

Test decisiv — conținutul real (`srcdoc` din iframe-ul blocat al modalului, 210887/110902 caractere)
copiat într-un iframe NOU, identic ca `sandbox`:
```js
const real = document.querySelector('.preview-iframe--edit').srcdoc; // sau --modal, testat pe ambele
const test2 = document.createElement('iframe');
test2.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
test2.srcdoc = real;
document.body.appendChild(test2);
```
Rezultat: se randează INSTANT și CORECT (header „Atelier Ivoire”, hero, buton „Programează-te”,
banner cookie, buton WhatsApp) — deci conținutul e valid, iar problema e izolată la
iframe-ul original al aplicației (posibil o cursă de randare specifică `cloneNode()` +
`replaceWith()` folosit de `replacePreviewDocument()`).

Network (fără cereri suplimentare relevante — conținutul e `srcdoc`, nu navigare de rețea):
```
GET /app/generated/templates/portfolio.js → 200 OK   (încărcat o singură dată, la boot)
```

## F2 — Facturi arată 99 € în ziua trialului

Cardul din dashboard imediat după plata de test (`POST /api/test-pay/complete` reușit):
```
"Trial de 7 zile · prima taxare 99€ pe 21 septembrie 2026"
```

`GET /api/sites` imediat după:
```json
{"id":"d6ca5621-8a85-45e3-b4a4-cd43198ddd9d","status":"live","paid":true,
 "url":"http://127.0.0.1:54321/live/atelier-ivoire/",
 "paidUntil":"2027-09-14T14:54:10.905Z", ...}
```

Modal „Facturi” (`#modal-invoices`), text complet:
```
Facturi și plăți
14 sept. 2026
Publicare (primul an)
99,00 EUR
```
HTML complet al `#invoices-list`:
```html
<div class="invoice-item">
  <div class="invoice-item-main">
    <span class="invoice-date">14 sept. 2026</span>
    <span class="invoice-kind">Publicare (primul an)</span>
  </div>
  <span class="invoice-amount">99,00&nbsp;EUR</span>
</div>
```
Niciun status/badge „pending”/„programat” în marcaj.

Cod sursă citit (`bot/webpublish.js`, `handleStripePaid`, ~2036-2110):
```js
const paymentStatus = cs.payment_status;
if (paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
    log('webpublish.stripe_paid.not_card_on_file', ...);
    return;
}
...
ledger.append({
    event: 'invoice', siteId, orderId, kind,
    invoiceId: ...,
    amountCents: order.amountCents != null ? order.amountCents : null,
    currency: order.currency || null,
});
```
Comentariul din cod (păstrat verbatim): „Card-on-file success: immediate charge OR subscription
trial (no charge yet).” — recunoaște explicit că `no_payment_required` = fără charge, dar tot scrie
în ledger identic ca la un charge real.

## F3 — Email magic-link în engleză

`bot/email.js` (citit direct, fără devLink expus în UI — nu există un „outbox” vizibil pentru
magic-link, doar `devLink` în răspunsul JSON):
```js
const subject = 'Sign in to Hidook Site Builder';
const html = `... <h2>Sign in to Hidook Site Builder</h2>
<p>Click the button below to sign in. This link is valid for <strong>15 minutes</strong>.</p>
...
<p>If you didn't request this link, you can safely ignore this email.</p> ...`;
```
Restul produsului (verificat live): toate mesajele UI întâlnite în explorare — toasturi, erori de
validare, modaluri — sunt în română.

## F4 — Buton plată cu preț alăturat

`builder/index.html:534-535`:
```html
<button id="btn-pay-publish" ...>
  Adaugă un card — începe trialul de 7 zile — <span id="success-price">—</span>
</button>
```
Text randat, capturat din `#modal-success` (`innerText`):
```
Adaugă un card ca să fii live

Adaugă un card ca să începi trialul de 7 zile. Site-ul e live imediat. Ești taxat în ziua 7 dacă nu anulezi. Apoi reînnoire 29€/an.

Adaugă un card — începe trialul de 7 zile —
99€
Înapoi la editor
```

## F5 — Proiect nou cu același nume după ștergere

Ordinea exactă a verificărilor prin `fetch('/api/sites')`:

Înainte de ștergere (după Anulează):
```json
{"sites":[{"id":"d6ca5621-8a85-45e3-b4a4-cd43198ddd9d","slug":"atelier-ivoire",
"status":"unpublished","paid":true,"canceledAt":"2026-09-14T15:00:56.619Z",
"subscriptionStatus":"canceled", ...}]}
```

Imediat după „Șterge definitiv” (confirmat cu numele tastat corect, buton neblocat):
```json
{"sites":[{"id":"eac060d9-d243-4568-b381-9131f4944220","slug":"atelier-ivoire",
"status":"draft","paid":false,"url":null,
"createdAt":"2026-09-14T15:01:45.876Z", ...}]}
```
Notă: id complet diferit, `paid:false`, `status:"draft"` — datele reale (abonament, site live) chiar
au fost șterse; problema e doar de percepție (numele identic reapare imediat în listă).

`GET /live/atelier-ivoire/` după cancel: `404` (confirmat separat, înainte de ștergere).

## Verificări pozitive — excerpte

- `POST /api/auth/email` (email valid), răspuns:
  `{"ok":true,"sent":false,"devLink":"http://127.0.0.1:54321/auth/verify?token=..."}`
- `POST /api/auth/email` (email invalid `not-an-email`): validat client-side, fără request de rețea.
- `GET /auth/verify?token=totally-invalid-garbage-token` → redirect (opaqueredirect) → UI:
  „Linkul de autentificare a expirat. Încearcă din nou.”
- `GET /api/slug-check?slug=frizerie-aast-nr5` → `{"available":true,"slug":"frizerie-aast-nr5"}`
  (după input „Frizerie Ăâșț Nr.5!!”).
- `GET /api/slug-check?slug=aaaa...(40 chars)` → `{"available":true,"slug":"aaaa...(40 chars)"}`
  (după input de 117 caractere — trunchiat client-side la 40).
- `POST /api/sites/:id/billing-portal` → `{"portalUrl":"http://127.0.0.1:54321/app/#test-billing-portal=bps_test_...","offline":true}`;
  navigare la acel URL → toast „Abonamentul a fost anulat. Site-ul e ciornă.”; `GET /api/sites` →
  `status:"unpublished"`, `subscriptionStatus:"canceled"`; `GET /live/atelier-ivoire/` → 404.
- `#modal-domain` cu `not a valid domain!!` → „Acesta nu pare a fi un domeniu valid. Exemplu corect:
  myshop.com sau afacereamea.ro.”; cu `atelier-ivoire-explore.ro` → „Nu am putut determina adresa
  Cloudflare a site-ului tău. Republică site-ul o dată și încearcă din nou.” (limită așteptată local).
- `#modal-delete-site` text complet: „Șterge definitiv site-ul — Această acțiune este ireversibilă:
  se șterge site-ul publicat, ciornele, domeniul propriu conectat și datele de programări. Ca să
  confirmi, scrie exact numele site-ului: atelier-ivoire”.

## Mediu / setup (pentru reproducere)

```
DATA_DIR=<tmp>
SERVER_SECRET=explore-account-local-secret-2026-09-14
HIDOOK_ISOLATED_DEPLOY=1
HIDOOK_TEST_PAY=1
NODE_ENV=test
PUBLIC_URL=http://127.0.0.1:54321
(fără STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, VERCEL_TOKEN, NETLIFY_TOKEN,
 DEPLOY_PROVIDER, CLOUDFLARE_API_TOKEN, RESEND_API_KEY, HIDOOK_FAKE_DEPLOY)
```
Pornire: `node --experimental-sqlite <launcher care cheamă startServer({port})>` — necesar pe
Node 23 pentru backend-ul sqlite din `bot/registry.js` (fără flag, orice endpoint care atinge
registry-ul cade cu 500 „The SQLite registry backend requires Node.js with node:sqlite...”).
Înainte de pornire: `node scripts/build-builder.js` (altfel landing page-ul arată „Designurile nu
sunt disponibile momentan.” din cauza `builder/generated/` lipsă).
