'use strict';
/**
 * bot/test/wave8-owner-ui-domain-reachable-e2e.test.js
 *
 * Reachability oracle for the self-serve custom-domain flow (audit #47).
 * bot/domains.js implements the whole state machine — validate, show DNS
 * records, poll propagation honestly, attach + provision TLS, disconnect —
 * and bot/server.js mounts and auth-gates all five routes for it. Nothing in
 * the product ever linked to any of it: no button, no menu entry, nothing a
 * customer could click. This drives the REAL browser through the builder's
 * "Proiectele mele" dashboard, the same place the earlier Wave 8 calendar fix
 * put its own reachability link, end to end:
 *
 *   1. publish a real site (magic-link sign-in, HIDOOK_TEST_PAY)
 *   2. open the "Domeniu" panel on that site's dashboard card
 *   3. connect a domain — the DNS records table renders with real,
 *      copy-pasteable values (never a placeholder)
 *   4. use the "Copiază" buttons to prove the exact values a non-technical
 *      owner needs are reachable via one click, not manual text selection
 *   5. against the existing Cloudflare-Pages-API stub (bot/test's own
 *      fakeCloudflare pattern) and a stubbed dns.promises, click "Verifică"
 *      until the panel reports the domain provisioning, then active
 *   6. click "Deconectează" and see the panel return to the connect form
 *
 * RED BEFORE this branch: builder/app.js had no "Domeniu" button anywhere,
 * no modal-domain markup in builder/index.html — this test's first
 * UI-specific step (finding that button on the dashboard card) times out and
 * fails. Proven by re-running this exact file against the pre-wave-8 copies
 * of builder/app.js, builder/app.css and builder/index.html (git-checkout'd
 * from the parent commit, no git stash involved) — see
 * 04-QA-Evidence/Wave8-owner-ui/domain-red-before.log.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-owner-ui-domain-reachable-e2e.test.js
 * Evidence: 04-QA-Evidence/Wave8-owner-ui/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave8-owner-ui');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

/**
 * Same fake Cloudflare Pages API bot/test/wave7-domains-cloudflare-attach.test.js
 * already uses (in-process global.fetch stub) — tracks one project's attached
 * custom domains in memory and answers exactly what bot/deploy-cloudflare.js's
 * cfRequest() asks for. HIDOOK_ISOLATED_DEPLOY=1 (used for the publish step
 * below) never touches Cloudflare at all, so this stub only ever sees the
 * domain-connect calls, never the publish/deploy path.
 */
