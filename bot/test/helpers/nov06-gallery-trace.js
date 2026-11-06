'use strict';

// Read-only native event diagnostics; never changes scrolling or control state.
async function installGalleryTrace(page) {
    await page.evaluate(() => {
        const deck = document.querySelector('.collage-deck');
        if (deck.__galleryTrace) return;
        const events = [];
        const snapshot = (type, event) => {
            const prev = document.querySelector('.collage-nav--prev');
            const next = document.querySelector('.collage-nav--next');
            const rect = deck.getBoundingClientRect();
            events.push({ type, time: performance.now(), left: deck.scrollLeft,
                max: deck.scrollWidth - deck.clientWidth, width: deck.clientWidth,
                top: rect.top, pageY: scrollY, ended: deck.__oracleScrollEnd?.count,
                prev: prev.disabled, next: next.disabled,
                target: event?.target?.className, key: event?.key,
                trusted: event?.isTrusted, x: event?.clientX, y: event?.clientY,
                nextRect: { top: next.getBoundingClientRect().top, bottom: next.getBoundingClientRect().bottom },
                focus: document.activeElement?.className });
            if (events.length > 2000) events.shift();
        };
        deck.__galleryTrace = { events, snapshot };
        document.addEventListener('scroll', e => snapshot('document-scroll', e));
        document.addEventListener('scrollend', e => snapshot('document-scrollend', e));
        for (const type of ['scroll', 'scrollend']) deck.addEventListener(type, e => snapshot(type, e));
        for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'focusin']) {
            document.addEventListener(type, e => snapshot(type, e), true);
        }
        new MutationObserver(() => snapshot('disabled')).observe(deck.parentElement, {
            subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden']
        });
        new ResizeObserver(() => snapshot('resize')).observe(deck);
        snapshot('installed');
    });
}

async function galleryTrace(page) {
    return page.evaluate(() => {
        const trace = document.querySelector('.collage-deck').__galleryTrace;
        trace.snapshot('readback');
        return trace.events;
    });
}

async function saveGalleryFailure(page, before, direction, error) {
    const fs = require('node:fs');
    const path = require('node:path');
    const out = path.resolve(__dirname, '../../../04-QA-Evidence/Implementation-2026-11-05/gallery-forward-recovery');
    fs.mkdirSync(out, { recursive: true });
    const name = `native-${process.pid}-${before.ended}-${direction}-wait-failed`;
    fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify({ before, direction,
        error: error.stack, events: await galleryTrace(page) }, null, 2));
    await page.screenshot({ path: path.join(out, name + '.png') });
}

module.exports = { installGalleryTrace, galleryTrace, saveGalleryFailure };
