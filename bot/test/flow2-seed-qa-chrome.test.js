'use strict';
/**
 * Flow 2 seed-QA regression oracle.
 *
 * Locks Romanian customer-visible builder chrome and verifies that every catalog
 * preview renders its first preset with recognisable seed content and photos.
 *
 * STALE ORACLE RECONCILE (S-legacy G1, 2026-09-05):
 * Instagram connected-panel selection moved from an inline draft.config.instagram.embedUrl
 * probe next to ig-connected-panel into connectedInstagramEmbedUrl() used by
 * syncInstagramModalPanels. The old 800-char proximity lock between the string
 * "instagram.embedUrl" and "ig-connected-panel" is no longer a valid contract signal.
 * Assertion now requires the helper + panel wiring. Not a stranger product defect.
 *
 * Form editor removed 2026-10-28: checks of the deleted editor (colour presets,
 * image-chooser plumbing and edit-overlay hit targets, edit preview via the
 * generated engine, preview modal, Instagram modal and its statuses, publish
 * step-1 address validation, stale-toast on start) were dropped. Catalog, sign-in
 * chrome, dashboard (Istoric, cancel), RO copy catalog, preset seed content and
 * published first presets are still covered.
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
const serverSrc = read('bot/server.js');
const indexHtml = read('builder/index.html');
const copyRoSrc = read('builder/copy-ro.js');

// PLAN-UX-2026-09-27 §5.8 (T-3): app.js now sources its Romanian toasts from
// the RO catalog (builder/copy-ro.js) instead of a literal at each call
// site — this reads the catalog's own value where this file used to assert
// a literal string was still in appSrc.
function copyRoValue(key) {
    const sandbox = {};
    vm.runInNewContext(copyRoSrc + '\nthis.RO = RO;', sandbox);
    if (!Object.prototype.hasOwnProperty.call(sandbox.RO, key)) throw new Error('RO.' + key + ' missing from builder/copy-ro.js');
    return sandbox.RO[key];
}
const professionalsTemplate = read('templates/professionals/template.html');
const professionalsScript = read('templates/professionals/script.js');
const professionalsPresetsSrc = read('templates/professionals/presets.json');

function collectEmailFields(value, trail = [], found = []) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectEmailFields(item, trail.concat(index), found));
    } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            const nextTrail = trail.concat(key);
            if (/email/i.test(key) && typeof item === 'string') {
                found.push({ path: nextTrail.join('.'), value: item });
            }
            collectEmailFields(item, nextTrail, found);
        }
    }
    return found;
}

check('seed phones are dialable in every preset and rendered call link', () => {
    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const schemaSrc = read(`templates/${entry.id}/schema.json`);
        const presetsSrc = read(`templates/${entry.id}/presets.json`);
        assert.ok(!schemaSrc.includes('****'), `${entry.id}: schema exposes a masked phone example`);
        assert.ok(!presetsSrc.includes('****'), `${entry.id}: preset contains a masked phone value`);

        const presets = JSON.parse(presetsSrc).presets || [];
        assert.ok(presets.length > 0, `${entry.id}: has at least one preset`);
        for (const preset of presets) {
            const html = renderHtml(read(`templates/${entry.id}/template.html`), preset.config);
            const telHrefs = Array.from(html.matchAll(/href=["'](tel:[^"']+)["']/gi), (match) => match[1]);
            assert.ok(telHrefs.length > 0, `${entry.id}/${preset.id || preset.name}: renders a call link`);
            for (const href of telHrefs) {
                assert.ok(!href.includes('*'), `${entry.id}/${preset.id || preset.name}: masked call link ${href}`);
                assert.match(href, /^tel:\+?[0-9]{10,}$/, `${entry.id}/${preset.id || preset.name}: broken call link ${href}`);
            }
        }
    }
});

check('customer-visible preset emails and professional renders never use reserved .example domains', () => {
    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const presets = JSON.parse(read(`templates/${entry.id}/presets.json`)).presets || [];
        for (const preset of presets) {
            const label = `${entry.id}/${preset.id || preset.name}`;
            for (const email of collectEmailFields(preset.config)) {
                assert.ok(
                    !/@[^\s@]+\.example(?:$|[/?#])/i.test(email.value),
                    `${label}: ${email.path} uses reserved email ${email.value}`
                );
            }

            if (entry.id === 'professionals') {
                const html = renderHtml(read('templates/professionals/template.html'), preset.config);
                const mailtoHrefs = Array.from(html.matchAll(/href=["']mailto:([^"']+)["']/gi), (match) => match[1]);
                for (const href of mailtoHrefs) {
                    assert.ok(!/\.example(?:$|[?&#])/i.test(href), `${label}: reserved mailto ${href}`);
                }
                const visibleText = html
                    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
                    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ');
                assert.ok(!/@[^\s<>@]+\.example\b/i.test(visibleText), `${label}: rendered visible email uses .example`);
            }
        }
    }
});

check('trial label uses customer-facing Romanian copy', () => {
    assert.ok(appSrc.includes('Trial de 14 zile'), 'cabinet trial label is missing ordinary Romanian spacing');
    for (const leak of ['7\u2011zile', '7-zile', '\\u2011zile']) {
        assert.ok(!appSrc.includes(leak), `cabinet trial label contains forbidden spelling: ${leak}`);
    }
});

check('catalog logo accessibility label is Romanian', () => {
    const catalogLogo = indexHtml.match(/<a\b[^>]*class="logo"[^>]*>/i);
    assert.ok(catalogLogo, 'catalog logo exists');
    assert.match(catalogLogo[0], /aria-label="[^"]*Acasă[^"]*"/i, 'catalog logo does not announce Acasă');
    assert.ok(!/aria-label="[^"]*Home[^"]*"/i.test(catalogLogo[0]), 'catalog logo still announces Home');
});

check('catalog grid accessibility label is Romanian', () => {
    const templatesGrid = indexHtml.match(/<div\b[^>]*id="templates-grid"[^>]*>/i);
    assert.ok(templatesGrid, 'catalog templates grid exists');
    assert.match(
        templatesGrid[0],
        /aria-label="Designuri disponibile"/i,
        'catalog templates grid does not have a Romanian label'
    );
    assert.ok(
        !/aria-label="[^"]*Available designs[^"]*"/i.test(templatesGrid[0]),
        'catalog templates grid still announces Available designs'
    );
});

check('catalog thumbnail accessibility text is Romanian', () => {
    const renderGrid = extractFunction(appSrc, 'renderTemplatesGrid');
    assert.ok(renderGrid, 'catalog grid renderer exists');
    assert.ok(
        /iframe\.title\s*=\s*'Previzualizare '\s*\+\s*pack\.label/.test(renderGrid),
        'catalog card preview iframe title must be "Previzualizare <design>"'
    );
    assert.ok(!/Design preview/.test(renderGrid) && !/\+\s*['"] preview['"]/.test(renderGrid), 'catalog preview text must not be English');
});

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
    const source = appSrc + '\n' + indexHtml;
    for (const phrase of forbidden) {
        assert.ok(!source.includes(phrase), `customer-visible English remains: ${phrase}`);
    }
    assert.ok(!/link magic/i.test(indexHtml), 'customer-visible auth still says link magic');
    assert.ok(!indexHtml.includes('vezi preview.'), 'landing hero still says vezi preview');
    assert.ok(!source.includes('Preview-ul live'), 'Details hint still says Preview-ul live');

    assert.ok(indexHtml.includes('vezi previzualizarea.'), 'landing uses Previzualizare wording');
    for (const key of ['PAYMENT_CANCELLED', 'LOGIN_LINK_EXPIRED', 'PAYMENT_PROCESSED_SITE_SOON']) {
        assert.ok(appSrc.includes('RO.' + key), `Romanian return toast no longer sourced from RO.${key}`);
    }
    assert.strictEqual(copyRoValue('PAYMENT_CANCELLED'), 'Plata a fost anulată.', 'PAYMENT_CANCELLED text is unchanged');
    assert.strictEqual(copyRoValue('LOGIN_LINK_EXPIRED'), 'Linkul de autentificare a expirat. Încearcă din nou.', 'LOGIN_LINK_EXPIRED text is unchanged');
    assert.strictEqual(copyRoValue('PAYMENT_PROCESSED_SITE_SOON'), 'Plata a fost procesată. Site-ul tău va fi publicat în câteva momente.', 'PAYMENT_PROCESSED_SITE_SOON text is unchanged');
});

check('professional presets and rendered pages use the bundled hero photograph', () => {
    const presets = JSON.parse(professionalsPresetsSrc).presets || [];
    assert.ok(presets.length > 0, 'professionals has presets');
    assert.ok(fs.existsSync(path.join(ROOT, 'templates/professionals/images/hero.jpg')), 'professional hero.jpg exists');
    for (const preset of presets) {
        const label = preset.id || preset.name;
        const background = String((((preset || {}).config || {}).hero || {}).background || '');
        assert.match(background, /url\(\s*['"]?images\/hero\.jpg['"]?\s*\)/, `${label}: hero background omits images/hero.jpg`);
        const html = renderHtml(professionalsTemplate, preset.config);
        assert.match(
            html,
            /url\(\s*(?:['"]|&#39;)?images\/hero\.jpg(?:['"]|&#39;)?\s*\)/,
            `${label}: rendered hero is gradient-only`
        );
    }
});

check('salon presets avoid awkward skin-service seed copy', () => {
    const source = read('templates/portfolio/presets.json');
    for (const phrase of ['Păr, piele și unghii', 'tratamente de piele']) {
        assert.ok(!source.includes(phrase), `salon customer seed still contains: ${phrase}`);
    }
});

check('publish slug collision copy is Romanian on the server', () => {
    const collisionCopy = 'Această adresă este deja folosită. Încearcă alta.';
    assert.ok(!appSrc.includes('That slug is already taken.'), 'builder can display raw English slug collision');
    assert.ok(!serverSrc.includes('That slug is already taken.'), 'publish API still emits raw English slug collision');
    assert.ok(serverSrc.includes(`error: '${collisionCopy}'`), 'publish API collision copy is missing');
});

check('Istoric loading, empty, and restore states are Romanian', () => {
    for (const phrase of ['Loading…', 'Restoring…', 'No saved versions yet.', 'Error restoring:']) {
        assert.ok(!appSrc.includes(phrase), `Istoric customer-visible English remains: ${phrase}`);
    }
    for (const phrase of ['Se încarcă…', 'Se restabilește…', 'Nu există versiuni salvate.']) {
        assert.ok(appSrc.includes(phrase), `Istoric Romanian state is missing: ${phrase}`);
    }
    // U-09 (PLAN-UX-2026-09-27 §5.8) replaced the old literal
    // 'Eroare la restabilire: ' + err.message (which could leak a raw
    // English browser/server string) with safeServerMessage()'s own fixed
    // Romanian fallback — still Romanian, never raw text now.
    assert.ok(appSrc.includes('RO.VERSION_RESTORE_FAILED'), 'restore error no longer sourced from RO.VERSION_RESTORE_FAILED');
    assert.strictEqual(copyRoValue('VERSION_RESTORE_FAILED'), 'Nu am putut restabili versiunea. Încearcă din nou.', 'restore error text is unchanged and Romanian');
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

check('cabinet cancellation requires explicit Romanian confirmation', () => {
    // U-01 (PLAN-UX-2026-09-27 §3): window.confirm() replaced by the
    // product's own modal — the click handler itself now only OPENS that
    // modal; the actual billing-portal call moved into a separate function
    // (confirmCancelSubscription) reachable only from the modal's own
    // confirm button, so the same "confirmation before portal" contract
    // this check locks now lives structurally instead of via a bare
    // window.confirm() string.
    const cancelHandler = appSrc.match(/cancelBtn\.addEventListener\('click',[\s\S]*?actions\.appendChild\(cancelBtn\)/);
    assert.ok(cancelHandler, 'cancel button handler exists');
    const handlerSrc = cancelHandler[0];
    assert.ok(/openCancelSubscriptionModal\(/.test(handlerSrc), 'cancel button opens the product\'s own confirmation modal');
    assert.ok(!/\/billing-portal/.test(handlerSrc), 'cancel button must not reach billing-portal directly — confirmation happens first, in the modal');

    const confirmFn = extractFunction(appSrc, 'confirmCancelSubscription');
    assert.ok(confirmFn, 'confirmCancelSubscription() exists');
    assert.ok(confirmFn.includes('/billing-portal'), 'billing portal is only reached from the modal\'s own confirm action');

    const modalStart = indexHtml.indexOf('id="modal-cancel-subscription"');
    assert.ok(modalStart >= 0, 'modal-cancel-subscription markup exists');
    const nextCommentAt = indexHtml.indexOf('<!-- =====', modalStart + 1);
    const modalMarkup = indexHtml.slice(modalStart, nextCommentAt === -1 ? modalStart + 2000 : nextCommentAt);
    assert.ok(/Sigur|confirm|anulezi|anularea/i.test(modalMarkup), 'confirmation copy is not understandable Romanian');
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
    const mobileHeader = appCss.match(/\/\* 390 cabinet[\s\S]*?\.header-nav \{/);
    assert.ok(mobileHeader, 'mobile cabinet header rules exist');
    assert.ok(/white-space:\s*nowrap/.test(mobileHeader[0]), 'email must not wrap mid-domain');
    assert.ok(/overflow:\s*hidden/.test(mobileHeader[0]), 'tight email is clipped safely');
    assert.ok(/text-overflow:\s*ellipsis/.test(mobileHeader[0]), 'tight email uses an ellipsis');
    assert.ok(!/overflow-wrap:\s*anywhere/.test(mobileHeader[0]), 'email must not shred at arbitrary letters');
});

check('all five first presets render seed content and local photography', () => {
    const registry = JSON.parse(read('templates/registry.json')).templates || [];
    assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
    for (const entry of registry) {
        const id = entry.id;
        const dir = `templates/${id}`;
        const presets = JSON.parse(read(`${dir}/presets.json`)).presets || [];
        assert.ok(presets[0] && presets[0].config, `${id}: first preset exists`);
        const config = presets[0].config;
        const html = renderHtml(read(`${dir}/template.html`), config);
        const businessName = String(((config || {}).business || {}).name || '').trim();
        assert.ok(businessName && html.includes(businessName), `${id}: render omits seed business name`);
        assert.ok(!html.includes('{{'), `${id}: render contains unresolved template tokens`);
        assert.ok(/(?:src=["']|url\(\s*(?:["']|&#39;)?)images\//i.test(html), `${id}: render omits local photography`);
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
        const localPhotoRefs = Array.from(
            liveHtml.matchAll(/(?:\bsrc=["']|url\(\s*(?:["']|&#39;)?)(images\/[^"')&\s]+)/gi),
            (match) => match[1]
        );
        assert.ok(localPhotoRefs.length > 0, `${entry.id}: no local seed photo found`);
        for (const src of localPhotoRefs) {
            assert.ok(fs.existsSync(path.join(ROOT, dir, src)), `${entry.id}: missing published asset ${src}`);
        }
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
