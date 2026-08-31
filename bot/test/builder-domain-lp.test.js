'use strict';
/**
 * Owner correction 2026-08-31: browser builder host is lp.hidook.agency,
 * not builder.hidook.agency. Docs/runbooks must not teach the stale host.
 *
 * Run: node bot/test/builder-domain-lp.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

const DOC_RELS = [
    'PRODUCT.md',
    'LAUNCH.md',
    'GO-LIVE.md',
    'CLOUDFLARE-DEPLOY.md',
    'README.md',
    path.join('bot', 'README.md'),
    path.join('bot', 'DEPLOY.md'),
    'OWNER-STRIPE-TRIAL.md',
    'OWNER-CALENDAR-CAL-DIY.md',
];

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

function readDocs() {
    return DOC_RELS.map((rel) => {
        const abs = path.join(rootDir, rel);
        assert.ok(fs.existsSync(abs), rel + ' must exist');
        return { rel, text: fs.readFileSync(abs, 'utf8') };
    });
}

const docs = readDocs();
const corpus = docs.map((d) => d.text).join('\n\n');

check('no stale builder.hidook.agency host', () => {
    const hits = [];
    for (const d of docs) {
        if (/builder\.hidook\.agency/i.test(d.text)) {
            const line = d.text.split('\n').find((l) => /builder\.hidook\.agency/i.test(l));
            hits.push(d.rel + ': ' + (line || '').trim().slice(0, 140));
        }
    }
    assert.strictEqual(hits.length, 0, 'stale builder.hidook.agency still present:\n  - ' + hits.join('\n  - '));
});

check('no stale builder.yourdomain.com / builder.example.com host', () => {
    const hits = [];
    for (const d of docs) {
        if (/builder\.(yourdomain|example)\.com/i.test(d.text)) {
            const line = d.text.split('\n').find((l) => /builder\.(yourdomain|example)\.com/i.test(l));
            hits.push(d.rel + ': ' + (line || '').trim().slice(0, 140));
        }
    }
    assert.strictEqual(
        hits.length,
        0,
        'stale builder.* placeholder still present:\n  - ' + hits.join('\n  - ')
    );
});

check('PRODUCT.md names lp.hidook.agency as the builder', () => {
    const product = docs.find((d) => d.rel === 'PRODUCT.md').text;
    assert.ok(
        /Builder:\s*`https:\/\/lp\.hidook\.agency`/.test(product),
        'PRODUCT.md must list Builder: https://lp.hidook.agency'
    );
});

check('LAUNCH.md names lp.hidook.agency in owner DNS gates', () => {
    const launch = docs.find((d) => d.rel === 'LAUNCH.md').text;
    assert.ok(
        /lp\.hidook\.agency/.test(launch),
        'LAUNCH.md must mention lp.hidook.agency'
    );
    assert.ok(
        !/builder\.hidook\.agency/.test(launch),
        'LAUNCH.md must not mention builder.hidook.agency'
    );
});

check('corpus teaches lp.hidook.agency', () => {
    assert.ok(/lp\.hidook\.agency/.test(corpus), 'docs must name lp.hidook.agency');
});

if (failed) {
    console.error('\nbuilder-domain-lp.test.js: FAILED');
    process.exit(1);
}
console.log('\nbuilder-domain-lp.test.js: all passed');
