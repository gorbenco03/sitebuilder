'use strict';
/**
 * bot/test/builder-no-trial-countdown.test.js — S13 success modal has no trial chrome.
 *
 * Invariant: commercial builder success modal must not carry trial-countdown DOM
 * or showSuccessScreen(trialEndsAtIso) countdown plumbing. Pay before publish;
 * no unpaid live trial.
 *
 * Run: node bot/test/builder-no-trial-countdown.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');
const INDEX_HTML = path.join(ROOT, 'builder', 'index.html');
const APP_CSS = path.join(ROOT, 'builder', 'app.css');

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

function extractFunction(src, name) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i++];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    return src.slice(m.index, i);
}

const app = fs.readFileSync(APP_JS, 'utf8');
const html = fs.readFileSync(INDEX_HTML, 'utf8');
const css = fs.existsSync(APP_CSS) ? fs.readFileSync(APP_CSS, 'utf8') : '';
const showSuccessSrc = extractFunction(app, 'showSuccessScreen') || '';
const showSuccessSig = (() => {
    const m = /function\s+showSuccessScreen\s*\(([^)]*)\)/.exec(app);
    return m ? m[1] : '';
})();

check('index.html has no #trial-countdown / trial-countdown-text / .trial-countdown block', () => {
    assert.ok(
        !/\bid\s*=\s*["']trial-countdown["']/.test(html),
        'index.html must not contain id="trial-countdown"'
    );
    assert.ok(
        !/\bid\s*=\s*["']trial-countdown-text["']/.test(html),
        'index.html must not contain id="trial-countdown-text"'
    );
    assert.ok(
        !/class\s*=\s*["'][^"']*\btrial-countdown\b/.test(html),
        'index.html must not contain a .trial-countdown success-modal block'
    );
    assert.ok(
        !/\btrial-countdown\b/.test(html),
        'index.html must not mention trial-countdown at all'
    );
});

check('showSuccessScreen does not read/write #trial-countdown', () => {
    assert.ok(showSuccessSrc.length > 50, 'showSuccessScreen must exist');
    assert.ok(
        !/trial-countdown/.test(showSuccessSrc),
        'showSuccessScreen must not reference trial-countdown'
    );
    assert.ok(
        !/\$\(\s*['"]trial-countdown['"]\s*\)/.test(showSuccessSrc),
        'showSuccessScreen must not look up #trial-countdown'
    );
});

check('showSuccessScreen does not accept or use trialEndsAtIso countdown arg', () => {
    assert.ok(showSuccessSrc.length > 50, 'showSuccessScreen must exist');
    assert.ok(
        !/\btrialEndsAtIso\b/.test(showSuccessSig) && !/\btrialEndsAtIso\b/.test(showSuccessSrc),
        'showSuccessScreen must not accept/use trialEndsAtIso'
    );
    // Call sites must not pass a third countdown arg from site.trialEndsAt
    assert.ok(
        !/showSuccessScreen\s*\(\s*[^,)]+\s*,\s*[^,)]+\s*,\s*[^)]*trialEndsAt/.test(app),
        'callers must not pass trialEndsAt into showSuccessScreen'
    );
});

check('no unpaid trial countdown copy reintroduced in builder success chrome', () => {
    const combined = app + '\n' + html;
    assert.ok(!/expiră în/i.test(combined), 'must not reintroduce "expiră în"');
    assert.ok(!/3 zile gratuite/i.test(combined), 'must not reintroduce "3 zile gratuite"');
    assert.ok(
        !/>\s*Păstrează\s*</.test(html),
        'success modal must not label unpaid CTA as Păstrează'
    );
});

check('app.css drops unused .trial-countdown rules when present', () => {
    if (!css) return;
    assert.ok(
        !/\.trial-countdown\b/.test(css),
        'app.css must not keep .trial-countdown rules after DOM removal'
    );
});

process.exit(failed ? 1 : 0);
