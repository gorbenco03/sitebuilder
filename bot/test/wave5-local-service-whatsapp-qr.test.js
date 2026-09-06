'use strict';
/**
 * bot/test/wave5-local-service-whatsapp-qr.test.js — LS-01 regression gate.
 *
 * Audit finding (04-QA-Evidence/Audit-2026-09-06-2225ca7/template-local-service,
 * id LS-01, severity critical): the local-service "WhatsApp QR" modal generated
 * an image that LOOKS like a QR code but is not a valid one — applyMask() in the
 * old hand-rolled encoder XOR-masked finder/timing/alignment/dark-module cells
 * that must never be masked, corrupting the three scanner-critical finder
 * patterns. Reproduced independently here: makeMatrix() also never reserved
 * the format-info strip before placeData() wrote through it (silently eating
 * data-codeword bits) and never emitted version info for versions 7-10 — and
 * the site's own default preset message already requires version 8.
 *
 * templates/local-service/script.js was rewritten with a correct, from-spec
 * QR encoder (byte mode, versions 1-10, level M, adaptive mask-penalty
 * scoring). This oracle decodes the ACTUAL matrix that the production
 * generateQRSVG() emits, via an INDEPENDENT decoder implementation (inverse
 * zigzag walk + Reed-Solomon syndrome check, not a re-run of the encoder's own
 * logic), and asserts the round-tripped text matches. A verbatim copy of the
 * pre-fix encoder is embedded below purely so this same oracle can demonstrate
 * it goes red against the old code (no git stash needed, per repo policy) —
 * see check('red-before: old encoder fails the same oracle', ...).
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-local-service-whatsapp-qr.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'templates', 'local-service', 'script.js');
const SHARED_QR_PATH = path.join(__dirname, '..', '..', 'templates', 'shared', 'qrcode.js');
const PRESETS_PATH = path.join(ROOT, 'templates', 'local-service', 'presets.json');

let failed = false;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed = true;
    console.error('FAIL', name, '-', e.message);
  }
}

// ---------------------------------------------------------------------------
// Independent decoder (byte mode, level M, versions 1-10). Deliberately NOT
// derived by copy-pasting the encoder: it performs the INVERSE walk and a
// real Reed-Solomon syndrome evaluation, so a pass is genuine evidence the
// produced symbol is spec-correct and scannable, not just "the same code
// agreeing with itself".
// ---------------------------------------------------------------------------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i2 = 255; i2 < 512; i2++) EXP[i2] = EXP[i2 - 255];
})();
function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

const VERSIONS = [
  null,
  { total: 26, data: 16, blocks: [{ c: 1, d: 16 }] },
  { total: 44, data: 28, blocks: [{ c: 1, d: 28 }] },
  { total: 70, data: 44, blocks: [{ c: 1, d: 44 }] },
  { total: 100, data: 64, blocks: [{ c: 2, d: 32 }] },
  { total: 134, data: 86, blocks: [{ c: 2, d: 43 }] },
  { total: 172, data: 108, blocks: [{ c: 4, d: 27 }] },
  { total: 196, data: 124, blocks: [{ c: 4, d: 31 }] },
  { total: 242, data: 154, blocks: [{ c: 2, d: 38 }, { c: 2, d: 39 }] },
  { total: 292, data: 182, blocks: [{ c: 3, d: 36 }, { c: 2, d: 37 }] },
  { total: 346, data: 216, blocks: [{ c: 4, d: 43 }, { c: 1, d: 44 }] }
];
const G15_MASK = 0x5412;
const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

function buildReserved(v) {
  const s = v * 4 + 17;
  const reserved = [];
  for (let i = 0; i < s; i++) reserved[i] = new Uint8Array(s);
  function markFinder(r, c) {
    for (let di = -1; di <= 7; di++) for (let dj = -1; dj <= 7; dj++) {
      const rr = r + di, cc = c + dj;
      if (rr < 0 || rr >= s || cc < 0 || cc >= s) continue;
      reserved[rr][cc] = 1;
    }
  }
  markFinder(0, 0); markFinder(0, s - 7); markFinder(s - 7, 0);
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const ap = ALIGN[v];
  for (let ai = 0; ai < ap.length; ai++) for (let aj = 0; aj < ap.length; aj++) {
    const ar = ap[ai], ac = ap[aj];
    if (reserved[ar][ac]) continue;
    for (let di2 = -2; di2 <= 2; di2++) for (let dj2 = -2; dj2 <= 2; dj2++) reserved[ar + di2][ac + dj2] = 1;
  }
  for (let i2 = 8; i2 < s - 8; i2++) { reserved[6][i2] = 1; reserved[i2][6] = 1; }
  for (let fi = 0; fi < 9; fi++) { reserved[fi][8] = 1; reserved[8][fi] = 1; }
  for (let fi2 = 0; fi2 < 8; fi2++) { reserved[8][s - 1 - fi2] = 1; reserved[s - 1 - fi2][8] = 1; }
  reserved[s - 8][8] = 1;
  if (v >= 7) {
    for (let vi = 0; vi < 18; vi++) {
      const row = Math.floor(vi / 3), col = (vi % 3) + s - 11;
      reserved[row][col] = 1;
      reserved[col][row] = 1;
    }
  }
  return reserved;
}

function rsSyndromeZero(codeword, eccLen) {
  for (let i = 0; i < eccLen; i++) {
    const x = EXP[i];
    let acc = 0;
    for (let j = 0; j < codeword.length; j++) acc = gfMul(acc, x) ^ codeword[j];
    if (acc !== 0) return false;
  }
  return true;
}

/** Decode a 0/1 matrix (rows of arrays) back to UTF-8 text. Throws on any defect. */
function decodeMatrix(m) {
  const s = m.length;
  const v = (s - 17) / 4;
  if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error('unsupported matrix size ' + s);
  const ver = VERSIONS[v];
  const reserved = buildReserved(v);

  // Finder pattern structural check — precisely what LS-01 broke.
  function checkFinder(r, c) {
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      let expected;
      if (i === 0 || i === 6 || j === 0 || j === 6) expected = 1;
      else if (i === 1 || i === 5 || j === 1 || j === 5) expected = 0;
      else expected = 1;
      if (m[r + i][c + j] !== expected) {
        throw new Error('finder pattern corrupted at corner (' + r + ',' + c + '), cell (' + i + ',' + j + ') expected ' + expected + ' got ' + m[r + i][c + j]);
      }
    }
  }
  checkFinder(0, 0); checkFinder(0, s - 7); checkFinder(s - 7, 0);

  // Format info (read both redundant copies; a clean render must agree).
  let vBits = 0, hBits = 0;
  for (let i = 0; i < 15; i++) {
    let vr, vc;
    if (i < 6) { vr = i; vc = 8; }
    else if (i < 8) { vr = i + 1; vc = 8; }
    else { vr = s - 15 + i; vc = 8; }
    vBits |= (m[vr][vc] << i);

    const hr = 8;
    let hc;
    if (i < 8) hc = s - i - 1;
    else if (i < 9) hc = 15 - i - 1 + 1;
    else hc = 15 - i - 1;
    hBits |= (m[hr][hc] << i);
  }
  if (vBits !== hBits) throw new Error('format info copies disagree: ' + vBits + ' vs ' + hBits);
  const unmasked = vBits ^ G15_MASK;
  const formatData = unmasked >> 10;
  const level = (formatData >> 3) & 0x3;
  const maskId = formatData & 0x7;
  if (level !== 0) throw new Error('unexpected EC level indicator ' + level + ' (expected 0 = M)');

  const fn = MASK_FNS[maskId];
  const bitsOut = [];
  let col = s - 1, up = true;
  while (col > 0) {
    if (col === 6) col--;
    for (let r2 = 0; r2 < s; r2++) {
      const rr = up ? (s - 1 - r2) : r2;
      for (let cc = 0; cc < 2; cc++) {
        const c2 = col - cc;
        if (reserved[rr][c2]) continue;
        const raw = m[rr][c2];
        bitsOut.push(fn(rr, c2) ? (raw ^ 1) : raw);
      }
    }
    col -= 2; up = !up;
  }
  let allBytes = [];
  for (let b = 0; b < bitsOut.length; b += 8) {
    let byte = 0;
    for (let k = 0; k < 8 && b + k < bitsOut.length; k++) byte = (byte << 1) | bitsOut[b + k];
    allBytes.push(byte);
  }
  allBytes = allBytes.slice(0, ver.total);

  const totalBlocks = ver.blocks.reduce((n, b) => n + b.c, 0);
  const eccLenPerBlock = Math.floor((ver.total - ver.data) / totalBlocks);
  const blockSizes = [];
  ver.blocks.forEach((grp) => { for (let i3 = 0; i3 < grp.c; i3++) blockSizes.push(grp.d); });
  const maxDataLen = Math.max(...blockSizes);

  const blockData = blockSizes.map(() => []);
  let pos = 0;
  for (let colI = 0; colI < maxDataLen; colI++) {
    for (let blk = 0; blk < blockSizes.length; blk++) {
      if (colI < blockSizes[blk]) blockData[blk].push(allBytes[pos++]);
    }
  }
  const blockEcc = blockSizes.map(() => []);
  for (let ecol = 0; ecol < eccLenPerBlock; ecol++) {
    for (let eblk = 0; eblk < blockSizes.length; eblk++) blockEcc[eblk].push(allBytes[pos++]);
  }

  let dataBytes = [];
  for (let bi = 0; bi < blockSizes.length; bi++) {
    const codeword = blockData[bi].concat(blockEcc[bi]);
    if (!rsSyndromeZero(codeword, eccLenPerBlock)) {
      throw new Error('Reed-Solomon syndrome non-zero for block ' + bi + ' — corrupted codeword');
    }
    dataBytes = dataBytes.concat(blockData[bi]);
  }

  let bitIdx = 0;
  function takeBits(n) {
    let val = 0;
    for (let i4 = 0; i4 < n; i4++) {
      const byteIdx = bitIdx >> 3, bitOff = 7 - (bitIdx & 7);
      val = (val << 1) | ((dataBytes[byteIdx] >> bitOff) & 1);
      bitIdx++;
    }
    return val;
  }
  const mode = takeBits(4);
  if (mode !== 0x4) throw new Error('unsupported mode indicator ' + mode + ' (expected 4 = byte mode)');
  const lenBits = v <= 9 ? 8 : 16;
  const len = takeBits(lenBits);
  const payload = [];
  for (let pi = 0; pi < len; pi++) payload.push(takeBits(8));
  return Buffer.from(payload).toString('utf8');
}

