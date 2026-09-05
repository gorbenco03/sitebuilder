'use strict';
/**
 * Flow 4.3 oracle — Calendar Professional groundwork + LP readiness.
 *
 * STALE ORACLE RECONCILE (S-legacy G2, 2026-09-04):
 * Professionals presets no longer use the English fallback
 * "request has been logged" / exact "Cererea ta a fost înregistrată" string.
 * Shipped RO confirmation is "Am înregistrat cererea…" plus intro/FAQ copy
 * that still denies automatic booking. Schema honesty moved from English
 * "local request|no external calendar" prose into RO field labels/hints
 * ("cerere, nu confirmare automată"). Assertions updated to the current
 * contract — not a product regression. Boundary/cal.diy Option C module
 * and no-fake-embed guards remain authoritative until native calendar ships.
 *
 * 1) No fake production cal.diy embed / "book now on hosted calendar" on
 *    public templates (professionals stays local appointment *request*).
 * 2) Builder landing/product chrome prices match commercial model from
 *    bot/pricing.js (trial 7 zile, 99 then 29/an) — no stale one-time/100/
 *    pay-before-publish-as-model numbers on product-visible surfaces.
 * 3) Option C documented; boundary module present; brand tokens not invented.
 *
 * Excludes: 00-Governance/, historical QA evidence (except Flow4/CalendarLP notes).
 *
 * Run: node bot/test/flow4-calendar-lp-oracle.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const pricing = require('../pricing.js');
const calendarBoundary = require('../calendar-boundary.js');

let failed = 0;
function check(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.then(
                () => console.log('PASS', name),
                (e) => {
                    failed++;
                    console.error('FAIL', name, '-', e.message);
                }
            );
        }
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
    }
    return Promise.resolve();
}

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walkFiles(dir, exts, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === '.git') continue;
            walkFiles(p, exts, out);
        } else if (exts.some((e) => ent.name.endsWith(e))) {
            out.push(p);
        }
    }
    return out;
}

/** Fake hosted-calendar claims that must not appear on public templates. */
const FAKE_CAL_CLAIMS = [
    {
        name: 'cal.diy iframe embed',
        re: /<iframe[^>]+(?:cal\.diy|cal\.com)/i,
    },
    {
        name: 'cal.diy script embed',
        re: /https?:\/\/(?:app\.)?cal\.(?:diy|com)\/[^"'\\s]*embed/i,
    },
    {
        name: 'book now on hosted calendar claim',
        re: /book\s+now\s+on\s+(?:our\s+)?hosted\s+calendar/i,
    },
    {
        name: 'production cal.diy booking widget claim',
        re: /(?:live|production)\s+cal\.diy\s+(?:booking|embed|widget)/i,
    },
    {
        name: 'confirmed automatic booking promise on template',
        re: /rezervare\s+confirmat[ăa]\s+automat|automatic(?:ally)?\s+confirmed\s+booking/i,
    },
];

const TEMPLATE_ROOT = path.join(ROOT, 'templates');
const BUILDER_HTML = 'builder/index.html';
const BUILDER_JS = 'builder/app.js';
const BUILDER_CSS = 'builder/app.css';

async function run() {
    await check('commercial pricing source is 9900 / 2900 cents', () => {
        assert.strictEqual(pricing.PRICE_CENTS, 9900);
        assert.strictEqual(pricing.RENEWAL_CENTS, 2900);
        const p = pricing.getPricing({ country: 'RO' });
        assert.strictEqual(p.amount, 99);
        assert.strictEqual(p.renewal, 29);
        assert.strictEqual(p.currency, 'eur');
    });

    await check('option C boundary module documents chosen path', () => {
        assert.strictEqual(calendarBoundary.CHOSEN_OPTION, 'C');
        assert.ok(/cal\.diy/i.test(calendarBoundary.CHOSEN_OPTION_LABEL));
        const b = calendarBoundary.getCalendarBoundary();
        assert.strictEqual(b.publicMode, 'local-request');
        assert.strictEqual(b.calDiyEnabled, false);
        assert.ok(calendarBoundary.mustUseLocalAppointmentRequest());
        const pub = calendarBoundary.getPublicCalendarConfig();
        assert.strictEqual(pub.calDiyEnabled, false);
        assert.strictEqual(pub.calDiyReady, false);
        assert.ok(pub.ownerGatesPending.includes('domain'));
        assert.ok(pub.ownerGatesPending.includes('secrets'));
        assert.ok(pub.ownerGatesPending.includes('db'));
        assert.ok(pub.ownerGatesPending.includes('deploy'));
        assert.ok(pub.ownerGatesPending.includes('spend'));
    });

    await check('OWNER-CALENDAR-CAL-DIY.md runbook exists with option C + owner gates', () => {
        const md = read('OWNER-CALENDAR-CAL-DIY.md');
        assert.ok(/option\s*C/i.test(md), 'option C');
        assert.ok(/cal\.diy/i.test(md), 'cal.diy');
        assert.ok(/CAL_DIY_BASE_URL/.test(md), 'env placeholder');
        for (const g of ['domain', 'secrets', 'DB', 'deploy', 'spend']) {
            assert.ok(new RegExp(g, 'i').test(md), 'owner gate ' + g);
        }
        assert.ok(/local-request|appointment\s+\*?request/i.test(md), 'request honesty');
        assert.ok(!/set CAL_DIY_ENABLED=1 now/i.test(md), 'must not arm production now');
    });

    await check('public templates: no fake cal.diy / hosted-calendar book claims', () => {
        const files = walkFiles(TEMPLATE_ROOT, ['.html', '.js', '.css', '.json']);
        const hits = [];
        for (const file of files) {
            // presets/schema may mention "booking" generically — only claim patterns
            const text = fs.readFileSync(file, 'utf8');
            const rel = path.relative(ROOT, file);
            for (const claim of FAKE_CAL_CLAIMS) {
                if (claim.re.test(text)) {
                    hits.push(rel + ' :: ' + claim.name);
                }
            }
        }
        assert.strictEqual(hits.length, 0, 'fake calendar claims:\n  - ' + hits.join('\n  - '));
    });

    await check('professionals presets keep request-not-booking honesty', () => {
        const presets = read('templates/professionals/presets.json');
        // Current RO seeds use "cererea" + explicit no-auto-booking wording.
        assert.ok(/cererea/i.test(presets), 'presets still speak in request (cerere) terms');
        assert.ok(
            /Am înregistrat cererea|Cererea ta a fost înregistrată|request has been logged/i.test(presets),
            'confirmation acknowledges a logged request (current RO or legacy EN)'
        );
        assert.ok(
            /nu (face o )?rezervare automată|nu rezervă automat|isn't an automatic (calendar )?booking/i.test(
                presets
            ),
            'intro/FAQ still denies automatic booking'
        );
        assert.ok(
            /Confirmăm (disponibilitatea|cererea)|înainte ca întâlnirea să devină fermă/i.test(presets),
            'confirmation is provisional until owner confirms'
        );
        assert.ok(!FAKE_CAL_CLAIMS.some((c) => c.re.test(presets)));
        const tpl = read('templates/professionals/template.html');
        assert.ok(!/<iframe/i.test(tpl) || !/cal\.(diy|com)/i.test(tpl));
        const schema = read('templates/professionals/schema.json');
        // Schema honesty is now RO labels/hints, not English "local request" prose.
        assert.ok(
            /local request|no external calendar|cerere,\s*nu confirmare automată|nu confirmare automată/i.test(
                schema
            ),
            'schema still documents request-not-auto-confirm honesty'
        );
    });

    await check('builder landing has config-driven price spans (not hard-coded 99€/29€ in how/success)', () => {
        const html = read(BUILDER_HTML);
        // Product-visible landing must not hardcode EUR major units in how-step / success
        assert.ok(/id=["']how-price["']/.test(html), 'how-price id');
        assert.ok(/id=["']how-renewal["']/.test(html), 'how-renewal id');
        assert.ok(/id=["']how-renewal-step["']/.test(html), 'how-renewal-step id');
        assert.ok(/id=["']success-renewal["']/.test(html), 'success-renewal id');
        assert.ok(/id=["']hero-price["']/.test(html), 'hero-price');
        assert.ok(/id=["']proof-price["']/.test(html), 'proof-price');
        assert.ok(/id=["']footer-price["']/.test(html), 'footer-price');
        assert.ok(/id=["']footer-renewal["']/.test(html), 'footer-renewal');
        // Stale hardcodes on landing chrome
        assert.ok(!/Taxăm\s+99€/.test(html), 'no hard-coded Taxăm 99€');
        assert.ok(!/reînnoire\s+29€\/an/.test(html), 'no hard-coded 29€/an in how');
        assert.ok(!/reînnoirea e 29€\/an/.test(html), 'no hard-coded step04 29');
        assert.ok(!/Apoi reînnoire 29€\/an/.test(html), 'no hard-coded success 29');
        // Stale commercial model phrases
        assert.ok(!/pay\s+once/i.test(html), 'no pay once');
        assert.ok(!/pay-before-publish/i.test(html), 'no pay-before-publish as model');
        assert.ok(!/\bPays?\s+100\b/i.test(html), 'no Pay 100');
        assert.ok(!/one-?time\s+99/i.test(html), 'no one-time 99');
        // Trial 7 zile still stated
        assert.ok(/trial(?:ul)?\s+de\s+7\s+zile|7\s*zile/i.test(html), 'trial 7 zile');
    });

    await check('builder/app.js fills how/success prices from /api/config', () => {
        const js = read(BUILDER_JS);
        assert.ok(/how-price/.test(js) && /how-renewal/.test(js), 'wires how spans');
        assert.ok(/success-renewal/.test(js), 'wires success renewal');
        assert.ok(/apiGet\(['"]\/api\/config['"]\)|\/api\/config/.test(js), 'reads config');
        assert.ok(/formatPriceLabel|formatRenewalLabel/.test(js));
    });

    await check('builder LP CSS does not invent hidook.agency brand token block', () => {
        const css = read(BUILDER_CSS);
        // Must not claim agency brand tokens as source of truth
        assert.ok(!/hidook\.agency\s*brand\s*tokens?/i.test(css));
        assert.ok(!/--agency-primary\s*:\s*#[0-9a-fA-F]{3,8}/.test(css));
        assert.ok(!/\/\*\s*hidook\.agency\s+palette/i.test(css));
        const brandNote = read('04-QA-Evidence/Flow4/CalendarLP/LP-BRAND-TOKENS.md');
        assert.ok(/Absent|waits on|owner/i.test(brandNote));
        assert.ok(/Left as-is|as-is/i.test(brandNote));
    });

    await check('GET /api/config exposes pricing + calendar honesty', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow43-cfg-'));
        process.env.DATA_DIR = tmpDir;
        process.env.SERVER_SECRET = 'test-secret-f43-' + crypto.randomBytes(4).toString('hex');
        process.env.PUBLIC_URL = 'http://127.0.0.1:0';
        process.env.HIDOOK_ISOLATED_DEPLOY = '1';
        process.env.HIDOOK_TEST_PAY = '1';
        delete process.env.CAL_DIY_ENABLED;
        delete process.env.CAL_DIY_BASE_URL;
        delete process.env.NODE_ENV;

        // Fresh require after env
        delete require.cache[require.resolve('../server.js')];
        delete require.cache[require.resolve('../calendar-boundary.js')];
        const { startServer } = require('../server.js');
        const server = startServer({ port: 0 });
        await new Promise((r) => server.once('listening', r));
        const addr = server.address();
        const base = `http://127.0.0.1:${addr.port}`;
        try {
            const res = await fetch(base + '/api/config', {
                headers: {
                    Accept: 'application/json',
                    'CF-IPCountry': 'RO',
                },
            });
            assert.strictEqual(res.status, 200);
            const body = await res.json();
            assert.strictEqual(body.amount, 99);
            assert.strictEqual(body.amountCents, 9900);
            assert.strictEqual(body.renewal, 29);
            assert.strictEqual(body.renewalCents, 2900);
            assert.strictEqual(String(body.currency).toLowerCase(), 'eur');
            assert.strictEqual(body.trialDays, 7);
            assert.ok(body.calendar, 'calendar object');
            assert.strictEqual(body.calendar.chosenOption, 'C');
            assert.strictEqual(body.calendar.publicMode, 'local-request');
            assert.strictEqual(body.calendar.calDiyEnabled, false);
            assert.ok(Array.isArray(body.calendar.ownerGatesPending));
            // Must not leak secrets
            assert.ok(!('apiKey' in body.calendar));
            assert.ok(!JSON.stringify(body).includes('CAL_DIY_API_KEY'));
        } finally {
            await new Promise((r) => server.close(r));
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            } catch (_) {}
        }
    });

    // Product-visible surfaces (exclude governance + historical QA except our notes path)
    await check('product-visible builder chrome has no stale 100 / one-time commercial leaks', () => {
        const surfaces = [
            'builder/index.html',
            'builder/app.js',
            'builder/terms.html',
            'builder/privacy.html',
            'PRODUCT.md',
            'README.md',
        ];
        const stale = [
            { name: 'Pay 100', re: /\bPays?\s+100\b/i },
            { name: '100 first publish as model', re: /\b100\s+first\s+publish\b/i },
            { name: 'one-time 99', re: /one-?time\s+99/i },
            { name: 'pay-before-publish as current model heading', re: /Payments\s*\(\s*builder\s+pay-before-publish\s*\)/i },
        ];
        const hits = [];
        for (const rel of surfaces) {
            if (!fs.existsSync(path.join(ROOT, rel))) continue;
            const text = read(rel);
            for (const s of stale) {
                if (s.re.test(text)) hits.push(rel + ' :: ' + s.name);
            }
        }
        assert.strictEqual(hits.length, 0, 'stale leaks:\n  - ' + hits.join('\n  - '));
    });

    if (failed) {
        console.error('\nflow4-calendar-lp-oracle.test.js: FAILED (' + failed + ')');
        process.exit(1);
    }
    console.log('\nflow4-calendar-lp-oracle.test.js: all passed');
    process.exit(0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
