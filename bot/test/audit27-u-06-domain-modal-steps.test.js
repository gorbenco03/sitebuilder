'use strict';
/**
 * bot/test/audit27-u-06-domain-modal-steps.test.js — U-06 oracle
 * (PLAN-UX-2026-09-27 §4 "Modal Domeniu propriu cu pași expliciți" +
 * "Confirmare explicită la Folosește alt domeniu").
 *
 * Two findings, one modal:
 *   1. `ux-benchmark` (gap-custom-domain-selfserve-depth adjacent): the
 *      Domeniu modal was a single flat panel with no indication of which of
 *      the several steps (enter domain / add DNS / verify / done) the owner
 *      is currently on.
 *   2. `gap-custom-domain-selfserve-depth#1`: "Folosește alt domeniu" had the
 *      exact same real-world effect as "Deconectează" (the eventual submit
 *      detaches the live Cloudflare hostname — see
 *      audit27-r-15-domain-switch-seo-fallback.test.js for the server-side
 *      half of this) but, unlike "Deconectează", carried no confirm() at all.
 *
 * RED BEFORE this branch: no `.domain-steps` element existed anywhere in the
 * rendered panel (assertion 1 below fails outright), and clicking "Folosește
 * alt domeniu" replaced the panel with the connect form unconditionally, so
 * dismissing the (nonexistent) dialog could never prevent it — the "cancel
 * keeps the active domain on screen" assertion fails on old code because the
 * connect form appears regardless of what a dialog handler does.
 * GREEN AFTER: a 4-step stepper mirrors the real DNS/TLS status machine, and
 * switching only proceeds after an accepted confirm() naming the domain that
 * gets disconnected and the Hidook-subdomain fallback.
 *
 * Same isolated-deploy + stubbed-Cloudflare + stubbed-dns.promises pattern as
 * bot/test/wave8-owner-ui-domain-reachable-e2e.test.js. Screenshots go to
 * os.tmpdir(), named after the action just performed (owner rule 2026-09-02
 * item 7) — never into the repo.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-06-domain-modal-steps.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

/** Same minimal fake Cloudflare Pages API as wave7/wave8's own oracles. */
function fakeCloudflare({ pagesHost }) {
    const attached = new Map();
    function jsonResponse(obj, status = 200) {
        return { ok: status < 400, status, json: async () => obj };
    }
    async function fetchImpl(url, opts) {
        const u = String(url);
        const method = (opts && opts.method) || 'GET';
        if (/\/pages\/projects\/[^/]+$/.test(u) && !u.includes('/domains') && method === 'GET') {
            return jsonResponse({ success: true, result: { subdomain: pagesHost } });
        }
        const domainMatch = u.match(/\/pages\/projects\/[^/]+\/domains\/([^/?]+)/);
        if (domainMatch) {
            const domain = decodeURIComponent(domainMatch[1]);
            if (method === 'GET') {
                if (!attached.has(domain)) return jsonResponse({ success: false, errors: [{ message: 'not found' }] }, 404);
                return jsonResponse({ success: true, result: { name: domain, status: attached.get(domain).status } });
            }
            if (method === 'DELETE') { attached.delete(domain); return jsonResponse({ success: true, result: {} }); }
        }
        if (/\/pages\/projects\/[^/]+\/domains$/.test(u) && method === 'POST') {
            const body = JSON.parse(opts.body);
            attached.set(body.name, { status: 'pending' });
            return jsonResponse({ success: true, result: { name: body.name, status: 'pending' } });
        }
        throw new Error('fakeCloudflare: unhandled request ' + method + ' ' + u);
    }
    return {
        fetchImpl,
        markActive(domain) { attached.get(domain).status = 'active'; },
        isAttached(domain) { return attached.has(domain); },
    };
}

function enotfound(name) {
    const e = new Error(`queryTxt ENOTFOUND ${name}`);
    e.code = 'ENOTFOUND';
    return e;
}

/** Reads the stepper's per-step state class straight from the live DOM. */
async function stepStates(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('#domain-modal-body .domain-step')).map((el) => {
        if (el.classList.contains('is-current')) return 'current';
        if (el.classList.contains('is-done')) return 'done';
        return 'upcoming';
    }));
}

