# Hidook Site Builder — VISION.md (sursă unică sincronizată)

**Autoritate:** acest fișier este sursa de adevăr pentru Site Builder până când owner-ul îl schimbă explicit. Orice `PRODUCT.md`, `AGENTS.md`, task Kanban, spec vechi sau comentariu care contrazice acest document este depășit.

**Sincronizat:** 2026-09-02. Bază: spec Opus 5 `t_7f6ffed8` / `OWNER-FEEDBACK-2026-08-26-SPEC.md` + deciziile owner ulterioare, inclusiv calendarul Professional din 2026-09-01, poarta comercială pentru export din `00-Governance/OWNER-FEEDBACK-2026-09-02.md` și regulile noi de studio anti-buclă din `Desktop/Hermes/00-Governance/AGENCY-COMPANY-CONTRACT.md`.

## 1. Ce este produsul

Hidook Site Builder este un **website builder în browser** pentru clienți mici, care trebuie să poată construi și publica un site fără ajutorul echipei.

Un străin trebuie să poată:

1. deschide builder-ul în browser;
2. alege un șablon real;
3. edita texte, poze, culori, detalii de contact și WhatsApp;
4. vedea preview clar;
5. crea cont / intra în cont;
6. introduce card test în staging;
7. porni trialul de 7 zile;
8. avea site live imediat după card valid;
9. reveni, edita și republica;
10. anula în trial fără taxare;
11. exporta site-ul pentru self-deploy când politica comercială permite;
12. vedea linkuri/pagini legale curate.

Telegram rămâne doar acquisition/intake care deschide **același draft**. Nu există checkout separat în Telegram și nu există deploy Telegram paralel.

## 2. Model comercial curent

Decizia owner ulterioară specului Opus suprascrie lista inițială „one-time 99 USD / 30 dacă deployăm noi”. Modelul curent este:

- **Stripe subscription cu trial de 7 zile.**
- **Card obligatoriu** la începutul trialului.
- Site-ul devine **live/public imediat** după card valid.
- Dacă userul nu anulează, se taxează automat în ziua 7.
- Preț start: **99** în bucket-ul clientului: EUR pentru UE, GBP pentru UK, USD pentru restul lumii.
- Renewal: **29/an** în aceeași monedă, necondiționat.
- Nu promite hosting permanent dintr-o plată unică.
- Owner creează Stripe live Product/Prices, policy de refund/cancellation și Customer Portal în producție.
- Studio implementează test/staging/env templates/runbook până în punctul unde rămân doar secretele și producția.

## 3. Șabloane și design

Scope curent de șabloane:

1. Product / menu businesses.
2. Local service / lead-gen.
3. Portfolio / beauty / events.
4. Professional services.
5. **Desserdirina remake** — fostul sample de brutărie/DESSERD din repo trebuie refăcut ca șablon aprobat, la același nivel de calitate ca celelalte. Nu este un vertical nou inventat.

Reguli:

- Produsul este în **limba română** pe suprafețele vizibile pentru client/site, cu diacritice corecte.
- Orice șablon nou real cere research-first. Desserdirina remake pornește din sample-ul existent, dar trebuie adus la calitate comercială.
- Fără AI slop: gradienturi generice, iconițe stock, chips haotice, layout evident de template.
- Fiecare șablon trebuie să conțină mențiunea non-editabilă: **`Build by hidook.tech powered by hidook.agency`**.
- Mențiunea nu se pune în `footer.note` editabil; trebuie să rămână după editări și republish.

## 4. Builder — cerințe obligatorii din specul Opus

### 4.1 Prima încărcare a șabloanelor

Defect verificat de Opus: `builder/generated/templates-data.js` era ~32 MB și bloca prima încărcare. Refresh-ul părea să repare doar din cache.

Done înseamnă:

- primul load arată cardurile de template în ≤ 3 secunde pe throttling realist;
- fără refresh manual;
- bundle split: registry ușor pentru grid, payload greu doar la Start/Preview;
- imagini template cacheabile ca fișiere reale, nu base64 uriaș în JS;
- `Cache-Control`, `ETag` / `Last-Modified`, 304 pe warm load;
- fără `readFileSync` de 32 MB per request.

### 4.2 Culori și background

Defect verificat de Opus: color picker-ul scria config, dar CSS-ul nu consuma variabilele; pe `professionals` tema nu schimba nimic vizibil.

Done înseamnă:

