'use strict';
/**
 * Flow 2 seed-QA regression oracle.
 *
 * Locks Romanian customer-visible builder chrome and verifies that every catalog
 * preview renders its first preset with recognisable seed content and photos.
 *
 * Run: node bot/test/flow2-seed-qa-chrome.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderHtml } = require('../../build.js');
const { makeLocalSeedImagesEager } = require('../webpublish.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractFunction(src, name) {
    const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
    if (!start) return '';
    let index = start.index + start[0].length;
    let depth = 1;
    while (index < src.length && depth > 0) {
        const char = src[index++];
        if (char === '{') depth++;
        else if (char === '}') depth--;
    }
    return src.slice(start.index, index);
}

let failed = 0;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (error) {
        failed++;
        console.error('FAIL', name, '-', error.message);
    }
}

const appSrc = read('builder/app.js');
const appCss = read('builder/app.css');
const overlaySrc = read('builder/edit-overlay.js');
const indexHtml = read('builder/index.html');
const professionalsTemplate = read('templates/professionals/template.html');
const professionalsScript = read('templates/professionals/script.js');
const professionalsPresetsSrc = read('templates/professionals/presets.json');

check('builder chrome contains no known English QA leaks', () => {
    const forbidden = [
        'Preview:',
        'Preview unavailable',
        'Loading your projects',
        'Replace photo',
        'Instagram is live on your site',
        'Instagram connected.',
        '+ Add',
        'Sign in to download your draft as HTML.',
        'HTML downloaded.',
        'Version ',
        '>Restore<',
        'Restore</button>',
        'Version restored successfully!',
        'Payment cancelled.',
        'Your sign-in link has expired',
        'Payment processed! Your site will be published',
    ];
    const source = appSrc + '\n' + overlaySrc + '\n' + indexHtml;
    for (const phrase of forbidden) {
        assert.ok(!source.includes(phrase), `customer-visible English remains: ${phrase}`);
    }
    assert.ok(!/link magic/i.test(indexHtml), 'customer-visible auth still says link magic');
    assert.ok(!indexHtml.includes('vezi preview.'), 'landing hero still says vezi preview');
    assert.ok(!source.includes('Preview-ul live'), 'Details hint still says Preview-ul live');

    const partnerNote = indexHtml.match(/id="ig-partner-note"[^>]*>([\s\S]*?)<\/p>/i);
    assert.ok(partnerNote, 'Instagram partner note exists');
    assert.ok(!partnerNote[1].includes('(watermark)'), 'partner note still says watermark');

    assert.ok(appSrc.includes('Previzualizare:'), 'preview modal title is Romanian');
    assert.ok(overlaySrc.includes('Înlocuiește fotografia'), 'photo overlay label is Romanian');
    assert.ok(indexHtml.includes('vezi previzualizarea.'), 'landing uses Previzualizare wording');
    assert.ok(indexHtml.includes('apoi Instafidget Free (filigran)'), 'partner note uses filigran');
    for (const phrase of [
        'Plata a fost anulată.',
        'Linkul de autentificare a expirat. Încearcă din nou.',
        'Plata a fost procesată. Site-ul tău va fi publicat în câteva momente.',
    ]) {
        assert.ok(appSrc.includes(phrase), `Romanian return toast is missing: ${phrase}`);
    }
});

check('Istoric loading, empty, and restore states are Romanian', () => {
    for (const phrase of ['Loading…', 'Restoring…', 'No saved versions yet.', 'Error restoring:']) {
        assert.ok(!appSrc.includes(phrase), `Istoric customer-visible English remains: ${phrase}`);
    }
    for (const phrase of ['Se încarcă…', 'Se restabilește…', 'Nu există versiuni salvate.']) {
        assert.ok(appSrc.includes(phrase), `Istoric Romanian state is missing: ${phrase}`);
    }
    assert.ok(appSrc.includes('Eroare la restabilire:'), 'restore error is not Romanian');
});

check('catalog preview opens visibly before assigning rendered first-preset HTML', () => {
    const fn = extractFunction(appSrc, 'openPreviewModal');
    assert.ok(fn, 'openPreviewModal exists');
    const openAt = fn.indexOf("openModal('modal-preview')");
    const loadAt = fn.indexOf('await ensureTemplateLoaded(templateId)');
    const renderAt = fn.indexOf('window.HidookEngine.renderPreview(tplData.files, config)');
    const assignAt = fn.indexOf('iframe.srcdoc = html');
    assert.ok(openAt >= 0 && openAt < loadAt, 'preview iframe must be visible before heavy load/render');
    assert.ok(renderAt > loadAt, 'preview uses HidookEngine.renderPreview after payload load');
    assert.ok(assignAt > renderAt, 'rendered first-preset HTML is assigned to the modal iframe');
    assert.ok(!fn.includes('Previzualizarea nu este disponibilă'), 'blank/unavailable preview body remains');
});

check('connected Instafidget editor is never described as unavailable locally', () => {
    assert.ok(
        !appSrc.includes('nu este disponibil în mediul local'),
        'connected Instafidget editor remains unavailable in local mode'
    );
    assert.ok(
        appSrc.includes('Editorul este pregătit și se va deschide într-un tab nou.'),
        'ready/new-tab status is missing'
    );
    const connect = extractFunction(appSrc, 'connectInstagram');
    assert.ok(connect, 'connectInstagram exists');
    assert.ok(
        /instagramEditorUrl\s*=\s*String\(\(session\s*&&\s*session\.editorUrl\)\s*\|\|\s*['"]['"]\)/.test(connect),
        'connect path does not retain the returned Instafidget editor URL'
    );
    assert.ok(
        /btn-ig-editor[\s\S]{0,500}disabled\s*=\s*!instagramEditorUrl/.test(connect),
        'connect path does not enable the open-editor control'
    );
});

check('all five preset catalogs and publish collision chrome are Romanian', () => {
    assert.ok(
        !appSrc.includes('That address is already taken'),
        'publish slug collision message is still English'
    );

    const templateIds = ['professionals', 'local-service', 'portfolio', 'product-menu', 'desserdirina'];
    const forbidden = [
        'Whitfield Law',
        'Northline Consulting',
        'Ridgeline',
        'OSHA',
        'ConstTop',
        'Manchester',
        'Salford',
        'New York',
        '+44',
        'London',
        'Londra',
        'Romford',
        'Austin',
        'Williamsburg',
        'Brooklyn',
        'NY 11249',
        '+1 917',
        'Chloe Bennett',
        'Dana Park',
        'Lauren Marsh',
        'de la $',
        '$55',
        '$60',
        '$75',
    ];
    for (const templateId of templateIds) {
        const presets = JSON.parse(read(`templates/${templateId}/presets.json`)).presets || [];
        for (const preset of presets) {
            const surface = JSON.stringify({ name: preset.name, config: preset.config });
            for (const leftover of forbidden) {
                assert.ok(
                    !surface.includes(leftover),
                    `${templateId}/${preset.id || preset.name}: leftover customer seed: ${leftover}`
                );
            }
        }
    }

    const professionalDefault = JSON.parse(professionalsPresetsSrc).presets[0];
    assert.ok(professionalDefault && professionalDefault.config, 'professionals default preset exists');
    assert.ok(
        !/\b(?:Law|Consulting)\b/i.test(professionalDefault.config.business.name),
        'professionals default still uses an English law/consulting brand'
    );

    const localDefault = JSON.parse(read('templates/local-service/presets.json')).presets[0];
    assert.ok(localDefault && localDefault.config, 'local-service default preset exists');
    assert.ok(
        !/Ridgeline/i.test(localDefault.config.business.name),
        'local-service default still uses the Ridgeline brand'
    );
});

check('publish address validation is Romanian', () => {
    assert.ok(
        !appSrc.includes('Address must be at least 3 characters'),
        'publish address minimum-length message is still English'
    );
    assert.ok(
        !appSrc.includes('Enter a valid address (at least 3 characters).'),
        'publish continue address validation is still English'
    );
    const romanianMinimumLength = 'Adresa trebuie să aibă cel puțin 3 caractere (litere mici, cifre, cratime).';
    assert.strictEqual(
        appSrc.split(romanianMinimumLength).length - 1,
        2,
        'both publish address minimum-length writers use the same Romanian copy'
    );
});

check('Instagram reconnect opens a persisted connected panel and Romanian statuses', () => {
    assert.ok(indexHtml.includes('id="ig-connected-panel"'), 'connected Instagram panel is missing');
    assert.ok(indexHtml.includes('id="btn-ig-editor"'), 'Instafidget editor control is missing');
    assert.ok(
        /instagram\.embedUrl[\s\S]{0,800}ig-connected-panel/.test(appSrc) ||
        /ig-connected-panel[\s\S]{0,800}instagram\.embedUrl/.test(appSrc),
        'persisted Instagram embed is not used to select the connected panel'
    );
    const editorOpens = [
        ['openInstagramEditor', 'instagramEditorUrl'],
        ['connectInstagram', 'session\\.editorUrl'],
    ];
    for (const [functionName, editorUrl] of editorOpens) {
        const fn = extractFunction(appSrc, functionName);
        assert.ok(fn, `${functionName} exists`);
        assert.ok(
            new RegExp(`window\\.open\\(\\s*${editorUrl}\\s*,\\s*['_"]_blank['_"]\\s*\\)`).test(fn),
            `${functionName} does not open Instafidget in a normal same-browser tab without window features`
        );
        assert.ok(
            !new RegExp(`window\\.open\\(\\s*${editorUrl}\\s*,\\s*['_"]_blank['_"]\\s*,`).test(fn),
            `${functionName} passes a prohibited third windowFeatures argument`
        );
        assert.ok(/\.opener\s*=\s*null/.test(fn), `${functionName} does not isolate the opener`);
    }
    for (const phrase of [
        'Sign in to connect Instagram.',
        'Connecting Instagram…',
        'Could not prepare Instagram',
        'Once you finish connecting',
    ]) {
        assert.ok(!appSrc.includes(phrase), `Instagram status remains English: ${phrase}`);
    }
});

check('hero replace-photo control owns the top hit target', () => {
    assert.ok(
        /\.hb-bg-btn[\s\S]{0,700}z-index:\s*2147483647/.test(overlaySrc),
        'hero replace-photo control does not have an unambiguous top layer'
    );
    assert.ok(
        /\.hb-bg-wrap:hover\s*>\s*\.hb-bg-btn[\s\S]{0,160}pointer-events:\s*auto/.test(overlaySrc),
        'hero replace-photo control is not the direct clickable hover target'
    );
    assert.ok(
        /resolvedPath\s*=\s*['"]hero\.background['"]/.test(overlaySrc),
        'hero background path has no deterministic click fallback'
    );
});

check('gallery replace-photo control owns the top hit target', () => {
    assert.ok(
        /\.hb-img-btn[\s\S]{0,700}z-index:\s*2147483647/.test(overlaySrc),
        'gallery replace-photo control does not have an unambiguous top layer'
    );
    assert.ok(
        /\.hb-img-wrap:hover\s*>\s*\.hb-img-btn[\s\S]{0,160}pointer-events:\s*auto/.test(overlaySrc),
        'gallery replace-photo control is not the direct clickable hover target'
    );
    assert.ok(
        /\.hb-img-wrap\s*>\s*img[\s\S]{0,140}position:\s*relative[\s\S]{0,80}z-index:\s*0/.test(overlaySrc),
        'wrapped gallery photo is not pinned below the replace-photo control'
    );
    const setupImages = extractFunction(overlaySrc, 'setupImages');
    assert.ok(
        /toParent\(\{\s*hb:\s*['"]image['"],\s*path:\s*resolvedPath,\s*src:/.test(setupImages),
        'gallery click does not send its source for parent-side path recovery'
    );
    assert.ok(
        /onImageChangeRequest\(msg\.path,\s*msg\.src\)/.test(appSrc),
        'parent does not receive the image source fallback'
    );
    const imageRequest = extractFunction(appSrc, 'onImageChangeRequest');
    assert.ok(/resolveImagePathFromSrc\(src\)/.test(imageRequest), 'parent cannot recover a missing image path');
});

check('cabinet cancellation requires explicit Romanian confirmation', () => {
    const cancelHandler = appSrc.match(/cancelBtn\.addEventListener\('click',[\s\S]*?actions\.appendChild\(cancelBtn\)/);
    assert.ok(cancelHandler, 'cancel button handler exists');
    const source = cancelHandler[0];
    const confirmAt = source.indexOf('window.confirm(');
    const portalAt = source.indexOf('/billing-portal');
    assert.ok(confirmAt >= 0, 'cancel button has no explicit confirmation');
    assert.ok(portalAt > confirmAt, 'billing portal is reached before confirmation');
    assert.ok(/Sigur|confirm|anulezi|anularea/i.test(source), 'confirmation copy is not understandable Romanian');
});

check('all five Details schemas use the Romanian preview hint', () => {
    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const schema = JSON.parse(read(`templates/${entry.id}/schema.json`));
        const fields = (schema.sections || []).flatMap((section) => section.fields || []);
        const background = fields.find((field) => field.key === 'hero.background');
        assert.ok(background, `${entry.id}: hero background field exists`);
        assert.strictEqual(
            background.hint,
            'Alege o culoare și opțional o poză. Previzualizarea live se actualizează imediat.',
            `${entry.id}: hero background hint is Romanian`
        );
    }
});

check('opened local-service and all professionals seeds use Romanian contact details', () => {
    const localFirst = JSON.parse(read('templates/local-service/presets.json')).presets[0];
    assert.ok(localFirst && localFirst.config, 'local-service first preset exists');
    const localSurface = JSON.stringify(localFirst);
    for (const leftover of ['Austin', '512-555', 'Ridgeline Renovations — Austin']) {
        assert.ok(!localSurface.includes(leftover), `local-service US seed remains: ${leftover}`);
    }
    assert.ok(/București|Ilfov/.test(localSurface), 'local-service default uses București / Ilfov');
    assert.ok(/\+40|407/.test(localSurface), 'local-service default uses a Romanian phone');

    const professionalPresets = JSON.parse(professionalsPresetsSrc).presets || [];
    const professionalFirst = professionalPresets[0];
    assert.ok(professionalFirst && professionalFirst.config, 'professionals first preset exists');
    const professionalSurface = JSON.stringify(professionalFirst);
    assert.ok(!professionalSurface.includes('New York, NY'), 'professionals default still names New York');
    assert.ok(!professionalSurface.includes('123 Main Street'), 'professionals default still uses US address');
    assert.ok(professionalSurface.includes('București'), 'professionals default uses București');

    for (const preset of professionalPresets) {
        const surface = JSON.stringify(preset);
        assert.ok(!surface.includes('123 Main Street'), `${preset.id}: US street address remains`);
        assert.ok(!surface.includes('New York, NY 10001'), `${preset.id}: New York address remains`);
    }

    const cabinetMarinRo = professionalPresets.find((preset) => preset.id === 'cabinet-marin-ro');
    assert.ok(cabinetMarinRo && cabinetMarinRo.config, 'cabinet-marin-ro preset exists');
    assert.ok(
        cabinetMarinRo.config.contact.address.includes('București'),
        'cabinet-marin-ro contact address uses București'
    );

    const atelierNord = professionalPresets.find((preset) => preset.id === 'atelier-nord');
    assert.ok(atelierNord && atelierNord.config, 'atelier-nord preset exists');
    assert.ok(!/Austin(?:, TX)?/i.test(JSON.stringify(atelierNord)), 'atelier-nord still names Austin');
});

check('professional booking chrome and presets are Romanian', () => {
    const source = professionalsTemplate + '\n' + professionalsScript + '\n' + professionalsPresetsSrc;
    assert.ok(!source.includes(' · office'), 'office mode remains customer-visible');
    assert.ok(!source.includes(' · phone'), 'phone mode remains customer-visible');
    assert.ok(!professionalsScript.includes("DateTimeFormat('en-US'"), 'day chips still use en-US');

    const presets = JSON.parse(professionalsPresetsSrc).presets || [];
    const allowedModes = new Set(['cabinet', 'telefon', 'online']);
    for (const preset of presets) {
        const types = (((preset || {}).config || {}).appointment || {}).types || [];
        for (const type of types) {
            assert.ok(
                allowedModes.has(type.mode),
                `${preset.id || preset.name}: booking mode is not Romanian: ${type.mode}`
            );
        }
    }
});

check('390px account email stays one ellipsized token', () => {
    const mobileHeader = appCss.match(/\/\* 390 cabinet[\s\S]*?\/\* ---------- Editor Topbar/);
    assert.ok(mobileHeader, 'mobile cabinet header rules exist');
    assert.ok(/white-space:\s*nowrap/.test(mobileHeader[0]), 'email must not wrap mid-domain');
    assert.ok(/overflow:\s*hidden/.test(mobileHeader[0]), 'tight email is clipped safely');
    assert.ok(/text-overflow:\s*ellipsis/.test(mobileHeader[0]), 'tight email uses an ellipsis');
    assert.ok(!/overflow-wrap:\s*anywhere/.test(mobileHeader[0]), 'email must not shred at arbitrary letters');
});

check('all five first presets render seed content and local photography', () => {
    const engineSrc = read('builder/generated/engine.js');
    const sandbox = { window: {}, console };
    vm.runInNewContext(engineSrc, sandbox);
    const engine = sandbox.window.HidookEngine;
    assert.ok(engine && typeof engine.renderPreview === 'function', 'generated preview engine exists');

    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const id = entry.id;
        const dir = `templates/${id}`;
        const presets = JSON.parse(read(`${dir}/presets.json`)).presets || [];
        assert.ok(presets[0] && presets[0].config, `${id}: first preset exists`);
        const config = presets[0].config;
        const files = {
            templateHtml: read(`${dir}/template.html`),
            stylesCss: read(`${dir}/styles.css`),
            scriptJs: read(`${dir}/script.js`),
            imageMap: {},
        };
        const collagePath = path.join(ROOT, dir, 'collage.js');
        if (fs.existsSync(collagePath)) files.collageJs = fs.readFileSync(collagePath, 'utf8');
        const imageDir = path.join(ROOT, dir, 'images');
        if (fs.existsSync(imageDir)) {
            for (const name of fs.readdirSync(imageDir)) {
                files.imageMap[`images/${name}`] = `/app/generated/template-assets/${id}/images/${name}`;
            }
        }

        const html = engine.renderPreview(files, config);
        const businessName = String(((config || {}).business || {}).name || '').trim();
        assert.ok(businessName && html.includes(businessName), `${id}: preview omits seed business name`);
        assert.ok(!html.includes('{{'), `${id}: preview contains unresolved template tokens`);
        if (id !== 'professionals') {
            assert.ok(
                html.includes(`/app/generated/template-assets/${id}/images/`),
                `${id}: preview omits local photography`
            );
        }
        assert.ok(html.includes('data-hidook-preview'), `${id}: deterministic preview visibility CSS missing`);
    }
});

check('all five published first presets eagerly load reachable same-origin seed photos', () => {
    assert.strictEqual(
        typeof makeLocalSeedImagesEager,
        'function',
        'isolated publish has no local seed-photo normalizer'
    );
    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const dir = `templates/${entry.id}`;
        const config = JSON.parse(read(`${dir}/presets.json`)).presets[0].config;
        const rendered = renderHtml(read(`${dir}/template.html`), config);
        const liveHtml = makeLocalSeedImagesEager(rendered);
        const imgTags = liveHtml.match(/<img\b[^>]*>/gi) || [];
        const localTags = imgTags.filter((tag) => /\bsrc=["']images\//i.test(tag));
        assert.ok(localTags.length > 0 || entry.id === 'professionals', `${entry.id}: no local seed <img> found`);
        for (const tag of localTags) {
            const src = tag.match(/\bsrc=["']([^"']+)["']/i)[1];
            assert.ok(fs.existsSync(path.join(ROOT, dir, src)), `${entry.id}: missing published asset ${src}`);
            assert.ok(!/\bloading=["']lazy["']/i.test(tag), `${entry.id}: ${src} can remain naturalWidth=0`);
            assert.ok(/\bloading=["']eager["']/i.test(tag), `${entry.id}: ${src} is not eager in live HTML`);
        }
    }
});

if (failed) {
    console.error(`\nflow2-seed-qa-chrome.test.js: ${failed} failure(s)`);
    process.exit(1);
}
console.log('\nflow2-seed-qa-chrome.test.js: all checks passed');
