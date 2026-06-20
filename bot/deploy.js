/**
 * Netlify deploy — zero extra dependencies.
 *
 * Uses Netlify's digest deploy API: send a map of {path: sha1}, Netlify replies with the
 * subset it doesn't have yet, we upload only those. No zipping, no CLI.
 *
 * Needs a Netlify personal access token:
 *   https://app.netlify.com/user/applications#personal-access-tokens
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.netlify.com/api/v1';

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Files that make up the live site (template/config are build inputs, not shipped).
function collectFiles(dir) {
    const out = [];
    for (const f of ['index.html', 'styles.css', 'script.js']) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) out.push({ rel: '/' + f, abs: p });
    }
    const imgDir = path.join(dir, 'images');
    if (fs.existsSync(imgDir)) {
        for (const f of fs.readdirSync(imgDir)) {
            const p = path.join(imgDir, f);
            if (fs.statSync(p).isFile()) out.push({ rel: '/images/' + f, abs: p });
        }
    }
    return out.map(x => ({ ...x, buf: fs.readFileSync(x.abs) }));
}

async function api(token, method, urlPath, body, contentType) {
    const res = await fetch(API + urlPath, {
        method,
        headers: {
            Authorization: 'Bearer ' + token,
            ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body,
    });
    if (!res.ok) throw new Error(`Netlify ${method} ${urlPath} → ${res.status}: ${await res.text()}`);
    return res;
}

async function getOrCreateSite(token, existingId) {
    if (existingId) {
        try { return await (await api(token, 'GET', `/sites/${existingId}`)).json(); }
        catch (_) { /* site deleted — fall through to create */ }
    }
    return await (await api(token, 'POST', '/sites', '{}', 'application/json')).json();
}

async function waitReady(token, siteId, deployId, tries = 20) {
    for (let i = 0; i < tries; i++) {
        const d = await (await api(token, 'GET', `/sites/${siteId}/deploys/${deployId}`)).json();
        if (d.state === 'ready') return d;
        if (d.state === 'error') throw new Error('Netlify deploy failed: ' + (d.error_message || 'unknown'));
        await new Promise(r => setTimeout(r, 1500));
    }
    return null; // not fatal — site usually live anyway
}

/**
 * Deploy a built site folder to Netlify.
 * @returns {Promise<{url, siteId, adminUrl}>}
 */
async function deployToNetlify(siteDir, token, existingId) {
    const files = collectFiles(siteDir);
    if (files.length === 0) throw new Error('Nothing to deploy in ' + siteDir);

    const digest = {};
    for (const f of files) digest[f.rel] = sha1(f.buf);

    const site = await getOrCreateSite(token, existingId);

    const deploy = await (await api(token, 'POST', `/sites/${site.id}/deploys`,
        JSON.stringify({ files: digest }), 'application/json')).json();

    const required = new Set(deploy.required || []);
    for (const f of files) {
        if (required.has(digest[f.rel])) {
            await api(token, 'PUT', `/deploys/${deploy.id}/files${f.rel}`, f.buf, 'application/octet-stream');
        }
    }

    await waitReady(token, site.id, deploy.id);
    return { url: site.ssl_url || site.url, siteId: site.id, adminUrl: site.admin_url };
}

module.exports = { deployToNetlify };
