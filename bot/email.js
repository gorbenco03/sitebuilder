'use strict';
/**
 * bot/email.js — Trimitere magic-link prin Resend (sau logging în dev).
 *
 * Dacă RESEND_API_KEY este setat → POST https://api.resend.com/emails
 * Altfel → loghează linkul și returnează { sent: false, devLink: url }
 *
 * Zero dependențe npm. Node 18+ CommonJS.
 */

const { log } = require('./logger.js');

const RESEND_API = 'https://api.resend.com/emails';

/**
 * Trimite un magic link la adresa de email dată.
 *
 * @param {string} email  Adresa destinatarului.
 * @param {string} url    URL-ul magic link de autentificare.
 * @returns {Promise<{ sent: boolean, devLink?: string }>}
 */
async function sendMagicLink(email, url) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        log('email.magic_link.dev', { email, devLink: url });
        return { sent: false, devLink: url };
    }

    const from    = process.env.EMAIL_FROM || 'onboarding@resend.dev';
    const subject = 'Link de autentificare DESSERD';
    const html    = `
<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#333">Autentifică-te în DESSERD</h2>
  <p>Apasă butonul de mai jos pentru a te autentifica. Link-ul este valabil <strong>15 minute</strong>.</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${url}"
       style="background:#E8588C;color:#fff;padding:12px 28px;border-radius:6px;
              text-decoration:none;font-size:16px;display:inline-block">
      Autentifică-te
    </a>
  </p>
  <p style="font-size:13px;color:#888">
    Dacă nu ai solicitat tu acest link, ignoră acest email.
  </p>
  <p style="font-size:13px;color:#aaa">
    Sau copiază linkul direct:<br>
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
        throw new Error(`Resend API eroare ${res.status}: ${text.slice(0, 120)}`);
    }

    log('email.magic_link.sent', { email });
    return { sent: true };
}

module.exports = { sendMagicLink };
