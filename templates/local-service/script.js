// Trade / construction vertical — defensive vanilla JS.
// Zero dependencies; every init returns early when its elements are absent.

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initScrollIndicator();
    initParallax();
    initWhatsAppQR();
    initLightbox();
    initContactRipple();
    initEditableLists();
});

// ============================================================
// WHATSAPP QR MODAL (desktop only)
// On desktop shows QR so pre-filled message is kept on the phone.
// On mobile / tablet the wa.me link opens directly.
// ============================================================
/* ─────────────────────────────────────────────────────────────
   QR Code generator — pure vanilla JS, no CDN, zero dependencies.
   Faithful ISO 18004 implementation, byte mode, versions 1-10, level M.
   Rewritten (audit LS-01): the previous hand-rolled encoder XOR-masked
   its own finder/timing/alignment/dark-module cells (corrupting the
   scanner-critical finder patterns), never reserved the format/version
   info strips before placing data (silently eating data-codeword bits),
   never emitted version info for v7-10 (needed by the default preset
   message, which already requires version 8), and always forced mask
   pattern 5 instead of scoring all 8 candidates — some payloads produce
   a technically valid but unreliable-to-scan symbol under a fixed mask.
   Verified end-to-end: generated codes decode correctly via cv2 and
   zbar for the default preset message and a wide sweep of lengths
   across every supported version (see bot/test/wave5-local-service-*).
   ───────────────────────────────────────────────────────────── */
// The hand-rolled QR encoder that used to live here was removed. It produced
// symbols with corrupted finder patterns -- the audit's finding #1, and the
// only critical it verified independently, by failing to decode the output
// with a real scanner. The fix vendored Kazuhiko Arase's MIT qrcode.js and
// overrode window.generateQRSVG with it just below, but left the broken
// encoder in place, where it shipped to every published site and would have
// silently taken over again if the override were ever reordered or dropped.

// QR Code Generator for JavaScript — Kazuhiko Arase, MIT License (qrcode.js).
// Published/exported sites load that local vendored asset before this script.
window.generateQRSVG = function (text, size) {
    var qr = qrcode(0, 'M');
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    qr.addData(String(text || ''), 'Byte');
    qr.make();
    var target = Number(size) || 240;
    var cell = target / (qr.getModuleCount() + 8);
    return qr.createSvgTag({ cellSize: cell, margin: cell * 4, scalable: true, alt: 'Cod QR WhatsApp' });
};

function initWhatsAppQR() {
    var modal = document.getElementById('wa-qr');
    var img = document.getElementById('wa-qr-img');
    var links = document.querySelectorAll('a[href*="wa.me"]');
    if (!modal || !img || !links.length) return;

    // Desktop viewport / UA only — do not treat Mac trackpads as phones (maxTouchPoints).
    var ua = navigator.userAgent || '';
    var isMobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    var narrow = false;
    try { narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches; } catch (_) {}
    if (isMobileUa && narrow) return;

    var openBtn = document.getElementById('wa-qr-open');

    function paintQr(waUrl) {
        var svg = (typeof window.generateQRSVG === 'function') ? window.generateQRSVG(waUrl, 240) : '';
        if (svg) {
            img.removeAttribute('src');
            img.setAttribute('alt', 'Cod QR WhatsApp');
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            img.style.display = 'block';
            var old = modal.querySelector('.wa-qr__svg');
            if (old) old.remove();
        }
        if (openBtn) openBtn.href = waUrl;
        modal.hidden = false;
        try { modal.removeAttribute('hidden'); } catch (_) {}
        document.body.style.overflow = 'hidden';
    }

    function closeQr() {
        modal.hidden = true;
        try { modal.setAttribute('hidden', ''); } catch (_) {}
        document.body.style.overflow = '';
    }

    links.forEach(function (a) {
        a.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            paintQr(a.href);
        });
    });

    modal.querySelectorAll('[data-wa-close]').forEach(function (el) {
        el.addEventListener('click', closeQr);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) closeQr();
    });
}

