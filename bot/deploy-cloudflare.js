'use strict';
/**
 * deploy-cloudflare.js — Deploy a static site to Cloudflare Pages (Direct Upload).
 *
 * Same interface as deploy-vercel.js so flow.js can swap providers:
 *   isConfigured() / deploySite(siteDir, {name}) / attachDomain(project, domain)
 *
 * Why Cloudflare Pages: free tier allows commercial use, unlimited bandwidth,
 * and Direct Upload deployments do NOT consume the 500 builds/month quota
 * (that quota is for Cloudflare's git-CI builds only). Every project gets a
 * public https://<project>.pages.dev URL — our free-subdomain tier for v1.
 *
 * Implementation note: the raw Direct Upload HTTP flow requires BLAKE3 file
 * hashing, which node:crypto doesn't provide — so project management goes
 * through the REST API, while the upload itself shells out to the official
 * wrangler CLI (`wrangler pages deploy`). Wrangler reads CLOUDFLARE_API_TOKEN
 * and CLOUDFLARE_ACCOUNT_ID from the environment — the same vars we use.
 *
 * Required env vars:
 *   CLOUDFLARE_API_TOKEN   — API token with "Cloudflare Pages: Edit" permission.
 *   CLOUDFLARE_ACCOUNT_ID  — the account id (dashboard → Workers & Pages → right rail).
 * Optional:
 *   WRANGLER_BIN           — explicit wrangler binary (default: `wrangler`,
 *                            falling back to `npx --yes wrangler`).
 *   WRANGLER_TIMEOUT_MS    — kill a hung deploy after this long (default 180000).
 *
 * @module deploy-cloudflare
 */

const { spawn } = require('child_process');

const CF_API = 'https://api.cloudflare.com/client/v4';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set.
 */
