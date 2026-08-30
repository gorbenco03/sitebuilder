'use strict';
/**
 * Flow 2 Local Service hero regression oracle.
 *
 * Locks the București renovation and roofing presets to bundled job-site
 * photography and rejects the former London/English-city images and slug.
 *
 * Run: node bot/test/flow2-local-service-heroes.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const IMAGE_DIR = path.join(ROOT, 'templates/local-service/images');
const FORBIDDEN_SHA256 = {
    'pr-hero.jpg': '4b342e5029bc27e929b0cd04240530ae5d493dd723302a34b182eb4dcf663462',
    'ct-hero.jpg': 'c9e3247ff23116d9acc570c61320bed5d94fd2a9d7323f1c9223b85f809b77c1',
};

for (const [name, forbiddenSha256] of Object.entries(FORBIDDEN_SHA256)) {
    const bytes = fs.readFileSync(path.join(IMAGE_DIR, name));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.notStrictEqual(sha256, forbiddenSha256, `${name} still uses the rejected foreign-location photograph`);
    assert.ok(bytes.length > 50 * 1024, `${name} must exceed 50 KB; received ${bytes.length} bytes`);
    assert.deepStrictEqual(Array.from(bytes.subarray(0, 3)), [0xff, 0xd8, 0xff], `${name} must have JPEG magic bytes`);
    assert.deepStrictEqual(Array.from(bytes.subarray(-2)), [0xff, 0xd9], `${name} must have a JPEG end marker`);
}

const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/local-service/presets.json'), 'utf8')).presets || [];
const renovation = presets.find((preset) => preset.id === 'renovari-bucuresti');
const roofing = presets.find((preset) => preset.id === 'acoperisuri-dacia');
assert.ok(renovation, 'renovari-bucuresti preset must remain available');
assert.ok(roofing, 'acoperisuri-dacia preset must remain available');

for (const [preset, imageName] of [[renovation, 'pr-hero.jpg'], [roofing, 'ct-hero.jpg']]) {
    const background = String((((preset || {}).config || {}).hero || {}).background || '');
    assert.match(
        background,
        new RegExp(`url\\(\\s*['"]images/${imageName.replace('.', '\\.')}['"]\\s*\\)`),
        `${preset.id}: hero.background must keep url('images/${imageName}')`
    );
}

for (const preset of presets) {
    assert.doesNotMatch(String(preset.id || ''), /manchester/i, 'Local Service preset id must not mention Manchester');
    assert.doesNotMatch(String(preset.name || ''), /manchester/i, 'Local Service preset name must not mention Manchester');
}

console.log('PASS Local Service renovation/roofing heroes are bundled job photography and preset names are location-clean');
