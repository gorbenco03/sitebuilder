'use strict';
/**
 * Seed + serve for Calendar-Cutover QA screenshots on a real opted-in professionals site.
 * Run: node --experimental-sqlite scripts/_cutover-shot-server.js
 */
if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawn } = require('child_process');
    const child = spawn(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit', env: process.env }
    );
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(code == null ? 1 : code);
    });
    return;
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8799);
const tmp = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cal-cutover-shot-'));
process.env.DATA_DIR = tmp;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'cal-cutover-shot-secret';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.HIDOOK_FAKE_DEPLOY;

const { renderHtml } = require('../build.js');
const { openCalendarDb } = require('../bot/calendar-native/db');
const engine = require('../bot/calendar-native/engine');
const cutover = require('../bot/calendar-native/cutover');
const publicApi = require('../bot/calendar-native/public-api');
const email = require('../bot/calendar-native/email');
const { zonedWallTimeToUtcMs, toIsoUtc } = require('../bot/calendar-native/time');
const { createHandler } = require('../bot/server.js');
const auth = require('../bot/auth');
const registry = require('../bot/registry');

publicApi.resetDbHandle();
const db = openCalendarDb({ dataDir: tmp });

// Memory email transport so harness outbox is inspectable
const mem = email.createMemoryTransport();
email.setTransport(mem);

// Real registry site (owner dashboard auth path) — not the widget demo tenant
const ownerUser = registry.getOrCreateUserByEmail('owner.cutover@example.com');
const siteRec = registry.createSite({
    userId: ownerUser.id,
    templateId: 'professionals',
    templateVersion: 1,
    slug: 'cutover-opted-in-cabinet',
});
const site = { userId: ownerUser.id, id: siteRec.id };

const preset = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')
).presets[0].config;
const tpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'templates/professionals/styles.css'), 'utf8');

// Legacy default HTML (native off)
const legacyHtml = renderHtml(tpl, preset).replace(
    'href="styles.css"',
    'href="/cutover-shot/styles.css"'
);

// Native opted-in HTML via preparePublishCutover (real seed + tenant ids + api base)
const nativeCfg = JSON.parse(JSON.stringify(preset));
nativeCfg.appointment.nativeBooking = 'da';
const prepared = cutover.preparePublishCutover({ config: nativeCfg, site, db });
let nativeHtml = renderHtml(tpl, prepared.config);
nativeHtml = nativeHtml.replace('href="styles.css"', 'href="/cutover-shot/styles.css"');

// Owner dashboard shell bound to this opted-in tenant
const ownerHtml = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Programări — owner cutover</title>
  <link rel="stylesheet" href="/calendar-native/owner/owner-dashboard.css" />
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f3f6f4; color: #14201c; }
  </style>
</head>
<body class="hod">
  <div
    id="hod-root"
    data-hidook-cal-owner
    data-customer-id="${site.userId}"
    data-site-id="${site.id}"
    data-api-base=""
    data-brand="Cabinet Cutover QA"
  ></div>
  <script src="/calendar-native/owner/owner-dashboard.js"></script>
