'use strict';
/**
 * Test: CLOUDFLARE-DEPLOY.md describes Hidook Site Builder — not desserdina Pages.
 * Run:  node bot/test/cloudflare-docs-commercial.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');
const docPath = path.join(rootDir, 'CLOUDFLARE-DEPLOY.md');

const doc = fs.readFileSync(docPath, 'utf8');

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

/** True if the line is clearly a prohibition / quoted “do not” callout about the old name. */
function isProhibitionOrQuotedCallout(line) {
    return (
        /\b(do\s+not|don't|never|not|must\s+not|should\s+not|obsolete|legacy|prohibited|forbidden|not the product|not operator)\b/i.test(
            line
        ) ||
        /[“"][^”"]*\b(DESSERD|desserd|desserdina)\b[^”"]*[”"]/i.test(line) ||
        /`[^`]*\b(DESSERD|desserd|desserdina)\b[^`]*`/i.test(line)
    );
}

async function run() {
    await check('CLOUDFLARE-DEPLOY.md exists', () => {
        assert.ok(fs.existsSync(docPath), 'CLOUDFLARE-DEPLOY.md must exist');
    });

    await check(
        'CLOUDFLARE-DEPLOY.md must not name DESSERD / desserd / desserdina as the product',
        () => {
            const lines = doc.split('\n');
            for (const line of lines) {
                if (/\bDESSERD\b/.test(line) || /desserdina/i.test(line) || /desserd/i.test(line)) {
                    assert.ok(
                        isProhibitionOrQuotedCallout(line),
                        'must not use DESSERD/desserd/desserdina as product name (only prohibition callouts), got: ' +
                            line.trim()
                    );
                }
            }
        }
    );

    await check('CLOUDFLARE-DEPLOY.md names Hidook Site Builder', () => {
        assert.ok(
            /Hidook Site Builder/i.test(doc),
            'doc must name Hidook Site Builder'
        );
    });

    await check(
        'doc describes browser builder as commercial product and customer sites as {slug}.sites.hidook.agency',
        () => {
            assert.ok(
                /browser builder|web builder|commercial product/i.test(doc),
                'doc must describe browser builder / commercial product'
            );
            assert.ok(
                /\{?slug\}?\.sites\.hidook\.agency|sites\.hidook\.agency/i.test(doc),
                'doc must mention customer live URLs as *.sites.hidook.agency'
            );
        }
    );

    await check(
        'doc must not teach deploying the bakery sample / wrangler desserdina as the commercial product',
        () => {
            // Old title / framing: Deploy desserdina to Cloudflare Pages
            assert.ok(
                !/^#\s*Deploy\s+desserdina/im.test(doc),
                'must not title the doc as Deploy desserdina…'
            );
            // Affirmative wrangler --project-name desserdina as the product deploy
            const projectNameLines = doc.split('\n').filter((l) =>
                /--project-name\s+desserdina|project-name\s+desserdina|pages deploy.*desserdina/i.test(l)
            );
            for (const line of projectNameLines) {
                assert.ok(
                    isProhibitionOrQuotedCallout(line),
                    'wrangler project-name desserdina must only appear as prohibition/legacy, got: ' +
                        line.trim()
                );
            }
            // Treat wrangler.toml name = "desserdina" as product identity
            const wranglerNameLines = doc.split('\n').filter(
                (l) => /wrangler\.toml/i.test(l) && /desserdina/i.test(l) && /name\s*=/i.test(l)
            );
            for (const line of wranglerNameLines) {
                assert.ok(
                    isProhibitionOrQuotedCallout(line),
                    'wrangler.toml name desserdina must not be taught as product identity, got: ' +
                        line.trim()
                );
            }
            // Bakery/sample framed as the product being deployed (not as example)
            assert.ok(
                !/desserdina landing page is a plain static site/i.test(doc),
                'must not frame desserdina landing page as what gets deployed'
            );
        }
    );

    await check(
        'doc must not instruct live production Cloudflare/DNS cutover for hidook.agency as this slice',
        () => {
            // Owner-only launch gates must stay framed as owner-only / not this slice
            const liveDnsLines = doc.split('\n').filter(
                (l) =>
                    /hidook\.agency/i.test(l) &&
                    /(DNS|custom domain|cutover|production Cloudflare|live Pages)/i.test(l)
            );
            for (const line of liveDnsLines) {
                const isOwnerGateOrLocal =
                    /\b(owner|owner-only|do\s+not|don't|never|not|local|staging|test|fake|isolated|must\s+not|launch gate|out of scope|not this slice|not in scope)\b/i.test(
                        line
                    ) || /PRODUCT\.md/i.test(line);
                assert.ok(
                    isOwnerGateOrLocal,
                    'hidook.agency DNS/production mentions must be owner-gate or local/test framing, got: ' +
                        line.trim()
                );
            }

            // Old custom domain cutover: desserdina.ro as affirmative operator step
            const customDomainAffirmative = doc.split('\n').filter(
                (l) =>
                    /custom domains?/i.test(l) &&
                    /desserdina\.(ro|pages\.dev)/i.test(l) &&
                    !isProhibitionOrQuotedCallout(l)
            );
            assert.ok(
                customDomainAffirmative.length === 0,
                'must not teach desserdina.ro / desserdina.pages.dev custom-domain cutover as product deploy'
            );

            // Affirmative “first run creates the Pages project desserdina”
            assert.ok(
                !/creates? the Pages project\s+`?desserdina`?/i.test(doc),
                'must not teach creating live Pages project desserdina as the product path'
            );
        }
    );

    await check(
        'doc may mention local/test or isolated fake deploy; sample site is not operator product copy',
        () => {
            // Prefer team-safe framing somewhere in the doc
            const hasLocalOrFakeOrIsolated =
                /\b(local|staging|test|fake|isolated|HIDOOK_FAKE_DEPLOY|owner-only|PRODUCT\.md)\b/i.test(
                    doc
                );
            assert.ok(
                hasLocalOrFakeOrIsolated,
                'doc should mention local/test/fake/isolated deploy and/or owner-only gates / PRODUCT.md'
            );
            // Sample bakery files not sold as Hidook product branding
            if (/config\.json|index\.html|bakery|sample/i.test(doc)) {
                const sampleLines = doc.split('\n').filter((l) =>
                    /(config\.json|index\.html|bakery|sample site)/i.test(l)
                );
                const hasDisclaim =
                    sampleLines.some((l) =>
                        /\b(sample|example|not (the )?product|not operator|customer-site|brochure)\b/i.test(
                            l
                        )
                    ) || /not operator product copy|not the commercial product/i.test(doc);
                assert.ok(
                    hasDisclaim,
                    'if sample/bakery files are mentioned, must disclaim they are not operator product copy'
                );
            }
        }
    );

    if (failed) {
        console.error('\ncloudflare-docs-commercial.test.js: FAILED');
        process.exit(1);
    }
    console.log('\ncloudflare-docs-commercial.test.js: all passed');
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
