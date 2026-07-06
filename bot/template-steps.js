'use strict';
/**
 * bot/template-steps.js — Multi-vertical template registry + dynamic wizard STEPS.
 *
 * Extracted from the wizard flow so that flow.js stays minimal. Provides:
 *   - templateRegistry  — loaded from templates/registry.json at module load
 *   - STEPS             — wizard step array, dynamically prefixed with a template
 *                         picker step when ≥2 templates are registered
 *   - handleTemplateStep(session, text) → {handled, reply?, nextPrompt?}
 *                         — process the 'template' wizard step answer
 *   - deriveVertical(session) → string|undefined
 *                         — derive the vertical string for polishBusinessData
 *   - copyTemplateFiles(templateId, siteDir, TEMPLATES_DIR)
 *                         — copy template folder files (excl. schema/presets/md)
 *                           into siteDir; saves templateVersion on the session
 *
 * CommonJS, Node 18+, zero new npm dependencies.
 * All user-facing strings are in Romanian.
 */

const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT  = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'templates');

// ---------------------------------------------------------------------------
// Template registry — loaded defensively; missing/malformed → []
// ---------------------------------------------------------------------------

/** @type {Array<{id:string, name:string, vertical:string, description:string, version:number}>} */
let templateRegistry = [];

(function _load() {
    try {
        const raw     = fs.readFileSync(path.join(TEMPLATES_DIR, 'registry.json'), 'utf8');
        const parsed  = JSON.parse(raw);
        const entries = Array.isArray(parsed && parsed.templates) ? parsed.templates : [];
        if (entries.length >= 2) templateRegistry = entries;
    } catch (_) { /* silently keep [] */ }
})();

// ---------------------------------------------------------------------------
// Dynamic STEPS construction
// ---------------------------------------------------------------------------

const TEMPLATE_EXCLUDES = /^(schema\.json|presets\.json)$|\.md$/i;

/**
 * Build the wizard step array. When ≥2 templates are loaded, prepends a
 * template-picker step and shifts all numeric counters by +1.
 *
 * @returns {Array<{key:string, prompt:string, photo?:true, photos?:true}>}
 */
function buildSteps() {
    const hasTemplate = templateRegistry.length >= 2;
    const total  = hasTemplate ? 10 : 9;
    const offset = hasTemplate ? 1  : 0;

    const numbered = [
        { key: 'name',      n: 1 + offset, label: '🏪',  text: 'Cum se numește afacerea ta?' },
        { key: 'offer',     n: 2 + offset, label: '🛍️', text: 'Ce produse sau servicii oferi? Enumeră-le (fiecare pe linie nouă sau separate prin virgulă).' },
        { key: 'about',     n: 3 + offset, label: '📝',  text: 'Spune-mi pe scurt despre afacerea ta — ce o face specială? (1-3 propoziții, scrie cum îți vine; AI-ul le aranjează frumos)' },
        { key: 'colors',    n: 4 + offset, label: '🎨',  text: 'Ce culori ai vrea pentru site? (ex: roz și auriu, albastru elegant, verde natural, minimalist alb-negru...)' },
        { key: 'instagram', n: 5 + offset, label: '📸',  text: 'Instagram-ul tău (username @nume sau link), sau scrie „skip".' },
        { key: 'facebook',  n: 6 + offset, label: '👍',  text: 'Facebook (link sau nume pagină), sau „skip".' },
        { key: 'whatsapp',  n: 7 + offset, label: '💬',  text: 'Număr WhatsApp cu prefix de țară (ex: 373..., 40..., 44...), sau „skip".' },
        { key: 'address',   n: 8 + offset, label: '📍',  text: 'Adresa afacerii (sau „skip").' },
        { key: 'logo',      n: 9 + offset, label: '🖼️', text: 'Trimite LOGO-ul afacerii ca poză. Dacă nu ai logo, scrie „skip" (vom folosi numele afacerii).', photo: true },
    ];

    const steps = [];

    if (hasTemplate) {
        const optionLines = templateRegistry.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
        steps.push({
            key:    'template',
            prompt: `🧱 (1/${total}) Ce tip de afacere ai?\n\n${optionLines}\n\nRăspunde cu numărul sau cu numele tipului de afacere.`,
        });
    }

    for (const s of numbered) {
        const entry = { key: s.key, prompt: `${s.label} (${s.n}/${total}) ${s.text}` };
        if (s.photo) entry.photo = true;
        steps.push(entry);
    }

    steps.push({
        key:    'gallery',
        prompt: '🎂 Acum trimite 3-6 poze cu produsele/serviciile tale (una câte una). Când termini, scrie /gata și AI-ul construiește site-ul.',
        photos: true,
    });

    return steps;
}

