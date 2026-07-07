// evenimente/script.js — vanilla defensive interactions
// Each init function does an early-return if its required elements are absent.

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initHeroParallax();
    initSmoothScrolling();
    initScrollIndicator();
    initWhatsAppQR();
});

/**
 * On DESKTOP, clicking a WhatsApp link shows a QR modal so users scan with their
 * phone instead of opening WhatsApp Web (which drops the pre-filled message).
 * On mobile/tablet the wa.me link opens directly.
 */
function initWhatsAppQR() {
    const modal  = document.getElementById('wa-qr');
    const img    = document.getElementById('wa-qr-img');
    const links  = document.querySelectorAll('a[href*="wa.me"]');
    if (!modal || !img || !links.length) return;

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
 * Scroll-triggered fade-in + staggered reveal of service items.
 */
function initScrollAnimations() {
    const sections = document.querySelectorAll('.fade-in-section');
    if (!sections.length) return;

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            staggerItems(entry.target);
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -72px 0px', threshold: 0.08 });

    sections.forEach(el => observer.observe(el));
}

function staggerItems(section) {
    const items = section.querySelectorAll('.service-item');
    items.forEach((item, i) => {
        item.style.setProperty('--reveal-delay', `${Math.min(i * 55, 400)}ms`);
    });
}

/**
 * Subtle parallax on the hero background and content fade as the user scrolls down.
 */
function initHeroParallax() {
    const hero    = document.querySelector('.hero');
    const bg      = document.querySelector('.hero-bg');
    const content = document.querySelector('.hero-content');
    const scrollEl = document.querySelector('.scroll-indicator');
    if (!hero || !bg) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ticking = false;

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const scrolled    = window.pageYOffset;
            const heroHeight  = hero.offsetHeight;
            if (scrolled < heroHeight) {
                // Slow background parallax (moves up at 30% of scroll speed)
                bg.style.transform = `scale(1.06) translateY(${scrolled * 0.18}px)`;

                // Fade & drift the hero text out
                const pct = scrolled / (heroHeight * 0.55);
                const opacity = Math.max(0, 1 - pct);
                if (content)  { content.style.opacity  = opacity; content.style.transform  = `translateY(${scrolled * 0.28}px)`; }
                if (scrollEl) { scrollEl.style.opacity = opacity; }
            }
            ticking = false;
        });
    }, { passive: true });
}

/**
 * Smooth scrolling for in-page anchors.
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
 * Clicking the scroll indicator jumps to the first main section.
 */
function initScrollIndicator() {
    const btn = document.querySelector('.scroll-indicator');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const target = document.querySelector('.about-section') || document.querySelector('main');
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
}

/**
 * Immediately reveal fade-in sections already visible on page load.
 */
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
    document.querySelectorAll('.fade-in-section').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            el.classList.add('visible');
            staggerItems(el);
        }
    });
});
