'use strict';
/**
 * Test: AI adapter assistant identity is Hidook, never DESSERD.
 * Run:  node bot/test/ai-brand.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const aiSrcPath = path.join(__dirname, '..', 'ai.js');
const aiSrc = fs.readFileSync(aiSrcPath, 'utf8');

let failed = false;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => { console.log('PASS', name); },
                (e) => { failed = true; console.error('FAIL', name, '-', e.message); }
            );
        }
        console.log('PASS', name);
        return Promise.resolve();
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        return Promise.resolve();
    }
}

async function run() {
    await check('ai.js assistant identity system prompt must not name DESSERD', () => {
        assert.ok(
            !/You are the DESSERD site-builder assistant/i.test(aiSrc),
            'system prompt must not say "You are the DESSERD site-builder assistant"'
        );
        // Production identity string that defines who the model is
        const identityMatch = aiSrc.match(
            /const systemPrompt\s*=\s*`([\s\S]*?)`/
        );
        assert.ok(identityMatch, 'systemPrompt template literal must exist');
        const systemPrompt = identityMatch[1];
        assert.ok(
            !/\bDESSERD\b/.test(systemPrompt),
            'assistant identity system prompt must not contain DESSERD'
        );
    });

    await check('ai.js assistant identity system prompt must name Hidook', () => {
        assert.ok(
            /You are the Hidook site-builder assistant/.test(aiSrc),
            'system prompt must say "You are the Hidook site-builder assistant"'
        );
    });

    await check('ai.js source must not instruct the model that the product is DESSERD', () => {
        assert.ok(
            !/\bDESSERD\b/.test(aiSrc),
            'ai.js must not contain the word DESSERD (file comment or prompts)'
        );
    });

    if (failed) {
        console.error('\nai-brand.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nai-brand.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
