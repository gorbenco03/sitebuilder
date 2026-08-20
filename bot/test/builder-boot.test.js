'use strict';
/**
 * bot/test/builder-boot.test.js — production-like builder UI boot.
 *
 * Ensures a stranger hitting /app/ after image build gets real generated JS,
 * not a blank page (gitignored builder/generated/ missing from the image).
 *
 * Checks:
 *   (a) Dockerfile runs the builder asset build after COPY
 *   (b) node scripts/build-builder.js produces engine.js + templates-data.js
 *   (c) GET /app/ references those scripts; GET of each JS returns JS (not HTML SPA fallback)
 *
 * Run: node bot/test/builder-boot.test.js
 * Exit non-zero on first failure class.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const GEN_DIR = path.join(ROOT, 'builder', 'generated');
const ENGINE = path.join(GEN_DIR, 'engine.js');
const TPL_DATA = path.join(GEN_DIR, 'templates-data.js');

let failed = false;

function check(name, fn) {
    try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                () => console.log('PASS', name),
                (e) => {
                    failed = true;
                    console.error('FAIL', name, '-', e.message);
                }
            );
        }
        console.log('PASS', name);
        return Promise.resolve();
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
        return Promise.resolve();
    }
}

(async () => {
    // ── (a) Dockerfile production recipe includes builder asset build ───────
    await check('(a) Dockerfile RUN builds builder/generated after COPY', () => {
        const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
        // Must copy sources first, then generate assets into the image.
        const copyIdx = df.search(/^\s*COPY\s+\.\s+\.\s*$/m);
        assert.ok(copyIdx >= 0, 'Dockerfile must COPY . . (full project)');

        const afterCopy = df.slice(copyIdx);
        const hasBuild =
            /RUN\s+.*\bnode\s+scripts\/build-builder\.js\b/.test(afterCopy) ||
            /RUN\s+.*\bnpm\s+run\s+build:app\b/.test(afterCopy);
        assert.ok(
            hasBuild,
            'Dockerfile must RUN node scripts/build-builder.js (or npm run build:app) after COPY so builder/generated/ is in the image'
        );
    });

    // ── (b) bundler produces the two gitignored assets ──────────────────────
    await check('(b) node scripts/build-builder.js writes engine.js + templates-data.js', () => {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-builder.js')], {
            cwd: ROOT,
            stdio: 'pipe',
        });
        assert.ok(fs.existsSync(ENGINE), 'builder/generated/engine.js missing after build');
        assert.ok(fs.existsSync(TPL_DATA), 'builder/generated/templates-data.js missing after build');
        const eng = fs.readFileSync(ENGINE, 'utf8');
        const tpl = fs.readFileSync(TPL_DATA, 'utf8');
        assert.ok(eng.includes('HidookEngine'), 'engine.js must define HidookEngine');
        assert.ok(tpl.includes('HIDOOK_TEMPLATES'), 'templates-data.js must define HIDOOK_TEMPLATES');
        assert.ok(eng.length > 500, 'engine.js suspiciously small');
        assert.ok(tpl.length > 500, 'templates-data.js suspiciously small');
    });

    // ── (c) HTTP static: /app/ + generated JS (production server path) ──────
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-boot-'));
    process.env.DATA_DIR = tmpDir;
    process.env.SERVER_SECRET = 'boot-test-' + crypto.randomBytes(8).toString('hex');
    process.env.HIDOOK_FAKE_DEPLOY = '1';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RESEND_API_KEY;

    const { startServer } = require('../server');
    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    try {
        await check('(c) GET /app/ is HTML and loads generated scripts', async () => {
            const res = await fetch(`${base}/app/`);
            assert.strictEqual(res.status, 200, 'GET /app/ status');
            const ct = res.headers.get('content-type') || '';
            assert.ok(ct.includes('text/html'), 'GET /app/ content-type html, got ' + ct);
            const html = await res.text();
            assert.ok(
                html.includes('generated/templates-data.js'),
                'index must reference generated/templates-data.js'
            );
            assert.ok(
                html.includes('generated/engine.js'),
                'index must reference generated/engine.js'
            );
        });

        await check('(c) GET /app/generated/engine.js → JS with HidookEngine', async () => {
            const res = await fetch(`${base}/app/generated/engine.js`);
            assert.strictEqual(res.status, 200, 'engine.js status');
            const ct = res.headers.get('content-type') || '';
            assert.ok(
                ct.includes('javascript') || ct.includes('ecmascript'),
                'engine.js must be JS content-type, got ' + ct + ' (SPA HTML fallback would blank the builder)'
            );
            const body = await res.text();
            assert.ok(!body.trimStart().startsWith('<!'), 'engine.js must not be HTML fallback');
            assert.ok(body.includes('HidookEngine'), 'engine.js body missing HidookEngine');
        });

        await check('(c) GET /app/generated/templates-data.js → JS with HIDOOK_TEMPLATES', async () => {
            const res = await fetch(`${base}/app/generated/templates-data.js`);
            assert.strictEqual(res.status, 200, 'templates-data.js status');
            const ct = res.headers.get('content-type') || '';
            assert.ok(
                ct.includes('javascript') || ct.includes('ecmascript'),
                'templates-data.js must be JS content-type, got ' + ct
            );
            const body = await res.text();
            assert.ok(!body.trimStart().startsWith('<!'), 'templates-data.js must not be HTML fallback');
            assert.ok(body.includes('HIDOOK_TEMPLATES'), 'templates-data.js body missing HIDOOK_TEMPLATES');
        });
    } finally {
        await new Promise((r) => srv.close(r));
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
    }

    if (failed) {
        console.error('\nbuilder-boot.test.js: FAILED');
        process.exit(1);
    }
    console.log('\nbuilder-boot.test.js: all checks passed');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
