// Landing page interactions: scroll reveals, hero parallax, smooth anchors.

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initParallaxEffect();
    initSmoothScrolling();
    initContactRipple();
    initScrollIndicator();
    initMenuLangToggle();
    initIgEmbedAutoResize();
    initWhatsAppQR();
});

/**
 * On DESKTOP, clicking a WhatsApp link shows a QR to scan with the phone instead of
 * opening WhatsApp Web — because WhatsApp Web/Desktop drops the pre-filled message,
 * while the phone keeps it as a draft. On mobile/tablet the wa.me link opens directly.
 * The QR encodes the link's CURRENT href, so it follows the language toggle.
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

/**
 * Auto-size the Instagram embed iframe to the widget's real content height, for any
 * layout (grid/carousel/masonry). The hearth widget posts its measured height to the
 * parent as { type: 'INSTA_WIDGET_HEIGHT', height }, so we just listen and apply it —
 * no fixed height left oversized. No-op on pages without the embed.
 */
function initIgEmbedAutoResize() {
    const frames = document.querySelectorAll('.instagram-embed-iframe');
    if (!frames.length) return;
    window.addEventListener('message', (e) => {
        const d = e.data;
        if (d && d.type === 'INSTA_WIDGET_HEIGHT' && typeof d.height === 'number' && d.height > 80 && d.height < 4000) {
            frames.forEach(f => { f.style.height = d.height + 'px'; });
        }
    });
}

/**
 * Bilingual menu: switch the visible menu panel (default EN) when a language
 * button is clicked. No-op when the page has no menu.
 */
function initMenuLangToggle() {
    const buttons = document.querySelectorAll('.menu-lang-btn');
    if (!buttons.length) return;

    const apply = (lang) => {
        // Menu panels (EN / RO)
        document.querySelectorAll('.menu-panel').forEach(panel => {
            panel.hidden = panel.dataset.menuPanel !== lang;
        });
        // Bilingual text (About us heading + text, Order now title + intro, menu title, …)
        document.querySelectorAll('[data-en][data-ro]').forEach(el => {
            const val = el.getAttribute('data-' + lang);
            if (val) el.textContent = val;
        });
        // Bilingual links (e.g. WhatsApp pre-filled message differs EN/RO)
        document.querySelectorAll('[data-en-href][data-ro-href]').forEach(el => {
            const href = el.getAttribute('data-' + lang + '-href');
            if (href) el.setAttribute('href', href);
        });
        // Button state + document language
        buttons.forEach(b => {
            const active = b.dataset.menuLang === lang;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        document.documentElement.setAttribute('lang', lang);
    };

    buttons.forEach(btn => btn.addEventListener('click', () => apply(btn.dataset.menuLang)));
}

/**
 * Scroll-triggered fade-in animations + staggered reveal of service cards.
 */
function initScrollAnimations() {
    const fadeElements = document.querySelectorAll('.fade-in-section');
    if (!fadeElements.length) return;

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            staggerChildren(entry.target);
            obs.unobserve(entry.target);   // reveal once, then stop watching
        });
    }, {
        root: null,
        rootMargin: '0px 0px -80px 0px',
        threshold: 0.1
    });

    fadeElements.forEach(el => observer.observe(el));
}

/**
 * Apply an incremental CSS delay so cards inside a revealed section fade in
 * one after another (graceful, not all-at-once).
 */
function staggerChildren(section) {
    const cards = section.querySelectorAll('.service-card');
    cards.forEach((card, i) => {
        card.style.setProperty('--reveal-delay', `${Math.min(i * 60, 420)}ms`);
    });
}

/**
 * Parallax + fade for the hero content as the page scrolls.
 */
function initParallaxEffect() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const heroContent = hero.querySelector('.hero-content');
    const scrollIndicator = hero.querySelector('.scroll-indicator');
    let ticking = false;

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const scrolled = window.pageYOffset;
            const heroHeight = hero.offsetHeight;

            if (scrolled < heroHeight) {
                const opacity = Math.max(0, 1 - (scrolled / (heroHeight * 0.5)));
                if (heroContent) {
                    heroContent.style.opacity = opacity;
                    heroContent.style.transform = `translateY(${scrolled * 0.3}px)`;
                }
                if (scrollIndicator) {
                    scrollIndicator.style.opacity = opacity;
                }
            }
            ticking = false;
        });
    }, { passive: true });
}

/**
 * Smooth scrolling for in-page anchor links.
 */
function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const id = this.getAttribute('href');
            if (id === '#') return;
            const target = document.querySelector(id);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

/**
 * Subtle ripple feedback when tapping a contact row.
 */
function initContactRipple() {
    document.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            ripple.style.cssText = `
                position: absolute;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                transform: scale(0);
                animation: ripple 0.6s linear;
                pointer-events: none;
            `;

            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);

            setTimeout(() => ripple.remove(), 600);
        });
    });

    // Inject the ripple keyframes once.
    const style = document.createElement('style');
    style.textContent = `@keyframes ripple { to { transform: scale(4); opacity: 0; } }`;
    document.head.appendChild(style);
}

/**
 * Clicking the scroll indicator jumps to the main content.
 */
function initScrollIndicator() {
    const scrollIndicator = document.querySelector('.scroll-indicator');
    if (!scrollIndicator) return;
    scrollIndicator.addEventListener('click', () => {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollIntoView({ behavior: 'smooth' });
    });
}

/**
 * On full load, immediately reveal any sections already in view (so above-the-fold
 * content isn't stuck invisible) and run their stagger.
 */
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
    document.querySelectorAll('.fade-in-section').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            el.classList.add('visible');
            const cards = el.querySelectorAll('.service-card');
            cards.forEach((card, i) => {
                card.style.setProperty('--reveal-delay', `${Math.min(i * 60, 420)}ms`);
            });
        }
    });
});