test('Domeniu modal shows numbered steps that track real DNS/TLS status, and switching domains asks for explicit confirmation first', async () => {
    const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u06-domain-steps-'));

    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u06-domain-data-'));
    process.env.SERVER_SECRET = 'audit27-u06-domain-secret';
    process.env.CLOUDFLARE_API_TOKEN = 'fake-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'fake-account';
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'CALENDAR_PUBLIC_BASE_URL']) {
        delete process.env[k];
    }

    const pagesHost = 'audit27-u06-xyz.pages.dev';
    const fakeCf = fakeCloudflare({ pagesHost });
    const origFetch = global.fetch;
    global.fetch = fakeCf.fetchImpl;

    const dnsPromises = require('dns').promises;
    const origResolveTxt = dnsPromises.resolveTxt;
    const origResolveCname = dnsPromises.resolveCname;
    dnsPromises.resolveTxt = async () => { throw enotfound('stub'); };
    dnsPromises.resolveCname = async () => { throw enotfound('stub'); };

    require(path.join(ROOT, 'scripts/build-builder.js'));
    const { startServer } = require(path.join(ROOT, 'bot/server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    const testDomain = 'u06-' + crypto.randomBytes(4).toString('hex') + '.com';

    try {
        // =====================================================================
        // 1. Publish a real site and reach the Domeniu modal on its dashboard
        //    card (same path as wave8-owner-ui-domain-reachable-e2e).
        // =====================================================================
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.locator('#hb-cookie-accept').click().catch(() => {});
        await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);
        await page.locator('#btn-close-drawer').click().catch(() => {});

        const runSlug = 'audit27-u06-' + crypto.randomBytes(4).toString('hex');
        await page.locator('#btn-publish').click();
        await page.locator('#modal-publish').waitFor({ state: 'visible' });
        await page.locator('#input-slug').fill(runSlug);
        await page.locator('#btn-publish-continue').click();
        await page.locator('#form-auth-email').waitFor({ state: 'visible' });
        await page.locator('#input-email').fill('audit27-u06-domain@example.com');
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        await page.locator('#modal-success').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').click();
        await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
        await page.locator('#btn-success-close').click().catch(() => {});
        await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});

        await page.locator('#nav-dashboard').click().catch(async () => {
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
        });
        await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
        const card = page.locator('.site-card', { hasText: runSlug });
        await card.waitFor({ state: 'visible' });
        await card.locator('button', { hasText: 'Domeniu' }).click();
        await page.locator('#modal-domain').waitFor({ state: 'visible' });

        // =====================================================================
        // 2. Step 1 — nothing connected yet: 4 numbered steps, step 1 current.
        // =====================================================================
        await page.locator('#domain-connect-form').waitFor({ state: 'visible' });
        const steps = page.locator('#domain-modal-body .domain-step');
        assert.equal(await steps.count(), 4, 'must render exactly 4 numbered steps');
        assert.deepStrictEqual(
            await stepStates(page),
            ['current', 'upcoming', 'upcoming', 'upcoming'],
            'entering the domain must be the highlighted current step before anything is connected'
        );
        await page.screenshot({ path: path.join(SHOTS, '01-step1-connect-form.png') });

        // =====================================================================
        // 3. Connect -> awaiting DNS: step 1 done, step 2 current, DNS records
        //    card visible with its own "Pasul 2" heading, short status label
        //    reads the required plain-language phrase.
        // =====================================================================
        await page.locator('#domain-input').fill(testDomain);
        await page.locator('#btn-domain-connect-submit').click();
        await page.locator('.dns-records-table').waitFor({ state: 'visible', timeout: 15000 });
        assert.deepStrictEqual(
            await stepStates(page),
            ['done', 'current', 'upcoming', 'upcoming'],
            'after entering the domain, step 2 (DNS records) must be current and step 1 done'
        );
        assert.match(await page.locator('.domain-step-card-title').first().innerText(), /Pasul 2/);
        assert.match(await page.locator('.domain-status-short').innerText(), /nu se vede încă/, 'the plain-language "not visible yet" phrase must be on screen');
        await page.screenshot({ path: path.join(SHOTS, '02-step2-dns-records.png') });

        // =====================================================================
        // 4. DNS wrong on purpose: short status must read "se vede, dar greșit".
        // =====================================================================
        const cnameName = 'www.' + testDomain;
        const txtValue = await page.locator('.btn-copy-dns').nth(1).getAttribute('data-copy');
        dnsPromises.resolveTxt = async () => [[txtValue]];
        dnsPromises.resolveCname = async () => ['some-other-host.pages.dev']; // mismatched on purpose
        await page.locator('#btn-domain-verify').click();
        await page.locator('.domain-status-short', { hasText: /greșit/ }).waitFor({ state: 'visible', timeout: 15000 });
        await page.screenshot({ path: path.join(SHOTS, '03-step2-dns-partial-wrong.png') });

        // =====================================================================
        // 5. Fix the CNAME -> DNS verified + attached -> provisioning: step 3
        //    current, steps 1-2 done, short status reads "verificat".
        // =====================================================================
        dnsPromises.resolveCname = async () => [pagesHost];
        await page.locator('#btn-domain-verify').click();
        await page.locator('#domain-modal-body .status-badge', { hasText: 'Se activează certificatul' }).waitFor({ state: 'visible', timeout: 15000 });
        assert.ok(fakeCf.isAttached(cnameName), 'DNS verifying must actually attach the domain on Cloudflare');
        assert.deepStrictEqual(
            await stepStates(page),
            ['done', 'done', 'current', 'upcoming'],
            'once DNS verifies and the certificate starts provisioning, step 3 (Verificare) must be current'
        );
        assert.match(await page.locator('.domain-status-short').innerText(), /verificat/);
        await page.screenshot({ path: path.join(SHOTS, '04-step3-provisioning.png') });

        // =====================================================================
        // 6. Cloudflare reports active -> step 4 current/last, "Pasul 4" card,
        //    live link visible.
        // =====================================================================
        fakeCf.markActive(cnameName);
        await page.locator('#btn-domain-verify').click();
        await page.locator('#domain-modal-body .status-badge', { hasText: 'Activ' }).waitFor({ state: 'visible', timeout: 15000 });
        assert.deepStrictEqual(
            await stepStates(page),
            ['done', 'done', 'done', 'current'],
            'once the domain is active, step 4 (Gata) must be the current/final step'
        );
        assert.match(await page.locator('.domain-step-card-title').innerText(), /Pasul 4/);
        await page.locator('#domain-modal-body a', { hasText: 'https://' + cnameName }).waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(SHOTS, '05-step4-active.png') });

        // =====================================================================
        // 7. "Folosește alt domeniu" while active: dismissing the confirm must
        //    leave the active domain exactly as it was — this is the assertion
        //    that fails outright on the pre-U-06 code (which had no confirm
        //    at all and switched unconditionally).
        //
        // U-01 (PLAN-UX-2026-09-27 §3, merged after this oracle was written)
        // replaced window.confirm() here with the product's own
        // modal-domain-switch (same open/close contract as every other
        // modal — see suite4-modal-contract.test.js) — a real page.once('dialog')
        // never fires anymore, so this drives the modal directly instead.
        // =====================================================================
        await page.locator('#btn-domain-switch').click();
        await page.locator('#modal-domain-switch').waitFor({ state: 'visible' });
        const switchMessage = (await page.locator('#domain-switch-message').innerText()).trim();
        assert.match(switchMessage, new RegExp(testDomain.replace(/[.]/g, '\\.')), 'the confirm must name the domain that will be disconnected');
        assert.match(switchMessage, /deconectat/i, 'the confirm must say the current domain gets disconnected');
        assert.match(switchMessage, /subdomeniul Hidook/, 'the confirm must reassure the site stays on its Hidook address meanwhile');
        await page.locator('#btn-dismiss-domain-switch').click();
        await page.locator('#modal-domain-switch').waitFor({ state: 'hidden' });
        await page.locator('#btn-domain-disconnect').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#domain-connect-form').count(), 0, 'dismissing the confirm must NOT switch to the connect form — the active domain must stay connected');
        await page.screenshot({ path: path.join(SHOTS, '06-switch-confirm-dismissed-still-active.png') });

        // =====================================================================
        // 8. Accepting the same confirm does proceed to step 1 (the fresh
        //    connect form), and the server-side domain is untouched by the UI
        //    action alone (only the eventual new-domain submit detaches it —
        //    covered server-side by audit27-r-15-domain-switch-seo-fallback).
        // =====================================================================
        await page.locator('#btn-domain-switch').click();
        await page.locator('#modal-domain-switch').waitFor({ state: 'visible' });
        await page.locator('#btn-confirm-domain-switch').click();
        await page.locator('#domain-connect-form').waitFor({ state: 'visible', timeout: 5000 });
        assert.deepStrictEqual(
            await stepStates(page),
            ['current', 'upcoming', 'upcoming', 'upcoming'],
            'accepting the confirm must return to step 1 for the new domain'
        );
        await page.screenshot({ path: path.join(SHOTS, '07-switch-confirm-accepted-step1.png') });

        console.log('PASS audit27-u-06-domain-modal-steps: numbered steps track real status; switching domains requires an explicit, accurate confirm');
    } finally {
        dnsPromises.resolveTxt = origResolveTxt;
        dnsPromises.resolveCname = origResolveCname;
        global.fetch = origFetch;
        await browser.close();
        await new Promise((r) => server.close(r));
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    }
});
