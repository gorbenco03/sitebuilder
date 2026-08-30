'use strict';
/**
 * Flow 2 Professional hero regression oracle.
 *
 * Locks the București Professional presets to a bundled office photograph and
 * rejects the former London-street image.
 *
 * Run: node bot/test/flow2-professional-hero.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HERO_PATH = path.join(ROOT, 'templates/professionals/images/hero.jpg');
const FORBIDDEN_LONDON_SHA256 = '4b342e5029bc27e929b0cd04240530ae5d493dd723302a34b182eb4dcf663462';
const EXPECTED_PRESETS = ['cabinet-marin', 'atelier-nord', 'cabinet-marin-ro'];

const hero = fs.readFileSync(HERO_PATH);
const heroSha256 = crypto.createHash('sha256').update(hero).digest('hex');

assert.notStrictEqual(heroSha256, FORBIDDEN_LONDON_SHA256, 'Professional hero still uses the London-street photograph');
assert.ok(hero.length > 50 * 1024, `Professional hero must exceed 50 KB; received ${hero.length} bytes`);
assert.deepStrictEqual(Array.from(hero.subarray(0, 3)), [0xff, 0xd8, 0xff], 'Professional hero must have JPEG magic bytes');
assert.deepStrictEqual(Array.from(hero.subarray(-2)), [0xff, 0xd9], 'Professional hero must have a JPEG end marker');

const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets || [];
assert.deepStrictEqual(presets.map((preset) => preset.id), EXPECTED_PRESETS, 'Professional preset coverage changed');
for (const preset of presets) {
    const background = String((((preset || {}).config || {}).hero || {}).background || '');
    assert.match(
        background,
        /url\(\s*['"]images\/hero\.jpg['"]\s*\)/,
        `${preset.id}: hero.background must keep url('images/hero.jpg')`
    );
}

console.log(`PASS Professional office hero ${heroSha256} (${hero.length} bytes); ${presets.length}/${EXPECTED_PRESETS.length} presets reference images/hero.jpg`);
