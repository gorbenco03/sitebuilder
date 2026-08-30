'use strict';
/**
 * Flow 2 Desserdirina catalog-thumbnail regression oracle.
 *
 * Run: node bot/test/flow2-desserdirina-thumb.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const REJECTED_COVER_SHA256 = '186c21dd14191e8ed95c94a4e14cf40562d304e23e8c61d22e221ad2003cac4f';

execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
});

const lightRegistryPath = path.join(ROOT, 'builder/generated/templates-data.js');
assert.ok(fs.existsSync(lightRegistryPath), 'light template registry exists after build');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(lightRegistryPath, 'utf8'), sandbox);
const entries = (((sandbox.window || {}).HIDOOK_TEMPLATES || {}).registry || {}).templates || [];
const desserdirina = entries.find((entry) => entry.id === 'desserdirina');
assert.ok(desserdirina, 'Desserdirina remains in the light template registry');
assert.match(
    desserdirina.thumbnail,
    /^\/app\/generated\/thumbs\/desserdirina\.(?:jpe?g|png|webp)$/i,
    `Desserdirina thumbnail is a generated raster, got ${desserdirina.thumbnail}`
);
assert.ok(!/\.svg(?:$|[?#])/i.test(desserdirina.thumbnail), 'Desserdirina thumbnail is not an SVG placeholder');

const thumbPath = path.join(ROOT, 'builder/generated/thumbs', path.basename(desserdirina.thumbnail));
assert.ok(fs.existsSync(thumbPath), 'generated Desserdirina thumbnail file exists');
const bytes = fs.readFileSync(thumbPath);
assert.ok(bytes.length > 8 * 1024, `Desserdirina thumbnail is real photo data (${bytes.length} bytes)`);

const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
assert.ok(isJpeg || isPng || isWebp, 'Desserdirina thumbnail bytes have a supported raster signature');

const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
assert.notStrictEqual(
    sha256,
    REJECTED_COVER_SHA256,
    'Desserdirina catalog still uses the rejected DESSERD page/logo screenshot'
);

console.log('PASS Desserdirina catalog thumbnail is clean raster pastry photography');
console.log(`  ${desserdirina.thumbnail} ${bytes.length} bytes sha256=${sha256}`);
