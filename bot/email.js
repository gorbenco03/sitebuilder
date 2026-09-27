'use strict';
/**
 * bot/email.js — send the magic link via Resend (or log it in dev).
 *
 * With RESEND_API_KEY set → POST https://api.resend.com/emails
 * Without it → log the link and return { sent: false, devLink: url }
 *
 * Zero npm dependencies. Node 18+ CommonJS.
 */

const { log } = require('./logger.js');

const RESEND_API = 'https://api.resend.com/emails';

/**
 * Send a magic link to the given email address.
 *
 * @param {string} email  Recipient address.
 * @param {string} url    Magic-link sign-in URL.
 * @returns {Promise<{ sent: boolean, devLink?: string }>}
 */
async function sendMagicLink(email, url) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        log('email.magic_link.dev', { email, devLink: url });
        return { sent: false, devLink: url };
    }

    const from    = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const subject = 'Autentificare la Hidook Site Builder';
    const html    = `
<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#333">Autentificare la Hidook Site Builder</h2>
  <p>Apasă butonul de mai jos ca să intri în cont. Linkul este valabil <strong>15 minute</strong>.</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${url}"
       style="background:#E8588C;color:#fff;padding:12px 28px;border-radius:6px;
              text-decoration:none;font-size:16px;display:inline-block">
      Intră în cont
    </a>
  </p>
  <p style="font-size:13px;color:#888">
    Dacă nu ai cerut acest email, îl poți ignora în siguranță.
  </p>
  <p style="font-size:13px;color:#aaa">
    Sau copiază acest link:<br>
    <a href="${url}" style="color:#aaa;word-break:break-all">${url}</a>
  </p>
</body>
</html>`.trim();

    const text =
        `Bună,\n\n` +
        `Apasă acest link ca să intri în contul tău Hidook Site Builder. Linkul este valabil 15 minute.\n\n` +
        `${url}\n\n` +
        `Dacă nu ai cerut acest email, îl poți ignora în siguranță.\n\n` +
        `— Hidook Site Builder`;

    const body = JSON.stringify({ from, to: email, subject, html, text });

    const res = await fetch(RESEND_API, {
        method:  'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body,
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        log('email.magic_link.error', { email, status: res.status, body: text.slice(0, 200) }, 'error');
        throw new Error(`Resend API error ${res.status}: ${text.slice(0, 120)}`);
    }

    log('email.magic_link.sent', { email });
    return { sent: true };
}

/**
 * Generic Resend send, sharing the endpoint/RESEND_API_KEY/EMAIL_FROM this
 * file already uses for the magic link — so a second feature (calendar-native
 * email, CAL-N-02) that wants real delivery does not open its own copy of
 * this fetch call. Throws on a missing key or a non-2xx response; the caller
 * decides how to log/fall back (see calendar-native/email/provider.js).
 *
 * @param {{ to: string, subject: string, html: string, text: string, attachments?: Array<{filename: string, content: string}> }} message
 * @returns {Promise<{ sent: true }>}
 */
async function sendResendEmail(message) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        const err = new Error('RESEND_API_KEY not set');
        err.code = 'NO_API_KEY';
        throw err;
    }

    const from = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const payload = {
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
    };
    if (message.attachments && message.attachments.length) {
        payload.attachments = message.attachments;
    }

    const res = await fetch(RESEND_API, {
        method:  'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const err = new Error(`Resend API error ${res.status}: ${bodyText.slice(0, 200)}`);
        err.code = 'RESEND_HTTP_' + res.status;
        throw err;
    }

    return { sent: true };
}

module.exports = { sendMagicLink, sendResendEmail, RESEND_API };
