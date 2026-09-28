'use strict';
/**
 * bot/test/audit27-r-27-gdpr-self-service.test.js
 *
 * Audit 2026-09-27, task R-27 (findings auth-account#3, auth-account#4;
 * 04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json; PLAN-AUDIT-2026-09-27.md).
 * Owner decision: GDPR self-service = data download AND full account deletion,
 * reachable from the browser product (not only the frozen Telegram /sterge),
 * from BOTH the plain header (#dashboard/#templates — "Site-urile mele") and
 * the editor topbar's account menu.
 *
 * Real UI throughout (Playwright, real server, HIDOOK_TEST_PAY +
 * HIDOOK_ISOLATED_DEPLOY stubs — same pattern as
 * bot/test/suite12-publish-lifecycle.test.js and
 * bot/test/audit27-r-02-cross-account-draft-isolation.test.js). Two real
 * accounts, each signed in through the real magic-link flow:
 *
 *   - B signs in, publishes a real live site (paid, /live/<slug>/ serving).
 *   - A signs in, publishes a real live site of its own.
 *   - A downloads its data via the header account menu (#dashboard): the
 *     actual network response is asserted to contain ONLY A's own data
 *     (business name, site slug) and NEVER B's (business name, slug, email).
 *   - A deletes its account via the editor topbar account menu's product
 *     modal (NOT window.confirm — a typed-email-confirmation gate that stays
 *     disabled until the exact account email is typed).
 *   - After deletion: A's /live/<slug>/ stops being served (404), A is
 *     signed out, and a fresh sign-in with the SAME email starts a brand-new
 *     account with zero sites (old data never resurfaces).
 *   - B's site and data are completely untouched throughout.
 *
 * Must fail on main (no /api/me/export-data, /api/me/delete-account, or
 * account-menu GDPR items exist there) and pass on this branch.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-27-gdpr-self-service.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

function freshTmpDataDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withServer(envOverrides, fn) {
    const saved = {};
    const clearKeys = ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY'];
    for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
    for (const k of clearKeys) saved[k] = process.env[k];
    Object.assign(process.env, envOverrides);
    for (const k of clearKeys) delete process.env[k];

    for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js', '../account-data.js']) {
        try { delete require.cache[require.resolve(rel)]; } catch (_) { /* not loaded yet */ }
    }
    require(path.join(ROOT, 'scripts/build-builder.js'));
    const { startServer } = require('../server.js');
    const server = startServer({ port: 0 });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const base = 'http://127.0.0.1:' + server.address().port;

    try {
        await fn(base);
    } finally {
        server.close();
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
}

function escapeForRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acceptCookiesAndStart(page, base, templateId) {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(300);
    }
}

async function editBusinessName(page, text) {
    const field = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await field.click({ clickCount: 3 });
    await page.keyboard.type(text, { delay: 12 });
    await field.blur().catch(() => {});
    await page.waitForFunction(
        (expected) => typeof draft !== 'undefined' && draft.config && draft.config.business &&
            draft.config.business.name === expected,
        text,
        { timeout: 5000 }
    );
    await page.waitForTimeout(1600); // past the debounced server autosave
}

/** Real magic-link sign-in, starting from the dashboard's own auth CTA — works
 *  whether the tab already has a local draft (resumes to #edit) or is
 *  brand-new (lands on #dashboard/#edit depending on site count). */
