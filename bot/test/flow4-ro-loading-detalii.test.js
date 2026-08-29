'use strict';
/**
 * bot/test/flow4-ro-loading-detalii.test.js — Flow 4 Detalii Romanian chrome oracle.
 *
 * Prior card locked no hero/SEO jargon + RO loading overlays.
 * Advocate on parent 254be23: professionals/local-service/portfolio Detalii still
 * leaked factory English (About the firm / practice, Site language, Pick a color…).
 * Desserdirina + product-menu were already RO on those slots.
 *
 * Causal RED on required parent 254be2353503f62d307fdae8bc93986c8dd140e4;
 * GREEN on HEAD after full title/label/hint romanization (keys stable).
 *
 * Run: node bot/test/flow4-ro-loading-detalii.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
/** Required parent for this remake card (Detalii leftover factory English). */
const PARENT_SHA = '254be2353503f62d307fdae8bc93986c8dd140e4';

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

/** Opened English factory phrases from 03b-professionals-details + sibling systems. */
const EN_FACTORY = [
  'About the firm / practice',
  'About the firm',
  'About the salon',
  'Company info',
  'Site language',
  'Languages you work in',
  'Button and section text',
  'WhatsApp link label (contact section)',
  'Colors & visual theme',
  'Pick a color and optional photo. The live preview updates immediately.',
  'Pick a color and optional photo',
  'Contact & location',
  'Phone (international format)',
  'WhatsApp (international digits)',
  'Map link (optional)',
  'Instagram (contact section)',
  'Instagram (optional)',
  'Appearance',
  'Contact details',
  'Contact & bookings',
  'Services offered',
  'Work portfolio',
  'Business hours (optional)',
  'Certifications & licenses',
  'Why us (trust points)',
  'Frequently asked questions',
  'Appointments (local request',
  'Services / expertise',
  'How you work',
  'Credentials (no unverifiable claims)',
  'Primary accent',
  'Lighter accent shade',
  'Darker accent shade',
  'Page background color',
  'Main button text',
  'Short tagline',
  'Business or trade name',
  'Studio, salon, or brand name',
  'Name of your firm',
  'Close button label (accessibility)',
  'Displayed phone number',
  'Phone number (international format',
  'WhatsApp number (international format',
  'WhatsApp number (no +',
  'Physical address (one line per row)',
  'Google Maps link',
  'Instagram profile',
  'Instagram username',
  'Instagram handle',
  'Instagram section title',
  'Instagram follow button',
  'WhatsApp QR modal title',
  'Open WhatsApp Web',
  'Copyright year',
  'Short address for the footer',
  'Short address in the footer',
  'Footer note',
  'Small footer note',
  'Team (optional)',
  'Work gallery',
  'Services & pricing',
  'Contact section title',
  'Services section title',
  'Process section title',
  'Gallery section title',
  'Team section title',
  'Hours section title',
  'Office address',
  'Contact email',
  'Office hours note',
  'Submit button text',
  'Consultation types',
  'Weekly availability',
  'Enable the appointment section',
  'Default consultation length',
  'Minimum notice before',
  'Message shown after the request',
  'Message shown when no slots',
  'Privacy note / personal data',
  "don't send confidential documents",
  'Primary button (e.g.',
  'Short qualifier below the tagline',
  'About you or your team',
  'Profession or credential',
  'Languages you work in',
  'How you work (e.g.',
  'Page title for the browser',
  'The salon\'s story',
  'About your business',
  'Years of experience',
  'Service area (e.g.',
  'About section title',
  'Scroll indicator text',
  'Call button / sticky dock',
  'About badge suffix',
  'Services section eyebrow',
  'Process section eyebrow',
  'Trust section eyebrow',
  'Trust section title',
  'Bottom contact band',
  'Contact band aria-label',
  'Sticky phone dock',
  'Gallery section eyebrow',
  'Lightbox dialog aria-label',
  'Lightbox previous button',
  'Lightbox next button',
  'Default process step',
  'Services list (emoji',
  'Services list (SVG',
  '"Why us" points',
  'Work categories',
  'Certifications / licenses',
  'Contact intro text',
  'Instagram text (e.g.',
  'Instagram label',
  'Photos for the Instagram grid',
  'Instagram grid photos',
  'Instagram gallery photos',
  'Intro text for contact',
  'Detailed price list',
  'Hours rows (day + hours)',
  'Team members',
  'Short label next to',
  'Small label above the',
  'WhatsApp button text in the contact',
  'Gallery nav link',
  'Services nav link',
  'Booking nav link',
  'FAQ nav link',
  'About nav link',
  'Contact nav link',
  'Appointment form:',
  'Paper / warm background',
  'Ink / primary text color',
  'Light accent',
  'Primary color — gold-beige',
  'Background color (nude cream',
  'Logo path (e.g.',
  'Logo image path',
  'Show the business name as text',
  'Primary accent color',
];

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

