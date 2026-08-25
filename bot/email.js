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
    const subject = 'Sign in to Hidook Site Builder';
    const html    = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#333">Sign in to Hidook Site Builder</h2>
  <p>Click the button below to sign in. This link is valid for <strong>15 minutes</strong>.</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${url}"
       style="background:#E8588C;color:#fff;padding:12px 28px;border-radius:6px;
              text-decoration:none;font-size:16px;display:inline-block">
      Sign in
    </a>
  </p>
  <p style="font-size:13px;color:#888">
    If you didn't request this link, you can safely ignore this email.
  </p>
  <p style="font-size:13px;color:#aaa">
    Or copy this link:<br>
    <a href="${url}" style="color:#aaa;word-break:break-all">${url}</a>
  </p>
</body>
</html>`.trim();

    const body = JSON.stringify({ from, to: email, subject, html });

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

module.exports = { sendMagicLink };
