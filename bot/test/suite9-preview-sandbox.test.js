'use strict';
/**
 * bot/test/suite9-preview-sandbox.test.js
 *
 * The preview iframes must never be granted `allow-same-origin`.
 *
 * The editor renders a customer's site into a sandboxed `srcdoc` iframe. Its
 * opaque origin is what keeps template JavaScript — and anything a customer
 * pastes into a field that ends up in that document — away from the
 * builder's own origin: its localStorage, its session cookie, its DOM.
 *
 * This assertion used to live in flow2-calcom-booking-link, whose subject was
 * the optional Cal.com link. That link is gone from the product, so the file
 * went with it — but this check had nothing to do with Cal.com and everything
 * to do with not handing a preview the keys to the account. It lives here now,
 * under a name that says what it protects.
 *
 * The opaque origin has a real cost, and the cost is not a reason to lift it:
 * desserdirina's self-hosted fonts fail CORS inside the preview because of it,
 * and the fix for that is CORS headers on the font route, never
 * `allow-same-origin`.
 *
 * Run: node --experimental-sqlite --test bot/test/suite9-preview-sandbox.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const INDEX = path.join(ROOT, 'builder', 'index.html');

function sandboxTokens(html, id) {
    const re = new RegExp('<iframe[^>]*\\bid="' + id + '"[^>]*>', 'i');
    const tag = re.exec(html);
    assert.ok(tag, 'iframe #' + id + ' not found in builder/index.html');
    const attr = /\bsandbox="([^"]*)"/i.exec(tag[0]);
    assert.ok(attr, 'iframe #' + id + ' has no sandbox attribute at all');
    return new Set(attr[1].split(/\s+/).filter(Boolean));
}

test('preview iframes are sandboxed without same-origin access', () => {
    const html = fs.readFileSync(INDEX, 'utf8');
    for (const id of ['preview-iframe', 'preview-modal-iframe']) {
        const tokens = sandboxTokens(html, id);
        assert.ok(!tokens.has('allow-same-origin'),
            '#' + id + ' must not carry allow-same-origin — that would give a customer\'s ' +
            'own template code reach into the builder\'s origin');
        for (const required of ['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox']) {
            assert.ok(tokens.has(required),
                '#' + id + ' sandbox lost ' + required + ', which the preview needs to work');
        }
    }
});