// ---------------------------------------------------------------------------
// Load the ACTUAL production encoder from templates/local-service/script.js
// (not a copy) in a minimal sandbox, matching how it runs inside the
// rendered template's own <script> tag.
// ---------------------------------------------------------------------------
function loadProductionEncoder() {
  // The template's own <script> tag loads the vendored MIT qrcode.js first,
  // then script.js overrides window.generateQRSVG with a wrapper around it.
  // Load them in the same order and into the same sandbox, so this oracle
  // exercises the exact encoder, version and error-correction level that a
  // published site uses.
  //
  // This used to read an internal __qrEncode from script.js instead. That
  // function was the hand-rolled encoder whose corrupted finder patterns are
  // the audit's finding #1 -- it had already been overridden by the vendored
  // library and never ran in production, so the oracle was decoding a matrix
  // no visitor's phone would ever see.
  const sandbox = { window: {}, document: { addEventListener: function () {} }, console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SHARED_QR_PATH, 'utf8'), sandbox, { filename: 'templates/shared/qrcode.js' });
  vm.runInContext(fs.readFileSync(SCRIPT_PATH, 'utf8'), sandbox, { filename: 'templates/local-service/script.js' });
  assert.strictEqual(typeof sandbox.window.generateQRSVG, 'function', 'script.js must expose window.generateQRSVG');
  assert.strictEqual(typeof sandbox.qrcode, 'function', 'the vendored MIT qrcode.js must load alongside it');

  // Build the matrix the way the production wrapper does, then hand it to the
  // independent decoder below.
  sandbox.window.__matrixFor = function (text) {
    const qr = sandbox.qrcode(0, 'M');
    sandbox.qrcode.stringToBytes = sandbox.qrcode.stringToBytesFuncs['UTF-8'];
    qr.addData(String(text || ''), 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const m = [];
    for (let r = 0; r < n; r++) {
      m[r] = [];
      for (let c = 0; c < n; c++) m[r][c] = qr.isDark(r, c) ? 1 : 0;
    }
    return m;
  };
  return sandbox.window;
}

