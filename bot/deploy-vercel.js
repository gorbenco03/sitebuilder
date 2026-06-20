/**
 * deploy-vercel.js — Deploy a static site to Vercel + attach a custom domain.
 *
 * Mirrors the structure of deploy.js (Netlify) so the two are swappable.
 *
 * SaaS flow position:
 *   client describes business → AI builds site → collect payment (payments.js)
 *   → buy domain (domains.js) → [THIS MODULE: deploy + attach domain] → return live URL
 *
 * Required env var:
 *   VERCEL_TOKEN    — Vercel personal access token or team token.
 *
 * Optional env var:
 *   VERCEL_TEAM_ID  — Vercel team ID. When present, all requests include ?teamId=...
 *                     Required if the token belongs to a team scope.
 *
 * NOTE: Vercel API version numbers are best-effort current as of mid-2025.
 * They are centralised in the constants below — bump them here if Vercel updates.
 *   Files upload endpoint : v2
 *   Deployments endpoint  : v13
 *   Project domain attach : v10
 *
 * @module deploy-vercel
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// API version constants (centralised for easy bumping)
// ---------------------------------------------------------------------------
const VERCEL_API        = 'https://api.vercel.com';
const FILES_API_VER     = 'v2';   // POST /v2/files
const DEPLOY_API_VER    = 'v13';  // POST /v13/deployments
const DOMAIN_API_VER    = 'v10';  // POST /v10/projects/{name}/domains
const PROJECTS_API_VER  = 'v9';   // PATCH /v9/projects/{id} (disable access protection)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute SHA-1 hex of a Buffer. */
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/**
 * Return the optional teamId query parameter string.
 * Returns the base string unchanged when VERCEL_TEAM_ID is not set.
 */
