// Beauty salon — vanilla JS interactions.
// Defensive: every init function returns early when its elements are absent.
// Zero external dependencies — QR codes generated locally via inline algorithm.

document.addEventListener('DOMContentLoaded', () => {
    sanitizeIconHrefs();
    initScrollAnimations();
    initParallax();
    initSmoothScrolling();
    initScrollIndicator();
    initWhatsAppQR();
    initMobileNav();
    initImageFallback();
    initSkipLink();
    initMessageForm();
    initLocationMapsLink();
});

// "Unde ne găsești" — builds the Google Maps search link from the rendered
// address text, client-side. No iframe, no external script: just a plain
// https://www.google.com/maps/search/ deep link built with encodeURIComponent.
function initLocationMapsLink() {
    var addressEl = document.querySelector('[data-location-address]');
    var linkEl = document.querySelector('[data-location-maps-link]');
    if (!addressEl || !linkEl) return;
    var address = (addressEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (!address) return;
    linkEl.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
}

function detectLiveSlug() {
    var m = String(location.pathname || '').match(/\/live\/([a-z0-9-]{3,40})(?:\/|$)/i);
    return m ? m[1].toLowerCase() : '';
}

// General "Scrie-ne" contact form; POST contract in audit27-s-2b oracle.
function initMessageForm() {
    var form = document.getElementById('pf-msg-form');
    if (!form) return;

    var submitBtn = document.getElementById('pf-msg-submit');
    var hint = document.getElementById('pf-msg-hint');
    var fail = document.getElementById('pf-msg-fail');
    var done = document.getElementById('pf-msg-done');

    function setBusy(busy) {
        if (!submitBtn) return;
        submitBtn.disabled = busy;
        var span = submitBtn.querySelector('span');
        var text = busy ? 'Se trimite…' : 'Trimite mesajul';
        if (span) span.textContent = text; else submitBtn.textContent = text;
    }

    function send(e) {
        if (e) e.preventDefault();
        if (submitBtn && submitBtn.disabled) return;
        if (fail) fail.hidden = true;

        var name = (form.querySelector('#pf-msg-name') || {}).value || '';
        var contact = (form.querySelector('#pf-msg-contact') || {}).value || '';
        var message = (form.querySelector('#pf-msg-message') || {}).value || '';
        var website = (form.querySelector('#pf-msg-website') || {}).value || '';

        if (!name.trim() || !contact.trim() || !message.trim()) {
            if (hint) {
                hint.hidden = false;
                hint.textContent = 'Completează numele, un contact și mesajul.';
            }
            return;
        }

        var apiBase = form.getAttribute('data-site-messages-api') || '';
        var slug = form.getAttribute('data-site-slug') || detectLiveSlug();
        var payload = {
            slug: slug,
            name: name.trim(),
            contact: contact.trim(),
            message: message.trim(),
            website: website,
        };

        function showDone() {
            form.hidden = true;
            if (done) done.hidden = false;
        }

        function showFail() {
            if (hint) {
                hint.hidden = false;
                hint.textContent = 'Mesajul NU a fost trimis — încearcă din nou sau folosește un contact direct mai jos.';
            }
            if (fail) fail.hidden = false;
            setBusy(false);
        }

        // No API base (static export / preview) — go straight to fallback.
        if (!apiBase || !/^https?:/i.test(apiBase)) {
            showFail();
            return;
        }

        setBusy(true);
        fetch(apiBase + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (body) {
                    if (res.ok && body && body.ok) return showDone();
                    throw new Error((body && body.error) || 'Cererea nu a putut fi înregistrată.');
                });
            })
            .catch(function () {
                showFail();
            });
    }

    if (submitBtn) submitBtn.addEventListener('click', send);
    form.addEventListener('submit', send);
}

function sanitizeIconHrefs() {
    var OK = ['http:', 'https:', 'tel:', 'mailto:'];
    document.querySelectorAll('.pf-chip__icon [href]').forEach(function (el) {
        try { if (OK.indexOf(new URL(el.getAttribute('href'), location.href).protocol) < 0) el.setAttribute('href', '#'); }
        catch (e) { el.setAttribute('href', '#'); }
    });
}

/**
 * Mobile navigation — hamburger toggle for the chrome nav below 720px.
 * The nav itself is .pf-chrome__nav (same markup/links as desktop); CSS turns
 * it into a fixed full-screen drawer on narrow viewports, this just toggles it.
 */
function initMobileNav() {
    var toggle = document.getElementById('pf-nav-toggle');
    var nav = document.getElementById('pf-mobile-nav');
    if (!toggle || !nav) return;

    var OPEN_LABEL = 'Deschide meniul';
    var CLOSE_LABEL = 'Închide meniul';

    function isOpen() { return nav.classList.contains('is-open'); }

    function openNav() {
        nav.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', CLOSE_LABEL);
        document.body.style.overflow = 'hidden';
    }

    function closeNav(focusToggle) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', OPEN_LABEL);
        document.body.style.overflow = '';
        if (focusToggle) toggle.focus();
    }

    toggle.addEventListener('click', function () {
        if (isOpen()) closeNav(false); else openNav();
    });

    // Selecting a link closes the drawer so the smooth-scroll target is visible.
    nav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { closeNav(false); });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) closeNav(true);
    });

    // Crossing back to desktop width with the drawer open would otherwise
    // leave aria-expanded stuck true and scroll locked.
    window.addEventListener('resize', function () {
        if (isOpen() && window.matchMedia('(min-width: 720px)').matches) closeNav(false);
    });
}