</body>
</html>`;

// Seed a confirmed booking + manage token for manage UI shots (separate from live book walk)
const services = engine.listServices(db, site.userId, site.id, { activeOnly: true });
const nowMs = Date.UTC(2026, 0, 1);
const startUtc = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 0, 'Europe/Bucharest'));
const booked = engine.createBooking(db, site.userId, site.id, {
    serviceId: services[0].id,
    startUtc,
    visitorName: 'Maria Popescu',
    visitorEmail: 'maria.cutover@example.com',
    nowMs,
});
// Drain email for seed booking so outbox has rows before walk
email.processOutbox(db, { nowMs, limit: 20 }).catch(() => {});

const meta = {
    port: PORT,
    dataDir: tmp,
    manageToken: booked.manageToken,
    bookingStatus: booked.status,
    bookingId: booked.booking && booked.booking.id,
    customerId: site.userId,
    siteId: site.id,
    serviceId: services[0].id,
    nativeApiBase: prepared.config.appointment.nativeApiBase || '',
    ownerSessionUserId: site.userId,
};
fs.mkdirSync(path.join(tmp, 'cutover-shot'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'legacy.html'), legacyHtml);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'native.html'), nativeHtml);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'owner.html'), ownerHtml);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'styles.css'), css);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'meta.json'), JSON.stringify(meta, null, 2));

function outboxSnapshot() {
    const rows = email.listOutbox(db, site.userId, site.id, { limit: 50, includeBodies: false });
    const delivered = mem.sent ? mem.sent.slice() : [];
    return {
        ok: true,
        count: rows.length,
        rows: rows.map((r) => ({
            id: r.id,
            template_key: r.template_key,
            status: r.status,
            booking_id: r.booking_id,
            booking_status_snapshot: r.booking_status_snapshot,
            to_email: r.to_email,
        })),
        memoryDelivered: delivered.length,
        memorySubjects: delivered.map((d) => d.subject || (d.message && d.message.subject) || '').slice(0, 20),
    };
}

function outboxHtmlPage() {
    const snap = outboxSnapshot();
    const rows = snap.rows
        .map(
            (r) =>
                `<tr><td>${r.template_key}</td><td>${r.status}</td><td>${r.booking_status_snapshot || ''}</td><td>${r.to_email || ''}</td></tr>`
        )
        .join('');
    return `<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"/><title>Email outbox harness</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;background:#f7faf8;color:#14201c}
h1{font-size:1.25rem;margin:0 0 8px}
p{color:#5c6d66;margin:0 0 16px}
table{border-collapse:collapse;width:100%;max-width:900px;background:#fff;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e4ebe7;font-size:14px}
th{background:#eef5f1;font-weight:600}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#d8f3e4;color:#0b6b3a;font-weight:600;font-size:12px}
</style></head><body>
<p class="badge">harness local — fără sender producție</p>
<h1>Email outbox (calendar nativ)</h1>
<p>${snap.count} mesaje în coadă / livrate local · memoryDelivered=${snap.memoryDelivered}</p>
<table><thead><tr><th>Template</th><th>Status</th><th>Stare booking</th><th>Către</th></tr></thead>
<tbody>${rows || '<tr><td colspan="4">Gol</td></tr>'}</tbody></table>
</body></html>`;
}

const baseHandler = createHandler({});
const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname.startsWith('/cutover-shot/')) {
        const rel = u.pathname.slice('/cutover-shot/'.length) || 'legacy.html';
        if (rel.includes('..')) {
            res.writeHead(403);
            return res.end('forbidden');
        }
        if (rel === 'outbox.json') {
            const body = JSON.stringify(outboxSnapshot(), null, 2);
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            return res.end(body);
        }
        if (rel === 'outbox.html') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            return res.end(outboxHtmlPage());
        }
        if (rel === 'owner-session' && req.method === 'POST') {
            const cookieValue = auth.signSession(site.userId);
            const cookie = auth.buildSessionCookie(cookieValue);
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Set-Cookie': cookie,
                'Cache-Control': 'no-store',
            });
            return res.end(JSON.stringify({ ok: true, customerId: site.userId, siteId: site.id }));
        }
        const file = path.join(tmp, 'cutover-shot', rel);
        if (!fs.existsSync(file)) {
            res.writeHead(404);
            return res.end('not found');
        }
        const ext = path.extname(file);
        const type =
            ext === '.css' ? 'text/css; charset=utf-8' :
            ext === '.js' ? 'application/javascript; charset=utf-8' :
            ext === '.json' ? 'application/json; charset=utf-8' :
            'text/html; charset=utf-8';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(file));
    }
    return baseHandler(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({ ready: true, ...meta }));
});