- `theme.primary`, `theme.cream` și variabilele echivalente sunt consumate real în toate șabloanele;
- hero background și secțiunile simple au controale reale de culoare/imagine, nu input de CSS brut;
- preview-ul și live site-ul arată aceeași schimbare;
- QA verifică pixelii, nu doar config-ul.

### 4.3 Details automat

Done înseamnă:

- Details drawer din builder se deschide automat la prima intrare în editor;
- userul îl poate închide;
- preferința închis/deschis se ține la reload;
- `<details>` relevante din șabloane care ascund conținut important sunt deschise by default unde are sens.

### 4.4 WhatsApp

Done înseamnă:

- badge-ul plutitor WhatsApp folosește icon/glyph recognoscibil, culoare WhatsApp, nu textul `WA`;
- userul introduce număr + mesaj normal în română;
- builder-ul generează `wa.me/<number>?text=<encoded>`;
- mesajul păstrează diacriticele;
- dacă nu există număr, badge-ul nu apare rupt;
- nu se modifică flow-ul Telegram pentru asta; logica se portează în browser/shared.

### 4.5 Preview

Există preview-uri parțiale, dar produsul trebuie să aibă o posibilitate clară de preview pentru client.

Done minim:

- preview vizibil înainte de card/trial;
- desktop/mobile toggle funcțional;
- preview-ul reflectă text, imagini, culori, WhatsApp și legal footer;
- dacă se introduce preview shareable public, trebuie să fie tokenizat/noindex/expirabil și să nu fie confundat cu site live final.

### 4.6 Builder slab — standard minim

Constructorul nu trebuie să fie o formă subțire. Defectele identificate de Opus devin backlog structural:

- fără section add/remove/reorder;
- fără undo/redo;
- fără multi-page real;
- fără typography controls;
- edit mapping fragil prin regex;
- imagini base64 în config;
- SEO insuficient expus;
- form builder limitat.

Nu se rezolvă toate într-un singur task. Se lucrează pe flow-uri verticale verificate în browser.

## 5. Legal

Privacy / Cookies / Terms lipsesc ca produs complet.

Studio trebuie să construiască:

- pagină Privacy Policy generată;
- pagină Terms & Conditions generată;
- cookie banner / consent;
- footer links în fiecare șablon;
- includerea acestor pagini în export;
- placeholder-uri clare pentru datele legale.

Owner trebuie să furnizeze înainte de producție:

- nume legal companie / entitate;
- VAT/CUI/adresă;
- cine este controller/procesator;
- subprocessors: Stripe, Cloudflare, Resend, Instafidget, calendar etc.;
- retenție date;
- jurisdicție și text legal final.

Nu se livrează la clienți plătitori cu text legal inventat.

## 6. Export / self-deploy

Done înseamnă:

- userul poate descărca ZIP cu site static complet;
- ZIP-ul conține HTML/CSS/JS/images/legal pages/badge;
- poate fi servit de pe orice static host fără runtime Hidook;
- site-ul exportat nu face request-uri către domenii Hidook pentru a funcționa;
- exportul HTML/ZIP folosește aceeași listă explicită de drepturi ca publicarea live: numai abonament Stripe `active`, trial `trialing` sau un drept paid legacy încă valabil; `past_due`, anularea și un `paidUntil` expirat blochează exportul chiar dacă istoricul păstrează `paid=true`;
- un draft unpaid, `past_due`, anulat sau expirat primește eroare/upsell clar în română și niciun fișier;
- exportul este verificat prin unzip + static server + browser real.

## 7. Instafidget

Instafidget este produs partener conectat din Site Builder ca bonus comercial: clientul primește conectare/widget Instafidget gratuit 12 luni cu site-ul, apoi trece pe Instafidget Free cu watermark dacă nu face upgrade în Instafidget.

Reguli:

- poziția slotului o alege studio/design după ce vede pagina;
- copy-ul spune clar: **Instafidget inclus gratuit 12 luni, apoi Instafidget Free cu watermark**;
- clientul se conectează la Instafidget și își alege widget/feed acolo;
- editorul Instafidget se deschide în **tab nou în același browser**, nu popup/fereastră separată;
- dacă Instafidget nu e conectat, secțiunea publică se ascunde complet;
- nu se arată iframe mort, feed gol sau promisiune falsă.

## 8. Calendar Professional

Decizia owner din 2026-09-01: Hidook **nu** găzduiește cal.diy. Fiecare client Professional își creează propriul cont gratuit Cal.com și lipește linkul de rezervare în Detalii.

