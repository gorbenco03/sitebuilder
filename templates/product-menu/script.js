// Landing page interactions — defensive vanilla JS.
// Every init function returns early when its elements are absent
// so pages with partial configs never error.

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initParallaxEffect();
    initSmoothScrolling();
    initContactRipple();
    initScrollIndicator();
    initMenuLangToggle();
    initIgEmbedAutoResize();
    initWhatsAppQR();
    initMobileNav();
});

// ── WhatsApp QR modal ─────────────────────────────────────
// On DESKTOP: intercept all wa.me links and show a QR instead.
// On MOBILE:  the wa.me link opens directly (keeps the pre-filled draft).
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

// ── Instagram embed iframe auto-resize ───────────────────
function initIgEmbedAutoResize() {
    const frames = document.querySelectorAll('.instagram-embed-iframe');
    if (!frames.length) return;
    window.addEventListener('message', (e) => {
        const d = e.data;
        if (d && d.type === 'INSTA_WIDGET_HEIGHT' &&
            typeof d.height === 'number' && d.height > 80 && d.height < 4000) {
            frames.forEach(f => { f.style.height = d.height + 'px'; });
        }
    });
}

// ── Bilingual menu (optional) ─────────────────────────────
function initMenuLangToggle() {
    const buttons = document.querySelectorAll('.menu-lang-btn');
    if (!buttons.length) return;

    function apply(lang) {
        document.querySelectorAll('.menu-panel').forEach(panel => {
            panel.hidden = panel.dataset.menuPanel !== lang;
        });
        document.querySelectorAll('[data-en][data-ro]').forEach(el => {
            const val = el.getAttribute('data-' + lang);
            if (val) el.textContent = val;
        });
        document.querySelectorAll('[data-en-href][data-ro-href]').forEach(el => {
            const href = el.getAttribute('data-' + lang + '-href');
            if (href) el.setAttribute('href', href);
        });
        buttons.forEach(b => {
            const active = b.dataset.menuLang === lang;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    buttons.forEach(btn =>
        btn.addEventListener('click', () => apply(btn.dataset.menuLang))
    );
}

// ── Scroll-triggered fade-in animations ──────────────────
function initScrollAnimations() {
    const fadeEls = document.querySelectorAll('.fade-in-section');
    if (!fadeEls.length) return;

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            staggerChildren(entry.target);
            obs.unobserve(entry.target);
        });
    }, {
        rootMargin: '0px 0px -80px 0px',
        threshold: 0.08
    });

    fadeEls.forEach(el => observer.observe(el));
}

function staggerChildren(section) {
    section.querySelectorAll('.service-card').forEach((card, i) => {
        card.style.setProperty('--reveal-delay', `${Math.min(i * 65, 420)}ms`);
    });
}

// ── Hero parallax + fade on scroll ───────────────────────
function initParallaxEffect() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const heroContent     = hero.querySelector('.hero-content');
    const scrollIndicator = hero.querySelector('.scroll-indicator');
    let ticking = false;

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const scrolled    = window.pageYOffset;
            const heroHeight  = hero.offsetHeight;
            if (scrolled < heroHeight) {
                const opacity = Math.max(0, 1 - scrolled / (heroHeight * 0.5));
                if (heroContent) {
                    heroContent.style.opacity   = opacity;
                    heroContent.style.transform = `translateY(${scrolled * 0.28}px)`;
                }
                if (scrollIndicator) {
                    scrollIndicator.style.opacity = opacity;
                }
            }
            ticking = false;
        });
    }, { passive: true });
}

// ── Smooth anchor scrolling ───────────────────────────────
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

// ── Contact-item ripple on click ──────────────────────────
function initContactRipple() {
    const style = document.createElement('style');
    style.textContent = '@keyframes ripple { to { transform: scale(4); opacity: 0; } }';
    document.head.appendChild(style);

    document.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            const rect   = this.getBoundingClientRect();
            const size   = Math.max(rect.width, rect.height);
            ripple.style.cssText = [
                'position:absolute',
                'border-radius:50%',
                'pointer-events:none',
                'background:rgba(255,255,255,0.28)',
                'transform:scale(0)',
                'animation:ripple 0.6s linear',
                `width:${size}px`,
                `height:${size}px`,
                `left:${e.clientX - rect.left - size / 2}px`,
                `top:${e.clientY - rect.top - size / 2}px`
            ].join(';');
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 620);
        });
    });
}

// ── Mobile navigation (hamburger) ─────────────────────────
// Toggles the same anchors used on desktop as a dropdown panel below the
// sticky mast. Accessible: aria-expanded/aria-controls, closes on Escape,
// on outside click, on link activation, and if the viewport grows past the
// desktop breakpoint while open.
function initMobileNav() {
    const burger = document.getElementById('pm-mast-burger');
    const nav = document.getElementById('pm-mast-nav');
    if (!burger || !nav) return;

    const LABEL_OPEN = 'Deschide meniul de navigație';
    const LABEL_CLOSE = 'Închide meniul de navigație';
    const desktopMq = window.matchMedia('(min-width: 834px)');

    function isOpen() { return nav.classList.contains('is-open'); }

    function open() {
        nav.classList.add('is-open');
        burger.setAttribute('aria-expanded', 'true');
        burger.setAttribute('aria-label', LABEL_CLOSE);
    }

    function close(focusBurger) {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-label', LABEL_OPEN);
        if (focusBurger) burger.focus();
    }

    burger.addEventListener('click', () => {
        if (isOpen()) close(false); else open();
    });

    nav.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', () => close(false));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) close(true);
    });

    document.addEventListener('click', (e) => {
        if (!isOpen()) return;
        if (nav.contains(e.target) || burger.contains(e.target)) return;
        close(false);
    });

    if (desktopMq.addEventListener) {
        desktopMq.addEventListener('change', (e) => { if (e.matches) close(false); });
    } else if (desktopMq.addListener) {
        desktopMq.addListener((e) => { if (e.matches) close(false); });
    }
}

// ── Scroll-indicator button scrolls to main content ──────
function initScrollIndicator() {
    const btn = document.querySelector('.scroll-indicator');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const main = document.querySelector('.main-content');
        if (main) main.scrollIntoView({ behavior: 'smooth' });
    });
}

// ── Immediately reveal sections already in the viewport ──
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
    document.querySelectorAll('.fade-in-section').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            el.classList.add('visible');
            staggerChildren(el);
        }
    });
});
