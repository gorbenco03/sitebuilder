# DESSERD — ghid de lansare business (cum aduci bani)

Serviciu: **site-uri web profesionale generate automat printr-un bot Telegram cu AI.**
Clientul povestește despre afacere + trimite poze → primește un site live în câteva minute.

---

## 1. Ce vinzi și la ce preț

| Pachet | Preț (sugerat) | Ce include |
|---|---|---|
| **Site pe vercel.app** | **$29 one-time** (`BUILD_FEE_USD`) | Site complet, live pe `nume.vercel.app` |
| **+ Domeniu custom** | + prețul domeniului (~$12–15/an) + markup opțional (`DOMAIN_MARKUP_USD`) | `afacereata.ro`/`.com` cumpărat + atașat automat |
| **Bespoke / custom** | 500 / 1000 / până la 1🍋 | Design la comandă, funcții speciale (manual, nu prin bot) |

> Marja: la $29 pe site, costurile tale per site sunt ~câțiva cenți (AI Haiku) + hosting fix.
> Practic profit ~$28/site. La domeniu, încasezi prețul + markup-ul tău.

## 2. Costuri lunare (mici, fixe)
- **Railway** (bot 24/7): ~$5/lună
- **Vercel**: gratis pentru zeci de site-uri (Hobby); domenii = cost per domeniu, pe care îl pasezi clientului
- **Anthropic (AI)**: ~$0.01–0.05 per site generat (Haiku + prompt caching)
- **Stripe/Revolut**: ~1.5–3% per tranzacție
→ Break-even: **1 client/lună** acoperă tot. Restul e profit.

## 3. Pașii ca să încasezi (checklist tehnic)
1. **Deploy bot pe Railway** (vezi `bot/DEPLOY.md`) → bot live non-stop.
2. **Plată live**: pune cheia **Revolut live** (`REVOLUT_SECRET_KEY` + `REVOLUT_ENV=production`).
3. **Domenii auto** (opțional): card pe Vercel + datele `REGISTRANT_*` în env.
4. **`ADMIN_CHAT_ID`** → primești notificare la fiecare site + plată.
5. Gata: trimiți oamenilor link-ul botului (`t.me/<bot>`), ei scriu `/start`.

## 4. Cum obții primii clienți (go-to-market)
**Ai deja cel mai bun argument de vânzare: desserdina.vercel.app** — un site real, frumos, făcut de sistemul tău. Folosește-l ca portofoliu.

Primele 10 vânzări, concret:
1. **Afaceri mici locale fără site** (cofetării, saloane, frizerii, florării, catering, pensiuni).
   Mesaj direct pe Instagram/Facebook/WhatsApp: *„Salut! Am văzut că nu aveți site. Vă fac unul
   profesional în 10 minute, live azi. Uitați un exemplu: desserdina.vercel.app. $29, fără bătăi de cap."*
2. **Grupuri Telegram/Facebook de antreprenori** din Chișinău/România — postează exemplul + botul.
3. **Oferta de lansare**: primele 5 site-uri la $15 (sau gratis pe vercel.app, plătesc doar domeniul)
   ca să strângi **testimoniale + exemple** reale în portofoliu.
4. **Referral**: fiecare client mulțumit aduce 2–3 cunoștințe cu afaceri.
5. **Demo video** de 30 sec: cum scrii în bot și apare site-ul → postezi pe TikTok/Reels.

## 5. Operare
- Notificările pe Telegram (`ADMIN_CHAT_ID`) îți spun când cineva face un site / plătește.
- Site-urile clienților rămân pe contul tău Vercel (le poți gestiona din dashboard).
- Pentru cereri „bespoke", răspunzi manual și ceri 500+.

## 6. Următorii pași de produs (când ai tracțiune)
- **behold.so** pentru feed Instagram live perfect în site-uri.
- 2–3 **teme/șabloane** la alegere (acum e unul, roz — bun pentru cofetării; adaugi unul „neutru business").
- DB pentru istoricul comenzilor + panou simplu de admin.
- Abonament lunar opțional (hosting + editări) = venit recurent.

---
**TL;DR:** tehnic ești la ~1 pas (Railway + cheie Revolut live) de a încasa real. Restul e
vânzare: folosește desserdina ca exemplu și abordează 20 de afaceri locale fără site. La $29/site
și costuri ~$5/lună, profitul vine de la primul client.
