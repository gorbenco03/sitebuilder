'use strict';

const { installGalleryTrace, saveGalleryFailure } = require('./nov06-gallery-trace.js');

// Place the gallery in view before focus can start an independent smooth page scroll.
async function prepareCarousel(page) {
    await page.locator('.collage-stage').scrollIntoViewIfNeeded();
}

// Observe before activation so even a short native smooth scroll is not missed.
async function observeCarousel(page) {
    await installGalleryTrace(page);
    return page.evaluate(() => {
        const deck = document.querySelector('.collage-deck');
        if (!deck.__oracleScrollEnd) {
            deck.__oracleScrollEnd = { count: 0 };
            deck.addEventListener('scrollend', () => { deck.__oracleScrollEnd.count++; });
        }
        return { left: deck.scrollLeft, ended: deck.__oracleScrollEnd.count };
    });
}

async function waitForCarouselStep(page, before, direction) {
    try {
        await page.waitForFunction(({ before, direction }) => {
            const deck = document.querySelector('.collage-deck');
            const prev = document.querySelector('.collage-nav--prev');
            const next = document.querySelector('.collage-nav--next');
            const max = deck.scrollWidth - deck.clientWidth;
            return deck.__oracleScrollEnd.count > before.ended &&
                (deck.scrollLeft - before.left) * direction > 1 &&
                prev.disabled === (deck.scrollLeft <= 1) &&
                next.disabled === (deck.scrollLeft >= max - 1);
        }, { before, direction }, { timeout: 5000 });
    } catch (error) {
        try {
            await saveGalleryFailure(page, before, direction, error);
        } catch (diagnosticError) {
            console.error('Gallery failure diagnostics failed:', diagnosticError);
        }
        throw error;
    }
}

module.exports = { prepareCarousel, observeCarousel, waitForCarouselStep };