Reguli:

- linkul este opțional; fără link, formularul local de cerere rămâne neschimbat;
- se acceptă numai linkuri complete `http://` sau `https://`, inclusiv domenii Cal.com personalizate;
- cu link valid, secțiunea Programări afișează `Programează-te` în tab nou și înlocuiește formularul local;
- fără iframe, popup sau infrastructură calendar Hidook;
- contul Cal.com și gestionarea rezervărilor aparțin clientului Professional.

## 9. Landing page Site Builder

LP-ul trebuie adaptat la brandul hidook.agency și la research bun de landing pages.

Reguli:

- nu ghici culorile hidook.agency;
- LP-ul așteaptă hex-urile exacte / brand tokens sau acces la sursa de brand;
- Mobbin MCP poate fi folosit pentru research dacă owner îl conectează, dar nu este blocker pentru research web normal;
- copy-ul LP citește pricing din config; nu hardcodează prețuri vechi.

## 10. Owner gates

Owner face doar pașii imposibili fără el:

- Stripe live Product/Prices/Customer Portal;
- DNS / Cloudflare live pentru hidook.agency;
- email sender production;
- date legale/VAT/jurisdicție;
- brand tokens exacte hidook.agency;
- orice deploy/push/producție/charge real.

Studio nu cere aceste lucruri până când tot ce se putea construi/testa local/staging este gata.

## 11. Plan de lucru sincronizat — fără buclă infinită

Task-urile vechi bazate pe specuri depășite se opresc. De acum se lucrează numai pe aceste flow-uri verticale:

### Flow 1 — Foundation / primul load + theming

Include: item 9 + item 11 + oracle de performanță.

Acceptare:

- bundle split + cache headers;
- first-load ≤ 3 secunde pe throttling realist;
- culorile schimbă vizibil fiecare template;
- test mecanic + browser evidence.

### Flow 2 — Template pass RO / Details / WhatsApp / Badge / Desserdirina

Include: item 1 + 2 + 5 + 10 + 12 + Instafidget slot messaging.

Acceptare:

- toate șabloanele în română;
- Desserdirina remake apare ca șablon real;
- badge Hidook prezent și non-editabil;
- Details auto-open;
- WhatsApp badge + mesaj custom;
- imaginea pentru distribuire socială se alege automat din fotografia de deschidere sau dintr-o fotografie existentă; clientul nu completează un URL `og:image`;
- Instafidget menționat ca inclus gratuit 12 luni, apoi Free cu watermark;
- verificare în browser pe preview și live/test publish.

### Flow 3 — Legal + export

Include: Privacy, Cookies, Terms, export ZIP/self-deploy.

Acceptare:

- pagini și banner generate cu placeholder legal clar;
- export ZIP complet;
- export HTML/ZIP disponibil numai pentru abonament `active`, trial `trialing` sau drept paid legacy neexpirat; unpaid, `past_due`, anulat și `paidUntil` expirat nu descarcă fișiere;
- unzip + static serve + browser real;
- niciun link legal mort.

### Flow 4 — Commercial E2E + calendar/LP readiness

Include: trial/card/live/cancel/renew, linkul Cal.com deținut de client pentru Professional, LP hidook.agency când există brand tokens.

Acceptare:

- card test → trial live imediat;
- cancel trial → comportament clar;
- renewal 29/an reflectat corect;
- clientul Professional poate lipi un link Cal.com valid, iar site-ul public deschide rezervarea în tab nou;
- LP nu intră până nu există brand tokens.

## 12. Reguli pentru studio

- Nu se mai creează micro-slice-uri pe istoricul vechi.
- Fiecare task nou citează flow-ul din acest VISION.
- Dacă o problemă revine de două ori, se construiește oracle/script/runbook, nu încă o regulă în task.
- Task body se scrie fresh din acest document, nu din lanțul de failuri vechi.
- QA/devil’s advocate deschid browser real și salvează screenshots în `04-QA-Evidence/`.
- Owner primește cel mult un taste checkpoint pe flow; owner nu face QA.
- Nu se declară **Produsul** până când toate flow-urile cerute pentru launch trec QA + advocate fără defect vizibil.

## 13. Artefacte canonice

- Spec Opus complet: `00-Governance/OWNER-FEEDBACK-2026-08-26-SPEC.md`.
- Contract companie: `../Hermes/00-Governance/AGENCY-COMPANY-CONTRACT.md`.
- Acest fișier: `VISION.md` — sursa operațională curentă.
