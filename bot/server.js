'use strict';
/**
 * bot/server.js — tiny zero-dependency HTTP server running alongside the bot.
 *
 * Why: the bot process needs an inbound HTTPS surface for (today) the Stripe
 * payment webhook and (soon) the WhatsApp Cloud API webhook + the site-editor
 * API. Railway routes public traffic to the PORT it injects; grammY keeps
 * long-polling independently, so the two never conflict.
 *
 * Routes:
 *   GET  /health           → { ok, service, uptimeSec }  (Railway healthcheck)
 *   POST /webhooks/stripe  → verify Stripe-Signature against the RAW body,
 *                            ACK 200 immediately, process the event async
 *                            (a slow handler must never trip Stripe's retry timer).
 *
 * Zero dependencies. Node 18+.
 */

const http = require('http');
const payments = require('./payments.js');
const { log } = require('./logger.js');

/** Max accepted request body (webhook payloads are a few KB; this blocks abuse). */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Read the full raw request body as a Buffer. The RAW bytes are required for
 * webhook signature verification — never JSON.parse before verifying.
 * Rejects with { code: 'BODY_TOO_LARGE' } past `limit`.
 *
 * @param {import('http').IncomingMessage} req
 * @param {number} [limit]
 * @returns {Promise<Buffer>}
 */
function readRawBody(req, limit = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 'BODY_TOO_LARGE' }));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/** Write a JSON response. */
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

/**
 * Build the request handler. Separated from startServer so tests can mount it
 * on an ephemeral port without touching process-wide state.
 *
 * @param {object} [opts]
 * @param {(event: object) => Promise<any>} [opts.onStripeEvent]
 *        Called with each signature-verified Stripe event, AFTER the 200 ACK.
 * @returns {(req, res) => Promise<void>}
 */
function createHandler({ onStripeEvent } = {}) {
    return async (req, res) => {
        const url = (req.url || '/').split('?')[0];
        try {
            if (req.method === 'GET' && (url === '/' || url === '/health')) {
                return sendJson(res, 200, { ok: true, service: 'hidook-bot', uptimeSec: Math.round(process.uptime()) });
            }

            if (req.method === 'POST' && url === '/webhooks/stripe') {
                const secret = process.env.STRIPE_WEBHOOK_SECRET;
                if (!secret) {
                    // Not configured → tell Stripe to retry later rather than swallowing events.
                    return sendJson(res, 503, { error: 'webhook not configured' });
                }
                let raw;
                try {
                    raw = await readRawBody(req);
                } catch (e) {
                    return sendJson(res, e.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'bad body' });
                }
                let event;
                try {
                    event = payments.constructWebhookEvent(raw, req.headers['stripe-signature'], secret);
                } catch (_) {
                    log('webhook.stripe.bad_signature', { ip: req.socket && req.socket.remoteAddress }, 'warn');
                    return sendJson(res, 400, { error: 'invalid signature' });
                }
                // ACK first, process after — Stripe retries on non-2xx / timeouts, and the
                // publish pipeline (deploy) can take longer than its patience.
                sendJson(res, 200, { received: true });
                log('webhook.stripe.received', { type: event.type, id: event.id });
                if (onStripeEvent) {
                    Promise.resolve()
                        .then(() => onStripeEvent(event))
                        .catch((e) => log('webhook.stripe.handler_error', { err: e.message, type: event.type }, 'error'));
                }
                return;
            }

            return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
            log('server.error', { err: e.message, url }, 'error');
            try { sendJson(res, 500, { error: 'internal' }); } catch (_) { /* socket gone */ }
        }
    };
}

/**
 * Start the HTTP server. Port precedence: opts.port → env PORT → 8787.
 * A bind failure logs but never crashes the bot (the bot can still poll Telegram;
 * webhooks fall back to the existing payment poller/sweeper).
 *
 * @param {object} [opts]  See createHandler; plus { port }.
 * @returns {import('http').Server}
 */
function startServer(opts = {}) {
    const port = opts.port != null ? opts.port : (Number(process.env.PORT) || 8787);
    const server = http.createServer(createHandler(opts));
    server.on('error', (e) => {
        console.error('[server] error:', e.message);
        log('server.error', { err: e.message }, 'error');
    });
    server.listen(port, () => {
        const addr = server.address();
        log('server.started', { port: addr && addr.port });
        console.log(`🌐 HTTP server on :${addr && addr.port} (health + webhooks)`);
    });
    return server;
}

module.exports = { startServer, createHandler, readRawBody };

// ---------------------------------------------------------------------------
// Self-test (run: node bot/server.js) — boots on an ephemeral port and checks /health.
// ---------------------------------------------------------------------------

if (require.main === module) {
    (async () => {
        console.log('server.js self-test');
        const srv = startServer({ port: 0 });
        await new Promise((r) => srv.once('listening', r));
        const { port } = srv.address();
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        const json = await res.json();
        console.log('  GET /health →', res.status, JSON.stringify(json));
        srv.close();
        if (res.status !== 200 || !json.ok) process.exit(1);
        console.log('  ✓ OK');
    })().catch((e) => { console.error(e); process.exit(1); });
}