/**
 * WhatsApp QR modal — desktop only.
 * On mobile the wa.me link opens directly (keeps the pre-filled message draft).
 * On desktop we show a QR generated locally (zero external CDN) so the user can scan with their phone.
 */
/* ─────────────────────────────────────────────────────────────
   Minimal QR Code generator — pure vanilla JS, no CDN.
   Based on the ISO 18004 QR Code standard, numeric/alphanumeric/byte modes.
   Supports URLs up to ~250 chars at error-correction level M.
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
    var lastFocused = null;

    function focusables() {
        return Array.prototype.slice.call(modal.querySelectorAll('a[href], button:not([disabled])'));
    }

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
        lastFocused = document.activeElement;
        modal.hidden = false;
        try { modal.removeAttribute('hidden'); } catch (_) {}
        document.body.style.overflow = 'hidden';
        // Move keyboard focus into the dialog (WCAG 2.4.3 / 4.1.2).
        var items = focusables();
        if (items.length) items[0].focus();
    }

    function closeQr() {
        modal.hidden = true;
        try { modal.setAttribute('hidden', ''); } catch (_) {}
        document.body.style.overflow = '';
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
        lastFocused = null;
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
        if (modal.hidden) return;
        if (e.key === 'Escape') {
            closeQr();
            return;
        }
        // Trap Tab inside the dialog while it is open.
        if (e.key === 'Tab') {
            var items = focusables();
            if (!items.length) return;
            var firstEl = items[0];
            var lastEl = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        }
    });
}

// Smooth-scroll only scrolls; the skip link needs its own focus-moving handler.
function initSkipLink() {
    var link = document.querySelector('.skip-link');
    if (!link) return;
    link.addEventListener('click', function (e) {
        var id = link.getAttribute('href');
        var target = id && document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// Broken <img> gets a neutral placeholder instead of the browser's icon.
function initImageFallback() {
    var FALLBACK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#e4e4e4"/><circle cx="86" cy="86" r="20" fill="#c9c9c9"/><path d="M20 190 L92 118 L134 156 L172 108 L220 190 Z" fill="#c9c9c9"/></svg>'
    );
    document.addEventListener('error', function (e) {
        var t = e.target;
        if (!t || t.tagName !== 'IMG' || t.dataset.hbFallback) return;
        t.dataset.hbFallback = '1';
        t.removeAttribute('srcset');
        t.src = FALLBACK;
        t.classList.add('img-fallback');
    }, true);
}

/**
 * Scroll-triggered fade-in for elements with .fade-in-section.
 * Cards inside each section stagger with incremental CSS delays.
 */
function initScrollAnimations() {
    var sections = document.querySelectorAll('.fade-in-section');
    if (!sections.length) return;

    var observer = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            stagger(entry.target);
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -72px 0px', threshold: 0.08 });

    sections.forEach(function (el) { observer.observe(el); });

    // Immediately reveal anything already in view on load.
    window.addEventListener('load', function () {
        sections.forEach(function (el) {
            if (el.getBoundingClientRect().top < window.innerHeight) {
                el.classList.add('visible');
                stagger(el);
            }
        });
    });
}

function stagger(section) {
    var staggerable = section.querySelectorAll(
        '.menu-item, .pricing-card, .schedule-row, .team-card, .insta-card, .collage-photo'
    );
    staggerable.forEach(function (el, i) {
        el.style.transitionDelay = Math.min(i * 55, 400) + 'ms';
    });
}

/**
 * Subtle hero-content parallax + fade on scroll.
 */
function initParallax() {
    var hero    = document.querySelector('.hero');
    var content = hero && hero.querySelector('.hero-content');
    var hint    = hero && hero.querySelector('.scroll-hint');
    if (!hero || !content) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var ticking = false;
    window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
            var scrolled = window.pageYOffset;
            var h = hero.offsetHeight;
            if (scrolled < h) {
                var t = scrolled / h;
                var opacity = Math.max(0, 1 - t * 2.2);
                content.style.opacity  = opacity;
                content.style.transform = 'translateY(' + (scrolled * 0.28) + 'px)';
                if (hint) hint.style.opacity = Math.max(0, 1 - t * 3);
            }
            ticking = false;
        });
    }, { passive: true });
}

/**
 * Smooth scrolling for in-page anchors.
 */
function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]:not(.skip-link)').forEach(function (a) {
        a.addEventListener('click', function (e) {
            var id = this.getAttribute('href');
            if (id === '#') return;
            var target = document.querySelector(id);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

/**
 * Scroll indicator button → scrolls to main content.
 */
function initScrollIndicator() {
    var btn  = document.querySelector('.scroll-hint');
    var main = document.querySelector('main');
    if (!btn || !main) return;
    btn.addEventListener('click', function () {
        main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}