function walkSurface(schema, out) {
  const sections = schema.sections || [];
  for (const sec of sections) {
    if (sec && typeof sec.title === 'string') {
      out.push({ kind: 'title', id: sec.id, text: sec.title });
    }
    for (const f of (sec && sec.fields) || []) {
      if (f && typeof f.label === 'string') {
        out.push({ kind: 'label', key: f.key, text: f.label });
      }
      if (f && typeof f.hint === 'string') {
        out.push({ kind: 'hint', key: f.key, text: f.hint });
      }
    }
  }
}

function collectSurface(schemaSrc) {
  const items = [];
  walkSurface(parseSchema(schemaSrc), items);
  return items;
}

function textHasFactoryEn(text) {
  if (typeof text !== 'string' || !text) return false;
  for (const p of EN_FACTORY) {
    if (text.includes(p)) return true;
  }
  return false;
}

function surfaceFactoryHits(items) {
  return items.filter((i) => textHasFactoryEn(i.text));
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

function assertNoFactoryEn(rel, items) {
  for (const i of items) {
    assert.ok(
      !textHasFactoryEn(i.text),
      rel + ' ' + i.kind + ' factory EN: ' + JSON.stringify(i.text)
    );
  }
}

// ── Causal RED on required parent 254be23 ────────────────────────────────

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} Detalii still leaks factory English`, () => {
  let leakCount = 0;
  const samples = [];
  for (const rel of SCHEMAS) {
    const hits = surfaceFactoryHits(collectSurface(parentBlob(rel)));
    leakCount += hits.length;
    for (const h of hits) {
      if (samples.length < 12) samples.push(rel + ' ' + h.kind + '=' + h.text);
    }
  }
  assert.ok(
    leakCount > 0,
    'parent must still leak factory English in customer titles/labels/hints; got none'
  );

  const pro = collectSurface(parentBlob('templates/professionals/schema.json'));
  const proTitles = pro.filter((i) => i.kind === 'title').map((i) => i.text);
  const proLabels = pro.filter((i) => i.kind === 'label').map((i) => i.text);
  const proHints = pro.filter((i) => i.kind === 'hint').map((i) => i.text);

  assert.ok(
    proTitles.some((t) => /About the firm/i.test(t)),
    'parent professionals business title still About the firm'
  );
  assert.ok(
    proLabels.some((l) => l === 'Site language'),
    'parent professionals Site language label'
  );
  assert.ok(
    proLabels.some((l) => /Languages you work in/i.test(l)),
    'parent professionals Languages you work in'
  );
  assert.ok(
    proTitles.some((t) => t === 'Button and section text'),
    'parent professionals Button and section text'
  );
  assert.ok(
    proTitles.some((t) => t === 'Colors & visual theme'),
    'parent professionals Colors & visual theme'
  );
  assert.ok(
    proTitles.some((t) => t === 'Contact & location'),
    'parent professionals Contact & location'
  );
  assert.ok(
    proHints.some((h) => /Pick a color and optional photo/i.test(h)),
    'parent professionals hero hint Pick a color…'
  );
  assert.ok(
    proLabels.some((l) => l === 'Phone (international format)'),
    'parent professionals Phone (international format)'
  );
  assert.ok(
    proLabels.some((l) => l === 'WhatsApp (international digits)'),
    'parent professionals WhatsApp (international digits)'
  );
  assert.ok(
    proLabels.some((l) => l === 'Instagram (contact section)'),
    'parent professionals Instagram (contact section)'
  );

  const ls = collectSurface(parentBlob('templates/local-service/schema.json'));
  assert.ok(
    ls.some((i) => i.text === 'Company info'),
    'parent local-service Company info'
  );
  assert.ok(
    ls.some((i) => i.text === 'Appearance'),
    'parent local-service Appearance'
  );

  const port = collectSurface(parentBlob('templates/portfolio/schema.json'));
  assert.ok(
    port.some((i) => i.text === 'About the salon'),
    'parent portfolio About the salon'
  );

  // Held: desserdirina already RO on those slots
  const dess = collectSurface(parentBlob('templates/desserdirina/schema.json'));
  assert.ok(
    dess.some((i) => i.kind === 'title' && i.text === 'Despre afacere'),
    'parent desserdirina already Despre afacere'
  );
  assert.ok(
    dess.some((i) => i.kind === 'label' && i.text === 'Limba site-ului'),
    'parent desserdirina already Limba site-ului'
  );
  void samples;
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} already ships RO loading + no hero/SEO (held)`, () => {
  const app = parentBlob('builder/app.js');
  assert.ok(app.includes(RO_PUBLISH), 'parent has Se publică…');
  assert.ok(app.includes(RO_PAY), 'parent has Se confirmă plata…');
  assert.ok(!app.includes(EN_PUBLISH), 'parent no Publishing…');
  assert.ok(!app.includes(EN_PAY), 'parent no Confirming payment…');

  for (const rel of SCHEMAS) {
    const items = collectSurface(parentBlob(rel));
    assertNoHeroSeo(rel + ' (parent)', items);
  }
});

