'use strict';
/**
 * bot/test/suite3-second-unpaid-draft-refused.test.js
 *
 * PLAN-QA-2026-09-12.md, Suite 3 / S3-1, defect B1 (blocker):
 * "un utilizator autentificat poate crea al doilea (și oricâte) site-uri
 * ciornă neplătite" — POST /api/publish's "max 1 unpaid site per user"
 * guard never fires for the exact sequence a real user hits in the
 * browser.
 *
 * WHY IT ESCAPED: bot/server.js's handlePublish() only ran the guard on
 * the branch taken when the request carries NO `siteId` (brand-new site).
 * That branch, tested alone, is correct — bot/test/flow2-auth-copy-second-
 * unpaid.test.js already covers it and stayed green throughout this fix.
 *
 * But a real browser session never reaches /api/publish with an empty
 * siteId for a second design: builder/app.js's runServerAutosave() posts
 * to POST /api/draft on every debounced edit, and bot/server.js's
 * handleSaveDraft() creates the second site row right there (it only
 * reuses an existing unpaid draft of the SAME templateId — a different
 * template gets its own brand-new site, with NO "max 1 unpaid" check of
 * any kind). By the time the user clicks "Continuă" on the publish modal,
 * builder/app.js's execPublish() already has that id in `currentSiteId`
 * and sends it as `siteId` — so /api/publish takes the `if (siteId)`
 * branch, which used to skip the guard entirely.
 *
 * THE FIX: bot/registry-sqlite.js / bot/registry-json.js#commitUnpaidDraft
 * — one registry-level, transaction-wrapped check-and-write, called from
 * BOTH branches of handlePublish right before a site is persisted as an
 * unpaid draft. It re-reads every OTHER non-deleted, non-entitled site the
 * user owns and refuses (without writing anything) if one already exists.
 * Doing the check and the write as a single registry call (not
 * server.js's own "read, then decide, then write") is also what closes
 * the race the plan calls out: two overlapping /api/publish calls for two
 * different draft sites of the same user cannot both "pass" a check that
 * ran before either had written its result.
 *
 * FOLLOW-UP (same session, coordinator review): commitUnpaidDraft() alone
 * would have turned a well-behaved user into a NEW victim. handleSaveDraft()
 * (POST /api/draft's autosave) only reused an existing unpaid draft when its
 * templateId matched exactly — trying a second, unrelated template created a
 * second unpaid site row with no check of its own. Once commitUnpaidDraft()
 * started enforcing "max 1 unpaid" at publish time, a user who simply tried
 * 3 designs before picking one would find EVERY one of them refused with
 * 409 — worse than the original bug (which at least let each one through).
 * Fixed by making handleSaveDraft() reuse the single unpaid-draft SLOT
 * regardless of templateId (see its inline comment in bot/server.js): the
 * browser only ever keeps one local draft anyway (builder/app.js's
 * `hb.draft.v1` is a single global key), so the abandoned server-side row
 * for a discarded design was already orphaned and unreachable from the
 * editor — reusing the slot just keeps the server in sync with that.
 * The "two unpaid drafts already exist" test below now seeds its state
 * directly through the registry (not through two draft() calls) because
 * that scenario can no longer be produced through the product itself — it
 * documents what a database with pre-existing duplicate unpaid rows (from
 * before this fix shipped) still needs to behave like.
 *
 * Run: node --experimental-sqlite --test bot/test/suite3-second-unpaid-draft-refused.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite3-unpaid-'));
process.env.SERVER_SECRET = 'suite3-unpaid-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
const auth = require(path.join(ROOT, 'bot', 'auth.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

const SECOND_UNPAID_RO = 'Ai deja un site neplătit. Plătește-l sau șterge-l înainte să creezi altul.';

let server;
let base;

test.before(async () => {
    server = startServer({ port: 0 });
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

test.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

function newUserCookie() {
    const user = registry.getOrCreateUserByEmail(
        'suite3-' + crypto.randomUUID().slice(0, 8) + '@example.com'
    );
    return { user, cookie: 'hb_session=' + auth.signSession(user.id) };
}

async function draft(cookie, templateId, name, siteId) {
    const res = await fetch(base + '/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ siteId, templateId, config: { business: { name } } }),
    });
    assert.equal(res.status, 200, 'autosave draft must succeed: ' + await res.clone().text());
    return (await res.json()).site;
}

async function publish(cookie, { siteId, templateId, slug, name }) {
    const res = await fetch(base + '/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
            siteId,
            templateId,
            slug,
            config: { business: { name } },
            images: [],
        }),
    });
    const body = await res.json();
    return { status: res.status, body };
}

test('dashboard "Editează" (explicit siteId, matching templateId) is untouched by the slot-reuse fix', async () => {
    // Coordinator's ask #1's verification, as an actual test rather than
    // just a code read: builder/app.js's loadSiteForEdit() sets
    // currentSiteId BEFORE any editing happens, so every autosave for an
    // existing draft opened via "Editează" already carries an explicit
    // siteId — the `if (siteId)` branch of handleSaveDraft, which the
    // slot-reuse fix never touches. Editing must keep saving to that EXACT
    // site (same id), not get silently redirected to some other "slot".
    const { user, cookie } = newUserCookie();
    const existing = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1,
        slug: 'editeaza-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });

    const saved = await draft(cookie, 'portfolio', 'Editat din dashboard', existing.id);
    assert.equal(saved.id, existing.id, 'an explicit siteId must keep saving to that same site');
    assert.equal(saved.templateId, 'portfolio');

    const sites = registry.listSites(user.id).filter((s) => s.status !== 'deleted');
    assert.equal(sites.length, 1, 'editing an existing draft by siteId must never create a second row');
});

test('two genuinely distinct unpaid sites (one via autosave, one opened separately by explicit siteId) are still refused symmetrically', async () => {
    // This is what commitUnpaidDraft() itself guards against: two DISTINCT
    // site rows, both unpaid, belonging to the same user, existing AT THE
    // SAME TIME. Before the handleSaveDraft follow-up fix, the browser's
    // own autosave could produce such a pair just from trying two templates
    // in a row (see the file header) — that specific path is closed now,
    // but the underlying registry guard must still hold for however such a
    // pair comes to exist (an old row from before the fix, an admin action,
    // a restore, ...). Model two such rows that both predate any publish
    // attempt: neither is "the" reused slot, so both correctly stay blocked
    // until the user pays or deletes one — see the LEGACY test below for
    // the same guarantee stated as a data-migration concern.
    const { user, cookie } = newUserCookie();
    const a = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1,
        slug: 'site-a-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });
    const b = registry.createSite({
        userId: user.id, templateId: 'local-service', templateVersion: 1,
        slug: 'site-b-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });

    const pa = await publish(cookie, {
        siteId: a.id, templateId: 'portfolio', slug: 'pub-a-' + crypto.randomUUID().slice(0, 6), name: 'Site A',
    });
    assert.equal(pa.status, 409, 'first attempt must be refused while a sibling unpaid site exists: ' + JSON.stringify(pa.body));
    assert.equal(pa.body.error, SECOND_UNPAID_RO);

    const pb = await publish(cookie, {
        siteId: b.id, templateId: 'local-service', slug: 'pub-b-' + crypto.randomUUID().slice(0, 6), name: 'Site B',
    });
    assert.equal(pb.status, 409, 'the other one must be refused too, symmetrically: ' + JSON.stringify(pb.body));
    assert.equal(pb.body.error, SECOND_UNPAID_RO);
});

test('trying 3 different designs in a row (autosave only, no siteId) leaves exactly ONE unpaid draft, publishable without 409', async () => {
    // The coordinator's exact ask: a well-behaved user who just tries a few
    // templates before settling on one must never trip commitUnpaidDraft's
    // "max 1 unpaid" guard on their OWN account. builder/app.js resets
    // currentSiteId to null every time startWithTemplate() picks a NEW
    // template from the catalog (S78/S80 "never keep the previous paid
    // siteId in draft"), so every one of these draft() calls below is a
    // faithful replay of what the browser actually sends — no siteId, ever,
    // for this flow.
    const { user, cookie } = newUserCookie();

    const d1 = await draft(cookie, 'portfolio', 'Încercarea 1');
    const d2 = await draft(cookie, 'local-service', 'Încercarea 2');
    const d3 = await draft(cookie, 'professionals', 'Încercarea 3 — asta rămâne');

    assert.equal(d2.id, d1.id, 'a second, different-template autosave must reuse the same slot, not create a new site');
    assert.equal(d3.id, d1.id, 'a third, different-template autosave must still reuse the same single slot');
    assert.equal(d3.templateId, 'professionals', 'the reused slot must reflect the LAST template tried');

    const onlySite = registry.listSites(user.id);
    assert.equal(
        onlySite.filter((s) => s.status !== 'deleted').length, 1,
        'exactly one site must exist for this user after 3 different-template autosaves'
    );

    const p3 = await publish(cookie, {
        siteId: d3.id, templateId: 'professionals', slug: 'incercarea-3-' + crypto.randomUUID().slice(0, 6), name: 'Încercarea 3 — asta rămâne',
    });
    assert.equal(p3.status, 200, 'the single remaining draft must publish without any 409: ' + JSON.stringify(p3.body));
    assert.equal(p3.body.site.paid, false);
    assert.equal(p3.body.site.templateId, 'professionals');
});

test('neighbour: republishing an ALREADY PAID site keeps working', async () => {
    const { user, cookie } = newUserCookie();
    const site = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1,
        slug: 'paid-repub-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });
    registry.updateSite(site.id, { paid: true, status: 'live', paidUntil: new Date(Date.now() + 365 * 86400000).toISOString() });

    const res = await publish(cookie, {
        siteId: site.id, templateId: 'portfolio', name: 'Editat',
    });
    assert.equal(res.status, 200, 'a paid site must still be able to republish: ' + JSON.stringify(res.body));
    assert.equal(res.body.site.paid, true);
});

test('neighbour: a user with 0 sites can publish their first draft', async () => {
    const { cookie } = newUserCookie();
    const res = await publish(cookie, {
        templateId: 'portfolio', slug: 'primul-site-' + crypto.randomUUID().slice(0, 6), name: 'Primul site',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('neighbour: after paying the first site, the user can create and publish a second unpaid draft', async () => {
    const { user, cookie } = newUserCookie();
    const first = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1,
        slug: 'paid-first-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });
    registry.updateSite(first.id, { paid: true, status: 'live', paidUntil: new Date(Date.now() + 365 * 86400000).toISOString() });

    const res = await publish(cookie, {
        templateId: 'local-service', slug: 'al-doilea-acum-permis-' + crypto.randomUUID().slice(0, 6), name: 'Al doilea, acum permis',
    });
    assert.equal(res.status, 200, 'a second unpaid draft must be allowed once the first is paid: ' + JSON.stringify(res.body));
    assert.equal(res.body.site.paid, false);
});

test('neighbour: after deleting the unpaid draft, the user can create a new one', async () => {
    const { user, cookie } = newUserCookie();
    const first = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1,
        slug: 'to-delete-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });
    // status 'deleted' is what bot/server.js's delete-site flow leaves behind.
    registry.updateSite(first.id, { status: 'deleted' });

    const res = await publish(cookie, {
        templateId: 'local-service', slug: 'dupa-stergere-' + crypto.randomUUID().slice(0, 6), name: 'După ștergere',
    });
    assert.equal(res.status, 200, 'a deleted draft must not count against the limit: ' + JSON.stringify(res.body));
});

test('neighbour: two simultaneous /api/publish calls with NO siteId (brand-new sites, 0 drafts yet) — exactly one wins', async () => {
    // The realistic race the plan asks for: a user with ZERO sites fires two
    // "Continuă" clicks for two different designs close enough together that
    // both requests are in flight before either has written anything (no
    // prior POST /api/draft here — this exercises the plain `else` branch of
    // handlePublish, i.e. two brand-new-site creations racing each other).
    const { cookie } = newUserCookie();

    const [r1, r2] = await Promise.all([
        publish(cookie, { templateId: 'portfolio', slug: 'cursa-a-' + crypto.randomUUID().slice(0, 6), name: 'Cursa A' }),
        publish(cookie, { templateId: 'local-service', slug: 'cursa-b-' + crypto.randomUUID().slice(0, 6), name: 'Cursa B' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one of the two concurrent publishes must win: ' + JSON.stringify({ r1, r2 }));
});

test('LEGACY DATA ONLY: for an account that already has two pre-existing unpaid drafts (a database from before the handleSaveDraft fix shipped), publishing EITHER is refused until one is resolved', async () => {
    // The product itself can no longer CREATE this state (handleSaveDraft
    // now reuses the single unpaid-draft slot regardless of templateId —
    // see the file header and the "trying 3 different designs" test above).
    // This documents what must still happen for a row pair that already
    // exists from before that fix (real accounts in production hit the
    // original B1 bug while it was live, so such rows exist today): this
    // fix correctly refuses to hand a checkout URL to EITHER site,
    // symmetrically, because from each site's own point of view the other
    // one is "already an unpaid site" — matching the refusal message's own
    // instruction ("plătește-l SAU șterge-l"): the user must resolve one
    // (pay it or delete it) before either can proceed to payment. Seeded
    // directly through the registry, not through two draft() calls, because
    // draft() cannot produce this pair anymore.
    const { user, cookie } = newUserCookie();
    const d1 = registry.createSite({
        userId: user.id, templateId: 'portfolio', templateVersion: 1,
        slug: 'legacy-a-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });
    const d2 = registry.createSite({
        userId: user.id, templateId: 'local-service', templateVersion: 1,
        slug: 'legacy-b-' + crypto.randomUUID().slice(0, 6), platform: 'web',
    });

    const [r1, r2] = await Promise.all([
        publish(cookie, { siteId: d1.id, templateId: 'portfolio', slug: 'cursa-a-' + crypto.randomUUID().slice(0, 6), name: 'Cursa A' }),
        publish(cookie, { siteId: d2.id, templateId: 'local-service', slug: 'cursa-b-' + crypto.randomUUID().slice(0, 6), name: 'Cursa B' }),
    ]);

    assert.equal(r1.status, 409, JSON.stringify(r1));
    assert.equal(r2.status, 409, JSON.stringify(r2));
});
