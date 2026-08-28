'use strict';
/**
 * bot/test/flow4-e2e-qa-fail-remake.test.js — Flow 4 QA FAIL remake gates.
 *
 * tester-qa FAIL on HEAD 0ec7a403: stranger catalog still leaked factory.
 *   (a) Desserdirina description: "Remake comercial al sample-ului de brutărie"
 *   (b) Previzualizare brand still DESSERD by Irina (logo/root sample brand)
 *   (c) Servicii profesionale catalog thumb = cream SVG placeholder
 *
 * Causal RED on required parent 0ec7a403; GREEN on HEAD after remake.
 * Run: node bot/test/flow4-e2e-qa-fail-remake.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
/** Required parent for this remake card (Instafidget correction accepted). */
const PARENT_SHA = '0ec7a4031a793a8131dfed22eb611a497e52e2f2';

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

function headBuf(rel) {
  return fs.readFileSync(path.join(ROOT, rel));
}

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function parentExists(rel) {
  try {
    execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function factoryCopyRe() {
  return /Remake comercial al sample-ului de brut[aă]rie/i;
}

function sampleFactoryRe() {
  return /\bsample-ului\b|\bRemake comercial\b|sample-ului de brut/i;
}

// ── Causal RED on required parent 0ec7a403 ───────────────────────────────

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} Desserdirina catalog still has factory sample sentence`, () => {
  const raw = parentBlob('templates/registry.json');
  const reg = JSON.parse(raw);
  const entry = (reg.templates || []).find((t) => t.id === 'desserdirina');
  assert.ok(entry, 'parent must list desserdirina');
  assert.ok(
    factoryCopyRe().test(entry.description || ''),
    'parent description must still contain factory Remake/sample sentence for causal RED'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} Desserdirina logo is still DESSERD-by-Irina sample brand`, () => {
  // Parent ships templates/desserdirina/images/logo.jpg identical to root bakery sample logo.
  assert.ok(
    parentExists('templates/desserdirina/images/logo.jpg'),
    'parent has desserdirina logo'
  );
  const logoBuf = execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:templates/desserdirina/images/logo.jpg`], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const rootLogoBuf = execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:images/logo.jpg`], {
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.strictEqual(
    sha256Buf(logoBuf),
    sha256Buf(rootLogoBuf),
    'parent desserdirina logo must match root DESSERD sample logo (causal)'
  );
  // Presets still point hero logo at that image (showWordmark false).
  const presets = JSON.parse(parentBlob('templates/desserdirina/presets.json'));
  const ro = (presets.presets || [])[0];
  assert.ok(ro && ro.config, 'parent RO preset');
  assert.ok(
    /images\/logo\.jpg/i.test(String(ro.config.logo || '')),
    'parent preset still uses DESSERD logo.jpg'
  );
  assert.strictEqual(!!ro.config.showWordmark, false, 'parent hides wordmark behind DESSERD logo');
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} professionals has no photographic thumb source`, () => {
  // No images/ dir in parent → build-builder writeFallbackThumb → professionals.svg
  const ls = execFileSync(
    'git',
    ['-C', ROOT, 'ls-tree', '--name-only', PARENT_SHA, 'templates/professionals/'],
    { encoding: 'utf8' }
  );
  assert.ok(!/images/.test(ls), 'parent professionals/ must lack images/ for causal RED');
  // build-builder comment + fallback path
  const build = parentBlob('scripts/build-builder.js');
  assert.ok(/writeFallbackThumb/.test(build), 'parent has SVG fallback helper');
  assert.ok(/professionals/.test(build) || /no local photos/.test(build), 'fallback intended for no-photo templates');
});

// ── HEAD GREEN: catalog copy ─────────────────────────────────────────────

check('HEAD: Desserdirina registry description is commercial RO, no factory/sample wording', () => {
  const reg = JSON.parse(headRead('templates/registry.json'));
  const entry = (reg.templates || []).find((t) => t.id === 'desserdirina');
  assert.ok(entry, 'desserdirina in registry');
  const desc = entry.description || '';
  assert.ok(desc.length > 40, 'description present');
  assert.ok(/[ăâîșțĂÂÎȘȚ]/.test(desc), 'Romanian diacritics');
  assert.ok(!factoryCopyRe().test(desc), 'must not say Remake comercial al sample-ului…');
  assert.ok(!sampleFactoryRe().test(desc), 'must not say sample/Remake comercial factory leak');
  assert.ok(!/\bfactory\b|\bstudio process\b/i.test(desc), 'no studio process leak');
  // Same commercial voice family as other verticals: business type + what you get
  assert.ok(
    /cofet|patiser|tort/i.test(desc),
    'commercial cofetărie/patisserie framing'
  );
  // Peer voice sanity: other cards still RO commercial (not weakened)
  for (const id of ['product-menu', 'local-service', 'portfolio', 'professionals']) {
    const peer = reg.templates.find((t) => t.id === id);
    assert.ok(peer && peer.description, id + ' description kept');
  }
});

// ── HEAD GREEN: Desserdirina preview brand ───────────────────────────────

check('HEAD: Desserdirina preset brand is Desserdirina, not DESSERD by Irina', () => {
  const presets = JSON.parse(headRead('templates/desserdirina/presets.json'));
  assert.ok((presets.presets || []).length >= 1, 'presets exist');
  for (const p of presets.presets) {
    const cfg = p.config || {};
    const biz = cfg.business || {};
    assert.ok(biz.name && /^Desserdirina$/i.test(String(biz.name).trim()), p.id + ' business.name');
    const blob = JSON.stringify(cfg);
    assert.ok(!/\bDESSERD\b/i.test(blob), p.id + ' config must not contain DESSERD');
    assert.ok(!/by Irina/i.test(blob), p.id + ' config must not contain by Irina');
  }

  // Visible brand path: either wordmark-only (no DESSERD logo file) or logo bytes ≠ root sample.
  const ro = presets.presets[0].config;
  const logoRel = String(ro.logo || '').trim();
  const rootLogo = path.join(ROOT, 'images/logo.jpg');
  const rootSha = fs.existsSync(rootLogo) ? sha256File(rootLogo) : null;

  if (!logoRel || ro.showWordmark === true) {
    // Wordmark path: business.name is the visible brand (Desserdirina).
    assert.ok(ro.showWordmark === true, 'showWordmark true when de-logoing DESSERD');
    assert.ok(!logoRel || logoRel === '', 'logo cleared so DESSERD mark is not rendered');
  } else {
    // Logo path: must not be the root bakery DESSERD mark.
    const abs = path.join(ROOT, 'templates/desserdirina', logoRel);
    assert.ok(fs.existsSync(abs), 'logo file exists at ' + logoRel);
    const logoSha = sha256File(abs);
    assert.ok(rootSha, 'root sample logo present for comparison');
    assert.notStrictEqual(logoSha, rootSha, 'desserdirina logo must not be root DESSERD sample');
  }

  // If a logo file still exists under template images, it must not match DESSERD sample.
  const tplLogo = path.join(ROOT, 'templates/desserdirina/images/logo.jpg');
  if (fs.existsSync(tplLogo) && rootSha) {
    assert.notStrictEqual(
      sha256File(tplLogo),
      rootSha,
      'templates/desserdirina/images/logo.jpg must not remain the DESSERD sample bytes'
    );
  }
});

check('HEAD: Desserdirina template surface has no hardcoded DESSERD / by Irina', () => {
  for (const rel of [
    'templates/desserdirina/template.html',
    'templates/desserdirina/schema.json',
    'templates/desserdirina/presets.json',
  ]) {
    const body = headRead(rel);
    assert.ok(!/\bDESSERD\b/.test(body), rel + ' no DESSERD');
    assert.ok(!/by Irina/i.test(body), rel + ' no by Irina');
  }
});

// ── HEAD GREEN: professionals photographic catalog thumb ────────────────

check('HEAD: professionals has local photographic images/ source for pickThumbnailSource', () => {
  const imgDir = path.join(ROOT, 'templates/professionals/images');
  assert.ok(fs.existsSync(imgDir) && fs.statSync(imgDir).isDirectory(), 'templates/professionals/images/');
  const names = fs.readdirSync(imgDir).filter((n) => {
    const ext = path.extname(n).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
  });
  assert.ok(names.length >= 1, 'at least one raster photo in professionals/images');
  // Prefer hero.jpg so pickThumbnailSource preferred list hits it
  const preferred = ['hero.jpg', 'pr-hero.jpg', 'cn-hero.jpg'];
  const hit = preferred.find((n) => names.includes(n)) || names[0];
  const abs = path.join(imgDir, hit);
  const st = fs.statSync(abs);
  assert.ok(st.size > 8 * 1024, hit + ' must be a real photo (>8KB), not empty chip');
  // Not an SVG
  assert.ok(!names.some((n) => n.toLowerCase().endsWith('.svg')), 'no svg-only fallback in images/');
});

check('HEAD: after build:app light registry professionals.thumbnail is raster not SVG', () => {
  // Ensure generated artifacts exist (test may run after npm run build:app).
  const genLight = path.join(ROOT, 'builder/generated/templates-data.js');
  if (!fs.existsSync(genLight)) {
    execFileSync('npm', ['run', 'build:app'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
  }
  assert.ok(fs.existsSync(genLight), 'builder/generated/templates-data.js after build');
  const light = fs.readFileSync(genLight, 'utf8');
  // Extract professionals entry thumbnail
  const m = light.match(
    /"id"\s*:\s*"professionals"[\s\S]{0,400}?"thumbnail"\s*:\s*"([^"]+)"/
  ) || light.match(
    /"thumbnail"\s*:\s*"([^"]+)"[\s\S]{0,200}?"id"\s*:\s*"professionals"/
  );
  assert.ok(m, 'professionals thumbnail in light registry');
  const thumb = m[1];
  assert.ok(!/\.svg(\?|$)/i.test(thumb), 'thumbnail must not be SVG placeholder, got ' + thumb);
  assert.ok(
    /\.(jpe?g|png|webp|gif)(\?|$)/i.test(thumb),
    'thumbnail must be raster URL, got ' + thumb
  );
  assert.ok(
    /\/app\/generated\/thumbs\/professionals\./i.test(thumb),
    'thumbnail under generated/thumbs/professionals.*, got ' + thumb
  );

  const thumbsDir = path.join(ROOT, 'builder/generated/thumbs');
  const files = fs.readdirSync(thumbsDir);
  const pro = files.find((f) => /^professionals\.(jpe?g|png|webp|gif)$/i.test(f));
  assert.ok(pro, 'builder/generated/thumbs/professionals.<raster> exists, got ' + files.join(','));
  assert.ok(!files.includes('professionals.svg'), 'no professionals.svg fallback after photo source');
  const proSize = fs.statSync(path.join(thumbsDir, pro)).size;
  assert.ok(proSize > 8 * 1024, 'professionals thumb file is real photo bytes');
});

check('HEAD: Desserdirina light registry description matches commercial registry (no factory)', () => {
  const genLight = path.join(ROOT, 'builder/generated/templates-data.js');
  assert.ok(fs.existsSync(genLight), 'templates-data.js');
  const light = fs.readFileSync(genLight, 'utf8');
  assert.ok(!factoryCopyRe().test(light), 'generated light registry must not carry factory sentence');
  assert.ok(!sampleFactoryRe().test(light), 'generated light registry no sample factory leak');
});

// ── Done ─────────────────────────────────────────────────────────────────
if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll flow4-e2e-qa-fail-remake checks passed.');
process.exit(0);
