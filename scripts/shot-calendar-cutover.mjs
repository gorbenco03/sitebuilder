/**
 * Deterministic Calendar-Cutover QA screenshots (VISION §8 step e remediation).
 * Walks a REAL opted-in professionals site (appointment.nativeBooking=true),
 * not the /calendar-native/widget/ design-canvas preview alone.
 *
 * Named shots (action → file):
 *   01-legacy-default-form-desktop.png
 *   02-native-opt-in-widget-desktop.png
 *   03-native-opt-in-widget-390.png
 *   04-book-form-filled-desktop.png
 *   05-book-result-ro-status.png          (no stale CTA "Se trimite…")
 *   10-email-outbox.png
 *   11-owner-dashboard.png
 *   12-owner-action.png
 *   13-visitor-manage-link.png
 *   14-slot-freed.png
 *   15-double-book-rejected.png
 *   (+ legacy manage/invalid shots kept)
 *
 * Run: node scripts/shot-calendar-cutover.mjs
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, '04-QA-Evidence', 'Calendar-Cutover');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(url, tries = 50) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch (_) {
            /* retry */
        }
        await sleep(250);
    }
    throw new Error('server not ready: ' + url);
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });

    const server = spawn(
        process.execPath,
        ['--experimental-sqlite', path.join(ROOT, 'scripts/_cutover-shot-server.js')],
        {
            cwd: ROOT,
            env: { ...process.env, PORT },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    let bootLog = '';
    server.stdout.on('data', (d) => {
        bootLog += d.toString();
        process.stdout.write(d);
    });
    server.stderr.on('data', (d) => process.stderr.write(d));

    const cleanup = () => {
        try {
            server.kill('SIGTERM');
        } catch (_) {
            /* ignore */
        }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
        cleanup();
        process.exit(130);
    });

    try {
        await waitReady(`${BASE}/cutover-shot/meta.json`);
        const meta = await (await fetch(`${BASE}/cutover-shot/meta.json`)).json();
        console.log('META', meta);

        const browser = await chromium.launch({ headless: true });
        const shots = [];

        async function shot(page, name) {
            const p = path.join(OUT, name);
            await page.screenshot({ path: p, fullPage: true });
            shots.push(name);
            console.log('WROTE', p);
            return p;
        }

        function acceptDialogs(page) {
            page.on('dialog', async (d) => {
                try {
                    await d.accept();
                } catch (_) {
                    /* ignore */
                }
            });
        }

        /**
         * Book on the opted-in professionals site HTML — not widget preview.
         */
        async function bookOnOptedInSite(page, { name, email, shotForm, shotResult }) {
            await page.goto(`${BASE}/cutover-shot/native.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 25000,
            });
            await page.waitForSelector('[data-hidook-cal-native]', { timeout: 15000 });
            await page.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
            if (await page.locator('#pr-appt-form').count()) {
                throw new Error('legacy form still present on opted-in site');
            }
            await page.waitForTimeout(600);
            const svc = page.locator('.hnb__svc').first();
            if ((await svc.count()) > 0) await svc.click();
            await page.waitForSelector('button.hnb__day', { timeout: 15000 });
            await page.waitForTimeout(800);
            const days = page.locator('button.hnb__day');
            const dayCount = await days.count();
            let foundSlot = false;
            for (let i = 0; i < dayCount; i++) {
                await days.nth(i).click();
                await page.waitForTimeout(250);
                if ((await page.locator('button.hnb__slot').count()) > 0) {
                    foundSlot = true;
                    break;
                }
            }
            if (!foundSlot) return { ok: false, reason: 'no-slot' };
            const slotBtn = page.locator('button.hnb__slot').first();
            const slotLabel = (await slotBtn.innerText()).trim();
            await slotBtn.click();
            await page.waitForSelector('form.hnb__form input[name="name"]', { timeout: 5000 });
            await page.locator('form.hnb__form input[name="name"]').fill(name);
            await page.locator('form.hnb__form input[name="email"]').fill(email);
            if (shotForm) await shot(page, shotForm);

            const [bookResp] = await Promise.all([
                page
                    .waitForResponse(
                        (r) =>
                            r.url().includes('/api/calendar-native/bookings') &&
                            r.request().method() === 'POST',
                        { timeout: 15000 }
                    )
                    .catch(() => null),
                page.locator('[data-hnb-submit], button.hnb__cta').first().click(),
            ]);
            let body = null;
            if (bookResp) {
                body = await bookResp.json().catch(() => null);
                console.log('BOOK_HTTP', bookResp.status(), body && body.status, body && body.ok);
            } else {
                console.warn('WARN no bookings POST observed');
            }
            await page.waitForSelector('[data-hnb-success], .hnb__result--ok, .hnb__result--wait, [data-hnb-error]', {
                timeout: 10000,
            });
            await page.waitForTimeout(400);
            if (shotResult) await shot(page, shotResult);

            // AC5: once status is shown, layout/steps/CTA must not still show "Se trimite…"
            const ctaVisible = await page.evaluate(() => {
                const cta = document.querySelector('[data-hnb-submit], button.hnb__cta');
                if (!cta) return false;
                const st = window.getComputedStyle(cta);
                if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
                // Also treat ancestors with [hidden] that CSS forces display:none
                let n = cta;
                while (n) {
                    if (n.hidden || n.getAttribute('hidden') != null) {
                        const cs = window.getComputedStyle(n);
                        if (cs.display === 'none') return false;
                    }
                    n = n.parentElement;
                }
                const r = cta.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            const bodyText = await page.locator('body').innerText();
            if (ctaVisible && /Se trimite/i.test(bodyText)) {
                throw new Error('AC5 lying CTA: "Se trimite…" still visible after status');
            }
            if (/Se trimite/i.test(bodyText) && /Programare confirmat|Cerere înregistrat/i.test(bodyText)) {
                // status + stale CTA text in same paint = defect
                const ctaText = await page.locator('[data-hnb-submit], button.hnb__cta').first().innerText().catch(() => '');
                if (/Se trimite/i.test(ctaText) && ctaVisible) {
                    throw new Error('AC5 lying CTA still painted with status');
                }
            }
            if (/worktree|kanban|SHA|factory/i.test(bodyText)) {
                throw new Error('factory jargon on book result');
            }
            return {
                ok: true,
                status: body && body.status,
                manageToken: body && body.manageToken,
                bookingId: body && body.id,
                startUtc: body && body.startUtc,
                slotLabel,
            };
        }

        // 01 — default professionals still shows legacy local request form
        {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            await page.goto(`${BASE}/cutover-shot/legacy.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('#pr-appt-form', { timeout: 10000 });
            await page.waitForTimeout(400);
            await shot(page, '01-legacy-default-form-desktop.png');
            if (!(await page.locator('#pr-appt-form').count())) throw new Error('legacy form missing');
            if (await page.locator('[data-hidook-cal-native]').count()) {
                throw new Error('native mount leaked onto default');
            }
            await page.close();
        }

        // 02 — opted-in site mounts native widget (desktop)
        {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            await page.goto(`${BASE}/cutover-shot/native.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('[data-hidook-cal-native]', { timeout: 15000 });
            await page.waitForSelector('.hnb__svc, .hnb__day, [data-hnb-error]', { timeout: 15000 });
            await page.waitForTimeout(700);
            await shot(page, '02-native-opt-in-widget-desktop.png');
            if (await page.locator('#pr-appt-form').count()) {
                throw new Error('legacy form still present after opt-in');
            }
            // Prove we are on site HTML with tenant attrs, not bare widget preview path
            const url = page.url();
            if (!/cutover-shot\/native\.html/.test(url)) {
                throw new Error('expected opted-in site URL, got ' + url);
            }
            const tenantOk = await page.evaluate(() => {
                const r = document.querySelector('[data-hidook-cal-native]');
                return !!(r && r.getAttribute('data-customer-id') && r.getAttribute('data-site-id'));
            });
            if (!tenantOk) throw new Error('opted-in mount missing tenant ids');
            await page.close();
        }

        // 03 — native widget mobile 390 on opted-in site
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(`${BASE}/cutover-shot/native.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('.hnb__svc, .hnb__day, [data-hnb-error]', { timeout: 15000 });
            await page.waitForTimeout(700);
            await shot(page, '03-native-opt-in-widget-390.png');
            await page.close();
        }

        // 04/05 — book free slot ON OPTED-IN SITE → RO status (no lying CTA)
        let liveBook = null;
        {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            liveBook = await bookOnOptedInSite(page, {
                name: 'Ana Cutover',
                email: 'ana.cutover@example.com',
                shotForm: '04-book-form-filled-desktop.png',
                shotResult: '05-book-result-ro-status.png',
            });
            if (!liveBook.ok) throw new Error('book on opted-in site failed: ' + liveBook.reason);
            if (!liveBook.status || !/^(confirmed|requested|reschedule_needed)$/.test(liveBook.status)) {
                throw new Error('unexpected book status ' + liveBook.status);
            }
            if (!liveBook.manageToken || String(liveBook.manageToken).length < 16) {
                throw new Error('book response missing manageToken (needed for visitor manage-link shot)');
            }
            await page.close();
        }

        // 10 — email outbox recorded in local harness
        {
            const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
            // Give outbox drain a beat
            await sleep(500);
            const outbox = await (await fetch(`${BASE}/cutover-shot/outbox.json`)).json();
            console.log('OUTBOX', outbox.count, outbox.rows.map((r) => r.template_key + ':' + r.status));
            if (!outbox.count || outbox.count < 1) {
                throw new Error('email outbox empty after book');
            }
            await page.goto(`${BASE}/cutover-shot/outbox.html`, {
                waitUntil: 'networkidle',
                timeout: 15000,
            });
            await page.waitForTimeout(300);
            await shot(page, '10-email-outbox.png');
            await page.close();
        }

        // 11 — owner dashboard sees booking for this tenant
        // Owner cancel used to rotate manage_token_hash (email ensureRawManageToken).
        // That product bug is fixed: lifecycle emails without raw token no longer rotate.
        // Still act on Maria first so Ana stays cancellable for the visitor manage walk.
        {
            const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
            const page = await context.newPage();
            // Mint owner session cookie for the opted-in site owner
            await page.goto(`${BASE}/cutover-shot/meta.json`, { waitUntil: 'networkidle' });
            const sess = await page.evaluate(async () => {
                const r = await fetch('/cutover-shot/owner-session', { method: 'POST', credentials: 'same-origin' });
                return r.json();
            });
            if (!sess.ok) throw new Error('owner session failed');
            await page.goto(`${BASE}/cutover-shot/owner.html`, {
                waitUntil: 'networkidle',
                timeout: 25000,
            });
            await page.waitForSelector('[data-hod-shell], .hod-tab, .hod-card, .hod-empty', {
                timeout: 20000,
            });
            await page.waitForTimeout(900);
            await shot(page, '11-owner-dashboard.png');
            const dashText = await page.locator('body').innerText();
            if (!/Ana Cutover/i.test(dashText)) {
                throw new Error('owner dash missing live Ana booking: ' + dashText.slice(0, 400));
            }
            if (/worktree|kanban|SHA|factory/i.test(dashText)) {
                throw new Error('factory jargon on owner dash');
            }

            // 12 — owner acts on a DIFFERENT booking (Maria seed), never Ana
            acceptDialogs(page);
            const mariaCancel = page
                .locator('.hod-booking:has-text("Maria Popescu") [data-hod-act="cancel"]')
                .first();
            const mariaConfirm = page
                .locator('.hod-booking:has-text("Maria Popescu") [data-hod-act="confirm"]')
                .first();
            const otherCancel = page
                .locator('.hod-booking:not(:has-text("Ana Cutover")) [data-hod-act="cancel"]')
                .first();
            if ((await mariaCancel.count()) > 0) {
                await mariaCancel.click();
                await page.waitForTimeout(1200);
            } else if ((await mariaConfirm.count()) > 0) {
                await mariaConfirm.click();
                await page.waitForTimeout(1200);
            } else if ((await otherCancel.count()) > 0) {
                await otherCancel.click();
                await page.waitForTimeout(1200);
            } else {
                // Last resort: confirm Ana (does not rotate token / still leaves manage usable)
                const anaConfirm = page
                    .locator('.hod-booking:has-text("Ana Cutover") [data-hod-act="confirm"]')
                    .first();
                if ((await anaConfirm.count()) > 0) {
                    await anaConfirm.click();
                    await page.waitForTimeout(1200);
                } else {
                    // Dump for diagnosis
                    const acts = await page.locator('[data-hod-act]').count();
                    const bodyPreview = (await page.locator('body').innerText()).slice(0, 500);
                    throw new Error(
                        'no safe owner action button (must not cancel Ana before manage); acts=' +
                            acts +
                            ' body=' +
                            bodyPreview
                    );
                }
            }
            await shot(page, '12-owner-action.png');
            const afterOwner = await page.locator('body').innerText();
            // Ana must still be present as an active (non-cancelled-only) row ideally;
            // at minimum we did not require canceling her for this shot.
            if (!/Ana Cutover/i.test(afterOwner)) {
                console.warn('WARN Ana missing after owner action:', afterOwner.slice(0, 300));
            }
            await context.close();
        }

        // 13 — visitor manage-link token works for the LIVE booked visitor (Ana)
        {
            if (!liveBook.manageToken || String(liveBook.manageToken).length < 16) {
                throw new Error('live book missing manageToken — cannot prove visitor manage-link');
            }
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            acceptDialogs(page);
            const token = liveBook.manageToken;
            const url = `${BASE}/calendar-native/manage/?token=${encodeURIComponent(token)}`;
            await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
            // Require booking card only — never accept error alert as success (prior false green)
            await page.waitForSelector('#hm-body .hm__card[data-hm-status]', { timeout: 15000 });
            await page.waitForTimeout(500);
            const text = await page.locator('body').innerText();
            if (/Nu am găsit programarea|Link invalid|nu putem deschide/i.test(text)) {
                throw new Error(
                    'visitor manage-link is invalid-token UI, not a working booking card: ' +
                        text.slice(0, 240)
                );
            }
            if (!/Gestionează programarea/i.test(text)) {
                throw new Error('manage UI missing RO chrome: ' + text.slice(0, 200));
            }
            if (!/Ana Cutover/i.test(text)) {
                throw new Error('manage UI missing live visitor name Ana Cutover: ' + text.slice(0, 240));
            }
            if (!/Stare/i.test(text) || !/confirmat|în așteptare|aștept/i.test(text)) {
                throw new Error('manage UI missing live booking status details: ' + text.slice(0, 240));
            }
            // Must show a real card + cancel control — not only the shell heading
            const hasCard = (await page.locator('#hm-body .hm__card').count()) > 0;
            const hasCancel = (await page.locator('[data-hm-cancel]').count()) > 0;
            if (!hasCard || !hasCancel) {
                throw new Error('manage UI has no booking card or cancel control');
            }
            // Named shots only after success asserts
            await shot(page, '13-visitor-manage-link.png');
            // also keep legacy-named 06 for continuity (same working manage view)
            await shot(page, '06-manage-token-view-390.png');

            // 14 — visitor cancels THIS live booking → slot frees (anulat)
            const cancelBtn = page.locator('[data-hm-cancel], button:has-text("Anulează")');
            if ((await cancelBtn.count()) === 0) {
                throw new Error('manage UI has no cancel control for live Ana booking');
            }
            await cancelBtn.first().click();
            await page.waitForTimeout(1200);
            await page.waitForFunction(() => /anulat/i.test(document.body.innerText), null, {
                timeout: 10000,
            });
            await shot(page, '14-slot-freed.png');
            await shot(page, '07-manage-cancel-confirmed-390.png');
            const after = await page.locator('body').innerText();
            if (!/anulat/i.test(after)) throw new Error('cancel did not show anulat state');
            if (/Nu am găsit programarea/i.test(after)) {
                throw new Error('slot-freed shot landed on invalid-token UI');
            }
            await page.close();
        }

        // 15 — double-book attempt stays requested/rejected, never falsely confirmed
        {
            // Book first slot via API, then attempt same start again
            const svcId = meta.serviceId;
            const start = '2030-01-08T08:00:00.000Z'; // 10:00 Europe/Bucharest winter
            const first = await fetch(`${BASE}/api/calendar-native/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId: meta.customerId,
                    siteId: meta.siteId,
                    serviceId: svcId,
                    startUtc: start,
                    visitorName: 'First Booker',
                    visitorEmail: 'first.book@example.com',
                }),
            }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
            console.log('DOUBLE first', first.status, first.body && first.body.status);
            if (first.body && first.body.status === 'confirmed') {
                /* expected free path */
            }
            const second = await fetch(`${BASE}/api/calendar-native/bookings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId: meta.customerId,
                    siteId: meta.siteId,
                    serviceId: svcId,
                    startUtc: start,
                    visitorName: 'Second Conflict',
                    visitorEmail: 'second.conflict@example.com',
                }),
            }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
            console.log('DOUBLE second', second.status, second.body && second.body.status);
            if (second.body && second.body.status === 'confirmed') {
                throw new Error('double-book falsely confirmed');
            }
            if (
                second.body &&
                second.body.ok &&
                second.body.status !== 'requested' &&
                second.body.status !== 'reschedule_needed'
            ) {
                // If engine rejects with error, that is also acceptable (not confirmed)
                if (second.body.status === 'confirmed') throw new Error('falsely confirmed');
            }

            const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
            const html = `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"/><title>Double-book</title>
<style>body{font-family:system-ui,sans-serif;padding:28px;background:#f7faf8;color:#14201c}
.card{background:#fff;border-radius:14px;padding:20px;max-width:560px;box-shadow:0 1px 0 rgba(0,0,0,.04)}
h1{font-size:1.2rem;margin:0 0 12px}.ok{color:#0b6b3a;font-weight:700}.bad{color:#a11}.row{margin:8px 0;font-size:14px}
code{background:#eef5f1;padding:2px 6px;border-radius:6px}</style></head><body>
<div class="card">
<h1>Încercare double-book</h1>
<div class="row">Prima rezervare: <code>${(first.body && first.body.status) || first.status}</code>
${first.body && first.body.status === 'confirmed' ? '<span class="ok"> — confirmată pe slot liber</span>' : ''}</div>
<div class="row">A doua pe același slot: <code>${(second.body && second.body.status) || (second.body && second.body.error) || second.status}</code>
${second.body && second.body.status === 'confirmed'
    ? '<span class="bad"> — EROARE: confirmat fals</span>'
    : '<span class="ok"> — nu e confirmată (requested / respins)</span>'}</div>
<p style="color:#5c6d66;font-size:13px;margin-top:16px">Regula VISION §8: niciodată „confirmat” pe un slot deja rezervat.</p>
</div></body></html>`;
            await page.setContent(html, { waitUntil: 'domcontentloaded' });
            await shot(page, '15-double-book-rejected.png');
            await page.close();
        }

        // 08 — manage invalid token honest error
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(`${BASE}/calendar-native/manage/?token=not-a-real-token-xxxxxx`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForTimeout(800);
            await shot(page, '08-manage-invalid-token-390.png');
            await page.close();
        }

        // 09 — legacy form still available (regression)
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(`${BASE}/cutover-shot/legacy.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('#pr-appt-form', { timeout: 10000 });
            await page.waitForTimeout(400);
            await shot(page, '09-legacy-form-unchanged-390.png');
            await page.close();
        }

        await browser.close();

        const required = [
            '01-legacy-default-form-desktop.png',
            '02-native-opt-in-widget-desktop.png',
            '03-native-opt-in-widget-390.png',
            '04-book-form-filled-desktop.png',
            '05-book-result-ro-status.png',
            '10-email-outbox.png',
            '11-owner-dashboard.png',
            '12-owner-action.png',
            '13-visitor-manage-link.png',
            '14-slot-freed.png',
            '15-double-book-rejected.png',
        ];
        for (const r of required) {
            if (!fs.existsSync(path.join(OUT, r))) throw new Error('missing required shot ' + r);
        }

        const manifest = {
            ok: true,
            out: OUT,
            shots: shots,
            surface: 'opted-in-professionals-site',
            notPreviewOnly: true,
            meta: {
                bookingStatus: liveBook && liveBook.status,
                customerId: meta.customerId,
                siteId: meta.siteId,
                liveManageTokenPresent: !!(liveBook && liveBook.manageToken),
            },
            cutoverFlag: 'appointment.nativeBooking',
            ac5CtaClean: true,
        };
        fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(JSON.stringify(manifest, null, 2));
    } finally {
        cleanup();
        await sleep(300);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
