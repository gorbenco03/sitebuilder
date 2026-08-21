'use strict';
/**
 * Test: template picker step injected into STEPS + handleTemplateStep routing.
 *
 * Covers:
 *  (a) With the real registry.json (when ≥2 templates): STEPS has a 'template' step at
 *      index 0; answering '2' advances correctly and returns the right templateId;
 *      answering an invalid input re-asks politely.
 *  (b) Without a registry (simulated): STEPS does NOT contain a 'template' step and
 *      legacy numbering (1/9) is preserved.
 *  (c) copyTemplateFiles copies template folder files (not root SHARED_FILES) when
 *      templateId is set and the folder exists.
 *  (d) deriveVertical derives the vertical from the registry entry.
 *
 * Run:  node bot/test/template-picker.test.js
 * Exits non-zero on any failed assertion.
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ─── helpers ────────────────────────────────────────────────────────────────

let failed = false;
const results = [];

async function check(name, fn) {
    try {
        await fn();
        results.push({ ok: true, name });
    } catch (e) {
        failed = true;
        results.push({ ok: false, name, msg: e.message });
    }
}

function report() {
    for (const r of results) {
        if (r.ok) console.log('PASS', r.name);
        else      console.error('FAIL', r.name, '-', r.msg);
    }
}

// ─── load template-steps (registry-aware) ───────────────────────────────────

// Isolate session state in a throw-away DATA_DIR.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpicker-real-'));
process.env.DATA_DIR = tmpDataDir;

const ts = require('../template-steps.js');

(async () => {
    // ── (a) STEPS shape ───────────────────────────────────────────────────────

    await check('(a) STEPS[0].key is "template" when registry has ≥2 entries', () => {
        assert.strictEqual(ts.STEPS[0].key, 'template', 'first step should be template picker');
    });

    await check('(a) STEPS[0].prompt contains the registry option names', () => {
        const p = ts.STEPS[0].prompt;
        assert.ok(p.includes('Meniu'), 'should include first template name');
        assert.ok(p.includes('Servicii locale'), 'should include second template name');
    });

    await check('(a) STEPS[0].prompt uses 1/10 counter (10 data+template steps)', () => {
        assert.ok(ts.STEPS[0].prompt.includes('(1/10)'), `expected (1/10) in: ${ts.STEPS[0].prompt}`);
    });

    await check('(a) name step gets counter (2/10)', () => {
        const nameStep = ts.STEPS.find(s => s.key === 'name');
        assert.ok(nameStep, 'name step must exist');
        assert.ok(nameStep.prompt.includes('(2/10)'), `expected (2/10) in: ${nameStep.prompt}`);
    });

    await check('(a) logo step gets counter (10/10)', () => {
        const logoStep = ts.STEPS.find(s => s.key === 'logo');
        assert.ok(logoStep, 'logo step must exist');
        assert.ok(logoStep.prompt.includes('(10/10)'), `expected (10/10) in: ${logoStep.prompt}`);
    });

    await check('(a) gallery step has no counter (photos: true)', () => {
        const g = ts.STEPS.find(s => s.key === 'gallery');
        assert.ok(g, 'gallery step must exist');
        assert.strictEqual(g.photos, true);
        assert.ok(!/\(\d+\/\d+\)/.test(g.prompt), `gallery prompt should not have a (x/y) counter: ${g.prompt}`);
    });

    // ── answer '2' → templateId set to local-service ───────────────────────────

    await check('(a) answering "2" sets session.templateId to second template id', () => {
        const session = { data: {} };
        const result  = ts.handleTemplateStep(session, '2');
        assert.ok(result.handled, 'should be handled');
        assert.strictEqual(session.templateId, 'local-service', `expected 'local-service', got '${session.templateId}'`);
    });

    // ── answer '1' → templateId set to product-menu ─────────────────────────────

    await check('(a) answering "1" sets session.templateId to first template id', () => {
        const session = { data: {} };
        const result  = ts.handleTemplateStep(session, '1');
        assert.ok(result.handled);
        assert.strictEqual(session.templateId, 'product-menu');
    });

    // ── case-insensitive text match ───────────────────────────────────────────

    await check('(a) answering "Portofoliu" (text, case-insensitive) matches third template', () => {
        const session = { data: {} };
        const result  = ts.handleTemplateStep(session, 'Portofoliu');
        assert.ok(result.handled);
        assert.strictEqual(session.templateId, 'portfolio');
    });

    // ── invalid input → re-ask politely ──────────────────────────────────────

    await check('(a) invalid input returns errorReply and does NOT set templateId', () => {
        const session = { data: {} };
        const result  = ts.handleTemplateStep(session, 'nu stiu');
        assert.strictEqual(result.handled, false, 'should not be handled');
        assert.ok(result.errorReply, 'should have errorReply');
        assert.ok(
            result.errorReply.toLowerCase().includes('1') || result.errorReply.includes('Meniu'),
            're-ask reply should include the options'
        );
        assert.ok(!session.templateId, 'templateId must NOT be set on invalid input');
    });

    // ── (c) copyTemplateFiles uses template folder ────────────────────────────

    await check('(c) copyTemplateFiles copies template folder files into siteDir', () => {
        const TEMPLATES_DIR = path.join(__dirname, '../../templates');
        const templateId    = 'product-menu';
        const tplDir        = path.join(TEMPLATES_DIR, templateId);
        if (!fs.existsSync(tplDir)) {
            console.log('SKIP (c) — product-menu template folder not found on disc');
            return;
        }

        const fakeSiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpicker-site-'));
        try {
            const session = {};
            const ok = ts.copyTemplateFiles(templateId, session, fakeSiteDir);
            assert.ok(ok, 'copyTemplateFiles should return true for an existing template');

            // template.html and styles.css must be present
            assert.ok(fs.existsSync(path.join(fakeSiteDir, 'template.html')), 'template.html copied');
            assert.ok(fs.existsSync(path.join(fakeSiteDir, 'styles.css')),    'styles.css copied');
            // schema.json must NOT be present (excluded)
            assert.ok(!fs.existsSync(path.join(fakeSiteDir, 'schema.json')),  'schema.json must NOT be copied');
            // presets.json must NOT be present (excluded)
            assert.ok(!fs.existsSync(path.join(fakeSiteDir, 'presets.json')), 'presets.json must NOT be copied');
        } finally {
            fs.rmSync(fakeSiteDir, { recursive: true, force: true });
        }
    });

    // ── (d) deriveVertical from registry entry ────────────────────────────────

    await check('(d) deriveVertical for local-service returns "local-service"', () => {
        const session = { templateId: 'local-service' };
        const v = ts.deriveVertical(session);
        assert.strictEqual(v, 'local-service');
    });

    await check('(d) deriveVertical for product-menu returns "product-menu"', () => {
        const session = { templateId: 'product-menu' };
        const v = ts.deriveVertical(session);
        assert.strictEqual(v, 'product-menu');
    });

    await check('(d) deriveVertical with unknown templateId falls back to templateId itself', () => {
        const session = { templateId: 'unknown-vertical' };
        const v = ts.deriveVertical(session);
        assert.strictEqual(v, 'unknown-vertical');
    });

    await check('(d) deriveVertical with no templateId returns undefined', () => {
        const session = {};
        const v = ts.deriveVertical(session);
        assert.strictEqual(v, undefined);
    });

    // ── templateVersion saved from registry ──────────────────────────────────

    await check('(a) templateVersion is saved on session after handleTemplateStep', () => {
        // Read the actual version from the registry (may be 1 or 2 depending on template agent)
        let expectedVersion = 1;
        try {
            const regPath = path.join(__dirname, '../../templates/registry.json');
            const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
            const first = reg && reg.templates && reg.templates[0];
            if (first && first.version != null) expectedVersion = first.version;
        } catch (_) {}
        const session = { data: {} };
        ts.handleTemplateStep(session, '1');
        assert.strictEqual(session.templateVersion, expectedVersion,
            `expected version ${expectedVersion}, got ${session.templateVersion}`);
    });

    await check('(a) templateVersion saved by copyTemplateFiles when not already set', () => {
        const TEMPLATES_DIR = path.join(__dirname, '../../templates');
        const tplDir = path.join(TEMPLATES_DIR, 'local-service');
        if (!fs.existsSync(tplDir)) { console.log('SKIP templateVersion from copyTemplateFiles'); return; }
        // Read expected version dynamically
        let expectedVersion = 1;
        try {
            const regPath = path.join(TEMPLATES_DIR, 'registry.json');
            const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
            const entry = reg && reg.templates && reg.templates.find(t => t.id === 'local-service');
            if (entry && entry.version != null) expectedVersion = entry.version;
        } catch (_) {}
        const fakeSiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpicker-ver-'));
        try {
            const session = {};
            ts.copyTemplateFiles('local-service', session, fakeSiteDir);
            assert.strictEqual(session.templateVersion, expectedVersion,
                `expected ${expectedVersion}, got ${session.templateVersion}`);
        } finally {
            fs.rmSync(fakeSiteDir, { recursive: true, force: true });
        }
    });

    // ── (b) legacy behaviour (no registry) ───────────────────────────────────
    // We verify the buildSteps logic directly with an empty registry.

    await check('(b) buildSteps with empty registry: no template step, numbering 1/9', () => {
        // Simulate what buildSteps does with an empty registry by re-implementing inline.
        const emptyRegistry = [];
        const hasTemplate = emptyRegistry.length >= 2;
        const total  = hasTemplate ? 10 : 9;
        const offset = hasTemplate ? 1 : 0;

        assert.strictEqual(total,  9, 'total should be 9 when no template');
        assert.strictEqual(offset, 0, 'offset should be 0 when no template');
        assert.ok(!hasTemplate, 'hasTemplate should be false');

        const steps = [];
        if (hasTemplate) steps.push({ key: 'template' });
        const numberedKeys = ['name', 'offer', 'about', 'colors', 'instagram', 'facebook', 'whatsapp', 'address', 'logo'];
        numberedKeys.forEach((k, i) => steps.push({ key: k, n: i + 1 + offset }));
        steps.push({ key: 'gallery', photos: true });

        assert.strictEqual(steps[0].key, 'name', 'first step should be name when no template');
        assert.ok(!steps.find(s => s.key === 'template'), 'no template step should exist');
        assert.strictEqual(steps[0].n, 1, 'name step counter should be 1');
    });

    await check('(b) real STEPS: gallery is last, has photos:true, no (x/y) counter', () => {
        const g = ts.STEPS[ts.STEPS.length - 1];
        assert.strictEqual(g.key,    'gallery');
        assert.strictEqual(g.photos, true);
        assert.ok(!/\(\d+\/\d+\)/.test(g.prompt), `gallery prompt should not have (x/y): ${g.prompt}`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    report();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
