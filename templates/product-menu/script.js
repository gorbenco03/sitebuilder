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
    initImageFallback();
    initSkipLink();
    initContactForm();
});

// Contact form — POSTs to data-site-messages-api, falls back to WhatsApp/email when empty or on failure.
function initContactForm() {
    var form = document.querySelector('[data-site-messages-api]');
    if (!form) return;
    var status = form.querySelector('[data-cf-status]');
    var submitBtn = form.querySelector('[data-cf-submit]');

    function setStatus(msg, kind) {
        if (!status) return;
        status.textContent = msg;
        status.className = 'pm-form__status' + (kind ? ' pm-form__status--' + kind : '');
        status.hidden = !msg;
    }

    function tryWhatsApp(name, contact, message) {
        var num = (form.getAttribute('data-wa-number') || '').trim();
        if (!num) return false;
        var text = 'Mesaj nou de la ' + name + ' (' + contact + '): ' + message;
        window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
        return true;
    }

    function tryMail(name, contact, message) {
        var email = (form.getAttribute('data-mail-to') || '').trim();
        if (!email) return false;
        var subject = 'Mesaj nou de pe site — ' + name;
        var body = 'De la: ' + name + '\nContact: ' + contact + '\n\n' + message;
        window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        return true;
    }

    function fallback(name, contact, message) {
        if (tryWhatsApp(name, contact, message)) {
            setStatus('Nu am putut trimite direct — te redirecționăm către WhatsApp.', 'info');
            return;
        }
        if (tryMail(name, contact, message)) {
            setStatus('Nu am putut trimite direct — îți deschidem clientul de email.', 'info');
            return;
        }
        setStatus('Nu am putut trimite mesajul acum. Sună-ne sau scrie-ne direct.', 'error');
    }

    form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var name = ((form.elements.name || {}).value || '').trim();
        var contact = ((form.elements.contact || {}).value || '').trim();
        var message = ((form.elements.message || {}).value || '').trim();
        var website = ((form.elements.website || {}).value || '').trim();
        if (!name || !contact || !message) {
            setStatus('Completează numele, un contact și mesajul.', 'error');
            return;
        }
        var apiBase = (form.getAttribute('data-site-messages-api') || '').trim();
        var slug = form.getAttribute('data-site-slug') || '';

        if (!apiBase) { fallback(name, contact, message); return; }

        if (submitBtn) submitBtn.disabled = true;
        fetch(apiBase + '/api/site-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: slug, name: name, contact: contact, message: message, website: website })
        }).then(function (res) {
            if (!res.ok) throw new Error('site-messages request failed');
            setStatus('Mulțumim! Mesajul tău a fost trimis — revenim cât mai curând.', 'success');
            form.reset();
        }).catch(function () {
            fallback(name, contact, message);
        }).finally(function () {
            if (submitBtn) submitBtn.disabled = false;
        });
    });
}

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
    document.querySelectorAll('a[href^="#"]:not(.skip-link)').forEach(anchor => {
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
