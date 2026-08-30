'use strict';
/**
 * bot/test/s86-s85-advocate.test.js — S86 remake of S85 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 3e231db (S83 ACCEPT):
 *   1. business.name cascade leaves factory IG/FB url/email (and about/chips without full identity)
 *   2. Meseriași remaining service ASCII + band CTA undiacritic
 *   3. Professionals Detalii: "Link Instagram contact"
 *   4. Unauth #dashboard empty state has no Intră control
 *   5. Live appointment confirmation prints (Europe/Bucharest)
 *
 * Overlay RED on parent, GREEN on HEAD. Isolated static + cascade vm only.
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
const PM_PRESETS = 'templates/product-menu/presets.json';
const PRO_PRESETS = 'templates/professionals/presets.json';
const PM_TPL = 'templates/product-menu/template.html';
const PRO_TPL = 'templates/professionals/template.html';

const { renderHtml } = require('../../build.js');

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

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(m.index, i);
}

function loadFirstPreset(rel) {
  const body = JSON.parse(read(rel));
  const presets = body.presets || [];
  assert.ok(presets.length >= 1, rel + ' has presets');
  return JSON.parse(JSON.stringify(presets[0].config));
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

/** Run cascadeBusinessNameIdentity from app source against a config clone. */
function runCascade(appSrc, config, oldName, newName) {
  const fn = extractFunction(appSrc, 'cascadeBusinessNameIdentity');
  assert.ok(fn && fn.length > 40, 'cascadeBusinessNameIdentity must exist in app.js');
  const getPathFn = extractFunction(appSrc, 'getPath');
  const setPathFn = extractFunction(appSrc, 'setPath');
  assert.ok(getPathFn && setPathFn, 'getPath/setPath required');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(getPathFn + '\n' + setPathFn + '\n' + fn + '\n', sandbox);
  const cfg = JSON.parse(JSON.stringify(config));
  sandbox.cascadeBusinessNameIdentity(cfg, oldName, newName);
  if (cfg.business) cfg.business.name = newName;
  return cfg;
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
check('causal RED: parent cascade leaves Casa Nord factory IG/FB url after rename', () => {
  const src = parentBlob(APP_JS);
  const presets = parentBlob(PM_PRESETS);
  assert.ok(src && presets, 'parent blobs');
  const body = JSON.parse(presets);
  const cfg = JSON.parse(JSON.stringify(body.presets[0].config));
  assert.strictEqual(cfg.business.name, 'Casa Nord');
  const fn = extractFunction(src, 'cascadeBusinessNameIdentity');
  assert.ok(fn, 'parent has cascade from S83');
  const getPathFn = extractFunction(src, 'getPath');
  const setPathFn = extractFunction(src, 'setPath');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(getPathFn + '\n' + setPathFn + '\n' + fn + '\n', sandbox);
  const next = JSON.parse(JSON.stringify(cfg));
  sandbox.cascadeBusinessNameIdentity(next, 'Casa Nord', 'Advocate S85');
  next.business.name = 'Advocate S85';
  const blob = JSON.stringify(next);
  // Parent cascade does not clear factory social / slug identity
  assert.ok(
    /casa\.nord|casanord|Casa Nord/.test(blob),
    'parent still has Casa Nord / casa.nord / casanord after cascade'
  );
});

check('causal RED: parent cascade leaves cabinet-marin.example email', () => {
  const src = parentBlob(APP_JS);
  const presets = parentBlob(PRO_PRESETS);
  assert.ok(src && presets, 'parent blobs');
  const body = JSON.parse(presets);
  const cfg = JSON.parse(JSON.stringify(body.presets[0].config));
  assert.ok(/Cabinet Marin/.test(cfg.business.name), 'factory Cabinet Marin');
  assert.ok(/cabinet-marin\.example/.test(cfg.contact.email), 'factory email');
  const fn = extractFunction(src, 'cascadeBusinessNameIdentity');
  const getPathFn = extractFunction(src, 'getPath');
  const setPathFn = extractFunction(src, 'setPath');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(getPathFn + '\n' + setPathFn + '\n' + fn + '\n', sandbox);
  const next = JSON.parse(JSON.stringify(cfg));
  sandbox.cascadeBusinessNameIdentity(next, 'Cabinet Marin', 'Cabinet Advocate S85');
  next.business.name = 'Cabinet Advocate S85';
  assert.ok(
    /cabinet-marin\.example/.test(next.contact.email),
    'parent email still cabinet-marin.example after cascade'
  );
});

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
check('HEAD: restaurant name cascade clears Casa Nord / casa.nord / casanord identity', () => {
  const appSrc = read(APP_JS);
  const cfg = loadFirstPreset(PM_PRESETS);
  assert.strictEqual(cfg.business.name, 'Casa Nord');
  const newName = 'Advocate S85';
  const next = runCascade(appSrc, cfg, 'Casa Nord', newName);
  assert.strictEqual(next.business.name, newName);
  assert.ok(next.business.about && !/Casa Nord/.test(next.business.about), 'about free of Casa Nord');
  assert.ok(next.business.about.startsWith(newName) || !/Casa Nord/.test(next.business.about), 'about updated');
  assert.ok(!/Casa Nord/.test(next.contact.facebook.label || ''), 'fb label free');
  assert.ok(!/casanord|casa\.nord|casa-nord/i.test(next.contact.facebook.url || ''), 'fb url free of old slug');
  assert.ok(!/casa\.nord|casanord|casa-nord/i.test(next.instagram.handle || ''), 'ig handle free');
  assert.ok(!/casa\.nord|casanord|casa-nord/i.test(next.instagram.url || ''), 'ig url free');
  assert.ok(!/casa\.nord|casanord|casa-nord/i.test((next.contact.instagram && next.contact.instagram.url) || ''), 'contact ig url free');
  assert.ok(!/casa\.nord|casanord|Casa Nord/i.test((next.contact.instagram && next.contact.instagram.label) || ''), 'contact ig label free');
  const blob = JSON.stringify({
    about: next.business.about,
    fb: next.contact.facebook,
    ig: next.instagram,
    cig: next.contact.instagram,
  });
  assert.ok(!/Casa Nord|casa\.nord|casanord/i.test(blob), 'identity blob free of factory: ' + blob.slice(0, 200));
});

check('HEAD: after restaurant cascade, renderHtml has no factory IG/FB slug', () => {
  const appSrc = read(APP_JS);
  const cfg = loadFirstPreset(PM_PRESETS);
  const next = runCascade(appSrc, cfg, 'Casa Nord', 'Advocate S85');
  const html = renderHtml(read(PM_TPL), next);
  assert.ok(!/Casa Nord/.test(html), 'html free of Casa Nord');
  assert.ok(!/casa\.nord\.bucuresti/i.test(html), 'html free of @casa.nord.bucuresti');
  assert.ok(!/casanordbucuresti/i.test(html), 'html free of facebook casanord slug');
  assert.ok(/Advocate S85/.test(html), 'html shows new name');
});

check('HEAD: professionals cascade clears Cabinet Juridic Ionescu heading leftovers and email', () => {
  const appSrc = read(APP_JS);
  const cfg = loadFirstPreset(PRO_PRESETS);
  assert.ok(/Cabinet Juridic Ionescu/.test(cfg.business.name), 'factory name');
  assert.strictEqual(cfg.contact.email, 'contact@cabinetjuridicionescu.ro', 'professional seed uses a plausible .ro email');
  const newName = 'Cabinet Advocate S85';
  const next = runCascade(appSrc, cfg, 'Cabinet Juridic Ionescu', newName);
  assert.strictEqual(next.business.name, newName);
  assert.ok(!/Cabinet Juridic Ionescu/.test(next.business.title || ''), 'title free of Cabinet Juridic Ionescu');
  assert.ok(!/cabinetjuridicionescu/i.test(next.contact.email || ''), 'email free of factory identity');
  assert.ok(!/Cabinet Juridic Ionescu/.test(JSON.stringify(next.business)), 'business block free of Cabinet Juridic Ionescu');
  const html = renderHtml(read(PRO_TPL), next);
  assert.ok(!/Cabinet Juridic Ionescu/.test(html), 'live html free of Cabinet Juridic Ionescu');
  assert.ok(!/contact@cabinetjuridicionescu\.ro/i.test(html), 'live html free of factory email');
  assert.ok(html.includes(newName), 'live html has new name');
});

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

check('HEAD: unauth dashboard empty-state source includes visible auth control', () => {
  const src = read(APP_JS);
  assert.ok(
    /Autentifică-te ca să vezi proiectele|Sign in to see your projects/.test(src),
    'unauth message remains (RO preferred)'
  );
  // Every unauth empty-state assignment includes an auth control
  const re =
    /(?:list\.innerHTML\s*=\s*)(['`])([\s\S]*?)\1/g;
  let m;
  let unauthBlocks = 0;
  while ((m = re.exec(src))) {
    const body = m[2];
    if (!/Autentifică-te ca să vezi proiectele|Sign in to see your projects/.test(body)) continue;
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

check('HEAD: cascade wired on drawer and canvas name edits + rerender after cascade', () => {
  const src = read(APP_JS);
  assert.ok(/cascadeBusinessNameIdentity\s*\(/.test(src), 'cascade called');
  const hasWiring =
    /business\.name[\s\S]{0,200}cascadeBusinessNameIdentity|cascadeBusinessNameIdentity[\s\S]{0,200}business\.name/.test(
      src
    ) ||
    /key\s*===\s*['"]business\.name['"][\s\S]{0,300}cascadeBusinessNameIdentity/.test(src) ||
    /path\s*===\s*['"]business\.name['"][\s\S]{0,300}cascadeBusinessNameIdentity/.test(src);
  assert.ok(hasWiring, 'cascade wired to business.name');
  // After cascade, iframe must re-render (about + chips)
  assert.ok(
    /cascadeBusinessNameIdentity[\s\S]{0,400}scheduleRerender|cascadeBusinessNameIdentity[\s\S]{0,400}fullRerender/.test(
      src
    ),
    'rerender after cascade'
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

check('HEAD non-regress: landing still shows 99€ / 29€ and Fără boți', () => {
  const html = read('builder/index.html');
  assert.ok(/99\s*€|99€/.test(html), '99€');
  assert.ok(/29\s*€|29€/.test(html), '29€');
  assert.ok(/Fără boți|Fara boti/i.test(html), 'Fără boți RO denial');
  assert.ok(!/No bots/i.test(html), 'no English No bots on landing');
});

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll s86-s85-advocate checks passed.');
process.exit(0);
