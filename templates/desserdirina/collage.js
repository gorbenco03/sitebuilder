// Photo collage — vanilla scattered, draggable photo gallery + lightbox viewer.
// Photos scatter into a spread-out row immediately on load (DSD-04 — see
// initDeck below for why this must not wait for a scroll-triggered
// IntersectionObserver), can be dragged (spring back), tilt + rise above the
// others on hover, and open in a full-screen lightbox on click/tap. Multiple
// decks supported (one per category). On small screens the scatter is
// replaced (via CSS) by a clean masonry of full photos.

(function () {
    const decks = Array.from(document.querySelectorAll('.collage-deck'));
    if (decks.length === 0) return;

    /* ---------------- Lightbox ---------------- */
    // All gallery images across every deck, in document order — used for prev/next.
    const allImgs = Array.from(document.querySelectorAll('.collage-photo img'));

    // Labels from template data-lb-* on <html>, with Romanian fallbacks.
    const root = document.documentElement;
    const lbCloseAria = root.getAttribute('data-lb-close') || 'Închide';
    const lbPrevAria  = root.getAttribute('data-lb-prev')  || 'Anterior';
    const lbNextAria  = root.getAttribute('data-lb-next')  || 'Următor';

    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('hidden', '');
    lb.innerHTML =
        '<button class="lightbox-close" aria-label="' + lbCloseAria.replace(/"/g, '&quot;') + '">&times;</button>' +
        '<button class="lightbox-nav lightbox-prev" aria-label="' + lbPrevAria.replace(/"/g, '&quot;') + '">&#8249;</button>' +
        '<img class="lightbox-img" alt="">' +
        '<button class="lightbox-nav lightbox-next" aria-label="' + lbNextAria.replace(/"/g, '&quot;') + '">&#8250;</button>';
    document.body.appendChild(lb);

    const lbImg   = lb.querySelector('.lightbox-img');
    const lbClose = lb.querySelector('.lightbox-close');
    const lbPrev  = lb.querySelector('.lightbox-prev');
    const lbNext  = lb.querySelector('.lightbox-next');
    let current = 0;

    function showAt(i) {
        if (allImgs.length === 0) return;
        current = (i + allImgs.length) % allImgs.length;
        const src = allImgs[current];
        lbImg.src = src.currentSrc || src.src;
        lbImg.alt = src.alt || '';
    }
    function openLightbox(i) {
        showAt(i);
        lb.removeAttribute('hidden');
        document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
        lb.setAttribute('hidden', '');
        document.body.style.overflow = '';
    }

    lbClose.addEventListener('click', closeLightbox);
    lbPrev.addEventListener('click', (e) => { e.stopPropagation(); showAt(current - 1); });
    lbNext.addEventListener('click', (e) => { e.stopPropagation(); showAt(current + 1); });
    lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });   // backdrop
    lbImg.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', (e) => {
        if (lb.hasAttribute('hidden')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') showAt(current - 1);
        else if (e.key === 'ArrowRight') showAt(current + 1);
    });

    /* ---------------- Scatter deck ---------------- */
    function initDeck(deck) {
        const photos = Array.from(deck.querySelectorAll('.collage-photo'));
        const n = photos.length;
        if (n === 0) return;

        const yPattern = [16, 34, 8, 26, 18, 40, 12, 30];   // gentle vertical variation
        let base = [];

        function compute() {
            const deckW = deck.getBoundingClientRect().width || 800;
            const photoW = photos[0].getBoundingClientRect().width || 220;
            const maxSpacing = photoW * 1.02;   // more breathing room between photos
            const fitSpacing = n > 1 ? (deckW - photoW) / (n - 1) : 0;
            // No hard-floor on spacing: a previous 40px minimum could force the row
            // wider than the deck itself on a narrow/zoomed viewport with several
            // photos, bleeding past the section and causing horizontal page scroll
            // (WCAG 1.4.10 reflow failure at 200% zoom). Clamping the floor to 0
            // instead lets photos overlap more tightly rather than ever overflow.
            const spacing = Math.max(0, Math.min(maxSpacing, fitSpacing));

            base = photos.map((el, i) => {
                const x = (i - (n - 1) / 2) * spacing;
                const y = yPattern[i % yPattern.length];
                const rot = (i % 2 ? 1 : -1) * (2 + (i % 3));
                const z = 50 - Math.round(Math.abs(i - (n - 1) / 2) * 6);
                return { x, y, rot, z };
            });
        }

        function apply(animate) {
            photos.forEach((el, i) => {
                el.style.zIndex = String(base[i].z);
                if (animate) {
                    el.style.setProperty('--x', base[i].x + 'px');
                    el.style.setProperty('--y', base[i].y + 'px');
                    el.style.setProperty('--r', base[i].rot + 'deg');
                    el.classList.add('placed');
                }
            });
        }

        compute();
        // DSD-04: scatter the photos into their spread-out positions
        // IMMEDIATELY, not only after an IntersectionObserver reports the
        // deck 20%-visible from a real scroll. That gate meant the very
        // first paint of every fresh page load showed all N photos stacked
        // exactly on top of each other at the deck's center (--x/--y default
        // to 0 in the base .collage-photo rule) — a single ~200-280px pile
        // the width of ONE photo, not the intended full-width grid, and a
        // click could only ever reach whichever photo the z-index stack put
        // on top. This is not just a real-user race: a live re-audit
        // confirmed it on the published site, and this file's own
        // `page.screenshot({ fullPage: true })` proof (see
        // bot/test/wave8-desserdirina-gallery-collapse.test.js) shows a
        // Playwright full-page capture — the exact technique most QA/audit
        // tooling uses — never triggers a real scroll event either, so the
        // observer's callback had not fired by capture time even though the
        // deck itself was already laid out correctly off-screen. Positioning
        // immediately removes the dependency on scroll timing entirely: the
        // gallery is a normal-width grid from the first frame, on every
        // template that uses this file.
        apply(true);

        function scatter() { apply(true); }

        let rt;
        function recompute() {
            clearTimeout(rt);
            rt = setTimeout(() => { compute(); apply(true); }, 150);
        }
        window.addEventListener('resize', recompute);
        // DSD-05 (200% zoom overflow): `window.resize` never fires from a
        // browser/OS zoom change alone (pinch-zoom, ctrl/cmd+=, or the CSS
        // `zoom` property used to approximate it in tests) — only from an
        // actual viewport size change. compute()'s photo offsets (--x/--y,
        // baked in as fixed CSS-pixel values) were therefore left stale at
        // whatever the deck's width was at zoom 1, while the deck's own box
        // keeps reflowing correctly under zoom — so the absolutely
        // positioned photos, translated by those stale wider-viewport
        // offsets, spilled out past the now-narrower effective deck and
        // caused real horizontal page overflow (worst of the five templates:
        // 42% at 1440px). A ResizeObserver on the deck itself fires on ANY
        // box-size change regardless of cause — zoom, container reflow, or a
        // real window resize — so it supersedes (and, mirroring the
        // `resize` listener's guard, is intentionally not removed) the
        // window-level listener above; wiring both is harmless since either
        // one settles into the same debounced recompute.
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(recompute).observe(deck);
        }

        // Drag with spring-back; a click/tap (no real movement) opens the lightbox.
        photos.forEach((el, i) => {
            const img = el.querySelector('img');
            const imgIndex = allImgs.indexOf(img);
            let dragging = false, moved = false, sx = 0, sy = 0;

            el.addEventListener('pointerdown', (ev) => {
                dragging = true; moved = false; sx = ev.clientX; sy = ev.clientY;
                el.setPointerCapture(ev.pointerId);
                el.classList.add('grabbing');
                el.style.zIndex = '9999';
            });
            el.addEventListener('pointermove', (ev) => {
                if (!dragging) return;
                const dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
                el.style.setProperty('--dx', dx + 'px');
                el.style.setProperty('--dy', dy + 'px');
            });
            const end = () => {
                if (!dragging) return;
                dragging = false;
                el.classList.remove('grabbing');
                el.style.setProperty('--dx', '0px');
                el.style.setProperty('--dy', '0px');
                el.style.zIndex = base.length ? String(base[i].z) : '';
                if (!moved) openLightbox(imgIndex);     // it was a click, not a drag
            };
            el.addEventListener('pointerup', end);
            el.addEventListener('pointercancel', end);
        });
    }

    decks.forEach(initDeck);
})();
