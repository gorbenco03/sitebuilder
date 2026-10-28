'use strict';
/**
 * bot/test/s86-s85-advocate.test.js — S86 remake of S85 ADVOCATE: STILL STANDING leaks.
 *
 * Form editor removed 2026-10-28: leftover 1 (business.name cascade clearing factory IG/FB
 * url/email in the editor, cascadeBusinessNameIdentity) lived in the deleted editor; its parent-RED,
 * HEAD and wiring checks were dropped. The rest stays.
 *
 * Causal leftovers on parent 3e231db (S83 ACCEPT):
 *   2. Meseriași remaining service ASCII + band CTA undiacritic
 *   3. Professionals Detalii: "Link Instagram contact"
 *   4. Unauth #dashboard empty state has no Intră control
 *   5. Live appointment confirmation prints (Europe/Bucharest)
 *
 * Overlay RED on parent, GREEN on HEAD. Isolated static + copy-ro vm only.
 * Run: node bot/test/s86-s85-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '3e231db87843efb96af8bd118de6f882ad7c9d6d';
const APP_JS = 'builder/app.js';
const LS_PRESETS = 'templates/local-service/presets.json';
const LS_TEMPLATE = 'templates/local-service/template.html';
const PRO_SCHEMA = 'templates/professionals/schema.json';
const PRO_SCRIPT = 'templates/professionals/script.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function parentBlob(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function collectLabels(schema) {
  const labels = [];
  function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (typeof n.label === 'string') labels.push(n.label);
      if (typeof n.title === 'string') labels.push(n.title);
      Object.values(n).forEach(walk);
    }
  }
  walk(schema);
  return labels;
}

const MESERIASI_ASCII_S85 = [
  'Rigips si tavane false',
  'Vopsitorie si tencuiala',
  'Gresie si faianta',
  'Instalatii sanitare',
  'Instalatii electrice',
  'Parchet si laminat',
  'Renovare completa casa',
  'Gata sa incepem',
  'raspundem in aceeasi zi',
];

// ── Causal RED on parent ───────────────────────────────────────────────────
check('causal RED: parent Meseriași still has remaining service/band ASCII', () => {
  const presets = parentBlob(LS_PRESETS);
  const tpl = parentBlob(LS_TEMPLATE);
  assert.ok(presets && tpl, 'parent local-service');
  const joined = presets + '\n' + tpl;
  for (const s of MESERIASI_ASCII_S85) {
    assert.ok(joined.includes(s), 'parent leftover: ' + s);
  }
});

check('causal RED: parent professionals Detalii still Link Instagram contact', () => {
  const schema = parentBlob(PRO_SCHEMA);
  assert.ok(schema, 'parent schema');
  assert.ok(/Link Instagram contact/.test(schema), 'parent Link Instagram contact');
});

check('causal RED: parent unauth dashboard empty-state has no Intră control', () => {
  const src = parentBlob(APP_JS);
  assert.ok(src, 'parent app.js');
  assert.ok(
    /Trebuie s[ăa] te autentifici pentru a vedea proiectele/.test(src),
    'parent has unauth message'
  );
  // The 401 / unauth empty-state strings must not include Intră button markup nearby
  const re =
    /Trebuie s[ăa] te autentifici pentru a vedea proiectele\.[^`]{0,200}/g;
  let m;
  let saw = false;
  while ((m = re.exec(src))) {
    saw = true;
    assert.ok(
      !/Intr[ăa]/.test(m[0]),
      'parent unauth empty-state snippet has no Intră: ' + m[0].slice(0, 120)
    );
  }
  assert.ok(saw, 'found unauth empty-state snippets');
});

check('causal RED: parent appointment confirmation still prints Europe/Bucharest', () => {
  const script = parentBlob(PRO_SCRIPT);
  assert.ok(script, 'parent professionals script');
  assert.ok(
    /doneBody\.textContent\s*=\s*[\s\S]{0,120}\(\$\{tz\}\)|doneBody\.textContent\s*=\s*[\s\S]{0,80}\(Europe\/Bucharest\)/.test(
      script
    ) || /\`\$\{type\.label\} · \$\{when\} \(\$\{tz\}\)\`/.test(script),
    'parent confirmation embeds (${tz}) IANA'
  );
});

// ── GREEN on HEAD ──────────────────────────────────────────────────────────
check('HEAD: Meseriași first opened preset/template has no S85 ASCII leftovers', () => {
  const presets = read(LS_PRESETS);
  const tpl = read(LS_TEMPLATE);
  const joined = presets + '\n' + tpl;
  for (const s of MESERIASI_ASCII_S85) {
    assert.ok(!joined.includes(s), 'no leftover: ' + s);
  }
  // Positive finished Romanian forms.
  assert.ok(/Gips-carton și tavane suspendate/.test(joined), 'Gips-carton și tavane suspendate');
  assert.ok(/Zugrăveli și tencuieli/.test(joined), 'Zugrăveli și tencuieli');
  assert.ok(/Gresie, faianță și pardoseli/.test(joined), 'Gresie, faianță și pardoseli');
  assert.ok(/Instalații sanitare/.test(joined), 'Instalații sanitare');
  assert.ok(/Instalații electrice/.test(joined), 'Instalații electrice');
  assert.ok(/Parchet din lemn și laminat/.test(joined), 'Parchet din lemn și laminat');
  assert.ok(/Renovări complete/.test(joined), 'Renovări complete');
  assert.ok(/Pregătit să începem\?/.test(joined), 'Pregătit să începem?');
  assert.ok(/răspundem în aceeași zi/i.test(joined), 'răspundem în aceeași zi');
});

check('HEAD: professionals Detalii labels have no Link Instagram contact and no tel:', () => {
  const schema = JSON.parse(read(PRO_SCHEMA));
  const labels = collectLabels(schema);
  const joined = labels.join('\n');
  assert.ok(!/Link Instagram contact/i.test(joined), 'no Link Instagram contact');
  assert.ok(!/\btel:/i.test(joined), 'no tel: in labels');
  assert.ok(!/\bURL Instagram contact\b/i.test(joined), 'no URL Instagram contact');
  // Field remains usable
  const keys = [];
  function walkKeys(n) {
    if (Array.isArray(n)) return n.forEach(walkKeys);
    if (n && typeof n === 'object') {
      if (typeof n.key === 'string') keys.push(n.key);
      Object.values(n).forEach(walkKeys);
    }
  }
  walkKeys(schema);
  assert.ok(keys.includes('contact.instagram.url'), 'contact.instagram.url stays');
  // Label is human Romanian without raw English "contact" fragment as leftover word
  const igLabel = labels.find((l) => /Instagram/i.test(l) && /contact/i.test(l));
  // Either no label pairs Instagram+contact, or Romanian phrasing without English bare "contact" as last token of "Link Instagram contact"
  assert.ok(
    !igLabel || !/^Link Instagram contact$/i.test(igLabel),
    'no exact Link Instagram contact label'
  );
});

// T-3 (PLAN-UX-2026-09-27 §5.8) moved this string (and others) out of
// app.js's inline literals onto RO.DASHBOARD_AUTH_REQUIRED_TITLE
// (builder/copy-ro.js) — same shipped Romanian text, referenced by key
// instead of repeated inline. Resolve RO.<KEY> references back to their
// literal string before the regexes below look for the text itself, so
// this still proves the same customer-visible copy rather than assuming
// app.js always spells it out inline.
function loadCopyRoCatalog() {
  const src = fs.readFileSync(path.join(ROOT, 'builder/copy-ro.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.RO = RO;', sandbox);
  return sandbox.RO;
}
function resolveRoRefs(src) {
  const RO = loadCopyRoCatalog();
  return src.replace(/RO\.([A-Z0-9_]+)/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(RO, key) ? JSON.stringify(RO[key]) : m);
}

check('HEAD: unauth dashboard empty-state source includes visible auth control', () => {
  const src = resolveRoRefs(read(APP_JS));
  assert.ok(
    // copy-i18n#1 (audit27 R-16): "proiectele" -> "site-urile" — one term
    // ("site") for the product's core concept, everywhere in app.js.
    /Autentifică-te ca să vezi site-urile|Sign in to see your projects/.test(src),
    'unauth message remains (RO preferred)'
  );
  // Every unauth empty-state assignment includes an auth control. U-08
  // (PLAN-UX-2026-09-27 §6) moved these off inline string literals onto a
  // shared stateBlockHTML({...}) helper — match both forms.
  const re =
    /list\.innerHTML\s*=\s*(?:(['`])([\s\S]*?)\1|stateBlockHTML\(\{([\s\S]*?)\}\))/g;
  let m;
  let unauthBlocks = 0;
  while ((m = re.exec(src))) {
    const body = m[2] !== undefined ? m[2] : m[3];
    if (!/Autentifică-te ca să vezi site-urile|Sign in to see your projects/.test(body)) continue;
    unauthBlocks++;
    assert.ok(
      /Autentificare|Sign in/.test(body),
      'unauth block has auth control label: ' + body.slice(0, 160)
    );
    // Prefer a real control (button or anchor), not only the word in a sentence
    assert.ok(
      /<(?:button|a)\b[^>]*>[\s\S]*?(?:Autentificare|Sign in)/i.test(body) ||
        /(?:Autentificare|Sign in)[\s\S]{0,40}<\/(?:button|a)>/i.test(body),
      'auth label is a visible control'
    );
  }
  assert.ok(unauthBlocks >= 1, 'at least one unauth empty-state block');
  // Must wire existing magic-link / auth modal — not a second auth system
  assert.ok(/wireAuthForm\s*\(/.test(src), 'wireAuthForm still used');
  assert.ok(
    /dashboard[\s\S]{0,400}wireAuthForm|wireAuthForm[\s\S]{0,400}dashboard|btn-dashboard-auth|openDashboardAuth|modal-publish/.test(
      src
    ),
    'dashboard auth uses existing publish/auth path'
  );
});

check('HEAD: appointment confirmation text for stranger has no Europe/Bucharest', () => {
  const script = read(PRO_SCRIPT);
  // Visible confirmation assembly must not interpolate IANA tz into stranger text
  assert.ok(
    !/\`\$\{type\.label\} · \$\{when\} \(\$\{tz\}\)\`/.test(script),
    'no (${tz}) in confirmation template'
  );
  // Extract a minimal builder: simulate the display string rule from source
  // Prefer: when only, or friendly "ora României" — never raw Europe/Bucharest in doneBody
  const doneAssign = script.match(/doneBody\.textContent\s*=\s*([\s\S]{0,200}?);/);
  assert.ok(doneAssign, 'doneBody assignment present');
  assert.ok(
    !/Europe\/Bucharest/.test(doneAssign[1]),
    'doneBody expr free of Europe/Bucharest literal'
  );
  assert.ok(
    !/\(\$\{tz\}\)/.test(doneAssign[1]),
    'doneBody expr does not parenthesize ${tz}'
  );
  // tz still used for slot math
  assert.ok(
    /timeZone:\s*tz|data-tz|Europe\/Bucharest/.test(script),
    'Europe/Bucharest or tz still used for math'
  );
});

// Non-regression smoke — do not weaken S83/S80/S77 surfaces
check('HEAD non-regress: catalog chips still name five systems', () => {
  const html = read('builder/index.html');
  const chips = (html.match(/id=["']catalog-chips["'][\s\S]*?<\/div>/i) || [''])[0];
  assert.ok(/Restaurant/.test(chips), 'Restaurant chip');
  assert.ok(/Meserii|Trades/.test(chips), 'Meserii chip');
  assert.ok(/Salon/.test(chips), 'Salon chip');
  assert.ok(/Servicii profesionale|Professional services/.test(chips), 'Servicii profesionale chip');
  assert.ok(/Cofetărie|Desserdirina/.test(chips), 'Cofetărie chip');
});

check('HEAD non-regress: landing shows price+renewal spans (currency owner 2026-09-27), and Fără boți', () => {
  const html = read('builder/index.html');
  assert.ok(/id="hero-price">99</.test(html), 'hero-price span with 99 fallback');
  // Owner decision 2026-09-27: the 29/year renewal (with currency symbol,
  // filled by app.js from /api/config) is back on the landing page.
  assert.ok(/id="hero-renewal">29</.test(html), 'hero-renewal span with 29 fallback');
  assert.ok(/Fără boți|Fara boti/i.test(html), 'Fără boți RO denial');
  assert.ok(!/No bots/i.test(html), 'no English No bots on landing');
});

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll s86-s85-advocate checks passed.');
process.exit(0);