function fakeCloudflare({ pagesHost }) {
    const attached = new Map(); // domain -> { status }
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
            if (method === 'DELETE') {
                attached.delete(domain);
                return jsonResponse({ success: true, result: {} });
            }
        }
        if (/\/pages\/projects\/[^/]+\/domains$/.test(u) && method === 'POST') {
            const body = JSON.parse(opts.body);
            if (attached.has(body.name)) {
                return jsonResponse({ success: false, errors: [{ message: 'You have already added this custom domain.' }] }, 400);
            }
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

test('owner connects a custom domain to active, and disconnects, entirely from the dashboard UI', async () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });

    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = 'test';
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-owner-ui-domain-'));
    process.env.SERVER_SECRET = 'wave8-owner-ui-domain-secret';
    process.env.CLOUDFLARE_API_TOKEN = 'fake-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'fake-account';
    for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN', 'CALENDAR_PUBLIC_BASE_URL']) {
        delete process.env[k];
    }

    const pagesHost = 'wave8-owner-ui-xyz.pages.dev';
    const fakeCf = fakeCloudflare({ pagesHost });
    const origFetch = global.fetch;
    global.fetch = fakeCf.fetchImpl;

    const dnsPromises = require('dns').promises;
    const origResolveTxt = dnsPromises.resolveTxt;
    const origResolveCname = dnsPromises.resolveCname;
    // Start "not visible yet" — the normal, expected state while an owner has
    // not touched their registrar's DNS panel yet.
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
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('dialog', (d) => d.accept());

    const testDomain = 'w8oi-' + crypto.randomBytes(4).toString('hex') + '.com';

    try {
        // =====================================================================
        // 1. Publish a real site (magic-link sign-in, HIDOOK_TEST_PAY).
        // =====================================================================
        await page.goto(base + '/app/', { waitUntil: 'networkidle' });
        await page.locator('#hb-cookie-accept').click().catch(() => {});
        await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/);
        await page.locator('#preview-iframe').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);
        // Details drawer auto-opens on a fresh design and its overlay covers
        // the topbar publish button — close it first, same as a real owner
        // would (and the same step the Wave 8 calendar oracle already takes).
        await page.locator('#btn-close-drawer').click().catch(() => {});

        const runSlug = 'wave8-owner-ui-dom-' + crypto.randomBytes(4).toString('hex');
        const ownerEmail = 'wave8-owner-ui-domain@example.com';

        await page.locator('#btn-publish').click();
        await page.locator('#modal-publish').waitFor({ state: 'visible' });
        await page.locator('#input-slug').fill(runSlug);
        await page.locator('#btn-publish-continue').click();
        await page.locator('#form-auth-email').waitFor({ state: 'visible' });

        await page.locator('#input-email').fill(ownerEmail);
        await page.locator('#btn-send-magic').click();
        await page.locator('#dev-link').waitFor({ state: 'visible' });
        await page.locator('#dev-link').click();
        await page.locator('#modal-success').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
        await page.locator('#btn-pay-publish').click();
        await page
            .locator('#modal-success-title')
            .filter({ hasText: 'Site-ul tău e live' })
            .waitFor({ state: 'visible', timeout: 20000 });

        const mySites = await page.evaluate(() => fetch('/api/sites', { credentials: 'include' }).then(r => r.json()));
        const site = (mySites.sites || []).find((s) => s.slug === runSlug);
        assert.ok(site, 'the just-published site must show up in /api/sites');

        await page.locator('#btn-success-close').click().catch(() => {});
        await page.locator('#modal-success').waitFor({ state: 'hidden' }).catch(() => {});

        // =====================================================================
        // 2. Reach the dashboard exactly where an owner would look, and open
        //    the "Domeniu" panel — RED BEFORE this wave: this button/panel did
        //    not exist anywhere in the product.
        // =====================================================================
        await page.locator('#nav-dashboard').click().catch(async () => {
            await page.evaluate(() => { window.location.hash = '#dashboard'; });
        });
        await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
        const card = page.locator('.site-card', { hasText: runSlug });
        await card.waitFor({ state: 'visible' });

        const domainBtn = card.locator('button', { hasText: 'Domeniu' });
        await domainBtn.waitFor({ state: 'visible', timeout: 15000 });
        await domainBtn.click();

        await page.locator('#modal-domain').waitFor({ state: 'visible' });
        await page.locator('#domain-connect-form').waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(EVIDENCE, 'domain-01-connect-form.png') });

        // =====================================================================
        // 3. Connect the domain — the DNS records table must render with the
        //    real target host / verification token, never a placeholder.
        // =====================================================================
        await page.locator('#domain-input').fill(testDomain);
        await page.locator('#btn-domain-connect-submit').click();
        await page.locator('.dns-records-table').waitFor({ state: 'visible', timeout: 15000 });

        const rows = page.locator('.dns-records-table tbody tr');
        assert.equal(await rows.count(), 2, 'must show exactly TXT + CNAME rows');
        const copyButtons = page.locator('.btn-copy-dns');
        assert.equal(await copyButtons.count(), 4, 'each of the 2 records must offer a copy button for both Nume and Valoare');

        const txtName = await copyButtons.nth(0).getAttribute('data-copy');
        const txtValue = await copyButtons.nth(1).getAttribute('data-copy');
        const cnameName = await copyButtons.nth(2).getAttribute('data-copy');
        const cnameValue = await copyButtons.nth(3).getAttribute('data-copy');
        assert.match(txtName, /^_hidook-challenge\./, 'TXT record name must be the real challenge subdomain');
        assert.match(txtValue, /^hidook-verify=/, 'TXT record value must carry the real verification token');
        assert.equal(cnameName, 'www.' + testDomain, 'two-label domain must target www.<domain> (apex heuristic)');
        assert.equal(cnameValue, pagesHost, 'CNAME value must be the real Cloudflare Pages host, not a placeholder');
        assert.match(await page.locator('.domain-apex-note').innerText(), /nu poate avea o înregistrare CNAME/, 'apex note must explain the apex-forwarding limitation in Romanian');
        await page.screenshot({ path: path.join(EVIDENCE, 'domain-02-dns-records.png') });

        // =====================================================================
        // 4. Prove the copy button actually reaches the clipboard — accurate
        //    copy-paste is the whole point ("must be easy to copy accurately").
        // =====================================================================
        await copyButtons.nth(1).click();
        await page.locator('.btn-copy-dns.copied').first().waitFor({ state: 'visible' });
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        assert.equal(clipboardText, txtValue, 'clicking Copiază must put the EXACT TXT value on the clipboard');

        // =====================================================================
        // 5. Poll with DNS still wrong: honest "waiting" state, never claims
        //    success early, never an alarming error.
        // =====================================================================
        await page.locator('#btn-domain-verify').click();
        await page.locator('.domain-message').waitFor({ state: 'visible' });
        const stillWaitingMsg = await page.locator('.domain-message').innerText();
        assert.match(stillWaitingMsg, /normal|propagarea/i, 'must read as a normal wait, not an error: ' + stillWaitingMsg);
        await page.screenshot({ path: path.join(EVIDENCE, 'domain-03-awaiting-dns.png') });

        // =====================================================================
        // 6. DNS now resolves correctly (stubbed) -> Verifică chains DNS-check
        //    into attach + first TLS poll -> provisioning.
        // =====================================================================
        dnsPromises.resolveTxt = async () => [[txtValue]];
        dnsPromises.resolveCname = async () => [cnameValue];
        await page.locator('#btn-domain-verify').click();
        await page.locator('#domain-modal-body .status-badge', { hasText: 'Se activează certificatul' }).waitFor({ state: 'visible', timeout: 15000 });
        assert.ok(fakeCf.isAttached(cnameName), 'must have actually attached the domain on Cloudflare, not just claimed to');
        await page.screenshot({ path: path.join(EVIDENCE, 'domain-04-provisioning.png') });

        // =====================================================================
        // 7. Cloudflare finally reports active -> "Verifică certificatul"
        //    flips the panel to active, never ahead of Cloudflare confirming it.
        // =====================================================================
        fakeCf.markActive(cnameName);
        const verifyBtn = page.locator('#btn-domain-verify');
        await verifyBtn.click();
        await page.locator('#domain-modal-body .status-badge', { hasText: 'Activ' }).waitFor({ state: 'visible', timeout: 15000 });
        await page.locator('#domain-modal-body a', { hasText: 'https://' + cnameName }).waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(EVIDENCE, 'domain-05-active.png') });

        const domainsModule = require(path.join(ROOT, 'bot/domains.js'));
        assert.equal(
            domainsModule.getActiveDomainForSite(site.id),
            cnameName,
            'the server-side record must independently confirm the domain is active — not just the UI claiming it'
        );

        // =====================================================================
        // 8. Disconnect from the UI -> back to the connect form; site stays
        //    live on its Hidook subdomain, never goes dark.
        // =====================================================================
        await page.locator('#btn-domain-disconnect').click();
        await page.locator('#domain-connect-form').waitFor({ state: 'visible', timeout: 15000 });
        assert.equal(fakeCf.isAttached(cnameName), false, 'must actually detach on Cloudflare, not just flip a local flag');
        assert.equal(domainsModule.getActiveDomainForSite(site.id), null, 'a disconnected domain must stop being reported active');
        await page.screenshot({ path: path.join(EVIDENCE, 'domain-06-disconnected.png') });

        console.log('PASS wave8-owner-ui-domain-reachable-e2e: connect -> DNS wait -> provisioning -> active -> disconnect, all from the dashboard UI');
    } finally {
        dnsPromises.resolveTxt = origResolveTxt;
        dnsPromises.resolveCname = origResolveCname;
        global.fetch = origFetch;
        await browser.close();
        await new Promise((r) => server.close(r));
    }
});
