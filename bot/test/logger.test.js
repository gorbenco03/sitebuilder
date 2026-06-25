'use strict';
/**
 * Test: logger output shape.
 * Run:  node bot/test/logger.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require('assert');
const { format, log } = require('../logger.js');

let failed = false;
function check(name, fn) {
    try { fn(); console.log('PASS', name); }
    catch (e) { failed = true; console.error('FAIL', name, '-', e.message); }
}

check('format injects ts + event and merges fields', () => {
    const rec = format('order.paid', { chatId: 42, slug: 'cafe' });
    assert.strictEqual(rec.event, 'order.paid');
    assert.strictEqual(rec.chatId, 42);
    assert.strictEqual(rec.slug, 'cafe');
    assert.strictEqual(typeof rec.ts, 'string');
    assert.ok(!Number.isNaN(Date.parse(rec.ts)), 'ts must be a valid date');
});

check('a field named "event" cannot clobber the event name', () => {
    const rec = format('real.event', { event: 'spoofed' });
    assert.strictEqual(rec.event, 'real.event');
});

check('Error fields are serialized to {name,message}', () => {
    const rec = format('boom', { err: new TypeError('nope') });
    assert.strictEqual(rec.err.name, 'TypeError');
    assert.strictEqual(rec.err.message, 'nope');
});

check('log emits exactly one valid JSON line to stdout', () => {
    const orig = process.stdout.write;
    let captured = '';
    process.stdout.write = (s) => { captured += s; return true; };
    try { log('hello.world', { a: 1 }); } finally { process.stdout.write = orig; }
    assert.strictEqual(captured.split('\n').filter(Boolean).length, 1, 'one line');
    assert.ok(captured.endsWith('\n'), 'newline-terminated');
    const parsed = JSON.parse(captured.trim());
    assert.strictEqual(parsed.event, 'hello.world');
    assert.strictEqual(parsed.a, 1);
});

check('log does not throw on circular fields', () => {
    const orig = process.stdout.write;
    process.stdout.write = () => true;
    try {
        const circ = {}; circ.self = circ;
        log('circular', { circ }); // must not throw
    } finally { process.stdout.write = orig; }
});

if (failed) { console.error('\nlogger.test.js: FAILED'); process.exit(1); }
console.log('\nlogger.test.js: all passed');
