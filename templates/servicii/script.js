// Servicii Locale — script.js
// Vanilla JS, zero dependencies. All init functions are defensive
// (early-return when the required elements are absent).

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initParallaxEffect();
    initSmoothScrolling();
    initScrollIndicator();
    initContactRipple();
    initWhatsAppQR();
});

/**
 * On DESKTOP, clicking a WhatsApp link shows a QR modal instead of
 * opening WhatsApp Web — the phone keeps the pre-filled message as a draft.
 * On mobile/tablet the wa.me link opens directly.
 */
function initWhatsAppQR() {
    const modal = document.getElementById('wa-qr');
    const img   = document.getElementById('wa-qr-img');
    if (!modal || !img) return;

    const links = document.querySelectorAll('a[href*="wa.me"]');
    if (!links.length) return;

    const ua       = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua)
                  || (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
    if (isMobile) return;

    const openBtn = document.getElementById('wa-qr-open');

    const openQr = (waUrl) => {
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data='
                + encodeURIComponent(waUrl);
        if (openBtn) openBtn.href = waUrl;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    };

    const closeQr = () => {
        modal.hidden = true;
        document.body.style.overflow = '';
        img.removeAttribute('src');
    };

    links.forEach(a => a.addEventListener('click', (e) => {
        e.preventDefault();
        openQr(a.href);
    }));

    modal.querySelectorAll('[data-wa-close]').forEach(el =>
        el.addEventListener('click', closeQr)
    );

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeQr();
    });
}

/**
 * Scroll-triggered fade-in for sections + staggered reveal for service cards.
 */
function initScrollAnimations() {
    const fadeEls = document.querySelectorAll('.fade-in-section');
    if (!fadeEls.length) return;

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            staggerServiceCards(entry.target);
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -80px 0px', threshold: 0.1 });

    fadeEls.forEach(el => observer.observe(el));
}

function staggerServiceCards(section) {
    section.querySelectorAll('.service-card').forEach((card, i) => {
        card.style.setProperty('--reveal-delay', `${Math.min(i * 60, 420)}ms`);
    });
}

/**
 * Parallax + opacity fade for the hero content on scroll.
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
            const scrolled    = window.pageYOffset;
            const heroHeight  = hero.offsetHeight;
            if (scrolled < heroHeight) {
                const opacity = Math.max(0, 1 - scrolled / (heroHeight * 0.5));
                if (heroContent) {
                    heroContent.style.opacity   = opacity;
                    heroContent.style.transform = `translateY(${scrolled * 0.28}px)`;
                }
                if (scrollIndicator) scrollIndicator.style.opacity = opacity;
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
 * Clicking the scroll indicator scrolls to the main content.
 */
function initScrollIndicator() {
    const btn = document.querySelector('.scroll-indicator');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const main = document.getElementById('main');
        if (main) main.scrollIntoView({ behavior: 'smooth' });
    });
}

/**
 * Subtle ripple on contact row tap.
 */
function initContactRipple() {
    document.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            ripple.style.cssText = `
                position: absolute;
                background: rgba(255,255,255,0.28);
                border-radius: 50%;
                transform: scale(0);
                animation: ripple 0.6s linear;
                pointer-events: none;
            `;
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width  = ripple.style.height = size + 'px';
            ripple.style.left   = (e.clientX - rect.left  - size / 2) + 'px';
            ripple.style.top    = (e.clientY - rect.top   - size / 2) + 'px';
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        });
    });
    const style = document.createElement('style');
    style.textContent = '@keyframes ripple { to { transform: scale(4); opacity: 0; } }';
    document.head.appendChild(style);
}

/**
 * Immediately reveal any sections already in the viewport on full load.
 */
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
    document.querySelectorAll('.fade-in-section').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            el.classList.add('visible');
            staggerServiceCards(el);
        }
    });
});
