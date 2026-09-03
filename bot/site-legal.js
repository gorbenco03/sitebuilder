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

/** Shared cookie banner CSS (also linked from templates via cookie-banner.css). */
const COOKIE_BANNER_CSS = `/* Hidook generated-site cookie consent banner */
.hb-cookie-banner {
  position: fixed;
  z-index: 40;
  left: 1rem;
  right: auto;
  bottom: 1rem;
  max-width: min(22rem, calc(100vw - 2rem));
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: #111;
  color: #f5f5f5;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  font-size: 0.88rem;
  line-height: 1.45;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  pointer-events: auto;
}
@media (max-width: 520px) {
  .hb-cookie-banner {
    left: 0.75rem;
    right: 0.75rem;
    max-width: none;
    bottom: 0.75rem;
  }
}
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
  function hideBanner() {
    var el = document.getElementById('hb-cookie-banner');
    if (!el) return;
    el.hidden = true;
    try { el.setAttribute('hidden', ''); } catch (e) { /* ignore */ }
    try { el.style.setProperty('display', 'none', 'important'); } catch (e) { /* ignore */ }
    try { el.setAttribute('data-hb-consent-dismissed', 'true'); } catch (e) { /* ignore */ }
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
        <button type="button" id="hb-cookie-accept" onclick="try{window.__hbCookieAccept&&window.__hbCookieAccept(event)}catch(e){}">Acceptă</button>
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