function teamQuery(base = '') {
    const teamId = process.env.VERCEL_TEAM_ID;
    if (!teamId) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}teamId=${encodeURIComponent(teamId)}`;
}

/**
 * Execute a Vercel API call. Throws an Error with the Vercel error message on
 * non-2xx responses.
 *
 * @param {string} method       HTTP method
 * @param {string} urlPath      Full versioned path, e.g. '/v13/deployments'
 * @param {object} [opts]
 * @param {object} [opts.body]  JSON body (object → serialised automatically)
 * @param {Buffer} [opts.rawBody]  Raw binary body (for file uploads)
 * @param {object} [opts.headers]  Extra headers to merge in
 * @returns {Promise<object>} Parsed JSON response
 */
async function vercelRequest(method, urlPath, { body, rawBody, headers: extraHeaders } = {}) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error('VERCEL_TOKEN is not set. Cannot call Vercel API.');

    const url = VERCEL_API + teamQuery(urlPath);
    const isJson = body !== undefined;

    const res = await fetch(url, {
        method,
        headers: {
            Authorization: 'Bearer ' + token,
            ...(isJson ? { 'Content-Type': 'application/json' } : {}),
            ...extraHeaders,
        },
        body: isJson ? JSON.stringify(body) : (rawBody || undefined),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = (json.error && json.error.message) || JSON.stringify(json);
        throw new Error(`Vercel ${method} ${urlPath} → ${res.status}: ${msg}`);
    }
    return json;
}

/**
 * Recursively walk a directory and collect all files as { rel, abs, buf }.
 * rel uses POSIX-style paths without a leading slash (e.g. 'images/photo.jpg').
 *
 * @param {string} dir   Absolute directory path to walk.
 * @param {string} [base]  Internal — base directory used to compute rel paths.
 * @returns {Array<{rel: string, abs: string, buf: Buffer}>}
 */
function collectFiles(dir, base) {
    base = base || dir;
    const out = [];
    for (const entry of fs.readdirSync(dir)) {
        const abs = path.join(dir, entry);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
            out.push(...collectFiles(abs, base));
        } else if (stat.isFile()) {
            // Compute POSIX-style relative path (no leading slash)
            const rel = path.relative(base, abs).split(path.sep).join('/');
            out.push({ rel, abs, buf: fs.readFileSync(abs) });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when VERCEL_TOKEN is present in the environment.
 * Use this to guard feature availability before calling other exports.
 *
 * @returns {boolean}
 */
function isConfigured() {
    return Boolean(process.env.VERCEL_TOKEN);
}

/**
 * Deploy all files in siteDir to Vercel as a production deployment.
 *
 * Steps:
 *   1. Walk siteDir recursively to collect files.
 *   2. For each file, upload raw bytes to POST /v2/files with SHA-1 digest.
 *      (Vercel deduplicates by digest — already-uploaded files are skipped.)
 *   3. Create a production deployment via POST /v13/deployments referencing the files.
 *   4. Return the live URL.
 *
 * @param {string} siteDir        Absolute path to the built site directory.
 * @param {object} opts
 * @param {string} opts.name      Vercel project name (must be URL-safe, e.g. 'desserd-by-irina').
 * @returns {Promise<{url: string, deploymentId: string, projectId: string|undefined}>}
 */
async function deploySite(siteDir, { name }) {
    if (!siteDir) throw new Error('siteDir is required.');
    if (!name) throw new Error('name is required.');

    const files = collectFiles(siteDir);
    if (files.length === 0) throw new Error('Nothing to deploy in ' + siteDir);

    // Step 1 — Upload each file (Vercel deduplicates by SHA-1)
    const fileEntries = [];
    for (const f of files) {
        const digest = sha1(f.buf);
        await vercelRequest('POST', `/${FILES_API_VER}/files`, {
            rawBody: f.buf,
            headers: {
                'x-vercel-digest': digest,
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(f.buf.length),
            },
        });
        fileEntries.push({ file: f.rel, sha: digest, size: f.buf.length });
    }

    // Step 2 — Create the deployment
    const deployment = await vercelRequest('POST', `/${DEPLOY_API_VER}/deployments`, {
        body: {
            name,
            target: 'production',
            project: name,
            files: fileEntries,
            projectSettings: {
                framework: null, // static HTML — no framework
            },
        },
    });

    const liveUrl = 'https://' + (deployment.url || deployment.alias?.[0] || `${name}.vercel.app`);

    // Make the site publicly accessible: new projects may default to "Vercel
    // Authentication" (ssoProtection), which returns 401 on the *.vercel.app URL.
    // Clients need a public link, so disable it. Best-effort — never fail the deploy.
    if (deployment.projectId) {
        await disablePublicProtection(deployment.projectId).catch(() => {});
    }

    return {
        url: liveUrl,
        deploymentId: deployment.id,
        projectId: deployment.projectId,
    };
}

/**
 * Disable access protection (Vercel Authentication / password) on a project so its
 * deployments are publicly reachable. Uses PATCH /v9/projects/{id}.
 *
 * @param {string} projectIdOrName
 * @returns {Promise<object>}
 */
async function disablePublicProtection(projectIdOrName) {
    return vercelRequest('PATCH', `/${PROJECTS_API_VER}/projects/${encodeURIComponent(projectIdOrName)}`, {
        body: { ssoProtection: null, passwordProtection: null },
    });
}

/**
 * Attach a custom domain to an existing Vercel project.
 *
 * When the domain was purchased through Vercel (via domains.js / buyDomain),
 * DNS is auto-managed by Vercel and the domain verifies automatically — no
 * manual DNS configuration is needed by the client.
 *
 * Uses: POST /v10/projects/{idOrName}/domains
 *
 * @param {string} projectIdOrName  Vercel project ID or project name.
 * @param {string} domainName       Full domain, e.g. 'myshop.com'
 * @returns {Promise<{ok: boolean, raw: object}>}
 */
async function attachDomain(projectIdOrName, domainName) {
    if (!projectIdOrName) throw new Error('projectIdOrName is required.');
    if (!domainName) throw new Error('domainName is required.');

    const raw = await vercelRequest(
        'POST',
        `/${DOMAIN_API_VER}/projects/${encodeURIComponent(projectIdOrName)}/domains`,
        { body: { name: domainName } }
    );

    return { ok: true, raw };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = { isConfigured, deploySite, attachDomain, disablePublicProtection };

// ---------------------------------------------------------------------------
// Self-test (run: node bot/deploy-vercel.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
    console.log('deploy-vercel.js self-test');
    console.log('  isConfigured():', isConfigured());
    if (!isConfigured()) {
        console.log('  VERCEL_TOKEN not set — all API calls would throw a clear Error. ✓');
        console.log('  Example:');
        console.log('    deploySite("/path/to/site", { name: "my-desserd-site" })');
        console.log('    → throws: "VERCEL_TOKEN is not set. Cannot call Vercel API."');
        console.log('  API version constants (easy to bump):');
        console.log('    Files upload : ' + FILES_API_VER + '  → POST /v2/files');
        console.log('    Deployments  : ' + DEPLOY_API_VER + ' → POST /v13/deployments');
        console.log('    Domain attach: ' + DOMAIN_API_VER + ' → POST /v10/projects/{name}/domains');
    } else {
        console.log('  VERCEL_TOKEN is present — Vercel deploy API calls are enabled.');
        console.log('  VERCEL_TEAM_ID:', process.env.VERCEL_TEAM_ID || '(not set — using personal account)');
    }
}