async function signIn(page, base, email) {
    await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    const authBtn = page.locator('#btn-dashboard-auth');
    if (await authBtn.isVisible().catch(() => false)) {
        await authBtn.click();
    } else {
        await page.locator('#btn-account-menu').click();
        await page.locator('#account-menu-projects').click();
        await page.waitForURL(/#dashboard$/);
        await page.locator('#btn-dashboard-auth').click();
    }
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await Promise.race([
        page.waitForURL(/#edit$/),
        page.waitForURL(/#dashboard$/),
    ]);
    await page.waitForTimeout(600);
}

/** Real publish+pay flow through the UI (HIDOOK_TEST_PAY stub) — ends on
 *  #dashboard with the LIVE success modal, closed. Mirrors
 *  bot/test/suite12-publish-lifecycle.test.js#publishAndPayThroughUi. */
async function publishAndPayThroughUi(page, slug) {
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.waitForURL(/#dashboard$/, { timeout: 20000 });
    await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 });
    const titleText = (await page.locator('#modal-success-title').innerText()).trim();
    assert.match(titleText, /live/i, 'must be the LIVE success modal, not the draft/pay-CTA one');
    await page.locator('#btn-close-success').click().catch(() => {});
    await page.waitForURL(/#dashboard$/);
}

test('R-27: "Descarcă datele mele" / "Șterge contul" — reachable, scoped to exactly one account, and the account/site are really gone afterwards', async () => {
    const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-27-shots-'));
    const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

    await withServer({
        HIDOOK_TEST_PAY: '1',
        HIDOOK_ISOLATED_DEPLOY: '1',
        NODE_ENV: 'test',
        DATA_DIR: freshTmpDataDir('audit27-r-27-'),
        SERVER_SECRET: 'audit27-r-27-' + crypto.randomBytes(8).toString('hex'),
    }, async (base) => {
        const browser = await chromium.launch({ headless: true });
        // Two independent browser contexts = two independent session cookies,
        // so A and B are genuinely concurrent signed-in accounts, not one
        // account's cookie overwriting the other's (unlike the deliberate
        // shared-context repro in audit27-r-02).
        const contextA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const contextB = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        try {
            const emailA = 'audit27-r27-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
            const emailB = 'audit27-r27-b-' + crypto.randomUUID().slice(0, 8) + '@example.com';
            const markerA = 'HIDOOK-A-DATA-' + crypto.randomUUID().slice(0, 8);
            const markerB = 'HIDOOK-B-DATA-' + crypto.randomUUID().slice(0, 8);
            const slugA = 'audit27-r27-a-' + crypto.randomUUID().slice(0, 8);
            const slugB = 'audit27-r27-b-' + crypto.randomUUID().slice(0, 8);

            // ---- B: sign in, publish a real live site. B is the "innocent
            // bystander" whose data must never leak into A's export and must
            // survive A's deletion untouched. ----
            const pageB = await contextB.newPage();
            pageB.setDefaultTimeout(30000);
            await acceptCookiesAndStart(pageB, base, 'product-menu');
            await editBusinessName(pageB, markerB);
            await signIn(pageB, base, emailB);
            if (!/#edit$/.test(pageB.url())) {
                await pageB.evaluate(() => { window.location.hash = '#edit'; });
                await pageB.waitForURL(/#edit$/);
            }
            await editBusinessName(pageB, markerB); // re-assert after sign-in resume
            await publishAndPayThroughUi(pageB, slugB);
            await pageB.screenshot({ path: path.join(shotDir, '01-account-b-published-live.png') });

            // ---- A: sign in, publish a real live site of its own. ----
            const pageA = await contextA.newPage();
            pageA.setDefaultTimeout(30000);
            await acceptCookiesAndStart(pageA, base, 'local-service');
            await editBusinessName(pageA, markerA);
            await signIn(pageA, base, emailA);
            if (!/#edit$/.test(pageA.url())) {
                await pageA.evaluate(() => { window.location.hash = '#edit'; });
                await pageA.waitForURL(/#edit$/);
            }
            await editBusinessName(pageA, markerA);
            await publishAndPayThroughUi(pageA, slugA);
            await pageA.screenshot({ path: path.join(shotDir, '02-account-a-published-live.png') });

            // =================================================================
            // "Descarcă datele mele" — reachable from the dashboard header
            // menu ("Site-urile mele"), scoped to exactly A's own data.
            // =================================================================
            await pageA.locator('#btn-account-menu-header').click();
            await pageA.locator('#account-menu-header').waitFor({ state: 'visible' });
            await pageA.locator('#account-menu-header-export-data').waitFor({ state: 'visible' });
            await pageA.locator('#account-menu-header-delete-account').waitFor({ state: 'visible' });
            await pageA.locator('#account-menu-header-logout-all').waitFor({ state: 'visible' });
            await pageA.screenshot({ path: path.join(shotDir, '03-account-a-dashboard-header-menu-open.png') });

            const [exportResp] = await Promise.all([
                pageA.waitForResponse((r) => r.url().includes('/api/me/export-data') && r.request().method() === 'GET'),
                pageA.locator('#account-menu-header-export-data').click(),
            ]);
            assert.equal(exportResp.status(), 200, 'export-data must succeed for a signed-in account (triggered by the real "Descarcă datele mele" button)');
            // Content verification via a second, plain in-page fetch of the
            // same endpoint (rate limit allows 10/hour) — the button-click
            // response above already proved the real UI action works and
            // returns 200; Playwright's CDP body capture on a fetch() the
            // page itself already consumed via res.blob() is not reliable
            // enough to assert JSON content on.
            const exportJson = await pageA.evaluate(() => fetch('/api/me/export-data', { headers: { Accept: 'application/json' } }).then((r) => r.json()));
            const exportText = JSON.stringify(exportJson);

            assert.match(exportText, new RegExp(escapeForRegExp(markerA)), 'export must contain account A\'s own business name');
            assert.match(exportText, new RegExp(escapeForRegExp(slugA)), 'export must contain account A\'s own site slug');
            assert.ok(exportJson.user && String(exportJson.user.email || '').toLowerCase() === emailA.toLowerCase(),
                'export must identify account A as the owner');

            assert.doesNotMatch(exportText, new RegExp(escapeForRegExp(markerB)), 'export must NEVER contain account B\'s business name');
            assert.doesNotMatch(exportText, new RegExp(escapeForRegExp(slugB)), 'export must NEVER contain account B\'s site slug');
            assert.doesNotMatch(exportText, new RegExp(escapeForRegExp(emailB)), 'export must NEVER contain account B\'s email');

            // =================================================================
            // "Șterge contul" — reachable from the EDITOR topbar's account
            // menu too, gated by a real product modal (typed email, not
            // window.confirm).
            // =================================================================
            const editButton = pageA.locator('.site-card-actions button', { hasText: 'Editează' }).first();
            await editButton.click();
            await pageA.waitForURL(/#edit$/);
            await pageA.locator('#preview-iframe').waitFor({ state: 'visible' });
            await pageA.waitForTimeout(600);
            if (await pageA.locator('#details-drawer').isVisible().catch(() => false)) {
                await pageA.locator('#btn-close-drawer').click().catch(() => {});
                await pageA.waitForTimeout(300);
            }

            await pageA.locator('#btn-account-menu').click();
            await pageA.locator('#account-menu').waitFor({ state: 'visible' });
            await pageA.locator('#account-menu-export-data').waitFor({ state: 'visible' });
            await pageA.locator('#account-menu-delete-account').waitFor({ state: 'visible' });
            await pageA.screenshot({ path: path.join(shotDir, '04-account-a-editor-topbar-menu-open.png') });

            await pageA.locator('#account-menu-delete-account').click();
            await pageA.locator('#modal-delete-account').waitFor({ state: 'visible' });
            const shownEmail = (await pageA.locator('#delete-account-email').innerText()).trim();
            assert.equal(shownEmail.toLowerCase(), emailA.toLowerCase(), 'the modal must show account A\'s own email to type back');

            const confirmInput = pageA.locator('#input-delete-account-confirm');
            const confirmBtn = pageA.locator('#btn-confirm-delete-account');

            // Wrong text must keep the destructive action disabled — the whole
            // point of a typed-confirmation modal instead of window.confirm.
            await confirmInput.fill('not-the-right-email@example.com');
            assert.equal(await confirmBtn.isDisabled(), true, 'confirm button must stay disabled until the exact email is typed');

            await confirmInput.fill(emailA);
            assert.equal(await confirmBtn.isDisabled(), false, 'confirm button must enable once the exact email is typed');
            await pageA.screenshot({ path: path.join(shotDir, '05-account-a-delete-modal-confirmed.png') });

            const [deleteResp] = await Promise.all([
                pageA.waitForResponse((r) => r.url().includes('/api/me/delete-account') && r.request().method() === 'POST'),
                confirmBtn.click(),
            ]);
            assert.equal(deleteResp.status(), 200, 'account deletion must succeed for a correctly-confirmed request');

            await pageA.waitForURL(/#templates$/, { timeout: 15000 });
            await pageA.waitForTimeout(300);
            assert.equal(await pageA.locator('#user-badge').isVisible().catch(() => false), false, 'must be signed out after deletion');
            await pageA.screenshot({ path: path.join(shotDir, '06-account-a-signed-out-after-delete.png') });

            // =================================================================
            // The deleted account's live site must stop being served.
            // =================================================================
            const liveAfterDelete = await pageA.request.get(base + '/live/' + slugA + '/');
            assert.equal(liveAfterDelete.status(), 404, 'a deleted account\'s published site must stop being served at /live/<slug>/');

            // =================================================================
            // Re-signing in with the SAME email must never resurrect the old
            // account's data — it is a brand-new account with zero sites.
            // =================================================================
            await signIn(pageA, base, emailA);
            const sitesAfter = await pageA.evaluate(() => fetch('/api/sites', { headers: { Accept: 'application/json' } }).then((r) => r.json()));
            const listAfter = Array.isArray(sitesAfter) ? sitesAfter : (sitesAfter && sitesAfter.sites) || [];
            assert.equal(listAfter.length, 0, 'signing in again with the deleted account\'s email must start with zero sites');
            const pageAfterText = await pageA.locator('body').innerText().catch(() => '');
            assert.doesNotMatch(pageAfterText, new RegExp(escapeForRegExp(markerA)), 'the deleted account\'s old business name must never resurface after re-signup');
            await pageA.screenshot({ path: path.join(shotDir, '07-account-a-fresh-account-after-resignin.png') });

            // =================================================================
            // B's own site and data are completely untouched throughout.
            // =================================================================
            const pageB2 = await contextB.newPage();
            pageB2.setDefaultTimeout(30000);
            await pageB2.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
            await pageB2.waitForTimeout(500);
            const sitesB = await pageB2.evaluate(() => fetch('/api/sites', { headers: { Accept: 'application/json' } }).then((r) => r.json()));
            const listB = Array.isArray(sitesB) ? sitesB : (sitesB && sitesB.sites) || [];
            assert.ok(listB.some((s) => s.slug === slugB), 'account B must still have its own site after A\'s account was deleted');

            const liveB = await pageB2.request.get(base + '/live/' + slugB + '/');
            assert.equal(liveB.status(), 200, 'account B\'s live site must keep serving after A\'s account was deleted');
            const liveBText = await liveB.text();
            assert.match(liveBText, new RegExp(escapeForRegExp(markerB)), 'account B\'s live site must still show B\'s own business name');
            await pageB2.screenshot({ path: path.join(shotDir, '08-account-b-still-live-untouched.png') });

            console.log('PASS audit27-r-27: screenshots at', shotDir);
        } finally {
            await browser.close().catch(() => {});
        }
    });
});
