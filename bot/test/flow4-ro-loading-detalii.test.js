'use strict';
/**
 * bot/test/flow4-ro-loading-detalii.test.js — Flow 4 Detalii HERO/SEO jargon oracle.
 *
 * tester-qa FAIL on parent 1e13cf4: Detalii still showed SECȚIUNEA HERO /
 * Fundal hero / SEO ȘI PARTAJARE SOCIALĂ (schema titles/labels with hero/SEO).
 * RO loading overlays were already GREEN on that parent.
 *
 * Causal RED on required parent 1e13cf4f19a509ee6fd2e77d2103dec7e65cd687;
 * GREEN on HEAD after label remake (no \bhero\b / \bSEO\b in customer titles/labels).
 *
 * Run: node bot/test/flow4-ro-loading-detalii.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
/** Required parent for this remake card (RO loading + leftover Detalii hero/SEO). */
const PARENT_SHA = '1e13cf4f19a509ee6fd2e77d2103dec7e65cd687';

const FIVE = [
  'product-menu',
  'local-service',
  'portfolio',
  'professionals',
  'desserdirina',
];
const SCHEMAS = FIVE.map((id) => `templates/${id}/schema.json`);

const RO_PUBLISH = 'Se publică…';
const RO_PAY = 'Se confirmă plata…';
const EN_PUBLISH = 'Publishing…';
const EN_PAY = 'Confirming payment…';

const HERO_RE = /\bhero\b/i;
const SEO_RE = /\bSEO\b/;

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

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function parseSchema(src) {
  return JSON.parse(src);
}

function walkLabels(schema, out) {
  const sections = schema.sections || [];
  for (const sec of sections) {
    if (sec && typeof sec.title === 'string') {
      out.push({ kind: 'title', id: sec.id, text: sec.title });
    }
    for (const f of (sec && sec.fields) || []) {
      if (f && typeof f.label === 'string') {
        out.push({ kind: 'label', key: f.key, text: f.label });
      }
    }
  }
}

function collectSurface(schemaSrc) {
  const items = [];
  walkLabels(parseSchema(schemaSrc), items);
  return items;
}

function surfaceHasHeroOrSeo(items) {
  return items.some((i) => HERO_RE.test(i.text) || SEO_RE.test(i.text));
}

function assertNoHeroSeo(rel, items) {
  for (const i of items) {
    assert.ok(
      !HERO_RE.test(i.text),
      rel + ' ' + i.kind + ' leaks hero: ' + JSON.stringify(i.text)
    );
    assert.ok(
      !SEO_RE.test(i.text),
      rel + ' ' + i.kind + ' leaks SEO: ' + JSON.stringify(i.text)
    );
  }
}

// ── Causal RED on required parent 1e13cf4 ────────────────────────────────

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} Detalii titles/labels still leak hero/SEO`, () => {
  let leakCount = 0;
  const samples = [];
  for (const rel of SCHEMAS) {
    const items = collectSurface(parentBlob(rel));
    for (const i of items) {
      if (HERO_RE.test(i.text) || SEO_RE.test(i.text)) {
        leakCount++;
        if (samples.length < 8) samples.push(rel + ' ' + i.kind + '=' + i.text);
      }
    }
  }
  assert.ok(
    leakCount > 0,
    'parent must still leak hero/SEO in customer titles/labels; got none'
  );
  // Opened evidence family on desserdirina
  const dess = collectSurface(parentBlob('templates/desserdirina/schema.json'));
  const dessTitles = dess.filter((i) => i.kind === 'title').map((i) => i.text);
  const dessLabels = dess.filter((i) => i.kind === 'label').map((i) => i.text);
  assert.ok(
    dessTitles.some((t) => /hero/i.test(t)),
    'parent desserdirina hero section title still contains hero'
  );
  assert.ok(
    dessLabels.some((l) => /Fundal hero/i.test(l)),
    'parent desserdirina Fundal hero label'
  );
  assert.ok(
    dessTitles.some((t) => SEO_RE.test(t)),
    'parent desserdirina SEO section title still contains SEO'
  );
  assert.ok(
    surfaceHasHeroOrSeo(collectSurface(parentBlob('templates/product-menu/schema.json'))),
    'parent product-menu also leaks'
  );
  void samples;
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} already ships RO loading (held)`, () => {
  const app = parentBlob('builder/app.js');
  assert.ok(app.includes(RO_PUBLISH), 'parent has Se publică…');
  assert.ok(app.includes(RO_PAY), 'parent has Se confirmă plata…');
  assert.ok(!app.includes(EN_PUBLISH), 'parent no Publishing…');
  assert.ok(!app.includes(EN_PAY), 'parent no Confirming payment…');
});

// ── HEAD GREEN ───────────────────────────────────────────────────────────

check('HEAD: builder/app.js has no customer-visible Publishing… or Confirming payment…', () => {
  const app = headRead('builder/app.js');
  assert.ok(!app.includes(EN_PUBLISH), 'no Publishing…');
  assert.ok(!app.includes(EN_PAY), 'no Confirming payment…');
  assert.ok(!/Publishing\.\.\./.test(app), 'no Publishing...');
  assert.ok(!/Confirming payment/.test(app), 'no Confirming payment');
});

