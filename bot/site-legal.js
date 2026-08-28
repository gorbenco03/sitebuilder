'use strict';
/**
 * bot/site-legal.js — generated-site Privacy / Terms / Cookies pages + cookie banner.
 * Romanian visible copy. Owner-gated legal entity/VAT/jurisdiction placeholders only.
 * Zero dependencies. Used by build.js and ZIP export.
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
    <p class="hb-legal-meta">${biz} · ${y} · placeholder de produs</p>
    <div class="hb-legal-notice" role="note">
      <strong>Placeholder de produs — nu este consultanță juridică.</strong>
      Textul de mai jos este un schelet pentru site-ul generat. Datele legale complete
      (denumire entitate, CUI/VAT, adresă, jurisdicție, listă subprocessori) rămân
      <em>owner-gated</em> — nu inventăm text final de avocat. Înlocuiți marcajele
      <code>[PLACEHOLDER …]</code> înainte de livrare comercială.
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
      Baza legală tipică este interesul legitim sau executarea unei cereri precontractuale — detaliile finale rămân owner-gated.
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
      Cookie-urile și stocarea similară (localStorage) ajută site-ul <strong>${e}</strong>
      să țină minte preferințe simple, de exemplu consimțământul afișat în banner.
    </p>
    <h2>Ce folosim pe acest site</h2>
    <ul>
      <li><strong>Esențiale / funcționale</strong> — reținerea alegerii din bannerul de cookie-uri (<code>hb-cookie-consent</code>), astfel încât să nu reapară la fiecare vizită.</li>
      <li><strong>Opționale</strong> — nu activăm analytics sau marketing fără consimțământ; orice instrument viitor va fi listat aici după decizia owner-ului.</li>
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
  z-index: 99999;
  left: 1rem;
  right: 1rem;
  bottom: 1rem;
  max-width: 32rem;
  margin: 0 auto;
  padding: 1rem 1.1rem;
  border-radius: 12px;
  background: #111;
  color: #f5f5f5;
  box-shadow: 0 12px 40px rgba(0,0,0,.28);
  font-size: 0.92rem;
  line-height: 1.45;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.hb-cookie-banner[hidden] { display: none !important; }
.hb-cookie-banner p { margin: 0; opacity: 0.92; }
.hb-cookie-banner a { color: #c8e6c9; text-decoration: underline; }
.hb-cookie-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
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
  function accepted() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }
  function accept() {
    try { localStorage.setItem(KEY, 'accepted'); } catch (e) { /* private mode */ }
    var el = document.getElementById('hb-cookie-banner');
    if (el) el.hidden = true;
  }
  function show() {
    var el = document.getElementById('hb-cookie-banner');
    if (!el || accepted()) return;
    el.hidden = false;
    var btn = document.getElementById('hb-cookie-accept');
    if (btn && !btn._hbBound) {
      btn._hbBound = true;
      btn.addEventListener('click', accept);
    }
  }
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
        <button type="button" id="hb-cookie-accept">Accept</button>
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