// ── HEAD GREEN ───────────────────────────────────────────────────────────

check('HEAD: builder/app.js has no customer-visible Publishing… or Confirming payment…', () => {
  const app = headRead('builder/app.js');
  assert.ok(!app.includes(EN_PUBLISH), 'no Publishing…');
  assert.ok(!app.includes(EN_PAY), 'no Confirming payment…');
  assert.ok(!/Publishing\\.\\.\\./.test(app), 'no Publishing...');
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

check('HEAD: all five schemas — no hero/SEO and no factory English in title/label/hint', () => {
  for (const rel of SCHEMAS) {
    const src = headRead(rel);
    const items = collectSurface(src);
    assertNoHeroSeo(rel, items);
    assertNoFactoryEn(rel, items);

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
      assert.ok(
        /impresie|deschidere|pagină|introducere|banner/i.test(byId.hero.title),
        rel + ' hero title should read as first-impression RO: ' + byId.hero.title
      );
      const bg = (byId.hero.fields || []).find((f) => f.key === 'hero.background');
      if (bg && bg.hint) {
        assert.ok(
          /Alege o culoare|culoare sau foto|poză/i.test(bg.hint) ||
            /culoare sau foto/i.test(bg.label),
          rel + ' hero background hint/label RO family: ' + (bg.hint || bg.label)
        );
        assert.ok(
          !/Pick a color and optional photo/i.test(bg.hint),
          rel + ' no Pick a color EN hint'
        );
      }
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
    if (byId.business) {
      const lang = (byId.business.fields || []).find((f) => f.key === 'business.lang');
      if (lang) {
        assert.ok(
          /Limba site-ului/i.test(lang.label),
          rel + ' business.lang RO: ' + lang.label
        );
      }
      assert.ok(
        /Despre|afacer|firm|cabinet|salon/i.test(byId.business.title),
        rel + ' business title RO family: ' + byId.business.title
      );
    }
    if (byId.labels) {
      assert.ok(
        /Texte butoane|butoane și secțiuni/i.test(byId.labels.title),
        rel + ' labels title RO: ' + byId.labels.title
      );
    }
    const themeSec = byId.theme || byId.visual;
    if (themeSec) {
      assert.ok(
        /Culori|aspect/i.test(themeSec.title),
        rel + ' theme/visual title RO: ' + themeSec.title
      );
    }
    for (const sec of schema.sections || []) {
      for (const f of sec.fields || []) {
        if (f.key === 'contact.facebook.url') {
          assert.ok(
            /Link Facebook/i.test(f.label),
            rel + ' facebook url RO: ' + f.label
          );
        }
        if (f.key === 'contact.instagram.url') {
          assert.ok(
            /Instagram \(secțiune contact\)/i.test(f.label),
            rel + ' contact IG RO: ' + f.label
          );
          assert.ok(
            !/Instagram \(contact section\)/i.test(f.label),
            rel + ' no EN contact section IG'
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

check('HEAD: positive RO family on professionals (opened leak system)', () => {
  const items = collectSurface(headRead('templates/professionals/schema.json'));
  const titles = items.filter((i) => i.kind === 'title').map((i) => i.text);
  const labels = items.filter((i) => i.kind === 'label').map((i) => i.text);
  const hints = items.filter((i) => i.kind === 'hint').map((i) => i.text);
  assert.ok(titles.some((t) => /Despre firm/i.test(t)), 'Despre firmă title');
  assert.ok(titles.some((t) => /Texte butoane/i.test(t)), 'Texte butoane title');
  assert.ok(titles.some((t) => /^Culori/i.test(t)), 'Culori title');
  assert.ok(titles.some((t) => /Contact și locație/i.test(t)), 'Contact și locație');
  assert.ok(labels.some((l) => l === 'Limba site-ului'), 'Limba site-ului');
  assert.ok(labels.some((l) => /Limbi în care lucrezi/i.test(l)), 'Limbi în care lucrezi');
  assert.ok(labels.some((l) => /Telefon \(format internațional\)/i.test(l)), 'Telefon RO');
  assert.ok(labels.some((l) => /WhatsApp \(cifre internaționale\)/i.test(l)), 'WhatsApp RO');
  assert.ok(
    labels.some((l) => /Instagram \(secțiune contact\)/i.test(l)),
    'Instagram secțiune contact'
  );
  assert.ok(
    hints.some((h) => /Alege o culoare/i.test(h)),
    'hero hint Alege o culoare'
  );
});

// ── Exit ─────────────────────────────────────────────────────────────────
if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll checks passed.');
