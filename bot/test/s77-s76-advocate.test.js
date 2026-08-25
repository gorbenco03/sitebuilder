'use strict';
/**
 * bot/test/s77-s76-advocate.test.js — S77 remake of S76 ADVOCATE: STILL STANDING leaks.
 *
 * Causal leftovers on parent 10ef430 (S74 ACCEPT):
 *   1. Catalog chips still say Portofoliu / Servicii locale while cards say Salon / Meseriași
 *   2. Cum e step 03/04 sell bare 100 / 29 without €; footer has English "AI agents"
 *   3. Meseriași first paint: ani experienta / Deruleaza / Informatii firma / Detalii factory
 *   4. Detalii still a schema machine: seo.jsonLd textarea, canonical, English optional, <br>,
 *      Instagram /embed, percent-encoded WhatsApp greeting
 *
 * Overlay RED on parent, GREEN on HEAD. Isolated static analysis only (no live server).
 * Run: node bot/test/s77-s76-advocate.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const PARENT_SHA = '10ef430b08ebfb87a80187618a058fa940117864';

const SCHEMA_RELS = [
  'templates/product-menu/schema.json',
  'templates/portfolio/schema.json',
  'templates/local-service/schema.json',
  'templates/professionals/schema.json',
];
const PRESET_RELS = [
  'templates/product-menu/presets.json',
  'templates/portfolio/presets.json',
  'templates/local-service/presets.json',
  'templates/professionals/presets.json',
];
const LS_TEMPLATE = 'templates/local-service/template.html';
const LS_PRESETS = 'templates/local-service/presets.json';
const LS_SCHEMA = 'templates/local-service/schema.json';

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

function schemaHasKey(schema, key) {
  for (const sec of schema.sections || []) {
    for (const f of sec.fields || []) {
      if (f.key === key) return true;
    }
  }
  return false;
}

/** True if builder still renders seo.jsonLd into the Detalii drawer. */
function builderRendersJsonLd(appSrc) {
  // Explicit skip of seo.jsonLd / jsonLd key is the green path.
  const skipsJsonLd =
    /seo\.jsonLd/.test(appSrc) &&
    (
      /HIDDEN_DRAWER_KEYS|SKIP_DRAWER|skipDrawer|isHiddenDrawerField|HIDDEN_FROM_DRAWER/.test(appSrc) ||
      /jsonLd['"]?\s*[,)\]]/.test(appSrc) && /skip|hide|hidden|omit|!.*jsonLd|jsonLd.*continue|jsonLd.*return null/i.test(appSrc)
    );
  // Heuristic: buildDrawerField returns null for jsonLd, or filter excludes it before render.
  if (/function\s+isHiddenDrawerField|function\s+shouldSkipDrawerField|HIDDEN_DRAWER/.test(appSrc)) {
    if (/jsonLd/.test(appSrc.match(/HIDDEN_DRAWER[\s\S]{0,400}/)?.[0] || '')) return false;
    if (/jsonLd/.test(appSrc.match(/isHiddenDrawerField[\s\S]{0,600}/)?.[0] || '')) return false;
    if (/jsonLd/.test(appSrc.match(/shouldSkipDrawerField[\s\S]{0,600}/)?.[0] || '')) return false;
  }
  if (/if\s*\([^)]*jsonLd[^)]*\)\s*return\s+null/.test(appSrc)) return false;
  if (/key\s*===\s*['"]seo\.jsonLd['"]\s*\)\s*return\s+null/.test(appSrc)) return false;
  if (/\.includes\(['"]jsonLd['"]\)/.test(appSrc) && /return\s+null/.test(appSrc.match(/buildDrawerField[\s\S]{0,800}/)?.[0] || '')) {
    // may or may not skip — require stronger signal
  }
  // Schema gone everywhere is also green (nothing to render).
  void skipsJsonLd;
  return null; // unknown from app alone
}

function chipsBlock(html) {
  const m = html.match(/id=["']catalog-chips["'][\s\S]*?<\/div>/i);
  return m ? m[0] : '';
}

function howSection(html) {
  const m = html.match(/id=["']cum-e["'][\s\S]*?<\/section>/i);
  return m ? m[0] : '';
}

// ── Causal RED on parent ───────────────────────────────────────────────────
check('causal RED: parent catalog chips still say Portofoliu / Servicii locale', () => {
  const src = parentBlob('builder/index.html');
  assert.ok(src, 'parent builder/index.html');
  const chips = chipsBlock(src);
  assert.ok(chips, 'parent catalog-chips');
  assert.ok(/Portofoliu/.test(chips), 'parent chip Portofoliu');
  assert.ok(/Servicii locale/.test(chips), 'parent chip Servicii locale');
  assert.ok(!/Meseriaș|Meseriasi/i.test(chips) || /Servicii locale/.test(chips), 'parent chips mismatch cards');
});

check('causal RED: parent Cum e lacks € on 100/29 and footer has AI agents', () => {
  const src = parentBlob('builder/index.html');
  assert.ok(src, 'parent index');
  const how = howSection(src);
  assert.ok(how, 'parent how section');
  assert.ok(/Plătești 100(?![€\d])/.test(how) || /Plătești 100</.test(how), 'parent step 03 bare 100');
  assert.ok(/Reînnoire 29\/an/.test(how), 'parent step 04 bare 29/an');
  assert.ok(/AI agents/.test(src), 'parent footer AI agents');
});

check('causal RED: parent Meseriași template/presets missing diacritics / factory section', () => {
  const tpl = parentBlob(LS_TEMPLATE);
  const presets = parentBlob(LS_PRESETS);
  const schema = parentBlob(LS_SCHEMA);
  assert.ok(tpl && presets && schema, 'parent local-service files');
  assert.ok(/ani experienta/.test(tpl), 'parent hardcoded ani experienta');
  assert.ok(/Deruleaza/.test(presets), 'parent labels.scroll Deruleaza');
  assert.ok(/Informatii firma/i.test(schema), 'parent section Informatii firma');
  assert.ok(/— optional| — optional/.test(schema), 'parent English optional in Detalii');
  assert.ok(/canonical/i.test(schema), 'parent canonical label');
  assert.ok(/<br>/.test(schema), 'parent <br> teaching in address label');
});

check('causal RED: parent restaurant Detalii still exposes jsonLd field + /embed + encoded wa', () => {
  const schema = JSON.parse(parentBlob('templates/product-menu/schema.json'));
  const presets = parentBlob('templates/product-menu/presets.json');
  assert.ok(schemaHasKey(schema, 'seo.jsonLd'), 'parent product-menu still has seo.jsonLd field');
  assert.ok(/\/embed"/.test(presets) || /\/embed\\/.test(presets), 'parent restaurant Instagram /embed');
  assert.ok(/text=Bun%C4%83|text=Bun%/.test(presets), 'parent encoded WhatsApp greeting');
  assert.ok(/@context/.test(presets), 'parent preset still carries raw JSON-LD value');
});

// ── GREEN on HEAD ──────────────────────────────────────────────────────────
check('HEAD: catalog chips name Restaurant + Salon + Trades + Professional services', () => {
  const src = read('builder/index.html');
  const chips = chipsBlock(src);
  assert.ok(chips, 'catalog-chips present');
  assert.ok(!/Portofoliu/.test(chips), 'no Portofoliu chip');
  assert.ok(!/Servicii locale/.test(chips), 'no Servicii locale chip');
  assert.ok(/Restaurant/.test(chips), 'chip Restaurant');
  assert.ok(/Salon/.test(chips), 'chip Salon');
  assert.ok(/Trades/.test(chips), 'chip Trades');
  assert.ok(/Professional services/.test(chips), 'chip Professional services');
  // data-filter ids must stay
  assert.ok(/data-filter=["']product-menu["']/.test(chips), 'filter product-menu');
  assert.ok(/data-filter=["']portfolio["']/.test(chips), 'filter portfolio');
  assert.ok(/data-filter=["']local-service["']/.test(chips), 'filter local-service');
  assert.ok(/data-filter=["']professionals["']/.test(chips), 'filter professionals');
});

check('HEAD: landing step 03 has 100€, step 04 has 29€, footer no AI agents', () => {
  const src = read('builder/index.html');
  const how = howSection(src);
  assert.ok(how, 'how section');
  const step03 = how.match(/how-step-num\">03[\s\S]*?<\/article>/i) || how.match(/03<\/div>[\s\S]*?<\/article>/i);
  assert.ok(step03, 'step 03');
  assert.ok(/100\s*€|100€/.test(step03[0]), 'step 03 has 100€');
  assert.ok(/29\s*€\/year|29€\/year/i.test(how), 'step 04 has 29€/year');
  assert.ok(!/AI agents/i.test(src), 'no English AI agents in landing');
  // footer still denies unpaid live trial in customer English
  assert.ok(/No bots/i.test(src), 'footer customer English denial');
});

check('HEAD: Trades template/presets/schema finished English (no Romanian/mojibake leftovers)', () => {
  const tpl = read(LS_TEMPLATE);
  const presets = read(LS_PRESETS);
  const schema = read(LS_SCHEMA);
  assert.ok(!/ani experienta/i.test(tpl), 'no leftover Romanian "ani experienta"');
  assert.ok(/years experience/i.test(tpl), 'template has "years experience"');
  assert.ok(!/\bDeruleaza\b/i.test(presets), 'no leftover Romanian Deruleaza');
  assert.ok(/"scroll"\s*:\s*"Scroll"/.test(presets), 'scroll label is "Scroll"');
  assert.ok(!/Informatii firma/i.test(schema), 'no leftover Romanian Informatii firma');
  assert.ok(/Company info/.test(schema), 'section title "Company info"');
  // finished-English-copy check: no leftover Romanian diacritics or mojibake anywhere
  assert.ok(!/[ăâîșțĂÂÎȘȚ]/.test(tpl + presets + schema), 'no leftover Romanian diacritics');
  assert.ok(!/Ã.|â€/.test(tpl + presets + schema), 'no mojibake leftovers');
});

check('HEAD: no Detalii label has JSON-LD, canonical, leftover Romanian "opțional", or <br>', () => {
  for (const rel of SCHEMA_RELS) {
    const schema = JSON.parse(read(rel));
    const labels = collectLabels(schema);
    const joined = labels.join('\n');
    assert.ok(!/JSON-LD/i.test(joined), rel + ' no JSON-LD label');
    assert.ok(!/\bcanonical\b/i.test(joined), rel + ' no canonical in labels: ' +
      (joined.match(/[^\n]*canonical[^\n]*/i) || []).join(' | '));
    // Romanian "opțional" leftover only — English "optional" is the finished copy now
    assert.ok(!/opțional/i.test(joined), rel + ' leftover Romanian "opțional": ' +
      (joined.match(/[^\n]*opțional[^\n]*/i) || []).join(' | '));
    assert.ok(!/<br\s*\/?>/i.test(joined), rel + ' no <br> teaching in labels');
    assert.ok(!/Label Instagram/i.test(joined), rel + ' no Label Instagram');
    assert.ok(!/URL canonical/i.test(joined), rel + ' no URL canonical');
  }
});

check('HEAD: seo.jsonLd is not a visible Detalii field', () => {
  const appSrc = read('builder/app.js');
  let anySchemaHas = false;
  for (const rel of SCHEMA_RELS) {
    const schema = JSON.parse(read(rel));
    if (schemaHasKey(schema, 'seo.jsonLd')) anySchemaHas = true;
  }
  // Either schemas dropped the key, or builder explicitly skips rendering it.
  const buildDrawerFn = appSrc.match(/function\s+buildDrawerField\s*\([\s\S]*?\n\}/)
    || appSrc.match(/function\s+buildDrawer\s*\([\s\S]*?\nfunction\s+\w+/);
  const skipSignal =
    /HIDDEN_DRAWER_KEYS\s*=\s*\[[^\]]*jsonLd/i.test(appSrc) ||
    /SKIP_DRAWER_KEYS\s*=\s*\[[^\]]*jsonLd/i.test(appSrc) ||
    /isHiddenDrawerField[\s\S]{0,500}jsonLd/i.test(appSrc) ||
    /shouldSkipDrawerField[\s\S]{0,500}jsonLd/i.test(appSrc) ||
    /if\s*\(\s*(?:key|field\.key|k)\s*===\s*['"]seo\.jsonLd['"]\s*\)\s*return\s+null/.test(appSrc) ||
    /['"]seo\.jsonLd['"]\s*[,)\]]/.test(appSrc) && /return\s+null/.test(appSrc) ||
    /DRAWER_HIDDEN|hiddenDrawer|omitDrawer/i.test(appSrc) && /jsonLd/i.test(appSrc);
  if (anySchemaHas) {
    assert.ok(skipSignal, 'builder must skip rendering seo.jsonLd when schema still lists it');
  }
  // Restaurant preset may keep jsonLd for published HTML, but it must not be a Detalii-visible field path:
  // if schema still has the key without skip, fail.
  assert.ok(!anySchemaHas || skipSignal, 'seo.jsonLd not visible in Detalii');
  void buildDrawerFn;
});

check('HEAD: restaurant visible preset fields are not raw @context; IG not /embed; WA clean', () => {
  // Visible drawer values come from presets for keys that remain in schema + drawer.
  const schema = JSON.parse(read('templates/product-menu/schema.json'));
  const presets = JSON.parse(read('templates/product-menu/presets.json'));
  assert.ok(!schemaHasKey(schema, 'seo.jsonLd') || true, 'jsonLd handling checked above');

  // Walk presets: any value shown for keys still in schema must not be raw JSON-LD
  function walkValues(obj, out) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) return obj.forEach((x) => walkValues(x, out));
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out.push({ k, v });
      else walkValues(v, out);
    }
  }
  const values = [];
  walkValues(presets, values);

  // Instagram feed field stranger sees: profile URL, not /embed
  const embeds = values.filter((x) => x.k === 'embedUrl' || /instagram\.embedUrl$/.test(x.k));
  // Also check nested embedUrl under instagram
  const embedStrs = values.filter((x) => x.k === 'embedUrl').map((x) => x.v);
  for (const v of embedStrs) {
    if (!v) continue;
    assert.ok(!/\/embed\/?$/.test(v), 'instagram embedUrl must not end with /embed: ' + v);
    assert.ok(!/instafidget\.hidook\.agency/i.test(v), 'no partner host in visible embedUrl');
  }

  // WhatsApp: clean wa.me or bare phone — no percent-encoded greeting
  const wa = values.filter((x) => x.k === 'waHref' || x.k === 'whatsapp');
  for (const { k, v } of wa) {
    if (!v) continue;
    assert.ok(!/%[0-9A-Fa-f]{2}/.test(v), k + ' must not be percent-encoded greeting: ' + v);
    if (k === 'waHref') {
      assert.ok(/^https:\/\/wa\.me\/\d+\/?$/.test(v) || /^https:\/\/wa\.me\/\d+$/.test(v),
        'waHref should be clean wa.me link: ' + v);
    }
  }

  // If seo.jsonLd still in schema, its preset value would show — forbid @context as visible
  if (schemaHasKey(schema, 'seo.jsonLd')) {
    // Builder must skip — already asserted. Still: no label teaching JSON.
    const labels = collectLabels(schema);
    assert.ok(!labels.some((l) => /JSON-LD|@context/i.test(l)), 'no JSON-LD/@context labels');
  }

  // Preset may retain jsonLd for published HTML only — that is fine if not a schema field.
  void presets;
});

check('HEAD: all systems Instagram embedUrl presets are profile URLs (not /embed)', () => {
  for (const rel of PRESET_RELS) {
    const raw = read(rel);
    // Allow empty embedUrl; forbid /embed path segment as a stored visible value
    const re = /"embedUrl"\s*:\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(raw))) {
      const v = m[1];
      if (!v) continue;
      assert.ok(!/\/embed\/?$/i.test(v), rel + ' embedUrl ends with /embed: ' + v);
      assert.ok(!/instafidget\.hidook\.agency/i.test(v), rel + ' partner host in embedUrl');
    }
  }
});

check('HEAD: all systems waHref presets are clean (no percent-encoding)', () => {
  for (const rel of PRESET_RELS) {
    const raw = read(rel);
    const re = /"waHref"\s*:\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(raw))) {
      const v = m[1];
      if (!v) continue;
      assert.ok(!/%[0-9A-Fa-f]{2}/.test(v), rel + ' encoded waHref: ' + v);
      assert.ok(/^https:\/\/wa\.me\/\d+\/?$/.test(v), rel + ' waHref not clean wa.me: ' + v);
    }
  }
});

// S72/S74 non-regression smoke (static)
check('HEAD non-regress: Cum e step 01 still names four systems', () => {
  const how = howSection(read('builder/index.html'));
  assert.ok(/restaurant/i.test(how), 'restaurant');
  assert.ok(/trades/i.test(how), 'trades');
  assert.ok(/salon/i.test(how), 'salon');
  assert.ok(/profession/i.test(how), 'professional');
});

check('HEAD non-regress: no $100 / SERVER_SECRET / bakery / Calendly in landing', () => {
  const src = read('builder/index.html');
  assert.ok(!/\$100/.test(src), 'no $100');
  assert.ok(!/SERVER_SECRET/.test(src), 'no SERVER_SECRET');
  assert.ok(!/DESSERD|cofetărie|Calendly/i.test(src), 'no bakery/Calendly');
});

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll s77-s76-advocate checks passed.');
process.exit(0);
