'use strict';
/** Seed a persistent DATA_DIR with one real paid site, for backup/restore testing. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a210a955143021a0f';
const DATA_DIR = process.argv[2];
if (!DATA_DIR) { console.error('usage: node seed-datadir.js <dataDir>'); process.exit(1); }
fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = DATA_DIR;
process.env.SERVER_SECRET = 'reaudit-seed-' + crypto.randomBytes(12).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY']) delete process.env[k];

async function main() {
    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
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

    const auth = await api('POST', '/api/auth/email', { email: 'backup-restore-customer@example.com' });
    const token = new URL(auth.json.devLink, BASE).searchParams.get('token');
    await api('GET', '/auth/verify?token=' + token);
    const presetConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')).presets[0].config;
    const pub = await api('POST', '/api/publish', { templateId: 'professionals', config: presetConfig, images: [], slug: 'backup-restore-site' });
    const siteId = pub.json.site.id;
    const sessionId = /test-checkout=([^&]+)/.exec(pub.json.paymentUrl)[1];
    const payResult = await api('POST', '/api/test-pay/complete', { sessionId });
    console.log(JSON.stringify({ siteId, slug: 'backup-restore-site', payResult: payResult.json, dataDir: DATA_DIR }, null, 2));
    server.close();
    process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