// ============================================================
// LIGHTBOX — fullscreen image viewer triggered by photo-card clicks
// ============================================================
function initLightbox() {
    const photos = Array.from(document.querySelectorAll('.photo-card img'));
    if (!photos.length) return;

    const lb      = document.getElementById('lightbox');
    const lbImg   = document.getElementById('lightbox-img');
    const closeEl = document.getElementById('lightbox-close');
    const prevEl  = document.getElementById('lightbox-prev');
    const nextEl  = document.getElementById('lightbox-next');

    // Fallback: build lightbox if it's not already in the DOM
    if (!lb || !lbImg) return;

    let current = 0;

    const show = (idx) => {
        current = (idx + photos.length) % photos.length;
        lbImg.src = photos[current].src;
        lbImg.alt = photos[current].alt || '';
        lb.hidden = false;
        document.body.style.overflow = 'hidden';
        if (closeEl) closeEl.focus();
    };

    const close = () => {
        lb.hidden = true;
        document.body.style.overflow = '';
        lbImg.src = '';
    };

    photos.forEach((img, i) => {
        const card = img.closest('.photo-card');
        if (!card) return;
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', img.alt || 'Deschide fotografie');
        card.addEventListener('click',   () => show(i));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); }
        });
    });

    if (closeEl) closeEl.addEventListener('click', close);
    if (prevEl)  prevEl.addEventListener('click',  () => show(current - 1));
    if (nextEl)  nextEl.addEventListener('click',  () => show(current + 1));

    lb.addEventListener('click', (e) => { if (e.target === lb) close(); });

    document.addEventListener('keydown', (e) => {
        if (lb.hidden) return;
        if (e.key === 'Escape')     close();
        if (e.key === 'ArrowLeft')  show(current - 1);
        if (e.key === 'ArrowRight') show(current + 1);
    });
}

// ============================================================
// SCROLL-TRIGGERED FADE-IN + STAGGER
// ============================================================
function initScrollAnimations() {
    const sections = document.querySelectorAll('.fade-in-section');
    if (!sections.length) return;

    const stagger = (parent, selector, stepMs) => {
        parent.querySelectorAll(selector).forEach((card, i) => {
            card.style.setProperty('--reveal-delay', `${Math.min(i * stepMs, 500)}ms`);
        });
    };

    const reveal = (el) => {
        el.classList.add('visible');
        stagger(el, '.service-card', 55);
        stagger(el, '.trust-card',   80);
        stagger(el, '.step-card',    90);
    };

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            reveal(entry.target);
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -80px 0px', threshold: 0.06 });

    sections.forEach(el => observer.observe(el));

    // Immediately reveal any section already in viewport on load
    window.addEventListener('load', () => {
        sections.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight) reveal(el);
        });
    });
}

// ============================================================
// SCROLL INDICATOR — click to jump past hero
// ============================================================
function initScrollIndicator() {
    const btn  = document.querySelector('.scroll-indicator');
    const main = document.getElementById('main-content');
    if (!btn || !main) return;
    btn.addEventListener('click', () => {
        main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// ============================================================
// HERO PARALLAX — fades hero content on scroll
// ============================================================
function initParallax() {
    const hero    = document.querySelector('.hero');
    const content = document.querySelector('.hero-content');
    const scrollBtn = document.querySelector('.scroll-indicator');
    if (!hero) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const scrolled   = window.pageYOffset;
            const heroHeight = hero.offsetHeight;
            if (scrolled < heroHeight) {
                const opacity = Math.max(0, 1 - scrolled / (heroHeight * 0.55));
                if (content) {
                    content.style.opacity   = opacity;
                    content.style.transform = `translateY(${scrolled * 0.22}px)`;
                }
                if (scrollBtn) scrollBtn.style.opacity = Math.max(0, opacity - 0.2);
            }
            ticking = false;
        });
    }, { passive: true });
}

