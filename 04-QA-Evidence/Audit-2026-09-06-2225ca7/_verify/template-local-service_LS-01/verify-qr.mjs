import fs from 'fs';

const src = fs.readFileSync('/Users/Work/Desktop/sitebuilder/templates/local-service/script.js', 'utf8');

// Extract just the QR IIFE (from "(function (root) {" that defines generateQRSVG, to its closing "})(window);")
const startMarker = '(function (root) {';
const start = src.indexOf(startMarker);
const endMarker = '})(window);';
const end = src.indexOf(endMarker, start) + endMarker.length;
const qrCode = src.slice(start, end);

// Fake window
const fakeWindow = {};
const fn = new Function('window', qrCode + '\nreturn window;');
fn(fakeWindow);

if (typeof fakeWindow.generateQRSVG !== 'function') {
  console.error('FAILED to extract generateQRSVG');
  process.exit(1);
}

// We need access to internal `encode`/matrix, but only generateQRSVG/toSVG(matrix) are exposed via SVG.
// Instead, let's re-derive the matrix by parsing the produced SVG rects into a grid, since toSVG draws exact cell rects only for 1-modules; 0-modules are unmarked (background).
// This is ambiguous (can't distinguish 0 vs "masked away" only by rects), so instead let's monkey-patch:
// re-extract makeMatrix/applyMask/encode by directly eval-ing script with a wrapper that also exposes internals.

const debugWrapper = qrCode.replace(
  'root.generateQRSVG = function (text, size) { return toSVG(encode(text), size || 240); };',
  'root.generateQRSVG = function (text, size) { return toSVG(encode(text), size || 240); };\n' +
  'root.__debug = { makeMatrix, applyMask, placeData, placeFormat, encode, getVersion, EC_M, rsEncode };'
);

const fakeWindow2 = {};
const fn2 = new Function('window', debugWrapper + '\nreturn window;');
fn2(fakeWindow2);

const dbg = fakeWindow2.__debug;

function testMessage(label, text) {
  console.log('=== ' + label + ' ===');
  console.log('text:', JSON.stringify(text), 'len(bytes approx):', text.length);
  const v = dbg.getVersion(text.length); // approx, real uses utf8 byte length but ascii here
  console.log('version guess:', v);

  const mat = dbg.encode ? null : null;
  // Reproduce encode() steps manually to inspect intermediate matrix pre-mask and post-mask
  // Instead, call the real encode() via fakeWindow2.generateQRSVG-backing function by re-implementing:
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) { bytes.push(0xC0|(c>>6)); bytes.push(0x80|(c&63)); }
    else { bytes.push(0xE0|(c>>12)); bytes.push(0x80|((c>>6)&63)); bytes.push(0x80|(c&63)); }
  }
  const ver = dbg.getVersion(bytes.length);
  console.log('actual version:', ver, 'byteLen:', bytes.length);
  if (ver < 0) { console.log('TEXT TOO LONG for this mini QR encoder'); return; }
  const ec = dbg.EC_M[ver];

  const preMask = dbg.makeMatrix(ver);
  // snapshot pre-mask finder corner (top-left 8x8) BEFORE placeData (pure function patterns)
  const s = preMask.length;
  console.log('matrix size', s);

  function printCorner(m, label2) {
    console.log('--- ' + label2 + ' top-left 9x9 ---');
    for (let r = 0; r < 9; r++) {
      let row = '';
      for (let c = 0; c < 9; c++) {
        const v2 = m[r][c];
        row += (v2 === -1 ? '.' : v2 === 1 ? '#' : ' ');
      }
      console.log(row);
    }
  }

  printCorner(preMask, 'PRE-PLACE-DATA (pure function patterns)');

  // Now placeData mutates preMask in place (matches real encode() flow)
  const buf = [];
  buf.push(((4 << 4) | (bytes.length >> 4)) & 0xFF);
  buf.push(((bytes.length & 0xF) << 4) | ((bytes[0] >> 4) & 0xF));
  for (let i2 = 0; i2 < bytes.length - 1; i2++)
    buf.push(((bytes[i2] & 0xF) << 4) | ((bytes[i2+1] >> 4) & 0xF));
  buf.push((bytes[bytes.length-1] & 0xF) << 4);
  while (buf.length < ec.data) buf.push(buf.length % 2 === 0 ? 0xEC : 0x11);
  const data = new Uint8Array(buf);
  const ecBytes = dbg.rsEncode(data, ec.total - ec.data);
  const allData = new Uint8Array(ec.total);
  allData.set(data); allData.set(ecBytes, data.length);

  dbg.placeData(preMask, allData);
  printCorner(preMask, 'POST-PLACE-DATA, PRE-MASK (finder pattern should be untouched by placeData)');

  const masked = dbg.applyMask(preMask, 5);
  printCorner(masked, 'POST-MASK (finder pattern corrupted if bug is real)');

  // Compare pre-place-data finder ring values vs post-mask values at same coordinates
  // Recompute a clean reference finder-only matrix for comparison
  const ref = dbg.makeMatrix(ver);
  let mismatches = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (ref[r][c] !== -1) {
        if (masked[r][c] !== ref[r][c]) mismatches++;
      }
    }
  }
  console.log('Finder-pattern cell mismatches (masked vs canonical finder) in top-left 8x8:', mismatches, '/ total finder cells checked');
}

testMessage('Custom message with diacritics', 'Bună, aș dori o programare pentru instalație electrică!');
testMessage('Default-ish short message', 'https://wa.me/40712345678?text=Buna');
