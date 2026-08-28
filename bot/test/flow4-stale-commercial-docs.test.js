'use strict';
/**
 * Flow 4.1 oracle: operator commercial docs must describe the current model
 * (Stripe subscription, 7-day card trial → auto-charge 99 → renewal 29/year
 * via subscription schedule). Fails on leftover 100 / manual-renewal /
 * pay-before-publish-as-current-model copy.
 *
 * Scope (six files only; historical 00-Governance/ and old QA evidence exempt):
 *   GO-LIVE.md, README.md, LAUNCH.md, bot/README.md, bot/DEPLOY.md,
 *   CLOUDFLARE-DEPLOY.md
 *
 * Run:  node bot/test/flow4-stale-commercial-docs.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

const DOC_RELS = [
    'GO-LIVE.md',
    'README.md',
    'LAUNCH.md',
    path.join('bot', 'README.md'),
    path.join('bot', 'DEPLOY.md'),
    'CLOUDFLARE-DEPLOY.md',
];

/** Stale phrases verified on e06ef00 — must not teach as current commercial model. */
const STALE_PHRASES = [
    {
        name: '100-as-price: "Pay 100" / "Pays 100"',
        re: /\bPays?\s+\*?\*?100\*?\*?\b/i,
    },
    {
        name: '100-as-price: "Taking the 100 payment"',
        re: /Taking the 100\b/i,
    },
    {
        name: '100-as-price: "100 first publish"',
        re: /\b100\s+first\s+publish\b/i,
    },
    {
        name: '100-as-price: "100 once then 29"',
        re: /\b100\s+once\s+then\s+29\b/i,
    },
    {
        name: '100-as-price: "outside the 100 SKU"',
        re: /\b100\s+SKU\b/i,
    },
    {
        name: '100-as-price: table/bold **100** as first-publish amount',
        re: /\|\s*\*\*100\*\*\s*\|/,
    },
    {
        name: '100-as-price: brochure offer priced at **100** EUR/GBP/USD',
        re: /\*\*100\*\*\s*EUR\b/i,
    },
    {
        name: 'manual renewal: "Renewal is priced but not automated"',
        re: /Renewal is priced but not automated/i,
    },
    {
        name: 'manual renewal: renewals are a manual charge',
        re: /renewals are a manual charge/i,
    },
    {
        name: 'stale gap: "No refund/cancellation flow in the product"',
        re: /No refund\/cancellation flow in the product/i,
    },
    {
        name: 'pay-before-publish as current model: section "Payments (builder pay-before-publish)"',
        re: /Payments\s*\(\s*builder\s+pay-before-publish\s*\)/i,
    },
    {
        name: 'pay-before-publish as current model: "pay-before-publish; paid publish pipeline"',
        re: /pay-before-publish\s*;\s*paid\s+publish\s+pipeline/i,
    },
    {
        name: 'pay-before-publish as current model: drafts until pay-before-publish (no card trial)',
        re: /until\s+pay-before-publish/i,
    },
    {
        name: 'pay-before-publish as current model: unpaid drafts + pay-before-publish without trial framing',
        // Affirmative old happy path: unpaid → pay-before-publish (no 7-day card trial nearby on same line)
        re: /Unpaid\s+sites\s+stay\s+drafts\s+until\s+pay-before-publish/i,
    },
];

