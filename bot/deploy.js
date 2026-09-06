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

/**
 * DI-05: Netlify's digest-deploy API (site create + per-file upload, all
 * routed through this one helper) had no timeout — a slow/hung response left
 * a client's publish blocked forever. 15s per call; the file upload loop in
 * deployToNetlify makes one call per changed file, so a large gallery still
 * completes in bounded steps rather than one giant unbounded request.
 */
const NETLIFY_API_TIMEOUT_MS = Number(process.env.NETLIFY_API_TIMEOUT_MS) || 15000;

// Files that make up the live site (template/config are build inputs, not shipped).
// F6: robots.txt/sitemap.xml are written into siteDir by webpublish.js before
// deploy runs — Cloudflare (wrangler ships the whole dir) and Vercel
// (collectFiles there walks the whole dir) pick them up automatically, but
// this Netlify path uses an explicit allowlist, so they must be named here
// too or every Netlify-hosted site would silently ship without them.
function collectFiles(dir) {
    const out = [];
    for (const f of ['index.html', 'styles.css', 'script.js', 'robots.txt', 'sitemap.xml']) {
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
    let res;
    try {
        res = await fetch(API + urlPath, {
            method,
            headers: {
                Authorization: 'Bearer ' + token,
                ...(contentType ? { 'Content-Type': contentType } : {}),
            },
            body,
            signal: AbortSignal.timeout(NETLIFY_API_TIMEOUT_MS),
        });
    } catch (e) {
        if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
            throw new Error(`Netlify ${method} ${urlPath} timed out after ${NETLIFY_API_TIMEOUT_MS}ms`);
        }
        throw e;
    }
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
