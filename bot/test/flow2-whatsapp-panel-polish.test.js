'use strict';
/**
 * Flow 2 WhatsApp QR presentation oracle.
 *
 * Proves every launch template centers the QR in a deliberate container and
 * presents the surrounding modal as finished customer-facing chrome.
 *
 * Run: node bot/test/flow2-whatsapp-panel-polish.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = 'd60241e6be29bedbd28a13d1b72dbf8d44fdf855';
const TEMPLATE_IDS = ['product-menu', 'local-service', 'portfolio', 'professionals', 'desserdirina'];

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function baseBlob(rel) {
    return execFileSync('git', ['-C', ROOT, 'show', `${BASE_SHA}:${rel}`], { encoding: 'utf8' });
}

function rule(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

function assertCenteredQr(source, label) {
    const qrCode = rule(source, '.wa-qr__code');
    assert.ok(qrCode, `${label}: missing QR container rule`);
    assert.match(qrCode, /display:\s*(?:grid|flex)/, `${label}: QR container is not a layout container`);
    assert.match(qrCode, /place-items:\s*center|align-items:\s*center/, `${label}: QR is not vertically centered`);
    assert.match(qrCode, /place-items:\s*center|justify-content:\s*center/, `${label}: QR is not horizontally centered`);
    assert.match(qrCode, /min-height:\s*260px/, `${label}: QR container has no stable vertical space`);

    const qrImage = rule(source, '.wa-qr__code img');
    assert.match(qrImage, /max-width:\s*100%/, `${label}: QR cannot shrink inside its container`);
    assert.match(qrImage, /height:\s*auto/, `${label}: a narrow QR can lose its square aspect ratio`);
}

function assertPolishedPanel(source, label) {
    const card = rule(source, '.wa-qr__card');
    assert.ok(card, `${label}: missing QR card rule`);
    assert.match(card, /border:\s*1px\s+solid/, `${label}: QR panel has no deliberate edge`);
    assert.match(card, /box-shadow:/, `${label}: QR panel has no elevation`);
    assert.match(card, /text-align:\s*center/, `${label}: QR panel copy is not composed`);

    const title = rule(source, '.wa-qr__title');
    assert.match(title, /line-height:/, `${label}: QR title has no typographic treatment`);

    const open = rule(source, '.wa-qr__open');
    assert.match(open, /display:\s*inline-flex/, `${label}: WhatsApp Web action is still a bare text link`);
    assert.match(open, /min-height:\s*44px/, `${label}: WhatsApp Web action is not a usable control`);
    assert.match(open, /background:\s*#25D366/i, `${label}: WhatsApp Web action lacks brand treatment`);
    assert.match(open, /color:\s*#fff/i, `${label}: WhatsApp Web action lacks readable contrast`);
}

let baseFailures = 0;
for (const id of TEMPLATE_IDS) {
    const css = baseBlob(`templates/${id}/styles.css`);
    try {
        assertCenteredQr(css, `base ${id}`);
        assertPolishedPanel(css, `base ${id}`);
    } catch {
        baseFailures++;
    }
}
assert.strictEqual(baseFailures, TEMPLATE_IDS.length, 'causal RED: each base template must lack the complete treatment');
console.log('PASS causal RED: all five base WhatsApp panels lack the complete centered/polished treatment');

for (const id of TEMPLATE_IDS) {
    const css = read(`templates/${id}/styles.css`);
    assertCenteredQr(css, id);
    assertPolishedPanel(css, id);
}
console.log('PASS all five WhatsApp QR panels are centered and polished');
