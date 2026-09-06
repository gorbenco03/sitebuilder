'use strict';
/**
 * Focused, uncontaminated test of the failed-payment / dunning lifecycle on a
 * clean paid+live site: does the owner learn (message language/actionability),
 * does the dashboard-facing API/badge tell the truth at each stage, and what
 * happens when Stripe exhausts retries (unpaid -> unpublish)?
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a210a955143021a0f';
const EVID = path.join(ROOT, '04-QA-Evidence/Reaudit-2026-09-06/commercial-ops/evidence');

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-reaudit-dunning-'));
process.env.SERVER_SECRET = 'reaudit-' + crypto.randomBytes(12).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[k];

const results = { startedAt: new Date().toISOString(), steps: [] };
function record(name, data) { results.steps.push({ name, data }); console.log('STEP', name, JSON.stringify(data)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function simulateBadge(site) {
    if (!site) return 'NO_SITE';
    function isHostingExpired(s) {
        if (!s) return false;
        if (s.status === 'expired') return true;
        if (s.paidUntil) { const t = Date.parse(s.paidUntil); if (Number.isFinite(t) && t < Date.now()) return true; }
        return false;
    }
    const hostingExpired = isHostingExpired(site);
    let badgeLabel = 'Ciornă (DEFAULT/FALLTHROUGH — no branch matched)';
    if (site.paid && hostingExpired) badgeLabel = 'Expirat';
    else if (site.paid && (site.status === 'live' || site.status === 'active')) badgeLabel = 'Activ';
    else if (site.status === 'live' && !site.paid) badgeLabel = 'Neplătit (legacy unpaid live)';
    else if (site.status === 'expired') badgeLabel = 'Expirat';
    else if (site.status === 'needs-retry') badgeLabel = 'Reîncearcă';
    else if (!site.paid) badgeLabel = 'Neplătit';
    return { badgeLabel, hostingExpired, rawStatus: site.status, rawPaid: site.paid, rawPaidUntil: site.paidUntil };
}

async function main() {
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
    const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
    const registry = require(path.join(ROOT, 'bot', 'registry.js'));
    const server = startServer({ port: 0, onStripeEvent });
    await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
    const BASE = 'http://127.0.0.1:' + server.address().port;

    let cookie = '';
    async function api(method, p, body) {
        const headers = { 'Content-Type': 'application/json' };
        if (cookie) headers.Cookie = cookie;
        const res = await fetch(BASE + p, { method, headers, redirect: 'manual', body: body !== undefined ? JSON.stringify(body) : undefined });
        const sc = res.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0];
        const text = await res.text();
        let json = null; try { json = JSON.parse(text); } catch (_) {}
        return { status: res.status, json };
    }

    const auth = await api('POST', '/api/auth/email', { email: 'dunning-customer@example.com' });
    const token = new URL(auth.json.devLink, BASE).searchParams.get('token');
    await api('GET', '/auth/verify?token=' + token);

    const presetConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config;
    const pub = await api('POST', '/api/publish', { templateId: 'professionals', config: presetConfig, images: [], slug: 'dunning-test-' + Date.now() });
    const siteId = pub.json.site.id;
    const sessionId = /test-checkout=([^&]+)/.exec(pub.json.paymentUrl)[1];
    await api('POST', '/api/test-pay/complete', { sessionId });

    let site = registry.getSite(siteId);
    const subId = site.stripeSubscriptionId;
    const custId = site.stripeCustomerId;
    // Establish the sub as active via the real lifecycle webhook (as production does).
    await api('POST', '/webhooks/stripe', { id: 'evt_created_' + crypto.randomBytes(6).toString('hex'), type: 'customer.subscription.created', data: { object: { id: subId, status: 'active', customer: custId, metadata: { siteId } } } });
    await sleep(30);
    site = registry.getSite(siteId);
    record('clean_baseline_live_active', { status: site.status, paid: site.paid, paidUntil: site.paidUntil, stripeSubscriptionStatus: site.stripeSubscriptionStatus });
    record('dashboard_badge_baseline', simulateBadge(await api('GET', '/api/sites').then(r => r.json.sites.find(s => s.id === siteId))));

    // ── First card decline: invoice.payment_failed, attempt 1 ──────────────
    const failEvt1 = { id: 'evt_fail1_' + crypto.randomBytes(6).toString('hex'), type: 'invoice.payment_failed', data: { object: { id: 'in_fail1_' + crypto.randomBytes(6).toString('hex'), subscription: subId, customer: custId, attempt_count: 1 } } };
    await api('POST', '/webhooks/stripe', failEvt1);
    const pastDue1 = { id: 'evt_pd1_' + crypto.randomBytes(6).toString('hex'), type: 'customer.subscription.updated', data: { object: { id: subId, status: 'past_due', customer: custId, metadata: { siteId } } } };
    await api('POST', '/webhooks/stripe', pastDue1);
    await sleep(30);
    site = registry.getSite(siteId);
    record('after_first_decline', {
        status: site.status, paid: site.paid, paidUntil: site.paidUntil,
        stripeSubscriptionStatus: site.stripeSubscriptionStatus,
        paymentFailedAt: site.paymentFailedAt || null, paymentFailedCount: site.paymentFailedCount || null,
    });
    const dunningState = webpublish.getDunningState(site);
    record('server_side_getDunningState_result', dunningState);
    const apiSitesAfterDecline = await api('GET', '/api/sites');
    const apiSiteAfterDecline = apiSitesAfterDecline.json.sites.find(s => s.id === siteId);
    record('raw_api_GET_sites_after_first_decline', apiSiteAfterDecline);
    record('dashboard_badge_after_first_decline_STILL_SHOWS', simulateBadge(apiSiteAfterDecline));
    record('is_dunning_info_present_in_ANY_api_response_field_the_UI_reads', {
        note: 'buildSiteCard() in builder/app.js never reads paymentFailedAt/paymentFailedCount/stripeSubscriptionStatus for warning UI (grep confirmed 0 references); getDunningState() is exported by webpublish.js but is not called from bot/server.js or builder/app.js anywhere (grep confirmed) -- it exists only in bot/test/wave7-payments-dunning.test.js unit tests.',
    });

    // GET /api/sites/:id (single-site detail) -- does that path expose it either?
    const singleSite = await api('GET', '/api/sites/' + siteId);
    record('raw_api_GET_single_site_after_decline', singleSite.json && singleSite.json.site);

    // ── Retries exhausted: Stripe gives up -> unpaid, site unpublished ──────
    const unpaidEvt = { id: 'evt_unpaid_' + crypto.randomBytes(6).toString('hex'), type: 'customer.subscription.updated', data: { object: { id: subId, status: 'unpaid', customer: custId, metadata: { siteId } } } };
    await api('POST', '/webhooks/stripe', unpaidEvt);
    await sleep(30);
    site = registry.getSite(siteId);
    record('after_retries_exhausted', { status: site.status, paid: site.paid, paidUntil: site.paidUntil, url: site.url, stripeSubscriptionStatus: site.stripeSubscriptionStatus });
    const apiSitesFinal = await api('GET', '/api/sites');
    const apiSiteFinal = apiSitesFinal.json.sites.find(s => s.id === siteId);
    record('raw_api_GET_sites_after_unpaid_unpublish', apiSiteFinal);
    record('dashboard_badge_after_unpaid_unpublish', simulateBadge(apiSiteFinal));
    const finalDunning = webpublish.getDunningState(site);
    record('server_side_getDunningState_at_terminal_state', finalDunning);

    // Live-site reachability check: does GET /live/<slug>/ actually 404 now?
    const liveCheck = await fetch(BASE + '/live/' + site.slug + '/');
    record('live_site_http_status_after_unpublish', { status: liveCheck.status, slug: site.slug });

    fs.writeFileSync(path.join(EVID, 'run-dunning.json'), JSON.stringify(results, null, 2));
    console.log('DONE');
    server.close();
    process.exit(0);
}
main().catch(e => { console.error('FATAL', e, e.stack); process.exit(1); });
