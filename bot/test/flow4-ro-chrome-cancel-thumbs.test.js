'use strict';
/**
 * bot/test/flow4-ro-chrome-cancel-thumbs.test.js — Flow 4 QA FAIL remake oracle.
 *
 * tester-qa FAIL on parent 1275ccd: stranger still hit English factory chrome,
 * Anulează hash dumped to catalog, professionals/Desserdirina thumbs blank beige.
 *
 * Causal RED on required parent 1275ccde7ecf4ce60a13f77904fea4d6117ff282;
 * GREEN on HEAD after remake.
 *
 * Run: node bot/test/flow4-ro-chrome-cancel-thumbs.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
/** Required parent for this remake card (isolated live URL chrome accepted). */
const PARENT_SHA = '1275ccde7ecf4ce60a13f77904fea4d6117ff282';

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

function parentBuf(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    maxBuffer: 8 * 1024 * 1024,
  });
}

const EN_FACTORY = [
  'No bots',
  'Choose photo',
  'Photo added',
  'Open the site',
  'Enter your email address.',
];

// ── Causal RED on required parent 1275ccd ────────────────────────────────

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} still ships English factory chrome`, () => {
  const html = parentBlob('builder/index.html');
  const app = parentBlob('builder/app.js');
  const surface = html + '\n' + app;
  assert.ok(/No bots/i.test(html), 'parent footer still has No bots');
  assert.ok(/Choose photo/.test(app), 'parent Detalii Choose photo');
  assert.ok(/Photo added/.test(app), 'parent Photo added');
  assert.ok(/Open the site/.test(app), 'parent Open the site magic-link CTA');
  assert.ok(/Enter your email address\./.test(app), 'parent empty-email English');
  assert.ok(
    /Text, poze, meniu, culoare/.test(html),
    'parent how-it-works 02 still schema chip'
  );
  for (const s of EN_FACTORY) {
    assert.ok(surface.includes(s) || new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(surface),
      'parent surface contains ' + s);
  }
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} ignores #test-billing-portal= (falls to catalog)`, () => {
  const app = parentBlob('builder/app.js');
  // Parent has test-checkout handler but no test-billing-portal route → else → templates
  assert.ok(/test-checkout=/.test(app), 'parent has test-checkout handler');
  assert.ok(
    !/test-billing-portal=/.test(app),
    'parent must NOT handle test-billing-portal hash (causal dump to catalog)'
  );
  const handle = (app.match(/async function handleRoute\s*\([\s\S]*?\n\}/) || [''])[0];
  assert.ok(handle.length > 80, 'handleRoute present');
  assert.ok(
    !/test-billing-portal/.test(handle),
    'handleRoute ignores billing-portal return'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} professionals thumb source is beige UI screenshot`, () => {
  // Parent hero.jpg is a rendered site screenshot (mostly cream paper chrome), not interior photography.
  const buf = parentBuf('templates/professionals/images/hero.jpg');
  assert.ok(buf.length > 8 * 1024, 'parent professionals hero exists');
  // JPEG SOI
  assert.ok(buf[0] === 0xff && buf[1] === 0xd8, 'parent hero is JPEG');
  // Causal: parent size matches the known screenshot (~102699) — HEAD replaces with real photo.
  assert.ok(
    buf.length < 150000,
    'parent professionals hero is the small UI screenshot (' + buf.length + ' bytes)'
  );
});

// ── HEAD GREEN: no English factory chrome ────────────────────────────────

check('HEAD: builder landing/app has no customer-visible English factory chrome', () => {
  const html = headRead('builder/index.html');
  const app = headRead('builder/app.js');
  const css = headRead('builder/app.css');
  const surface = html + '\n' + app;

  for (const s of EN_FACTORY) {
    assert.ok(
      !surface.includes(s),
      'must not ship customer-visible "' + s + '"'
    );
  }
  assert.ok(!/No bots/i.test(html), 'no No bots');
  assert.ok(/Fără boți|Fara boti/.test(html), 'RO Fără boți kept');
  assert.ok(/Alege o poză/.test(app), 'RO Choose photo');
  assert.ok(/Poză adăugată/.test(app), 'RO Photo added');
  assert.ok(/Deschide site-ul/.test(app + html), 'RO Open the site');
  assert.ok(/Introdu adresa de email/.test(app), 'RO empty email');
  assert.ok(
    !/Text, poze, meniu, culoare/.test(html),
    'how-it-works 02 is not a schema chip'
  );
  assert.ok(
    /Schimbi textele|fotografiile|meniul|culorile/.test(html),
    'how-it-works 02 full RO commercial line'
  );
  // Header stack at 390 for cabinet readability
  assert.ok(
    /390 cabinet|Designuri|flex-wrap:\s*wrap/.test(css) &&
      /@media\s*\(max-width:\s*420px\)[\s\S]{0,800}flex-wrap:\s*wrap/.test(css),
    'cabinet header wraps at 390'
  );
});

check('HEAD: #test-billing-portal= opens cabinet dashboard (Ciornă path), not catalog', () => {
  const app = headRead('builder/app.js');
  const handle = (app.match(/async function handleRoute\s*\([\s\S]*?\n\}/) || [''])[0];
  assert.ok(handle.length > 80, 'handleRoute');
  assert.ok(
    /test-billing-portal\s*=/.test(handle) || /test-billing-portal=/.test(handle),
    'handleRoute matches test-billing-portal hash'
  );
  assert.ok(
    /showScreen\s*\(\s*['"]dashboard['"]\s*\)/.test(handle),
    'billing-portal return shows dashboard'
  );
  // Must not fall through to templates-only for this hash
  const portalBlock = (handle.match(
    /test-billing-portal[\s\S]{0,900}?return;/
  ) || [''])[0];
  assert.ok(portalBlock.length > 40, 'early return after billing-portal');
  assert.ok(
    /loadDashboard|showScreen\s*\(\s*['"]dashboard['"]/.test(portalBlock),
    'loads Proiectele mele'
  );
  assert.ok(
    !/showScreen\s*\(\s*['"]templates['"]\s*\)/.test(portalBlock),
    'does not open catalog on cancel return'
  );
  // #sites return_url from server also maps to cabinet
  assert.ok(
    /raw\s*===\s*['"]sites['"]|route\s*===\s*['"]sites['"]/.test(handle) ||
      /test-billing-portal[\s\S]{0,200}sites/.test(handle),
    '#sites also lands in cabinet'
  );
});

check('HEAD: professionals + desserdirina catalog thumbs are non-empty photographic rasters', () => {
  const genLight = path.join(ROOT, 'builder/generated/templates-data.js');
  if (!fs.existsSync(genLight)) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-builder.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
  }
  assert.ok(fs.existsSync(genLight), 'templates-data.js after build');
  // Rebuild so HEAD photo sources land in thumbs/
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });
  const light = fs.readFileSync(genLight, 'utf8');
  const thumbsDir = path.join(ROOT, 'builder/generated/thumbs');

  for (const id of ['professionals', 'desserdirina']) {
    const m =
      light.match(new RegExp('"id"\\s*:\\s*"' + id + '"[\\s\\S]{0,400}?"thumbnail"\\s*:\\s*"([^"]+)"')) ||
      light.match(new RegExp('"thumbnail"\\s*:\\s*"([^"]+)"[\\s\\S]{0,200}?"id"\\s*:\\s*"' + id + '"'));
    assert.ok(m, id + ' thumbnail in light registry');
    const thumb = m[1];
    assert.ok(!/\.svg(\?|$)/i.test(thumb), id + ' must not be SVG placeholder, got ' + thumb);
    assert.ok(
      /\.(jpe?g|png|webp|gif)(\?|$)/i.test(thumb),
      id + ' thumbnail must be raster, got ' + thumb
    );
    assert.ok(
      new RegExp('/app/generated/thumbs/' + id + '\\.', 'i').test(thumb),
      id + ' under generated/thumbs/' + id + '.*, got ' + thumb
    );
    const files = fs.readdirSync(thumbsDir);
    const hit = files.find((f) => new RegExp('^' + id + '\\.(jpe?g|png|webp|gif)$', 'i').test(f));
    assert.ok(hit, id + ' thumb file exists, got ' + files.join(','));
    assert.ok(!files.includes(id + '.svg'), 'no ' + id + '.svg fallback');
    const size = fs.statSync(path.join(thumbsDir, hit)).size;
    assert.ok(size > 20 * 1024, id + ' thumb is real photo bytes (' + size + ')');
  }

  // professionals source must not remain the parent UI screenshot size class
  const proSrc = path.join(ROOT, 'templates/professionals/images/hero.jpg');
  assert.ok(fs.existsSync(proSrc), 'professionals/images/hero.jpg');
  const proSize = fs.statSync(proSrc).size;
  assert.ok(
    proSize > 150000,
    'professionals hero is real interior photography (>' + proSize + ' vs parent screenshot)'
  );

  // Desserdirina prefers a clean pastry collage, never the legacy promo artwork.
  const build = headRead('scripts/build-builder.js');
  assert.ok(/images\/torturi-1\.jpg/.test(build), 'pickThumbnailSource prefers clean pastry photography');
  assert.ok(!/['"]images\/cover\.jpg['"]/.test(build), 'pickThumbnailSource does not prefer legacy promo chrome');

  // Catalog cards use object-fit cover thumb class (not iframe scale on photos)
  const app = headRead('builder/app.js');
  const css = headRead('builder/app.css');
  assert.ok(
    /className\s*=\s*['"]template-card-preview-thumb['"]/.test(app),
    'catalog img uses preview-thumb only'
  );
  assert.ok(
    /\.template-card-preview-thumb[\s\S]{0,200}object-fit:\s*cover/.test(css),
    'thumb CSS object-fit cover'
  );
});

// ── Done ─────────────────────────────────────────────────────────────────
if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll flow4-ro-chrome-cancel-thumbs checks passed.');
process.exit(0);
