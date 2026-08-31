// Photo collage — vanilla scattered, draggable photo gallery + lightbox viewer.
// Photos start stacked in the center, spring out into a row when scrolled into view,
// can be dragged (spring back), tilt + rise above the others on hover, and open in a
// full-screen lightbox on click/tap. Multiple decks supported (one per category).
// On small screens the scatter is replaced (via CSS) by a clean masonry of full photos.

(function () {
    const decks = Array.from(document.querySelectorAll('.collage-deck'));
    if (decks.length === 0) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
            const spacing = Math.max(40, Math.min(maxSpacing, fitSpacing));

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
        apply(false);

        function scatter() { apply(true); }

        if (reduce) {
            scatter();
        } else {
            const io = new IntersectionObserver((entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) { setTimeout(scatter, 150); io.disconnect(); }
                });
            }, { threshold: 0.2 });
            io.observe(deck);
        }

        let rt;
        window.addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => { compute(); apply(deck.querySelector('.placed') !== null); }, 150);
        });

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
