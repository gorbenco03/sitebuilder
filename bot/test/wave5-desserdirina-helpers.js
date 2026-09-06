'use strict';
/**
 * bot/test/wave5-desserdirina-helpers.js — shared harness for the Wave5
 * desserdirina audit-fix oracles (bot/test/wave5-desserdirina-*.test.js).
 *
 * Not itself a test (no .test.js suffix) — the `node --experimental-sqlite
 * --test bot/test/*.test.js` runner does not pick this file up.
 *
 * Builds a real, servable copy of the desserdirina template either from the
 * CURRENT working tree ("after" — with all Wave5 fixes) or from a given git
 * ref ("before" — e.g. HEAD, the commit this wave started from), so each
 * oracle can prove red-before / green-after against the exact same rendering
 * pipeline (build.js's real renderHtml/build(), not a re-implementation).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_DIR = path.join(ROOT, 'templates', 'desserdirina');

// Files that make up the template "chrome" (not data/schema) — copied verbatim
// into the built site directory alongside the generated index.html.
const STATIC_FILES = ['template.html', 'styles.css', 'script.js', 'collage.js'];

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

/** Binary-safe variant of readGitFile (for font/image blobs). */
function readGitFileBuffer(ref, relPath) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${relPath}`], {
      maxBuffer: 16 * 1024 * 1024,
    }); // no `encoding` -> raw Buffer
  } catch (e) {
    return null;
  }
}

function listGitDir(ref, relDir) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-tree', '--name-only', ref, relDir + '/'], {
      encoding: 'utf8',
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.basename(l));
  } catch (e) {
    return [];
  }
}

/**
 * Materialize a servable desserdirina site into a fresh tmp dir.
 *
 * @param {object} opts
 * @param {'before'|'after'} opts.state - 'after' = current working tree (with
 *   Wave5 fixes); 'before' = git ref `opts.ref` (defaults to HEAD, the commit
 *   this wave started from — i.e. the pre-fix template).
 * @param {string} [opts.ref='HEAD']
 * @param {number} [opts.presetIndex=0]
 * @returns {{ dir: string, presetConfig: object }}
 */
function buildSite(opts) {
  const state = opts.state;
  const ref = opts.ref || 'HEAD';
  const presetIndex = opts.presetIndex || 0;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wave5-desserd-${state}-`));

  // 1) Template chrome files (template.html/styles.css/script.js/collage.js)
  for (const name of STATIC_FILES) {
    const content =
      state === 'after'
        ? fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8')
        : readGitFile(ref, `templates/desserdirina/${name}`);
    if (content == null) throw new Error(`${name} missing at ${state === 'after' ? 'working tree' : ref}`);
    fs.writeFileSync(path.join(dir, name), content);
  }

  // 2) Self-hosted font binaries (only exist in the "after"/working-tree state —
  //    the "before" ref pre-dates Wave5 and has no fonts/ directory at all).
  const fontsOutDir = path.join(dir, 'fonts');
  if (state === 'after') {
    fs.mkdirSync(fontsOutDir, { recursive: true });
    for (const f of fs.readdirSync(path.join(TEMPLATE_DIR, 'fonts'))) {
      fs.copyFileSync(path.join(TEMPLATE_DIR, 'fonts', f), path.join(fontsOutDir, f));
    }
  } else {
    const beforeFonts = listGitDir(ref, 'templates/desserdirina/fonts');
    if (beforeFonts.length) {
      fs.mkdirSync(fontsOutDir, { recursive: true });
      for (const f of beforeFonts) {
        const buf = readGitFileBuffer(ref, `templates/desserdirina/fonts/${f}`);
        if (buf != null) fs.writeFileSync(path.join(fontsOutDir, f), buf);
      }
    }
  }

  // 3) Images — always from the current working tree (images/** is owned by a
  //    different agent re-encoding photos right now; irrelevant to these fixes).
  const imagesOutDir = path.join(dir, 'images');
  fs.mkdirSync(imagesOutDir, { recursive: true });
  const imagesSrcDir = path.join(TEMPLATE_DIR, 'images');
  for (const img of fs.readdirSync(imagesSrcDir)) {
    const from = path.join(imagesSrcDir, img);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(imagesOutDir, img));
  }

  // 4) config.json from the matching presets.json (same state as the template
  //    chrome, so "before" faithfully reproduces the pre-fix blank galleryTitle
  //    etc., and "after" reflects the Wave5 preset defaults).
  const presetsRaw =
    state === 'after'
      ? fs.readFileSync(path.join(TEMPLATE_DIR, 'presets.json'), 'utf8')
      : readGitFile(ref, 'templates/desserdirina/presets.json');
  const presets = JSON.parse(presetsRaw).presets;
  const presetConfig = JSON.parse(JSON.stringify(presets[presetIndex].config));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(presetConfig, null, 2));

  // 5) Render index.html (+ legal pages/cookie banner) via the REAL build.js —
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

module.exports = { buildSite, serveDir, loadPlaywright, TEMPLATE_DIR, ROOT };
