'use strict';
/**
 * Flow 2 Professional appointment-language regression oracle.
 *
 * Keeps validation, in-flight, and failed-request chrome Romanian without
 * exposing browser or server error messages to a visitor.
 *
 * Run: node bot/test/flow2-professional-appointment-ro.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(ROOT, 'templates/professionals/script.js'), 'utf8');

for (const phrase of [
    'Sending',
    'SENDING',
    'Failed to fetch',
    'Please fill in your name',
    "couldn't log",
    'Something went wrong sending',
]) {
    assert.ok(!script.includes(phrase), `Professional appointment chrome still contains customer-visible English: ${phrase}`);
}

assert.match(script, /['"]Se trimite…['"]/, 'In-flight appointment button copy must be Romanian');
assert.match(
    script,
    /['"]Completează numele, emailul și un interval orar\.['"]/,
    'Missing appointment fields must have a Romanian validation hint'
);
assert.match(
    script,
    /['"]Nu am putut trimite cererea\. Încearcă din nou sau folosește emailul de contact\.['"]/,
    'Failed appointment requests must have a Romanian retry hint'
);
assert.doesNotMatch(
    script,
    /hint\.textContent\s*=\s*(?:err|error)\.message/,
    'Appointment hints must never expose raw browser or server error messages'
);
assert.match(
    script,
    /if \(span\) span\.textContent = submitLabel;\s*else submitBtn\.textContent = submitLabel;/,
    'Failed requests must restore the configured submit label for either button shape'
);
assert.match(script, /fetch\(location\.origin \+ ['"]\/api\/appointments['"]/, 'Appointment POST endpoint must remain wired');
assert.match(script, /method:\s*['"]POST['"]/, 'Appointment request must remain a POST');

console.log('PASS Professional appointment validation, in-flight, and failure chrome is Romanian');