check('HEAD: RO loading replacements present (Se publică… / Se confirmă plata…)', () => {
  const app = headRead('builder/app.js');
  assert.ok(app.includes(RO_PUBLISH), 'Se publică… present');
  assert.ok(app.includes(RO_PAY), 'Se confirmă plata… present');
  assert.ok(
    /setBtnLoading\([^)]*Se publică…/.test(app) || /setLoading\(\s*true,\s*'Se publică…'/.test(app),
    'Se publică… wired to loading helpers'
  );
  assert.ok(
    /setLoading\(\s*true,\s*'Se confirmă plata…'/.test(app),
    'Se confirmă plata… on setLoading'
  );
  assert.ok(/Se trimite…/.test(app), 'Se trimite… family kept');
  assert.ok(/Se încarcă site-ul…/.test(app), 'Se încarcă site-ul… family kept');
});

check('HEAD: all five schemas — no \\bhero\\b / \\bSEO\\b in customer title or label', () => {
  for (const rel of SCHEMAS) {
    const src = headRead(rel);
    const items = collectSurface(src);
    assertNoHeroSeo(rel, items);

    // Keep prior Facebook / EN social-sharing bans
    for (const lab of items.filter((i) => i.kind === 'label').map((i) => i.text)) {
      assert.ok(
        lab !== 'Facebook URL' && !/^Facebook URL\b/i.test(lab),
        rel + ' Facebook URL label forbidden: ' + lab
      );
      assert.ok(
        lab !== 'Imagine pentru social sharing',
        rel + ' Imagine pentru social sharing forbidden: ' + lab
      );
      assert.ok(
        !/\bsocial sharing\b/i.test(lab),
        rel + ' English social sharing in label forbidden: ' + lab
      );
      assert.ok(
        !/^Facebook link\b/i.test(lab),
        rel + ' English Facebook link label forbidden: ' + lab
      );
      assert.ok(
        !/^Image for social sharing/i.test(lab),
        rel + ' Image for social sharing forbidden: ' + lab
      );
    }

    // Do NOT require "Secțiunea hero" or "SEO și partajare socială" as positive strings.
    // Positive: commercial RO without factory jargon where those sections exist.
    const schema = parseSchema(src);
    const byId = Object.create(null);
    for (const sec of schema.sections || []) byId[sec.id] = sec;
    if (byId.hero) {
      assert.ok(
        typeof byId.hero.title === 'string' && byId.hero.title.trim().length > 0,
        rel + ' hero section still has a customer title'
      );
      assert.ok(
        !HERO_RE.test(byId.hero.title),
        rel + ' hero title must not contain hero: ' + byId.hero.title
      );
      // Bakery-owner friendly: first impression / opening, not factory jargon
      assert.ok(
        /impresie|deschidere|pagină|introducere|banner/i.test(byId.hero.title),
        rel + ' hero title should read as first-impression RO: ' + byId.hero.title
      );
    }
    if (byId.seo) {
      assert.ok(
        typeof byId.seo.title === 'string' && byId.seo.title.trim().length > 0,
        rel + ' seo section still has a customer title'
      );
      assert.ok(
        !SEO_RE.test(byId.seo.title),
        rel + ' seo title must not contain SEO: ' + byId.seo.title
      );
      assert.ok(
        /partajare|rețele|social|vizibilitate|Google/i.test(byId.seo.title),
        rel + ' seo title should read as sharing/visibility RO: ' + byId.seo.title
      );
      const og = (byId.seo.fields || []).find((f) => f.key === 'seo.ogImage');
      if (og) {
        assert.ok(
          /Imagine pentru partajare socială/i.test(og.label),
          rel + ' ogImage RO label: ' + og.label
        );
        assert.ok(!SEO_RE.test(og.label) && !HERO_RE.test(og.label), rel + ' ogImage clean');
      }
    }
    for (const sec of schema.sections || []) {
      for (const f of sec.fields || []) {
        if (f.key === 'contact.facebook.url') {
          assert.ok(
            /Link Facebook/i.test(f.label),
            rel + ' facebook url RO: ' + f.label
          );
        }
      }
    }
  }
});

check('HEAD: schema keys/ids for hero/seo/facebook unchanged (labels only)', () => {
  for (const rel of SCHEMAS) {
    const parent = parseSchema(parentBlob(rel));
    const head = parseSchema(headRead(rel));
    const pIds = (parent.sections || []).map((s) => s.id).join(',');
    const hIds = (head.sections || []).map((s) => s.id).join(',');
    assert.strictEqual(hIds, pIds, rel + ' section ids stable');

    function keysOf(schema) {
      const keys = [];
      for (const sec of schema.sections || []) {
        for (const f of sec.fields || []) {
          if (f && f.key) keys.push(f.key + ':' + (f.type || ''));
        }
      }
      return keys.join('|');
    }
    assert.strictEqual(keysOf(head), keysOf(parent), rel + ' field keys/types stable');
  }
});

// ── Exit ─────────────────────────────────────────────────────────────────
if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll checks passed.');
