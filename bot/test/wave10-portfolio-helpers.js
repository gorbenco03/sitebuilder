'use strict';
/**
 * bot/test/wave10-portfolio-helpers.js — shared harness for the Wave10
 * portfolio (Salon) polish-pass oracles (bot/test/wave10-portfolio-*.test.js).
 *
 * Not itself a test (no .test.js suffix) — the `node --experimental-sqlite
 * --test bot/test/*.test.js` runner does not pick this file up.
 *
 * Same pattern as bot/test/wave5-desserdirina-helpers.js (that file's own
 * header explains the design in more depth): materialize a real, servable
 * copy of the portfolio template either from the CURRENT working tree
 * ("after" — with all Wave10 fixes) or from a given git ref ("before" — the
 * commit this wave started from), so each oracle can prove red-before /
 * green-after against the exact same rendering pipeline (build.js's real
 * renderHtml/build(), not a re-implementation).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

// The pre-fix baseline is pinned to the commit this wave branched from (this
// worktree's HEAD when the Wave10 task started), not to a moving HEAD —
// using a moving HEAD would mean the oracle asserts "the bug is present at
// HEAD", which stops being true the moment the fix lands. Override with
// HIDOOK_BEFORE_REF if a different baseline commit is ever needed.
const BEFORE_REF = process.env.HIDOOK_BEFORE_REF || '20a3a2b';
const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'portfolio');

// Files that make up the template "chrome" (not data/schema) — copied verbatim
// into the built site directory alongside the generated index.html.
const STATIC_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js', 'qrcode.js'];

function readGitFile(ref, relPath) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return null; // file did not exist at that ref
  }
}

/**
 * Materialize a servable portfolio site into a fresh tmp dir.
 *
 * @param {object} opts
 * @param {'before'|'after'} opts.state - 'after' = current working tree (with
 *   Wave10 fixes); 'before' = git ref `opts.ref` (defaults to BEFORE_REF —
 *   the commit this wave started from, i.e. the pre-fix template).
 * @param {string} [opts.ref=BEFORE_REF]
 * @param {number} [opts.presetIndex=0]
 * @returns {{ dir: string, presetConfig: object }}
 */
function buildSite(opts) {
  const state = opts.state;
  const ref = opts.ref || BEFORE_REF;
  const presetIndex = opts.presetIndex || 0;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wave10-portfolio-${state}-`));

  // 1) Template chrome files (template.html/styles.css/script.js/collage.js/qrcode.js)
  for (const name of STATIC_FILES) {
    const content =
      state === 'after'
        ? fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8')
        : readGitFile(ref, `templates/portfolio/${name}`);
    if (content == null) throw new Error(`${name} missing at ${state === 'after' ? 'working tree' : ref}`);
    fs.writeFileSync(path.join(dir, name), content);
  }

  // 2) Images — always from the current working tree. This wave did not
  //    touch templates/portfolio/images/** (the photography itself checked
  //    out fine — no watermarks, no collage-of-unrelated-subjects — the
  //    defects found here were layout/CSS, not asset quality), so "before"
  //    and "after" intentionally use the identical photo set; only the CSS
  //    differs between the two states.
  const imagesOutDir = path.join(dir, 'images');
  fs.mkdirSync(imagesOutDir, { recursive: true });
  const imagesSrcDir = path.join(TEMPLATE_DIR, 'images');
  for (const img of fs.readdirSync(imagesSrcDir)) {
    const from = path.join(imagesSrcDir, img);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(imagesOutDir, img));
  }

  // 3) config.json from the matching presets.json (same state as the template
  //    chrome, so "before" faithfully reproduces the pre-fix rendering and
  //    "after" reflects the Wave10 preset defaults — presets.json itself is
  //    unchanged this wave, but kept state-matched for consistency).
  const presetsRaw =
    state === 'after'
      ? fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8')
      : readGitFile(ref, 'templates/portfolio/presets.json');
  const presets = JSON.parse(presetsRaw).presets;
  const presetConfig = JSON.parse(JSON.stringify(presets[presetIndex].config));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presetConfig, null, 2));

  // 4) Render index.html (+ legal pages/cookie banner) via the REAL build.js —
  //    same engine that builds every live/published site.
  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);

  return { dir, presetConfig };
}

/** Minimal static file server over a built site dir. Returns { server, base, close }. */
function serveDir(dir) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
  };
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let rel = urlPath === '/' ? '/index.html' : urlPath;
      const full = path.join(dir, rel);
      if (!full.startsWith(dir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end('not found: ' + rel);
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function loadPlaywright() {
  // Plain `require('playwright')` lets Node's normal resolution algorithm walk
  // up parent node_modules (this worktree has none of its own; the package
  // lives in the outer repo checkout's node_modules, same as every other test
  // in this suite). Falls back to an explicit path only if that ever changes.
  const candidates = ['playwright', path.join(ROOT, 'node_modules/playwright')];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found — install devDependency (npm install in the repo root)');
}

module.exports = { buildSite, serveDir, loadPlaywright, TEMPLATE_DIR, ROOT, BEFORE_REF };