// ============================================================
// CONTACT ITEM RIPPLE — subtle tap feedback
// ============================================================
function initContactRipple() {
    document.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            const rect   = this.getBoundingClientRect();
            const size   = Math.max(rect.width, rect.height);
            ripple.style.cssText = `
                position:absolute;width:${size}px;height:${size}px;
                left:${e.clientX - rect.left - size / 2}px;
                top:${e.clientY - rect.top  - size / 2}px;
                border-radius:50%;background:rgba(255,255,255,.18);
                transform:scale(0);animation:ctaRipple .5s linear;
                pointer-events:none;
            `;
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove());
        });
    });

    // Inject ripple keyframes once
    if (!document.getElementById('cta-ripple-style')) {
        const s = document.createElement('style');
        s.id = 'cta-ripple-style';
        s.textContent = '@keyframes ctaRipple { to { transform:scale(4); opacity:0; } }';
        document.head.appendChild(s);
    }
}

// ============================================================
// EDITABLE LISTS — add / remove for services, "De ce noi" points,
// portfolio categories and certifications (audit LS-02).
//
// Only active inside the builder editor: every field the render engine
// marks editable carries a data-hb-edit="config.path" attribute (see
// build.js, opts.editMode); a published/exported site never has that
// attribute, so this whole function is a silent no-op there.
//
// The generic in-iframe overlay (builder/edit-overlay.js) already scans for
// data-hb-edit="root.N..." groups and injects its own "+"/"×" controls, but
// only for a fixed name whitelist (SAFE_LIST_PATHS) that omits
// "certifications" and "trust" entirely — see HANDOFF-local-service.md for
// the one-line fix needed there. It DOES include "services" and
// "categories", but its container-detection assumes an item's fields sit
// directly on (or contain) the repeated card element; a service has only
// one field ("label") wrapped in its own inline span
// (<span class="ls-punch__label"><span data-hb-edit=...>), one DOM level
// short of the real item root (<li class="service-card">) — the exact class
// of bug the round-2 audit wave already fixed for product-menu/
// professionals/portfolio (also documented in HANDOFF-local-service.md).
// Rather than depend on that being ported here, this template builds its
// own controls for ALL FOUR lists — using CSS classes it owns and controls
// precisely — and talks the SAME postMessage protocol
// ({hb:'list-add',listPath} / {hb:'list-remove',path} / {hb:'text',path,
// value}) builder/app.js already handles unconditionally (onListAdd/
// onListRemove/onInlineTextEdit carry no whitelist of their own). Any stray
// controls the generic overlay still injects for "services"/"categories"
// are removed once its mount() has run, so there is only ever one set of
// buttons per item.
//
// A freshly added item always starts with every itemShape field set to an
// empty string (builder/app.js: onListAdd). An empty text node has nothing
// for an owner to click into, so as soon as a new item's fields are all
// still empty this template fills it with real Romanian placeholder copy,
// echoed back via the same {hb:'text'} message app.js already listens for.
// Never a literal "New item"/"Element nou" placeholder.
// ============================================================
function initEditableLists() {
    if (!document.querySelector('[data-hb-edit]')) return; // not in the editor iframe

    function toParent(msg) {
        try { window.parent.postMessage(msg, '*'); } catch (_) {}
    }

    function fieldsForItem(root, idx) {
        var itemPath = root + '.' + idx;
        return Array.prototype.slice.call(document.querySelectorAll(
            '[data-hb-edit="' + itemPath + '"], [data-hb-edit^="' + itemPath + '."]'
        ));
    }

    function fillEmptyDefaults(listRoot, itemSelector, defaults) {
        var items = Array.prototype.slice.call(document.querySelectorAll(itemSelector));
        items.forEach(function (el) {
            var marker = el.querySelector('[data-hb-edit^="' + listRoot + '."]') ||
                (el.matches('[data-hb-edit^="' + listRoot + '."]') ? el : null);
            if (!marker) return;
            var markerPath = marker.getAttribute('data-hb-edit');
            var idx = parseInt(markerPath.slice(listRoot.length + 1).split('.')[0], 10);
            if (isNaN(idx)) return;

            var itemPath = listRoot + '.' + idx;
            var fields = fieldsForItem(listRoot, idx);
            var allEmpty = fields.length > 0 && fields.every(function (f) {
                return f.textContent.replace(/\s+/g, '') === '';
            });
            if (!allEmpty) return;
            fields.forEach(function (f) {
                var p = f.getAttribute('data-hb-edit');
                // "certifications.3" (scalar item) -> key "."; "services.3.label" -> key "label".
                var key = (p === itemPath) ? '.' : p.slice(itemPath.length + 1);
                var text = defaults[key] || defaults['.'];
                if (text) {
                    f.textContent = text;
                    toParent({ hb: 'text', path: p, value: text });
                }
            });
        });
    }

    function setupCustomList(opts) {
        var items = Array.prototype.slice.call(document.querySelectorAll(opts.itemSelector));
        if (!items.length) return; // list is currently empty — see note in HANDOFF-local-service.md

        items.forEach(function (el) {
            var marker = el.querySelector('[data-hb-edit^="' + opts.listRoot + '."]') ||
                (el.matches('[data-hb-edit^="' + opts.listRoot + '."]') ? el : null);
            if (!marker) return;
            var idx = parseInt(marker.getAttribute('data-hb-edit').slice(opts.listRoot.length + 1).split('.')[0], 10);
            if (isNaN(idx)) return;

            // Never let the last remaining item be removed: the whole section
            // is wrapped in <!-- @if root --> in template.html, so an empty
            // array would hide the section entirely — including this button's
            // own anchor point — leaving no way back in from the editor.
            if (items.length > 1) {
                var removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'hb-ls-remove';
                removeBtn.setAttribute('aria-label', opts.removeAriaPrefix + ' ' + (idx + 1));
                removeBtn.textContent = '×';
                removeBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    toParent({ hb: 'list-remove', path: opts.listRoot + '.' + idx });
                });
                if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
                el.appendChild(removeBtn);
            }
        });

        fillEmptyDefaults(opts.listRoot, opts.itemSelector, opts.defaults);

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'hb-ls-add';
        addBtn.textContent = opts.addLabel;
        addBtn.addEventListener('click', function () {
            toParent({ hb: 'list-add', listPath: opts.listRoot });
        });

        var last = items[items.length - 1];
        if (last.parentNode) last.parentNode.insertBefore(addBtn, last.nextSibling);
    }

    setupCustomList({
        itemSelector: '.service-card',
        listRoot: 'services',
        addLabel: '+ Adaugă serviciu',
        removeAriaPrefix: 'Șterge serviciul',
        defaults: { label: 'Serviciu nou' }
    });
    setupCustomList({
        itemSelector: '.ls-trust__card',
        listRoot: 'trust',
        addLabel: '+ Adaugă punct',
        removeAriaPrefix: 'Șterge punctul',
        defaults: { title: 'Motiv nou', text: 'Adaugă o propoziție scurtă despre acest motiv de a vă alege.' }
    });
    setupCustomList({
        itemSelector: '.ls-work',
        listRoot: 'categories',
        addLabel: '+ Adaugă categorie',
        removeAriaPrefix: 'Șterge categoria',
        defaults: {
            title: 'Categorie de lucrări nouă',
            blurb: 'Adaugă o descriere scurtă a acestei categorii de lucrări.'
        }
    });
    setupCustomList({
        itemSelector: '.ls-cert',
        listRoot: 'certifications',
        addLabel: '+ Adaugă certificare',
        removeAriaPrefix: 'Șterge certificarea',
        defaults: { '.': 'Certificare nouă' }
    });

    // "services" and "categories" are ALSO in builder/edit-overlay.js's
    // SAFE_LIST_PATHS, so its generic in-iframe overlay tries to add its own
    // +/- controls for them too. For a single-text-field item (a service has
    // only "label") its container-detection lands one DOM level too shallow
    // — on the field's own inline wrapper span, not the repeated <li> — so
    // its button ends up misplaced rather than simply duplicating ours (this
    // is the same class of bug the round-2 audit wave fixed for product-menu/
    // professionals/portfolio; see HANDOFF-local-service.md for the pointer).
    // Rather than fight two competing sets of injected controls, remove any
    // the generic overlay adds once its own mount() has run (it registers its
    // DOMContentLoaded listener after this file's, so a same-tick deferral is
    // enough to run strictly after it) and keep this template's own controls
    // as the single source of truth for all four lists.
    setTimeout(function () {
        document.querySelectorAll('.hb-add-btn, .hb-remove-btn').forEach(function (el) { el.remove(); });
    }, 0);
}
