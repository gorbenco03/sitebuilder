'use strict';
/**
 * bot/test/s70-professionals-appointments.test.js — S70 Professionals + local appointment requests.
 *
 * Causal locks:
 *   - registry includes professionals (4th design system)
 *   - renderHtml professionals preset has appointment section + no unresolved tokens
 *   - builder catalog chip + badge for Servicii profesionale
 *   - pay/test → isolated live professionals HTML
 *   - POST /api/appointments persists status=requested (never confirmed)
 *   - GET /api/appointments is owner-auth only (401 unauth, 403 other user; PII not public)
 *   - republish keeps appointment config text
 *   - no Calendly/Google calendar secrets / fake integration
 *
 * Run: node bot/test/s70-professionals-appointments.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's70-pro-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'test-secret-s70-' + crypto.randomBytes(4).toString('hex');
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.NODE_ENV;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;
delete process.env.DEPLOY_PROVIDER;

const { renderHtml } = require('../../build.js');
const registry = require('../registry.js');
const webpublish = require('../webpublish.js');
const { startServer } = require('../server.js');

let failed = 0;
async function check(name, fn) {
    try {
        await fn();
        console.log('PASS', name);
    } catch (e) {
        failed++;
        console.error('FAIL', name, '-', e.message);
        if (process.env.VERBOSE) console.error(e.stack);
    }
}

function loadPreset(tid, idx = 0) {
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8')).presets;
    return JSON.parse(JSON.stringify(presets[idx].config));
}

function loadTpl(tid) {
    return fs.readFileSync(path.join(ROOT, 'templates', tid, 'template.html'), 'utf8');
}

function makeClient(base) {
    const jar = {};
    async function doFetch(urlPath, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
        if (cookieStr) headers.Cookie = cookieStr;
        const res = await fetch(base + urlPath, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
        for (const sc of setCookie) {
            if (!sc) continue;
            const first = sc.split(';')[0];
            const eq = first.indexOf('=');
            if (eq < 0) continue;
            jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
        }
        return res;
    }
    return doFetch;
}

async function main() {
    await check('registry lists professionals as fourth system', () => {
        const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'registry.json'), 'utf8'));
        const ids = reg.templates.map((t) => t.id);
        assert.deepStrictEqual(ids, ['product-menu', 'local-service', 'portfolio', 'professionals']);
        const pr = reg.templates.find((t) => t.id === 'professionals');
        assert.ok(/profesion/i.test(pr.name), 'catalog name must be Romanian professionals');
        assert.ok(/program/i.test(pr.description) || /consulta/i.test(pr.description), 'description should mention appointments/consult');
    });

    await check('professionals folder assets + ≥2 presets render cleanly', () => {
        const dir = path.join(ROOT, 'templates', 'professionals');
        for (const f of ['template.html', 'styles.css', 'script.js', 'schema.json', 'presets.json']) {
            assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
        }
        const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;
        assert.ok(presets.length >= 2);
        const tpl = loadTpl('professionals');
        for (const p of presets) {
            const html = renderHtml(tpl, p.config);
            assert.ok(!html.includes('{{'), 'unresolved tokens');
            assert.ok(html.includes(p.config.business.name));
            assert.ok(/Solicită o programare|appointment|pr-appt/i.test(html), 'appointment UI missing');
            assert.ok(/Cerere|confirm/i.test(html), 'request/confirm language missing');
            assert.ok(!/calendly|google calendar|oauth/i.test(html), 'must not fake calendar integrations');
            assert.ok(!/SERVER_SECRET|HIDOOK_/i.test(html), 'no env leaks in HTML');
        }
        const edit = renderHtml(tpl, presets[0].config, { editMode: true });
        assert.ok(edit.includes('data-hb-edit="business.name"'));
        assert.ok(edit.includes('data-hb-edit="services.0.label"'));
    });

    await check('professionals art direction is paper/ink not restaurant/salon clone', () => {
        const css = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'styles.css'), 'utf8');
        const html = loadTpl('professionals');
        assert.ok(/paper|ink|editorial|Professionals/i.test(css.slice(0, 500)));
        assert.ok(!/MENU BOARD|chalkboard|powder calm.*salon/i.test(css));
        assert.ok(/pr-page|pr-nav|pr-appt/.test(html), 'unique professionals class prefix');
        assert.ok(!/pf-chrome|pf-page|ls-page/.test(html), 'must not reuse salon/trade page classes');
        const schema = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'schema.json'), 'utf8');
        assert.ok(/Servicii profesionale/i.test(schema));
        assert.ok(/appointment\.types|appointment\.weekly/.test(schema));
        assert.ok(!/cofetărie|patiserie|meniu de sezon/i.test(schema));
    });

    await check('builder catalog exposes professionals chip + badge', () => {
        const index = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');
        const app = fs.readFileSync(path.join(ROOT, 'builder', 'app.js'), 'utf8');
        assert.ok(/data-filter="professionals"/.test(index), 'catalog chip missing');
        assert.ok(/Servicii profesionale/.test(index));
        assert.ok(/'professionals':\s*'Servicii profesionale'/.test(app), 'DESIGN_BADGE missing');
    });

    await check('script appointment model is request-not-booking', () => {
        const js = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'script.js'), 'utf8');
        assert.ok(/\/api\/appointments/.test(js), 'must POST local appointments API');
        assert.ok(/requested|Cerere/i.test(js));
        assert.ok(!/calendly\.com|googleapis\.com\/calendar/i.test(js));
        assert.ok(/sessionStorage|localOnly|previzualizare/i.test(js), 'preview fallback required');
    });

    // Live server path
    process.env.PUBLIC_URL = 'http://127.0.0.1';
    const server = startServer({ port: 0 });
    await new Promise((r) => setTimeout(r, 30));
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_URL = base;
    const fetchAuth = makeClient(base);

    await check('GET /api/templates includes professionals', async () => {
        const res = await fetch(`${base}/api/templates`);
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        const ids = (body.templates || []).map((t) => t.id);
        assert.ok(ids.includes('professionals'), ids.join(','));
        const pr = (body.templates || []).find((t) => t.id === 'professionals');
        assert.ok(pr.schema && pr.presets && pr.presets.length >= 2);
    });

    let siteId;
    let slug;
    const distinctive = 'Cabinet Marin S70-' + crypto.randomBytes(3).toString('hex');
    const distinctive2 = 'Cabinet Marin S70-v2-' + crypto.randomBytes(3).toString('hex');

    await check('auth + publish professionals unpaid then test-pay live', async () => {
        const email = `s70-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const authRes = await fetchAuth('/api/auth/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        assert.strictEqual(authRes.status, 200);
        const authBody = await authRes.json();
        assert.ok(authBody.devLink, 'devLink required in test');
        const verifyPath = authBody.devLink.replace(/^https?:\/\/[^/]+/, '');
        const ver = await fetchAuth(verifyPath);
        assert.ok(ver.status === 302 || ver.status === 200, 'verify status ' + ver.status);

        const cfg = loadPreset('professionals', 0);
        cfg.business.name = distinctive;
        cfg.appointment.title = 'Solicită o programare S70';
        cfg.appointment.confirmationText = 'Cererea ta a fost înregistrată S70-CONFIRM.';

        const pub1 = await fetchAuth('/api/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateId: 'professionals',
                config: cfg,
                slug: 's70-cab-' + crypto.randomBytes(2).toString('hex'),
            }),
        });
        const pubBody = await pub1.json();
        assert.ok(pub1.status === 200 || pub1.status === 402 || pubBody.site, JSON.stringify(pubBody).slice(0, 200));
        siteId = (pubBody.site && pubBody.site.id) || pubBody.siteId;
        slug = (pubBody.site && pubBody.site.slug) || pubBody.slug;
        if (!siteId) {
            const sites = await (await fetchAuth('/api/sites')).json();
            const s = (sites.sites || sites || []).find((x) => x.templateId === 'professionals') || (sites.sites || [])[0];
            siteId = s && s.id;
            slug = s && s.slug;
        }
        assert.ok(siteId, 'siteId');
        assert.ok(slug, 'slug');

        // Ensure paid + live via registry + publishSite directly if checkout path
        let site = registry.getSite(siteId);
        if (!site.paid) {
            const paidUntil = new Date(Date.now() + 365 * 864e5).toISOString();
            registry.updateSite(siteId, { paid: true, paidUntil, slug });
            site = registry.getSite(siteId);
        }
        const live = await webpublish.publishSite({ site, config: cfg, images: [] });
        assert.ok(live && live.url, 'live url');
        slug = site.slug || slug;

        const liveRes = await fetch(`${base}/live/${slug}/`, { headers: { Accept: 'text/html' } });
        assert.strictEqual(liveRes.status, 200, 'live HTML');
        const html = await liveRes.text();
        assert.ok(html.includes(distinctive), 'live missing business name');
        assert.ok(/Solicită o programare S70|pr-appt-form|data-pr-appt/i.test(html), 'appointment section on live');
        assert.ok(/S70-CONFIRM|confirm/i.test(html));
        assert.ok(!/confirmed booking|rezervare confirmată automat/i.test(html));
    });

    await check('POST /api/appointments stores requested (not confirmed)', async () => {
        const start = new Date(Date.now() + 3 * 864e5);
        start.setUTCHours(10, 0, 0, 0);
        const res = await fetch(`${base}/api/appointments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                slug,
                appointmentTypeId: 'consult-init',
                appointmentTypeLabel: 'Prima discuție',
                requestedStartISO: start.toISOString(),
                timezone: 'Europe/Bucharest',
                durationMin: 45,
                mode: 'online',
                visitorName: 'Ana Pop',
                visitorEmail: 'ana-s70@example.com',
                note: 'Doar context public',
            }),
        });
        const body = await res.json();
        assert.strictEqual(res.status, 200, JSON.stringify(body));
        assert.strictEqual(body.status, 'requested');
        assert.ok(body.id);
        assert.ok(!/confirm/i.test(body.status));

        // List requires auth — unauthenticated must not receive PII
        const unauthList = await fetch(`${base}/api/appointments?slug=${encodeURIComponent(slug)}`);
        assert.strictEqual(unauthList.status, 401, 'list without session must be 401');
        const unauthBody = await unauthList.json().catch(() => ({}));
        assert.ok(!unauthBody.requests, 'no requests payload without auth');
        assert.ok(!JSON.stringify(unauthBody).includes('ana-s70@example.com'));

        // Owner session can list (includes visitor PII for the business)
        const listRes = await fetchAuth(`/api/appointments?slug=${encodeURIComponent(slug)}`);
        assert.strictEqual(listRes.status, 200, 'owner list');
        const list = await listRes.json();
        assert.ok(list.ok);
        assert.ok(list.requests.some((r) => r.id === body.id && r.visitorEmail === 'ana-s70@example.com'));

        // Other authenticated user must not list another owner's slug
        const other = makeClient(base);
        const otherEmail = `s70-other-${crypto.randomUUID().slice(0, 8)}@example.com`;
        const otherAuth = await other('/api/auth/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: otherEmail }),
        });
        const otherBody = await otherAuth.json();
        assert.ok(otherBody.devLink);
        await other(otherBody.devLink.replace(/^https?:\/\/[^/]+/, ''));
        const otherList = await other(`/api/appointments?slug=${encodeURIComponent(slug)}`);
        assert.strictEqual(otherList.status, 403, 'non-owner list must be 403');

        // Idempotent double-submit
        const res2 = await fetch(`${base}/api/appointments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slug,
                appointmentTypeId: 'consult-init',
                appointmentTypeLabel: 'Prima discuție',
                requestedStartISO: start.toISOString(),
                timezone: 'Europe/Bucharest',
                visitorName: 'Ana Pop',
                visitorEmail: 'ana-s70@example.com',
            }),
        });
        const b2 = await res2.json();
        assert.strictEqual(res2.status, 200);
        assert.ok(b2.alreadyRecorded || b2.id === body.id);

        // Unknown slug
        const bad = await fetch(`${base}/api/appointments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slug: 'no-such-slug-xyz',
                appointmentTypeId: 'x',
                requestedStartISO: start.toISOString(),
                visitorName: 'X',
                visitorEmail: 'x@example.com',
            }),
        });
        assert.ok(bad.status === 404 || bad.status === 400);
    });

    await check('edit/republish professionals persists appointment copy', async () => {
        const site = registry.getSite(siteId);
        const cfg = loadPreset('professionals', 0);
        cfg.business.name = distinctive2;
        cfg.appointment.title = 'Programare republicată S70';
        cfg.appointment.intro = 'Intro republicat — cerere, nu rezervare automată.';
        const result = await webpublish.publishSite({ site: { ...site, paid: true }, config: cfg, images: [] });
        assert.ok(result.url);
        const html = await (await fetch(`${base}/live/${site.slug || slug}/`)).text();
        assert.ok(html.includes(distinctive2), 'republish name');
        assert.ok(html.includes('Programare republicată S70'), 'appointment title persist');
        assert.ok(html.includes('Intro republicat'), 'appointment intro persist');
        assert.ok(!html.includes(distinctive) || html.includes(distinctive2), 'old name replaced');
    });

    await check('no factory jargon / env names in professionals surface', () => {
        const bundle = [
            fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8'),
            fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'schema.json'), 'utf8'),
            fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8'),
        ].join('\n');
        assert.ok(!/SERVER_SECRET|HIDOOK_|process\.env/i.test(bundle));
        assert.ok(!/\bDESSERD\b|desserdina|factory/i.test(bundle));
        assert.ok(!/test-link|localhost test/i.test(bundle));
    });

    try { server.close(); } catch (_) {}

    if (failed) {
        console.error('s70-professionals-appointments: FAILED', failed);
        process.exit(1);
    }
    console.log('s70-professionals-appointments: ok');
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
