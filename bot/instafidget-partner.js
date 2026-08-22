'use strict';
/**
 * Server-only Instafidget Partner API client.
 * Secret never leaves this process. Browser UI must not import this file.
 */

const DEFAULT_API = 'https://backend-production-b675.up.railway.app/api';

function partnerBase() {
    const raw = process.env.INSTAWIDGET_PARTNER_API || DEFAULT_API;
    return String(raw).replace(/\/+$/, '');
}

function partnerSecret() {
    const s = process.env.SITEBUILDER_PARTNER_SECRET;
    return typeof s === 'string' && s.trim() ? s.trim() : '';
}

function isConfigured() {
    return partnerSecret().length > 0;
}

async function partnerPost(pathname, body) {
    const secret = partnerSecret();
    if (!secret) {
        const err = new Error('SITEBUILDER_PARTNER_SECRET missing');
        err.code = 'SECRET_MISSING';
        throw err;
    }
    const url = partnerBase() + pathname;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-sitebuilder-partner-secret': secret,
        },
        body: JSON.stringify(body),
    });
    let json = {};
    try { json = await res.json(); } catch (_) { json = {}; }
    return { status: res.status, json: json && typeof json === 'object' ? json : {} };
}

function grantYear1(email) {
    return partnerPost('/billing/partner/site-bundle-grant', {
        email,
        acceptedTerms: true,
    });
}

function editorSession(email) {
    return partnerPost('/billing/partner/editor-session', { email });
}

module.exports = {
    DEFAULT_API,
    partnerBase,
    partnerSecretConfigured: isConfigured,
    isConfigured,
    grantYear1,
    editorSession,
};