function isConfigured() {
    return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

/**
 * Execute a Cloudflare API call. `{account}` in urlPath is replaced with the
 * account id. Throws an Error (with .status) carrying Cloudflare's message on
 * failure — including HTTP-200-but-success:false responses.
 *
 * @param {string} method
 * @param {string} urlPath e.g. '/accounts/{account}/pages/projects'
 * @param {object} [body]
 * @returns {Promise<object>} The `result` field of the response envelope.
 */
async function cfRequest(method, urlPath, body) {
    const token   = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !account) {
        throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set. Cannot call Cloudflare API.');
    }

    const res = await fetch(CF_API + urlPath.replace('{account}', encodeURIComponent(account)), {
        method,
        headers: {
            Authorization: 'Bearer ' + token,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
        const msg = (json.errors && json.errors[0] && json.errors[0].message) || JSON.stringify(json);
        const err = new Error(`Cloudflare ${method} ${urlPath} → ${res.status}: ${msg}`);
        err.status = res.status;
        throw err;
    }
    return json.result;
}

/**
 * Run the wrangler CLI, capturing stdout+stderr. Tries `WRANGLER_BIN` (when
 * set), then a globally installed `wrangler`, then `npx --yes wrangler` as a
 * last resort (dev machines). Rejects with the tail of stderr on a non-zero
 * exit, or on timeout.
 *
 * @param {string[]} args
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function runWrangler(args) {
    const timeoutMs = Number(process.env.WRANGLER_TIMEOUT_MS) || 180000;
    const candidates = process.env.WRANGLER_BIN
        ? [[process.env.WRANGLER_BIN, args]]
        : [['wrangler', args], ['npx', ['--yes', 'wrangler', ...args]]];

    const tryOne = ([bin, argv]) => new Promise((resolve, reject) => {
        const child = spawn(bin, argv, {
            env: process.env,                    // wrangler reads CLOUDFLARE_* from here
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '', timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });   // e.g. ENOENT
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) return reject(new Error(`wrangler timed out after ${timeoutMs}ms`));
            if (code !== 0) {
                const tail = (stderr || stdout).trim().split('\n').slice(-6).join('\n');
                return reject(new Error(`wrangler exited ${code}: ${tail}`));
            }
            resolve({ stdout, stderr });
        });
    });

    return (async () => {
        let lastErr;
        for (const cand of candidates) {
            try {
                return await tryOne(cand);
            } catch (e) {
                lastErr = e;
                if (e && e.code === 'ENOENT') continue;   // binary missing → next candidate
                throw e;                                  // real failure → surface it
            }
        }
        throw lastErr || new Error('wrangler binary not found');
    })();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a Pages project exists (idempotent): GET, create on 404.
 * Production branch is 'main' — deploySite deploys with --branch main so every
 * deploy is a production deploy on https://<name>.pages.dev.
 *
 * @param {string} name  Pages project name (lowercase [a-z0-9-], ≤58 chars).
 * @returns {Promise<object>} The project object.
 */
async function ensureProject(name) {
    try {
        return await cfRequest('GET', `/accounts/{account}/pages/projects/${encodeURIComponent(name)}`);
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    return cfRequest('POST', '/accounts/{account}/pages/projects', {
        name,
        production_branch: 'main',
    });
}

/**
 * Deploy all files in siteDir to Cloudflare Pages as a production deployment.
 * Creates the project on first deploy. Returns the stable production URL.
 *
 * @param {string} siteDir  Absolute path to the built site directory.
 * @param {object} opts
 * @param {string} opts.name  Pages project name (safeProjectName output is valid).
 * @returns {Promise<{url: string, deploymentUrl: string|null, deploymentId: null, projectId: string}>}
 */
async function deploySite(siteDir, { name }) {
    if (!siteDir) throw new Error('siteDir is required.');
    if (!name) throw new Error('name is required.');
    if (!isConfigured()) throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set.');

    await ensureProject(name);

    const { stdout } = await runWrangler([
        'pages', 'deploy', siteDir,
        '--project-name', name,
        '--branch', 'main',          // = production_branch → production deployment
        '--commit-dirty=true',       // we deploy from a plain folder, not a git checkout
    ]);

    // Wrangler prints the per-deployment preview URL (https://<hash>.<name>.pages.dev);
    // the stable production URL is the project subdomain.
    const m = stdout.match(/https:\/\/[^\s"']+\.pages\.dev/);
    return {
        url: `https://${name}.pages.dev`,
        deploymentUrl: m ? m[0] : null,
        deploymentId: null,
        projectId: name,
    };
}

/**
 * Attach a custom domain to a Pages project. NOTE: for the domain to actually
 * resolve, its DNS must point at the project — a CF zone on this account
 * (apex + www auto-wired) or an external CNAME for subdomains. That zone flow
 * is the Domain Service's job (roadmap F4); this call only registers the
 * domain on the project (mirrors deploy-vercel.attachDomain).
 *
 * @param {string} projectName
 * @param {string} domainName  e.g. 'afacereamea.ro'
 * @returns {Promise<{ok: boolean, raw: object}>}
 */
async function attachDomain(projectName, domainName) {
    if (!projectName) throw new Error('projectName is required.');
    if (!domainName)  throw new Error('domainName is required.');
    const raw = await cfRequest(
        'POST',
        `/accounts/{account}/pages/projects/${encodeURIComponent(projectName)}/domains`,
        { name: domainName }
    );
    return { ok: true, raw };
}

// ---------------------------------------------------------------------------
// ensureSubdomain — BRAND_DOMAIN helper
// ---------------------------------------------------------------------------

/**
 * After a Pages deploy, optionally attach <slug>.<BRAND_DOMAIN> to the project.
 * Requires BRAND_DOMAIN env and Cloudflare API credentials. Best-effort: never
 * throws — any failure is logged and the caller falls back to the pages.dev URL.
 *
 * Steps:
 *   1. Lookup zone id for BRAND_DOMAIN (GET /zones?name=BRAND_DOMAIN).
 *   2. Attach <slug>.<BRAND_DOMAIN> to the Pages project (POST /pages/projects/:name/domains).
 *   3. Create a CNAME record in the zone: slug → <name>.pages.dev (best-effort).
 *
 * @param {string} projectName  Pages project name (= slug).
 * @returns {Promise<{url: string, brandUrl: string|null}>}
 */
async function ensureSubdomain(projectName) {
    const brandDomain = process.env.BRAND_DOMAIN;
    if (!brandDomain || !isConfigured()) {
        return { url: `https://${projectName}.pages.dev`, brandUrl: null };
    }

    const subdomain = `${projectName}.${brandDomain}`;
    try {
        // 1. Look up zone
        const zones = await cfRequest('GET', `/zones?name=${encodeURIComponent(brandDomain)}`);
        const zone  = Array.isArray(zones) ? zones[0] : null;
        const zoneId = zone && zone.id;

        // 2. Attach domain to Pages project (idempotent — 409 = already attached)
        try {
            await cfRequest(
                'POST',
                `/accounts/{account}/pages/projects/${encodeURIComponent(projectName)}/domains`,
                { name: subdomain }
            );
        } catch (e) {
            if (e.status !== 409) throw e; // 409 = already registered, fine
        }

        // 3. Create CNAME in zone (best-effort)
        if (zoneId) {
            try {
                await cfRequest('POST', `/zones/${zoneId}/dns_records`, {
                    type:    'CNAME',
                    name:    projectName,         // <slug> relative to brandDomain zone
                    content: `${projectName}.pages.dev`,
                    proxied: true,
                    ttl:     1,
                });
            } catch (e) {
                // 409 duplicate or other errors — best-effort, ignore
                console.warn('[ensureSubdomain] CNAME create (best-effort):', e.message);
            }
        }

        return { url: `https://${projectName}.pages.dev`, brandUrl: `https://${subdomain}` };
    } catch (e) {
        console.warn('[ensureSubdomain] failed (best-effort):', e.message);
        return { url: `https://${projectName}.pages.dev`, brandUrl: null };
    }
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = { isConfigured, ensureProject, deploySite, attachDomain, ensureSubdomain };

// ---------------------------------------------------------------------------
// Self-test (run: node bot/deploy-cloudflare.js)
// ---------------------------------------------------------------------------

if (require.main === module) {
    console.log('deploy-cloudflare.js self-test');
    console.log('  isConfigured():', isConfigured());
    if (!isConfigured()) {
        console.log('  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set — API calls would throw a clear Error. ✓');
        console.log('  Example:');
        console.log('    deploySite("/path/to/site", { name: "patiseria-mea-123" })');
        console.log('    → ensureProject via API, then `wrangler pages deploy` → https://patiseria-mea-123.pages.dev');
    } else {
        console.log('  Cloudflare credentials present — Pages deploys are enabled.');
        console.log('  Account:', process.env.CLOUDFLARE_ACCOUNT_ID);
    }
}