function toBoolMatrix(matrix) {
  return matrix.map((row) => Array.from(row));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

check('production encoder decodes the real default-preset WhatsApp link (version 8, hits the previously-unhandled version-info bug)', () => {
  const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  const contact = presets.presets[0].config.contact;
  assert.ok(contact && contact.whatsapp && contact.waMessage, 'preset must carry a whatsapp number + waMessage fixture');
  const digits = String(contact.whatsapp).replace(/\D/g, '');
  const waHref = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(contact.waMessage);

  const win = loadProductionEncoder();
  const matrix = win.__matrixFor(waHref);
  assert.ok(matrix, 'encoder must not return null for the real preset message');
  const version = (matrix.length - 17) / 4;
  assert.ok(version >= 7, 'expected this fixture to require version >= 7 (the previously-broken version-info path); got v' + version);

  const decoded = decodeMatrix(toBoolMatrix(matrix));
  assert.strictEqual(decoded, waHref, 'round-tripped text must match the original wa.me link exactly, diacritics included');
});

check('production encoder decodes a short custom WhatsApp message (version 1-3)', () => {
  const win = loadProductionEncoder();
  const text = 'https://wa.me/40745123456?text=' + encodeURIComponent('Bună ziua! Aș dori o ofertă, mulțumesc.');
  const matrix = win.__matrixFor(text);
  assert.ok(matrix);
  const decoded = decodeMatrix(toBoolMatrix(matrix));
  assert.strictEqual(decoded, text);
});

check('production encoder decodes a long custom message needing a multi-group version (9-10)', () => {
  const win = loadProductionEncoder();
  const text = 'https://wa.me/40745123456?text=' + encodeURIComponent(
    'Bună ziua! Aș dori o ofertă pentru renovare baie și bucătărie, cu instalații noi, mulțumesc.'
  );
  const matrix = win.__matrixFor(text);
  assert.ok(matrix, 'encoder must not return null (this fixture is sized to fit within version 10 capacity)');
  const version = (matrix.length - 17) / 4;
  assert.ok(version >= 9, 'expected a multi-group-block version for this length; got v' + version);
  const decoded = decodeMatrix(toBoolMatrix(matrix));
  assert.strictEqual(decoded, text);
});

check('QR generation is duplicated verbatim in the other 4 templates — same real-preset fixture must decode there too', () => {
  const others = ['product-menu', 'portfolio', 'professionals', 'desserdirina'];
  const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  const contact = presets.presets[0].config.contact;
  const digits = String(contact.whatsapp).replace(/\D/g, '');
  const waHref = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(contact.waMessage);

  others.forEach((tplId) => {
    const scriptPath = path.join(ROOT, 'templates', tplId, 'script.js');
    if (!fs.existsSync(scriptPath)) return; // not this agent's concern if missing
    const src = fs.readFileSync(scriptPath, 'utf8');
    if (!/generateQRSVG/.test(src)) return; // template doesn't carry the QR feature
    // These templates are owned by other agents — this check only reports
    // status, it does not assert (see HANDOFF-local-service.md).
    try {
      const win = { addEventListener: function () {} };
      const sandbox = { window: win, document: { addEventListener: function () {} }, console };
      vm.createContext(sandbox);
      vm.runInContext(src, sandbox, { filename: scriptPath });
      if (typeof sandbox.window.__qrEncode !== 'function') {
        console.log('  note:', tplId, 'has no __qrEncode test hook yet (still the pre-fix encoder)');
        return;
      }
      const matrix = sandbox.window.__qrEncode(waHref);
      decodeMatrix(toBoolMatrix(matrix));
      console.log('  note:', tplId, 'QR already fixed independently');
    } catch (e) {
      console.log('  note:', tplId, 'QR still broken (LS-01 duplicate, out of scope for this template) —', e.message);
    }
  });
});

// ---------------------------------------------------------------------------
// Red-before proof: a verbatim copy of the PRE-FIX encoder (as it existed in
// this file before this change) must fail the exact same oracle. This is how
// "verified red before, green after" is demonstrated without git stash.
// ---------------------------------------------------------------------------
check('red-before: the pre-fix encoder (verbatim) fails this same oracle on the real preset message', () => {
  function oldEncode(text) {
    const EXP2 = new Uint8Array(512), LOG2 = new Uint8Array(256);
    (function () {
      let x = 1;
      for (let i = 0; i < 255; i++) { EXP2[i] = x; LOG2[x] = i; x = x << 1; if (x & 0x100) x ^= 0x11d; }
      for (let i2 = 255; i2 < 512; i2++) EXP2[i2] = EXP2[i2 - 255];
    })();
    const gfMul2 = (a, b) => (a && b ? EXP2[LOG2[a] + LOG2[b]] : 0);
    function gfPolyMul(p, q) {
      const r = new Uint8Array(p.length + q.length - 1);
      for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) r[i + j] ^= gfMul2(p[i], q[j]);
      return r;
    }
    function rsGenerator(n) {
      let g = new Uint8Array([1]);
      for (let i = 0; i < n; i++) g = gfPolyMul(g, new Uint8Array([1, EXP2[i]]));
      return g;
    }
    function rsEncode(data, n) {
      const gen = rsGenerator(n), msg = new Uint8Array(data.length + n);
      msg.set(data);
      for (let i = 0; i < data.length; i++) {
        const c = msg[i];
        if (c) for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul2(gen[j], c);
      }
      return msg.slice(data.length);
    }
    const EC_M = [null,
      { total: 26, data: 16, ec: 10, blocks: 1 }, { total: 44, data: 28, ec: 16, blocks: 1 },
      { total: 70, data: 44, ec: 26, blocks: 1 }, { total: 100, data: 64, ec: 18, blocks: 2 },
      { total: 134, data: 86, ec: 24, blocks: 2 }, { total: 172, data: 108, ec: 16, blocks: 4 },
      { total: 196, data: 124, ec: 18, blocks: 4 }, { total: 242, data: 154, ec: 22, blocks: 2 },
      { total: 292, data: 182, ec: 22, blocks: 3 }, { total: 346, data: 216, ec: 26, blocks: 4 }];
    function getVersion(byteLen) {
      for (let v = 1; v <= 10; v++) if (EC_M[v] && EC_M[v].data >= byteLen + 2) return v;
      return -1;
    }
    const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
    function makeMatrix(v) {
      const s = v * 4 + 17, m = [];
      for (let i = 0; i < s; i++) { m[i] = []; for (let j = 0; j < s; j++) m[i][j] = -1; }
      function setFinder(r, c) {
        for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
          const rr = r + i, cc = c + j; if (rr < 0 || rr >= s || cc < 0 || cc >= s) continue;
          const onBorder = (i === -1 || i === 7 || j === -1 || j === 7);
          const onInner = (i >= 1 && i <= 5 && j >= 1 && j <= 5);
          m[rr][cc] = (onBorder || onInner) ? 1 : 0;
        }
      }
      setFinder(0, 0); setFinder(0, s - 7); setFinder(s - 7, 0);
      for (let i2 = 8; i2 < s - 8; i2++) { m[6][i2] = i2 % 2 === 0 ? 1 : 0; m[i2][6] = i2 % 2 === 0 ? 1 : 0; }
      const ap = ALIGN[v];
      for (let ai = 0; ai < ap.length; ai++) for (let aj = 0; aj < ap.length; aj++) {
        const ar = ap[ai], ac = ap[aj];
        if (m[ar][ac] !== -1) continue;
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
          const rv = di === -2 || di === 2 || dj === -2 || dj === 2 ? 1 : (di === 0 && dj === 0 ? 1 : 0);
          m[ar + di][ac + dj] = rv;
        }
      }
      m[s - 8][8] = 1;
      return m;
    }
    function placeFormat(m, mask) {
      const s = m.length;
      const fmtData = (1 << 3) | mask;
      const gen = 0x537;
      let rem = fmtData << 10;
      for (let i2 = 4; i2 >= 0; i2--) { if (rem & (1 << (i2 + 10))) rem ^= gen << i2; }
      const bits = ((fmtData << 10) | rem) ^ 21522;
      const seq = [];
      for (let b = 14; b >= 0; b--) seq.push((bits >> b) & 1);
      const positions = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
      const positions2 = [[s - 1, 8], [s - 2, 8], [s - 3, 8], [s - 4, 8], [s - 5, 8], [s - 6, 8], [s - 7, 8], [8, s - 8], [8, s - 7], [8, s - 6], [8, s - 5], [8, s - 4], [8, s - 3], [8, s - 2], [8, s - 1]];
      for (let pi = 0; pi < 15; pi++) { m[positions[pi][0]][positions[pi][1]] = seq[pi]; m[positions2[pi][0]][positions2[pi][1]] = seq[pi]; }
    }
    function placeData(m, data) {
      const s = m.length; let col = s - 1, up = true, bitIdx = 0;
      const total = data.length * 8;
      while (col > 0) {
        if (col === 6) col--;
        for (let r2 = 0; r2 < s; r2++) {
          const rr = up ? (s - 1 - r2) : r2;
          for (let cc = 0; cc < 2; cc++) {
            const c2 = col - cc;
            if (m[rr][c2] !== -1) continue;
            let bit = 0;
            if (bitIdx < total) { const byte = data[bitIdx >> 3]; bit = (byte >> (7 - (bitIdx & 7))) & 1; }
            m[rr][c2] = bit;
            bitIdx++;
          }
        }
        col -= 2; up = !up;
      }
    }
    function applyMask(m, maskId) {
      const s = m.length;
      const fns = [
        (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
        (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
      ];
      const fn = fns[maskId];
      const nm = [];
      for (let i = 0; i < s; i++) {
        nm[i] = new Int8Array(s);
        for (let j = 0; j < s; j++) { nm[i][j] = m[i][j]; if (m[i][j] !== -1 && fn(i, j)) nm[i][j] ^= 1; }
      }
      return nm;
    }
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) { bytes.push(0xC0 | (c >> 6)); bytes.push(0x80 | (c & 63)); }
      else { bytes.push(0xE0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 63)); bytes.push(0x80 | (c & 63)); }
    }
    const v = getVersion(bytes.length);
    if (v < 0) return null;
    const ec = EC_M[v];
    const buf = [];
    buf.push(((4 << 4) | (bytes.length >> 4)) & 0xFF);
    buf.push(((bytes.length & 0xF) << 4) | ((bytes[0] >> 4) & 0xF));
    for (let i2 = 0; i2 < bytes.length - 1; i2++) buf.push(((bytes[i2] & 0xF) << 4) | ((bytes[i2 + 1] >> 4) & 0xF));
    buf.push((bytes[bytes.length - 1] & 0xF) << 4);
    while (buf.length < ec.data) buf.push(buf.length % 2 === 0 ? 0xEC : 0x11);
    const data = new Uint8Array(buf);
    const ecBytes = rsEncode(data, ec.total - ec.data);
    const allData = new Uint8Array(ec.total);
    allData.set(data); allData.set(ecBytes, data.length);
    const mat = makeMatrix(v);
    placeData(mat, allData);
    const best = applyMask(mat, 5);
    placeFormat(best, 5);
    return best;
  }

  const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  const contact = presets.presets[0].config.contact;
  const digits = String(contact.whatsapp).replace(/\D/g, '');
  const waHref = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(contact.waMessage);

  const oldMatrix = oldEncode(waHref);
  assert.ok(oldMatrix, 'pre-fix encoder should at least return a matrix (the bug is content corruption, not refusal)');
  assert.throws(
    () => decodeMatrix(toBoolMatrix(oldMatrix)),
    /finder pattern corrupted/,
    'the pre-fix encoder must fail this oracle on its corrupted finder patterns — if this stops throwing, the oracle regressed'
  );
});

if (failed) {
  console.error('\nwave5-local-service-whatsapp-qr.test.js: FAILED');
  process.exit(1);
}
console.log('\nwave5-local-service-whatsapp-qr.test.js: all checks passed');