/** Required current-model signals somewhere across the six docs (not every file). */
const REQUIRED_CURRENT = [
    {
        name: 'current model: Stripe subscription + 7-day trial',
        re: /subscription[\s\S]{0,80}7[-\s]?day\s+trial|7[-\s]?day\s+trial[\s\S]{0,80}subscription/i,
    },
    {
        name: 'current model: card required',
        re: /card\s+required|requires?\s+a\s+card|card\s+on\s+file/i,
    },
    {
        name: 'current model: live immediately after valid card',
        re: /live\s+(immediately|\/\s*public)\s+after|immediately\s+after\s+(a\s+)?valid\s+card|site\s+.*live.*after.*card/i,
    },
    {
        name: 'current model: auto-charge 99 after trial / day 7',
        re: /(?:auto(?:matic(?:ally)?)?[-\s]?charge|charged?\s+automatically|first\s+charge).{0,60}\b99\b|\b99\b.{0,60}(?:after\s+(?:day\s+)?7|after\s+the\s+trial)|day\s+7.{0,40}\b99\b/i,
    },
    {
        name: 'current model: renewal 29/year via subscription schedule',
        re: /(?:subscription\s+schedule|schedule).{0,80}\b29\b|\b29\b.{0,80}(?:subscription\s+schedule|\/\s*year)/i,
    },
    {
        name: 'current model: cancel during trial unpublishes',
        re: /cancel.{0,60}trial.{0,80}unpublish|unpublish.{0,60}cancel.{0,40}trial/i,
    },
    {
        name: 'current model: owner owns Stripe Product/Prices/Customer Portal/refunds',
        re: /Customer\s+Portal|owner.{0,40}(?:Stripe|refund)/i,
    },
];

let failed = false;
function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => {
                    console.log('PASS', name);
                },
                (e) => {
                    failed = true;
                    console.error('FAIL', name, '-', e.message);
                }
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

function readDocs() {
    const docs = [];
    for (const rel of DOC_RELS) {
        const abs = path.join(rootDir, rel);
        assert.ok(fs.existsSync(abs), rel + ' must exist');
        docs.push({ rel, text: fs.readFileSync(abs, 'utf8') });
    }
    return docs;
}

async function run() {
    const docs = readDocs();
    const corpus = docs.map((d) => d.text).join('\n\n');

    await check('all six commercial docs exist', () => {
        assert.strictEqual(docs.length, 6);
    });

    for (const stale of STALE_PHRASES) {
        await check('must not contain stale: ' + stale.name, () => {
            const hits = [];
            for (const d of docs) {
                if (stale.re.test(d.text)) {
                    const line = d.text
                        .split('\n')
                        .find((l) => stale.re.test(l));
                    hits.push(d.rel + (line ? ': ' + line.trim().slice(0, 120) : ''));
                }
            }
            assert.strictEqual(
                hits.length,
                0,
                'stale commercial copy still present:\n  - ' + hits.join('\n  - ')
            );
        });
    }

    for (const req of REQUIRED_CURRENT) {
        await check('must teach: ' + req.name, () => {
            assert.ok(
                req.re.test(corpus),
                'current commercial model missing across the six docs: ' + req.name
            );
        });
    }

    await check('first-publish amount taught as 99 (not 100) in pricing tables/journeys', () => {
        // At least one explicit 99 major-unit commercial amount
        assert.ok(
            /\b99\s*(EUR|GBP|USD|€)|\/\s*99\s*GBP|\*\*99\*\*/i.test(corpus),
            'docs must state 99 as the first-year / post-trial charge'
        );
        // No bare major-unit 100 used as the product price in journey steps
        const price100Lines = corpus.split('\n').filter((l) => {
            if (!/\b100\b/.test(l)) return false;
            // Allow HTTP status, ports, percentages, years, non-price contexts
            if (/status|HTTP|port|%|percent|MB|GB|bytes|line/i.test(l)) return false;
            if (/do\s+not|don't|never|not|legacy|obsolete|must\s+not|prohibited/i.test(l)) {
                return false;
            }
            // Price-like: Pay/Pays/price/EUR/GBP/USD near 100
            return (
                /\bPays?\b/i.test(l) ||
                /\bprice\b/i.test(l) ||
                /\bEUR\b|\bGBP\b|\bUSD\b|€/.test(l) ||
                /\*\*100\*\*/.test(l) ||
                /first\s+publish/i.test(l) ||
                /\bSKU\b/i.test(l) ||
                /once\s+then/i.test(l)
            );
        });
        assert.strictEqual(
            price100Lines.length,
            0,
            '100 still used as commercial price:\n  - ' +
                price100Lines
                    .map((l) => l.trim().slice(0, 120))
                    .join('\n  - ')
        );
    });

    if (failed) {
        console.error('\nflow4-stale-commercial-docs.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nflow4-stale-commercial-docs.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
