'use strict';
/**
 * bot/test/suite2-png-helpers.js — dependency-free PNG encoder for Suite 2
 * oracles (bot/test/suite2-*.test.js).
 *
 * Not itself a test (no .test.js suffix) — the `node --experimental-sqlite
 * --test bot/test/*.test.js` runner does not pick this file up.
 *
 * The repo ships zero runtime/dev image libraries (no sharp/jimp/canvas —
 * see package.json), and these oracles need exact, known pixel dimensions
 * and alpha values (a 200x200 square logo, a 1200x300 wide logo, a PNG with
 * a genuinely transparent corner) rather than whatever a stock JPEG/PNG
 * fixture happens to be. `build.js`'s own `decodeRasterDims()` only reads
 * the PNG signature + IHDR fields directly (bytes 16-24) — no CRC or IDAT
 * validation — but a real browser (Playwright/Chromium) actually decodes
 * the pixels to paint and to answer `getImageData()`, so this still emits a
 * genuinely valid, zlib-compressed PNG rather than a signature-only stub.
 */
const zlib = require('zlib');

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Builds a raw, uncompressed-then-deflated PNG. `pixelAt(x, y)` returns
 * `[r, g, b, a]` (a omitted/undefined when `hasAlpha` is false) for each
 * pixel — called width*height times, so keep it cheap.
 */
function encodePng(width, height, pixelAt, hasAlpha) {
  const channels = hasAlpha ? 4 : 3;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = pixelAt(x, y);
      const off = rowStart + 1 + x * channels;
      raw[off] = px[0];
      raw[off + 1] = px[1];
      raw[off + 2] = px[2];
      if (hasAlpha) raw[off + 3] = px[3] === undefined ? 255 : px[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = hasAlpha ? 6 : 2; // color type: 6 = RGBA, 2 = RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A flat, opaque, solid-colour PNG — for logo-size measurements where the
 * pixel content itself does not matter, only the file's width/height. */
function makeSolidPng(width, height, rgb) {
  return encodePng(width, height, () => rgb, false);
}

/** A PNG with a real transparent corner (alpha 0) and an opaque coloured
 * centre — mirrors the QA repro ("cerc albastru pe fundal transparent"):
 * a logo cut out on a transparent background, not a fully-blank image. */
function makeTransparentCornerPng(size, rgb) {
  const margin = Math.round(size * 0.2);
  return encodePng(size, size, (x, y) => {
    const inCentre = x >= margin && x < size - margin && y >= margin && y < size - margin;
    return inCentre ? [rgb[0], rgb[1], rgb[2], 255] : [0, 0, 0, 0];
  }, true);
}

function toDataUrl(buf) {
  return 'data:image/png;base64,' + buf.toString('base64');
}

module.exports = { makeSolidPng, makeTransparentCornerPng, toDataUrl };
