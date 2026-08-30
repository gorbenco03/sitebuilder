'use strict';
/**
 * Flow 2 Professional published-layout regression oracle.
 *
 * Keeps every commercial section in the page and makes reveal effects a
 * progressive enhancement so published content never rests invisible.
 *
 * Run: node bot/test/flow2-professional-layout.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const template = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'templates/professionals/styles.css'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'templates/professionals/script.js'), 'utf8');

for (const id of ['process', 'about', 'appointment', 'faq', 'contact']) {
    assert.match(template, new RegExp(`id=["']${id}["']`), `Professional template must keep #${id}`);
}

const defaultRevealRule = styles.match(/\.pr-reveal\s*\{([^}]*)\}/);
assert.ok(defaultRevealRule, 'Professional styles must define the default .pr-reveal rule');
assert.doesNotMatch(
    defaultRevealRule[1],
    /opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/,
    'Professional sections must be visible by default, without waiting for JavaScript'
);

const initReveal = script.match(/function initReveal\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(initReveal, 'Professional script must keep initReveal');
assert.match(initReveal[0], /querySelectorAll\(['"]\.pr-reveal['"]\)/, 'initReveal must find reveal nodes');
assert.match(initReveal[0], /if\s*\(!nodes\.length\)\s*return/, 'initReveal must remain safe when reveal nodes are missing');

console.log('PASS Professional published sections remain present and visible by default');
