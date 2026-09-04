'use strict';
/**
 * bot/site-legal.js — generated-site Privacy / Terms / Cookies pages + cookie banner.
 * Romanian visible copy. Honest unfinished placeholders for entity/VAT/jurisdiction.
 * Zero dependencies. Used by build.js, ZIP export, and builder preview isolation.
 */

const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function businessName(config) {
    const n =
        (config && config.business && config.business.name) ||
        (config && config.businessName) ||
        'Acest site';
    return String(n).trim() || 'Acest site';
}

function yearFrom(config) {
    const y = config && config.footer && config.footer.year;
    if (y) return String(y);
    return String(new Date().getFullYear());
}

function legalShell(opts) {
    const title = opts.title;
    const h1 = opts.h1;
    const body = opts.bodyHtml;
    const biz = escapeHtml(opts.biz);
    const y = escapeHtml(opts.year);
    return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, follow" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2314120f'/%3E%3Cpath d='M9 10h3v5h8v-5h3v12h-3v-5h-8v5H9z' fill='%23fffaf3'/%3E%3C/svg%3E" type="image/svg+xml" />
  <title>${escapeHtml(title)} — ${biz}</title>
  <link rel="stylesheet" href="styles.css" />
  <style>
    .hb-legal { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; color: inherit; }
    .hb-legal h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
    .hb-legal .hb-legal-meta { opacity: 0.75; font-size: 0.9rem; margin-bottom: 1.25rem; }
    .hb-legal .hb-legal-notice {
      border: 1px solid rgba(0,0,0,.12); background: rgba(0,0,0,.03);
      padding: 0.9rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-size: 0.92rem; line-height: 1.5;
    }
    .hb-legal h2 { font-size: 1.05rem; margin: 1.4rem 0 0.45rem; }
    .hb-legal p, .hb-legal li { line-height: 1.6; font-size: 0.95rem; opacity: 0.92; }
    .hb-legal ul { padding-left: 1.2rem; }
    .hb-legal a { color: inherit; text-decoration: underline; }
    .hb-legal-nav {
      display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem;
      margin-top: 2.25rem; padding-top: 1.1rem; border-top: 1px solid rgba(0,0,0,.12); font-size: 0.88rem;
    }
    .hb-built-by { font-size: 0.8rem; opacity: 0.7; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <main class="hb-legal">
    <h1>${escapeHtml(h1)}</h1>
    <p class="hb-legal-meta">${biz} · ${y} · politici de bază ale site-ului</p>
    <div class="hb-legal-notice" role="note">
      <strong>Politici de bază pentru site-ul publicat — nu sunt consultanță juridică personalizată.</strong>
      Titularul afacerii completează datele de identificare (denumire legală, CUI/VAT, adresă, jurisdicție)
      în locurile marcate <code>[PLACEHOLDER …]</code>. Până atunci, aceste pagini descriu practicile tipice
      ale site-ului generat (formulare, cookie-uri esențiale, contact).
    </div>
    ${body}
    <nav class="hb-legal-nav" aria-label="Pagini legale">
      <a href="index.html">Acasă</a>
      <a href="privacy.html">Confidențialitate</a>
      <a href="terms.html">Termeni</a>
      <a href="cookies.html">Cookie-uri</a>
    </nav>
    <p class="hb-built-by">Build by <a href="https://hidook.tech" target="_blank" rel="noopener noreferrer">hidook.tech</a> powered by <a href="https://hidook.agency" target="_blank" rel="noopener noreferrer">hidook.agency</a></p>
  </main>
  <script src="cookie-banner.js"></script>
</body>
</html>
`;
}

function privacyHtml(config) {
    const biz = businessName(config);
    const e = escapeHtml(biz);
    return legalShell({
        biz,
        year: yearFrom(config),
        title: 'Politica de confidențialitate',
        h1: 'Politica de confidențialitate',
        bodyHtml: `
    <h2>Cine este operatorul</h2>
    <p>
      Pentru datele pe care le trimiteți prin acest site (formulare de contact, programări, WhatsApp),
      operatorul este <strong>${e}</strong>.
      Identitatea legală completă: <code>[PLACEHOLDER: denumire legală / entitate]</code>,
      CUI/VAT <code>[PLACEHOLDER: CUI/VAT]</code>,
      adresă <code>[PLACEHOLDER: adresă sediu]</code>.
    </p>
    <h2>Ce date putem primi</h2>
    <ul>
      <li>Nume, telefon, e-mail și mesaj pe care le introduceți în formulare.</li>
      <li>Date tehnice de bază ale browserului (tip dispozitiv, pagină vizitată) dacă site-ul folosește stocare locală pentru preferințe.</li>
    </ul>
    <h2>De ce le folosim</h2>
    <p>
      Pentru a răspunde solicitărilor dumneavoastră, a confirma o programare sau a livra serviciul cerut.
      Baza legală tipică este interesul legitim sau executarea unei cereri precontractuale — detaliile finale rămân de completat
      (<code>[PLACEHOLDER: bază legală / temei final]</code>).
    </p>
    <h2>Păstrare și partajare</h2>
    <p>
      Durata de retenție: <code>[PLACEHOLDER: perioadă retenție]</code>.
      Subprocessori posibili (găzduire, e-mail, plăți, calendar):
      <code>[PLACEHOLDER: listă subprocessori — ex. Cloudflare, Stripe, Resend]</code>.
      Nu vindem datele dumneavoastră.
    </p>
    <h2>Drepturile dumneavoastră</h2>
    <p>
      Aveți dreptul de acces, rectificare, ștergere, restricționare și opoziție, în limitele legii aplicabile
      (<code>[PLACEHOLDER: jurisdicție / lege aplicabilă]</code>).
      Contact: folosiți datele de pe acest site sau adresa
      <code>[PLACEHOLDER: e-mail DPO / contact confidențialitate]</code>.
    </p>
`,
    });
}

function termsHtml(config) {
    const biz = businessName(config);
    const e = escapeHtml(biz);
    return legalShell({
        biz,
        year: yearFrom(config),
        title: 'Termeni și condiții',
        h1: 'Termeni și condiții',
        bodyHtml: `
    <h2>Despre acest site</h2>
    <p>
      Acest site prezintă activitatea <strong>${e}</strong>.
      Informațiile (meniu, servicii, prețuri, program) pot fi actualizate fără notificare prealabilă.
      Nu constituie ofertă fermă decât dacă este confirmată explicit în scris sau prin canalul de contact.
    </p>
    <h2>Servicii și programări</h2>
    <p>
      Solicitările trimise prin formulare sau WhatsApp sunt cereri, nu rezervări confirmate automat,
      decât dacă <strong>${e}</strong> confirmă altfel. Anulările și politicile de plată:
      <code>[PLACEHOLDER: politică anulare / plată]</code>.
    </p>
    <h2>Proprietate intelectuală</h2>
    <p>
      Textele, fotografiile și elementele de design de pe site aparțin operatorului sau licențiatorilor săi.
      Nu le redistribuiți fără acord.
    </p>
    <h2>Limitarea răspunderii</h2>
    <p>
      Site-ul este oferit „ca atare”. În măsura permisă de lege, <strong>${e}</strong> nu răspunde pentru
      întreruperi de găzduire, erori de conținut sau daune indirecte.
      Legea aplicabilă: <code>[PLACEHOLDER: jurisdicție]</code>.
    </p>
    <h2>Contact</h2>
    <p>
      Pentru întrebări despre acești termeni folosiți datele de contact de pe pagina principală
      sau <code>[PLACEHOLDER: e-mail legal]</code>.
    </p>
`,
    });
}

function cookiesHtml(config) {
    const biz = businessName(config);
    const e = escapeHtml(biz);
    return legalShell({
        biz,
        year: yearFrom(config),
        title: 'Politica de cookie-uri',
        h1: 'Politica de cookie-uri',
        bodyHtml: `
    <h2>Ce sunt cookie-urile</h2>
    <p>
      Cookie-urile și tehnologiile similare ajută site-ul <strong>${e}</strong>
      să țină minte preferințe simple, de exemplu alegerea făcută în banner.
    </p>
    <h2>Ce folosim pe acest site</h2>
    <ul>
      <li><strong>Esențiale / funcționale</strong> — browserul reține alegerea din bannerul de cookie-uri, astfel încât acesta să nu reapară la fiecare vizită.</li>
      <li><strong>Opționale</strong> — nu activăm analytics sau marketing fără consimțământ; orice instrument viitor va fi listat aici după decizia titularului afacerii.</li>
    </ul>
    <h2>Controlul dumneavoastră</h2>
    <p>
      Puteți accepta din banner, șterge datele site-ului din setările browserului sau folosi navigare privată.
      Blocarea stocării esențiale poate face bannerul să reapară. Detalii suplimentare:
      <code>[PLACEHOLDER: categorii / retenție cookie finală]</code>.
    </p>
    <h2>Mai multe</h2>
    <p>
      Vezi și <a href="privacy.html">Politica de confidențialitate</a> pentru datele din formulare.
    </p>
`,
    });
}

/** Shared bottom-chrome layout + cookie banner CSS (cookie-banner.css).
 * One contract for ALL commercial systems — not per-template patches:
 *   1. Consent card = compact bottom-LEFT (never bottom-right / full-bleed bar)
 *   2. Primary actions (.ls-dock / .whatsapp-float) = bottom-RIGHT
 *   3. Exactly one WhatsApp affordance when a call dock already ships WA
 *   4. Credibility strips + scroll labels never enter the FAB / cookie AABB
 * Open state is class-driven (html/body.hb-cookie-open) AND :has() so clearance
 * still applies if either signal is missing in a preview paint.
 */
const COOKIE_BANNER_CSS = `/* Hidook generated-site bottom chrome + cookie consent (shared layout rule). */
:root {
  --hb-fab-size: 3.25rem;
  --hb-fab-gap: 1rem;
  --hb-fab-safe-right: calc(var(--hb-fab-size) + var(--hb-fab-gap) + 0.35rem);
  --hb-fab-safe-bottom: calc(var(--hb-fab-size) + var(--hb-fab-gap));
  --hb-dock-safe-bottom: 0px;
  --hb-cookie-clearance: 0px;
  --hb-cookie-width-cap: 14.5rem;
}
/* Call dock present → reserve its height; suppress the duplicate WA float so
 * strangers never see two stacked WhatsApp controls on the first screen. */
body:has(.ls-dock),
html:has(.ls-dock) {
  --hb-dock-safe-bottom: 3.85rem;
}
body:has(.ls-dock__wa) .whatsapp-float,
body:has(.ls-dock) .whatsapp-float,
html:has(.ls-dock) .whatsapp-float {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
.hb-cookie-banner {
  position: fixed;
  z-index: 40;
  top: auto;
  left: 0.75rem;
  right: auto;
  bottom: calc(0.75rem + var(--hb-dock-safe-bottom));
  /* Never span into the FAB/dock corner — width capped to left half. */
  max-width: min(var(--hb-cookie-width-cap), calc(100vw - var(--hb-fab-safe-right) - 1.25rem));
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: 12px;
  background: #111;
  color: #f5f5f5;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  font-size: 0.82rem;
  line-height: 1.35;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: auto;
}
/* Narrow canvases: keep card above full-bleed docks; stay compact left. */
@media (max-width: 899px) {
  :root {
    /* Wider + shorter on narrow canvases: a tall skinny card climbs into
     * hero meta / explore labels. Cap width just left of the FAB zone. */
    --hb-cookie-width-cap: 18rem;
  }
  .hb-cookie-banner {
    left: 0.5rem;
    right: auto;
    bottom: calc(0.5rem + max(var(--hb-dock-safe-bottom), 0px));
    max-width: min(var(--hb-cookie-width-cap), calc(100vw - var(--hb-fab-safe-right) - 0.85rem));
    padding: 0.45rem 0.55rem;
    font-size: 0.74rem;
    line-height: 1.3;
    gap: 0.4rem;
  }
  body:not(:has(.ls-dock)) .hb-cookie-banner {
    /* Keep left of FAB; no need to stack above it when width is capped. */
    bottom: 0.5rem;
  }
}
/* Clearance token — class + :has so preview paints cannot drop the lift. */
html.hb-cookie-open,
body.hb-cookie-open,
body:has(#hb-cookie-banner:not([hidden])) {
  --hb-cookie-clearance: 10.25rem;
  scroll-padding-bottom: calc(var(--hb-cookie-clearance) + var(--hb-dock-safe-bottom) + var(--hb-fab-safe-bottom));
}
@media (max-width: 899px) {
  html.hb-cookie-open,
  body.hb-cookie-open,
  body:has(#hb-cookie-banner:not([hidden])) {
    /* Match the shorter mobile card height so hero padding does not overshoot. */
    --hb-cookie-clearance: 8rem;
  }
}
/* Bottom-aligned hero pitch / section seeds clear the left corner card. */
html.hb-cookie-open .ls-hero__copy,
body.hb-cookie-open .ls-hero__copy,
body:has(#hb-cookie-banner:not([hidden])) .ls-hero__copy,
html.hb-cookie-open .pf-hero__copy,
body.hb-cookie-open .pf-hero__copy,
body:has(#hb-cookie-banner:not([hidden])) .pf-hero__copy,
html.hb-cookie-open .pm-hero__copy,
body.hb-cookie-open .pm-hero__copy,
body:has(#hb-cookie-banner:not([hidden])) .pm-hero__copy,
html.hb-cookie-open .pr-hero__copy,
body.hb-cookie-open .pr-hero__copy,
body:has(#hb-cookie-banner:not([hidden])) .pr-hero__copy,
html.hb-cookie-open .hero-content,
body.hb-cookie-open .hero-content,
body:has(#hb-cookie-banner:not([hidden])) .hero-content {
  padding-bottom: calc(var(--hb-cookie-clearance) + 0.75rem);
  padding-right: max(0.5rem, calc(var(--hb-fab-safe-right) * 0.35));
  box-sizing: border-box;
}
/* Hero shells: margin-bottom (not only padding) so border-box min-height
 * templates actually push the next in-flow strip below the fixed chrome. */
html.hb-cookie-open .pf-hero__frame,
body.hb-cookie-open .pf-hero__frame,
body:has(#hb-cookie-banner:not([hidden])) .pf-hero__frame,
html.hb-cookie-open .ls-hero__cut,
body.hb-cookie-open .ls-hero__cut,
body:has(#hb-cookie-banner:not([hidden])) .ls-hero__cut,
html.hb-cookie-open .pr-hero,
body.hb-cookie-open .pr-hero,
body:has(#hb-cookie-banner:not([hidden])) .pr-hero,
html.hb-cookie-open header.hero,
body.hb-cookie-open header.hero,
body:has(#hb-cookie-banner:not([hidden])) header.hero,
html.hb-cookie-open .pf-hero,
body.hb-cookie-open .pf-hero,
body:has(#hb-cookie-banner:not([hidden])) .pf-hero,
html.hb-cookie-open .ls-hero,
body.hb-cookie-open .ls-hero,
body:has(#hb-cookie-banner:not([hidden])) .ls-hero {
  box-sizing: border-box;
  padding-bottom: var(--hb-cookie-clearance);
  margin-bottom: calc(var(--hb-dock-safe-bottom) + 0.35rem);
}
/* Credibility / meta strips at the fold — never enter FAB or cookie corners. */
.pr-strip {
  padding-inline-end: max(1rem, var(--hb-fab-safe-right)) !important;
  box-sizing: border-box;
  overflow-x: clip;
}
.pr-strip__row {
  padding-inline-end: max(0.5rem, var(--hb-fab-safe-right)) !important;
  max-width: 100%;
  box-sizing: border-box;
}
/* While consent is open, keep the strip OFF the first screen under fixed
 * chrome (border-box min-height heroes otherwise leave a peek strip under FAB). */
@media (max-width: 899px) {
  html.hb-cookie-open .pr-hero,
  body.hb-cookie-open .pr-hero,
  body:has(#hb-cookie-banner:not([hidden])) .pr-hero {
    min-height: 100vh !important;
    min-height: 100dvh !important;
    margin-bottom: 0 !important;
    padding-bottom: calc(var(--hb-cookie-clearance) + 1.25rem) !important;
  }
  html.hb-cookie-open .pr-strip,
  body.hb-cookie-open .pr-strip,
  body:has(#hb-cookie-banner:not([hidden])) .pr-strip,
  html.hb-cookie-open .pr-strip__row,
  body.hb-cookie-open .pr-strip__row,
  body:has(#hb-cookie-banner:not([hidden])) .pr-strip__row {
    /* No huge left pad — that crushed the flex row into the FAB column. */
    padding-inline-start: 0;
    padding-inline-end: max(1rem, var(--hb-fab-safe-right)) !important;
    padding-bottom: 0.85rem;
    box-sizing: border-box;
  }
}
html.hb-cookie-open .pr-hero__meta,
body.hb-cookie-open .pr-hero__meta,
body:has(#hb-cookie-banner:not([hidden])) .pr-hero__meta {
  /* Do not crush width — that wraps meta into a tall block under the card.
   * Horizontal FAB pad only; vertical clearance comes from hero copy padding. */
  max-width: 100%;
  padding-right: max(0.75rem, var(--hb-fab-safe-right));
  box-sizing: border-box;
}
/* Section titles near the fold — keep clear of the left corner card. */
html.hb-cookie-open .pm-ticket__label,
body.hb-cookie-open .pm-ticket__label,
body:has(#hb-cookie-banner:not([hidden])) .pm-ticket__label,
html.hb-cookie-open .pm-menublock__h,
body.hb-cookie-open .pm-menublock__h,
body:has(#hb-cookie-banner:not([hidden])) .pm-menublock__h,
html.hb-cookie-open .pm-rail__label,
body.hb-cookie-open .pm-rail__label,
body:has(#hb-cookie-banner:not([hidden])) .pm-rail__label {
  max-width: calc(100% - min(15rem, 42vw));
  box-sizing: border-box;
}
/* Scroll / explore labels — never under the FAB. Do NOT force left placement
 * (that put centered absolute cues like desserdirina under the cookie card).
 * Preserve each template's horizontal anchor; only enforce safe max-width and
 * a lifted bottom while consent is open. */
.pf-hint,
.scroll-hint,
.ls-scroll,
.scroll-indicator,
.pm-scroll {
  max-width: calc(100% - var(--hb-fab-safe-right) - 0.35rem);
  box-sizing: border-box;
  padding-inline-end: 0.5rem;
}
/* Professionals vertical cue — always clear of the FAB corner. */
.pr-scroll {
  right: var(--hb-fab-safe-right) !important;
}
/* Absolute / fixed scroll cues: lift above cookie + dock; keep template's
 * horizontal centering (left:50% + translateX) or right anchor. */
html.hb-cookie-open .scroll-indicator,
body.hb-cookie-open .scroll-indicator,
body:has(#hb-cookie-banner:not([hidden])) .scroll-indicator {
  bottom: calc(var(--hb-cookie-clearance) + var(--hb-dock-safe-bottom) + 0.75rem) !important;
  max-width: min(16rem, calc(100% - var(--hb-fab-safe-right) - 1rem));
  box-sizing: border-box;
  z-index: 2;
}
/* In-flow explore labels (portfolio / local-service / product-menu): keep left
 * of the FAB and pad so the full word is not under the fixed chrome stack. */
html.hb-cookie-open .pf-hint,
body.hb-cookie-open .pf-hint,
body:has(#hb-cookie-banner:not([hidden])) .pf-hint,
html.hb-cookie-open .scroll-hint,
body.hb-cookie-open .scroll-hint,
body:has(#hb-cookie-banner:not([hidden])) .scroll-hint,
html.hb-cookie-open .ls-scroll,
body.hb-cookie-open .ls-scroll,
body:has(#hb-cookie-banner:not([hidden])) .ls-scroll,
html.hb-cookie-open .pm-scroll,
body.hb-cookie-open .pm-scroll,
body:has(#hb-cookie-banner:not([hidden])) .pm-scroll {
  max-width: calc(100% - var(--hb-fab-safe-right) - 0.75rem) !important;
  padding-inline-end: var(--hb-fab-safe-right) !important;
  padding-bottom: calc(0.85rem + var(--hb-dock-safe-bottom)) !important;
  text-align: left !important;
  align-items: flex-start !important;
  box-sizing: border-box;
}
/* Portfolio/local/product-menu: park in-flow explore labels ABOVE the fixed
 * cookie + dock stack (left of FAB). Absolute placement is the only reliable
 * way past border-box min-height heroes that otherwise leave the label under
 * the card on the first screen. */
@media (max-width: 899px) {
  html.hb-cookie-open .ls-hero,
  body.hb-cookie-open .ls-hero,
  body:has(#hb-cookie-banner:not([hidden])) .ls-hero,
  html.hb-cookie-open .pf-hero,
  body.hb-cookie-open .pf-hero,
  body:has(#hb-cookie-banner:not([hidden])) .pf-hero,
  html.hb-cookie-open header.hero,
  body.hb-cookie-open header.hero,
  body:has(#hb-cookie-banner:not([hidden])) header.hero {
    position: relative;
  }
  html.hb-cookie-open .pf-hero__frame,
  body.hb-cookie-open .pf-hero__frame,
  body:has(#hb-cookie-banner:not([hidden])) .pf-hero__frame,
  html.hb-cookie-open .ls-hero__cut,
  body.hb-cookie-open .ls-hero__cut,
  body:has(#hb-cookie-banner:not([hidden])) .ls-hero__cut {
    min-height: calc(100vh - 2.5rem) !important;
    padding-bottom: calc(var(--hb-cookie-clearance) + var(--hb-dock-safe-bottom) + 2.75rem) !important;
  }
  html.hb-cookie-open .pf-hint,
  body.hb-cookie-open .pf-hint,
  body:has(#hb-cookie-banner:not([hidden])) .pf-hint,
  html.hb-cookie-open .ls-scroll,
  body.hb-cookie-open .ls-scroll,
  body:has(#hb-cookie-banner:not([hidden])) .ls-scroll,
  html.hb-cookie-open .pm-scroll,
  body.hb-cookie-open .pm-scroll,
  body:has(#hb-cookie-banner:not([hidden])) .pm-scroll {
    /* fixed to the viewport — absolute bottom was relative to a tall hero
     * box and left the label under the viewport-fixed cookie card. */
    position: fixed !important;
    left: 0.75rem !important;
    right: auto !important;
    bottom: calc(var(--hb-cookie-clearance) + var(--hb-dock-safe-bottom) + 0.5rem) !important;
    width: auto !important;
    max-width: calc(100vw - var(--hb-fab-safe-right) - 1.5rem) !important;
    margin: 0 !important;
    padding: 0.35rem 0.5rem !important;
    text-align: left !important;
    align-items: flex-start !important;
    background: transparent !important;
    z-index: 36;
    box-sizing: border-box;
    pointer-events: auto;
  }
}
/* Absolute vertical cue (professionals): above chrome, left of FAB. */
html.hb-cookie-open .pr-scroll,
body.hb-cookie-open .pr-scroll,
body:has(#hb-cookie-banner:not([hidden])) .pr-scroll {
  left: auto !important;
  right: var(--hb-fab-safe-right) !important;
  bottom: calc(var(--hb-cookie-clearance) + var(--hb-dock-safe-bottom) + 0.5rem) !important;
  transform: rotate(180deg) !important;
  text-align: center !important;
}
/* Primary call docks / WA floats stay bottom-right — opposite corner from the
 * consent card — so they remain fully readable and tappable without a fragile
 * bottom-lift race against the card height. */
.hb-cookie-banner[hidden] { display: none !important; }
.hb-cookie-banner p { margin: 0; opacity: 0.92; }
.hb-cookie-banner a { color: #c8e6c9; text-decoration: underline; }
.hb-cookie-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  pointer-events: auto;
}
.hb-cookie-banner button {
  appearance: none;
  border: 0;
  border-radius: 8px;
  padding: 0.55rem 1rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  background: #25d366;
  color: #06210f;
  position: relative;
  z-index: 1;
  pointer-events: auto;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
}
.hb-cookie-banner button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.hb-cookie-banner .hb-cookie-link {
  font-size: 0.88rem;
}
.hb-legal-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 0.65rem 0 0;
  font-size: 0.85rem;
}
.hb-legal-links a {
  color: inherit;
  text-decoration: underline;
  opacity: 0.85;
}
.hb-legal-links a:hover { opacity: 1; }
`;

const COOKIE_BANNER_JS = `/* Hidook cookie consent — dismissible, non-blocking essentials */
(function () {
  var KEY = 'hb-cookie-consent';
  var docBound = false;
  function readCookie() {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i].trim();
        if (s.indexOf(KEY + '=') === 0) return decodeURIComponent(s.slice(KEY.length + 1));
      }
    } catch (e) { /* ignore */ }
    return '';
  }
  function accepted() {
    try { if (localStorage.getItem(KEY)) return true; } catch (e) { /* private mode */ }
    var c = readCookie();
    if (c) {
      try { localStorage.setItem(KEY, c); } catch (e) { /* private mode */ }
      return true;
    }
    return false;
  }
  function persist() {
    try { localStorage.setItem(KEY, 'accepted'); } catch (e) { /* private mode */ }
    try { document.cookie = KEY + '=accepted; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) { /* ignore */ }
  }
  function setOpenClass(on) {
    try {
      var root = document.documentElement;
      if (root && root.classList) {
        if (on) root.classList.add('hb-cookie-open');
        else root.classList.remove('hb-cookie-open');
      }
    } catch (e) { /* ignore */ }
    try {
      if (document.body && document.body.classList) {
        if (on) document.body.classList.add('hb-cookie-open');
        else document.body.classList.remove('hb-cookie-open');
      }
    } catch (e) { /* ignore */ }
  }
  function hideBanner() {
    var el = document.getElementById('hb-cookie-banner');
    if (!el) return;
    el.hidden = true;
    try { el.setAttribute('hidden', ''); } catch (e) { /* ignore */ }
    try { el.style.setProperty('display', 'none', 'important'); } catch (e) { /* ignore */ }
    try { el.setAttribute('data-hb-consent-dismissed', 'true'); } catch (e) { /* ignore */ }
    setOpenClass(false);
  }
  function accept(e) {
    // Avoid preventDefault: on pointerdown it can suppress the subsequent click
    // and confuse actionability in sandboxed srcdoc previews.
    persist();
    hideBanner();
  }
  function acceptTarget(t) {
    if (!t) return null;
    if (t.nodeType === 3) t = t.parentElement;
    if (!t || !t.closest) {
      return t && t.id === 'hb-cookie-accept' ? t : null;
    }
    return t.closest('#hb-cookie-accept');
  }
  function onActivate(e) {
    if (!acceptTarget(e && e.target)) return;
    accept(e);
  }
  function bindDocument() {
    if (docBound) return;
    docBound = true;
    // Capture-phase delegation survives node swaps and runs even when a
    // direct button listener was lost after a provisional srcdoc paint.
    // pointerdown fires before layout can cancel the click gesture.
    document.addEventListener('pointerdown', onActivate, true);
    document.addEventListener('click', onActivate, true);
  }
  function bindButton(btn) {
    if (!btn) return;
    if (btn.getAttribute('data-hb-bound') === '1') return;
    btn.setAttribute('data-hb-bound', '1');
    btn._hbBound = true;
    btn.addEventListener('pointerdown', accept);
    btn.addEventListener('click', accept);
    // Property handler: first trusted click must dismiss even if addEventListener
    // was dropped by a mid-load document replacement in catalog srcdoc previews.
    btn.onclick = accept;
  }
  function markReady(el) {
    if (!el) return;
    try { el.setAttribute('data-hb-consent-ready', 'true'); } catch (e) { /* ignore */ }
  }
  function show() {
    bindDocument();
    var el = document.getElementById('hb-cookie-banner');
    if (!el) return;
    if (accepted() || el.getAttribute('data-hb-consent-dismissed') === 'true') {
      hideBanner();
      markReady(el);
      return;
    }
    el.hidden = false;
    try { el.removeAttribute('hidden'); } catch (e) { /* ignore */ }
    try { el.style.removeProperty('display'); } catch (e) { /* ignore */ }
    setOpenClass(true);
    bindButton(document.getElementById('hb-cookie-accept'));
    markReady(el);
  }
  // Expose for inline fallback + preview-ready gating.
  try { window.__hbCookieAccept = accept; } catch (e) { /* ignore */ }
  bindDocument();
  if (document.getElementById('hb-cookie-banner')) show();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', show);
  } else {
    show();
  }
})();
`;

/** Markup snippet injected into templates (before </body>). */
const COOKIE_BANNER_HTML = `    <div id="hb-cookie-banner" class="hb-cookie-banner" role="dialog" aria-label="Consimțământ cookie-uri" hidden>
      <p>Folosim stocare locală esențială ca să reținem preferințele tale (inclusiv acest banner). <a class="hb-cookie-link" href="cookies.html">Politica de cookie-uri</a></p>
      <div class="hb-cookie-actions">
        <button type="button" onclick="try{window.__hbCookieAccept&&window.__hbCookieAccept(event)}catch(e){}" id="hb-cookie-accept">Acceptă</button>
        <a class="hb-cookie-link" href="cookies.html">Află mai mult</a>
      </div>
    </div>
    <link rel="stylesheet" href="cookie-banner.css">
    <script src="cookie-banner.js"></script>
`;

const LEGAL_FOOTER_NAV = `                <nav class="hb-legal-links" aria-label="Pagini legale">
                    <a href="privacy.html">Confidențialitate</a>
                    <a href="terms.html">Termeni</a>
                    <a href="cookies.html">Cookie-uri</a>
                </nav>
`;

/**
 * Write privacy.html, terms.html, cookies.html + cookie-banner assets into siteDir.
 * @param {string} siteDir
 * @param {object} config
 * @returns {{ files: string[] }}
 */
function writeLegalSiteFiles(siteDir, config) {
    const files = [];
    const pairs = [
        ['privacy.html', privacyHtml(config)],
        ['terms.html', termsHtml(config)],
        ['cookies.html', cookiesHtml(config)],
        ['cookie-banner.css', COOKIE_BANNER_CSS],
        ['cookie-banner.js', COOKIE_BANNER_JS],
    ];
    fs.mkdirSync(siteDir, { recursive: true });
    for (const [name, body] of pairs) {
        fs.writeFileSync(path.join(siteDir, name), body, 'utf8');
        files.push(name);
    }
    return { files };
}

module.exports = {
    escapeHtml,
    businessName,
    privacyHtml,
    termsHtml,
    cookiesHtml,
    writeLegalSiteFiles,
    COOKIE_BANNER_CSS,
    COOKIE_BANNER_JS,
    COOKIE_BANNER_HTML,
    LEGAL_FOOTER_NAV,
};
