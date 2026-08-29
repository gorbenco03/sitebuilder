'use strict';
/**
 * bot/test/flow4-ro-loading-detalii.test.js — Flow 4 QA FAIL remake oracle.
 *
 * tester-qa FAIL on parent f62032d: stranger still saw English loading overlays
 * «Publishing…» after magic-link login and «Confirming payment…» after the test
 * card, plus Detalii factory chrome HERO / SEO / Facebook URL / Imagine pentru
 * social sharing.
 *
 * Causal RED on required parent f62032d0e06a7a64feec7a4b6e12572ab94bd266;
 * GREEN on HEAD after remake.
 *
 * Run: node bot/test/flow4-ro-loading-detalii.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
/** Required parent for this remake card (thumbs + RO IG + cookie accepted). */
const PARENT_SHA = 'f62032d0e06a7a64feec7a4b6e12572ab94bd266';

const FIVE = [
  'product-menu',
  'local-service',
  'portfolio',
  'professionals',
  'desserdirina',
];
const SCHEMAS = FIVE.map((id) => `templates/${id}/schema.json`);

const EN_PUBLISH = 'Publishing…';
const EN_PAY = 'Confirming payment…';
const RO_PUBLISH = 'Se publică…';
const RO_PAY = 'Se confirmă plata…';

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

// ── Causal RED on required parent f62032d ────────────────────────────────

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} ships English Publishing… loading`, () => {
  const app = parentBlob('builder/app.js');
  assert.ok(app.includes(EN_PUBLISH), 'parent has Publishing…');
  assert.ok(
    /setBtnLoading\([^)]*Publishing…/.test(app) || /setLoading\(\s*true,\s*'Publishing…'/.test(app),
    'parent sets Publishing… on btn or overlay'
  );
  assert.ok(!app.includes(RO_PUBLISH), 'parent lacks RO Se publică…');
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} ships English Confirming payment…`, () => {
  const app = parentBlob('builder/app.js');
  assert.ok(app.includes(EN_PAY), 'parent has Confirming payment…');
  assert.ok(
    /setLoading\(\s*true,\s*'Confirming payment…'/.test(app),
    'parent setLoading Confirming payment…'
  );
  assert.ok(!app.includes(RO_PAY), 'parent lacks RO Se confirmă plata…');
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} Detalii still has HERO/SEO/Facebook URL/social sharing`, () => {
  // Opened evidence was desserdirina Detalii; parent must still leak those exact strings.
  const dess = parentBlob('templates/desserdirina/schema.json');
  assert.ok(/"title":\s*"Hero"/.test(dess) || /"title":\s*"HERO"/.test(dess), 'parent desserdirina Hero title');
  assert.ok(/"title":\s*"SEO"/.test(dess), 'parent desserdirina standalone SEO title');
  assert.ok(dess.includes('Facebook URL'), 'parent Facebook URL');
  assert.ok(dess.includes('Imagine pentru social sharing'), 'parent Imagine pentru social sharing');

  // professionals also had bare Hero + English social sharing
  const pro = parentBlob('templates/professionals/schema.json');
  assert.ok(/"title":\s*"Hero"/.test(pro), 'parent professionals Hero title');
  assert.ok(
    /Image for social sharing|social sharing/i.test(pro),
    'parent professionals English social sharing'
  );
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
  // Same family as existing RO overlays
  assert.ok(/Se trimite…/.test(app), 'Se trimite… family kept');
  assert.ok(/Se încarcă site-ul…/.test(app), 'Se încarcă site-ul… family kept');
});

check('HEAD: all five schemas — no HERO bare title, no standalone SEO, no Facebook URL, no social sharing EN', () => {
  for (const rel of SCHEMAS) {
    const src = headRead(rel);
    const items = collectSurface(src);
    const titles = items.filter((i) => i.kind === 'title').map((i) => i.text);
    const labels = items.filter((i) => i.kind === 'label').map((i) => i.text);

    for (const t of titles) {
      assert.ok(
        !/^(HERO|Hero)$/i.test(t.trim()),
        rel + ' bare HERO/Hero title forbidden: ' + t
      );
      assert.ok(
        t.trim() !== 'SEO',
        rel + ' standalone SEO title forbidden'
      );
      assert.ok(
        !/^Hero section\b/i.test(t),
        rel + ' English Hero section title forbidden: ' + t
      );
      assert.ok(
        !/SEO\s*&\s*social sharing/i.test(t),
        rel + ' English SEO & social sharing title forbidden: ' + t
      );
      assert.ok(
        t.trim() !== 'Social sharing' && t.trim() !== 'Search details',
        rel + ' English SEO section title forbidden: ' + t
      );
    }

    for (const lab of labels) {
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

    // Positive RO chrome on hero + seo + facebook where those sections exist
    const schema = parseSchema(src);
    const byId = Object.create(null);
    for (const sec of schema.sections || []) byId[sec.id] = sec;
    if (byId.hero) {
      assert.ok(
        /Secțiunea hero|hero \(prima/i.test(byId.hero.title),
        rel + ' hero title RO commercial: ' + byId.hero.title
      );
    }
    if (byId.seo) {
      assert.ok(
        /SEO și partajare socială/i.test(byId.seo.title),
        rel + ' seo title RO: ' + byId.seo.title
      );
      const og = (byId.seo.fields || []).find((f) => f.key === 'seo.ogImage');
      if (og) {
        assert.ok(
          /Imagine pentru partajare socială/i.test(og.label),
          rel + ' ogImage RO label: ' + og.label
        );
      }
    }
    // facebook url field when present
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