/** The wizard steps array (built once at module load based on the registry). */
const STEPS = buildSteps();

// ---------------------------------------------------------------------------
// handleTemplateStep — process the 'template' wizard step
// ---------------------------------------------------------------------------

/**
 * Process a user answer for the 'template' wizard step.
 *
 * @param {object} session  — the flow session (mutated on success)
 * @param {string} text     — raw user input
 * @returns {{ handled: boolean, errorReply?: string, nextPrompt?: string }}
 *   handled=true  → input was valid; session.templateId + templateVersion set; nextPrompt is the next step text.
 *   handled=false → input was invalid; errorReply is the polite re-ask string.
 */
function handleTemplateStep(session, text) {
    const input = (text || '').trim();
    const num   = parseInt(input, 10);
    let matched = null;

    if (!isNaN(num) && num >= 1 && num <= templateRegistry.length) {
        matched = templateRegistry[num - 1];
    } else {
        const lower = input.toLowerCase();
        matched = templateRegistry.find(t =>
            t.name.toLowerCase().includes(lower) || (t.id && t.id.toLowerCase() === lower)
        );
    }

    if (!matched) {
        const opts = templateRegistry.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
        return {
            handled:    false,
            errorReply: `Nu am înțeles alegerea. Te rog răspunde cu numărul (1–${templateRegistry.length}) sau cu numele tipului:\n\n${opts}`,
        };
    }

    session.data            = session.data || {};
    session.data.template   = matched.id;
    session.templateId      = matched.id;
    session.templateVersion = matched.version != null ? matched.version : undefined;

    // Advance stepIndex and find the next prompt (caller already increments stepIndex)
    return { handled: true };
}

// ---------------------------------------------------------------------------
// deriveVertical — extract the vertical string for polishBusinessData
// ---------------------------------------------------------------------------

/**
 * Derive the AI polishing vertical from the session's chosen template.
 *
 * @param {object} session
 * @returns {string|undefined}
 */
function deriveVertical(session) {
    if (!session || !session.templateId) return undefined;
    const entry = templateRegistry.find(t => t.id === session.templateId);
    return (entry && entry.vertical) || session.templateId || undefined;
}

// ---------------------------------------------------------------------------
// copyTemplateFiles — copy template folder into siteDir
// ---------------------------------------------------------------------------

/**
 * Copy all non-excluded files from templates/<templateId>/ into siteDir.
 * Also saves the templateVersion onto the session when not already set.
 *
 * @param {string}  templateId
 * @param {object}  session     — mutated: sets session.templateVersion
 * @param {string}  siteDir
 * @returns {boolean} true if the template folder existed and files were copied
 */
function copyTemplateFiles(templateId, session, siteDir) {
    // Also record the version on the session (from registry) if not already set
    if (session && session.templateVersion == null) {
        const reg = templateRegistry.find(t => t.id === templateId);
        if (reg && reg.version != null) session.templateVersion = reg.version;
    }

    const templateDir = path.join(TEMPLATES_DIR, templateId);
    if (!fs.existsSync(templateDir)) return false;

    const entries = fs.readdirSync(templateDir);
    for (const entry of entries) {
        if (TEMPLATE_EXCLUDES.test(entry)) continue;
        const src  = path.join(templateDir, entry);
        const stat = fs.statSync(src);
        if (stat.isFile()) fs.copyFileSync(src, path.join(siteDir, entry));
    }
    return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    templateRegistry,
    buildSteps,
    STEPS,
    handleTemplateStep,
    deriveVertical,
    copyTemplateFiles,
};
