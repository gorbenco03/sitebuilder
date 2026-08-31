'use strict';
/**
 * Flow 2 Desserdirina published-layout regression oracle.
 *
 * Keeps the commercial gallery and makes scroll reveals a progressive
 * enhancement so published photos never rest invisible before the footer.
 *
 * Run: node bot/test/flow2-desserdirina-layout.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const template = fs.readFileSync(path.join(ROOT, 'templates/desserdirina/template.html'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'templates/desserdirina/styles.css'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'templates/desserdirina/script.js'), 'utf8');

assert.match(template, /class=["'][^"']*gallery-section\b/, 'Desserdirina template must keep the gallery section');
assert.match(template, /class=["'][^"']*collage-deck\b/, 'Desserdirina gallery must keep its photo collage');
assert.match(
    template,
    /class=["'][^"']*collage-photo\b[^>]*>[\s\S]*?<img\b/,
    'Desserdirina collage must keep its photo markup'
);

const defaultRevealRule = styles.match(/\.fade-in-section\s*\{([^}]*)\}/);
assert.ok(defaultRevealRule, 'Desserdirina styles must define the default .fade-in-section rule');
assert.doesNotMatch(
    defaultRevealRule[1],
    /opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/,
    'Desserdirina sections must be visible by default, without waiting for JavaScript'
);

const initScrollAnimations = script.match(/function initScrollAnimations\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(initScrollAnimations, 'Desserdirina script may keep initScrollAnimations');
assert.match(
    initScrollAnimations[0],
    /querySelectorAll\(['"]\.fade-in-section['"]\)/,
    'initScrollAnimations must continue to enhance reveal sections when JavaScript runs'
);

console.log('PASS Desserdirina gallery remains present and visible by default');
