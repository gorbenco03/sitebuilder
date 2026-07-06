// CONSTRUCTII template — script.js
// Vanilla JS only, defensive (each init early-returns if elements are absent).

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initParallax();
    initSmoothScroll();
    initScrollIndicator();
    initWhatsAppQR();
    initLightbox();
    initContactRipple();
});

// ============================================================
// WHATSAPP QR MODAL (desktop only)
// On desktop a QR is shown so the pre-filled message is kept on the phone.
// On mobile / tablet wa.me link opens directly.
// ============================================================
function initWhatsAppQR() {
    const modal   = document.getElementById('wa-qr');
    const img     = document.getElementById('wa-qr-img');
    const links   = document.querySelectorAll('a[href*="wa.me"]');
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

// ============================================================
// LIGHTBOX — full-screen image viewer triggered by photo-card clicks
// ============================================================
function initLightbox() {
    const photos = Array.from(document.querySelectorAll('.photo-card img'));
    if (!photos.length) return;

    // Build lightbox DOM once
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.hidden = true;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Previzualizare fotografie');
    lb.innerHTML = `
        <button class="lightbox-close" aria-label="Inchide">&times;</button>
        <button class="lightbox-nav lightbox-prev" aria-label="Anterioara">&#8249;</button>
        <img class="lightbox-img" src="" alt="">
        <button class="lightbox-nav lightbox-next" aria-label="Urmatoarea">&#8250;</button>
    `;
    document.body.appendChild(lb);

    const lbImg   = lb.querySelector('.lightbox-img');
    const closeEl = lb.querySelector('.lightbox-close');
    const prevEl  = lb.querySelector('.lightbox-prev');
    const nextEl  = lb.querySelector('.lightbox-next');

    let current = 0;

    const show = (idx) => {
        current = (idx + photos.length) % photos.length;
        lbImg.src = photos[current].src;
        lbImg.alt = photos[current].alt || '';
        lb.hidden = false;
        document.body.style.overflow = 'hidden';
        closeEl.focus();
    };

    const close = () => {
        lb.hidden = true;
        document.body.style.overflow = '';
        lbImg.src = '';
    };

    photos.forEach((img, i) => {
        const card = img.closest('.photo-card');
        if (!card) return;
        card.addEventListener('click', () => show(i));
        card.setAttribute('tabindex', '0');
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); }
        });
    });

    closeEl.addEventListener('click', close);
    prevEl.addEventListener('click', () => show(current - 1));
    nextEl.addEventListener('click', () => show(current + 1));

    lb.addEventListener('click', (e) => {
        if (e.target === lb) close();
    });

    document.addEventListener('keydown', (e) => {
        if (lb.hidden) return;
        if (e.key === 'Escape')    close();
        if (e.key === 'ArrowLeft') show(current - 1);
        if (e.key === 'ArrowRight') show(current + 1);
    });
}

// ============================================================
// SCROLL-TRIGGERED FADE-IN + STAGGER
// ============================================================
function initScrollAnimations() {
    const sections = document.querySelectorAll('.fade-in-section');
    if (!sections.length) return;

    const reveal = (el) => {
        el.classList.add('visible');
        stagger(el, '.service-card', 60);
        stagger(el, '.trust-card', 80);
    };

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            reveal(entry.target);
            obs.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -80px 0px', threshold: 0.08 });

    sections.forEach(el => observer.observe(el));

    // Immediately reveal any section already in viewport on load
    window.addEventListener('load', () => {
        sections.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight) reveal(el);
        });
    });
}

function stagger(parent, selector, stepMs) {
    parent.querySelectorAll(selector).forEach((card, i) => {
        card.style.setProperty('--reveal-delay', `${Math.min(i * stepMs, 480)}ms`);
    });
}

// ============================================================
// HERO PARALLAX — fades and shifts content on scroll
// ============================================================
function initParallax() {
    const hero        = document.querySelector('.hero');
    const heroContent = document.querySelector('.hero-content');
    const scrollBtn   = document.querySelector('.scroll-indicator');
    if (!hero) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
                if (scrollBtn) scrollBtn.style.opacity = opacity;
            }
            ticking = false;
        });
    }, { passive: true });
}

// ============================================================
// SMOOTH SCROLLING for anchor links
// ============================================================
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', function (e) {
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

// ============================================================
// SCROLL INDICATOR — click to jump to main content
// ============================================================
function initScrollIndicator() {
    const btn = document.querySelector('.scroll-indicator');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const main = document.querySelector('.main-content');
        if (main) main.scrollIntoView({ behavior: 'smooth' });
    });
}

// ============================================================
// CONTACT RIPPLE — subtle tap feedback on contact rows
// ============================================================
function initContactRipple() {
    document.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', function (e) {
            const ripple = document.createElement('span');
            ripple.style.cssText = `
                position: absolute;
                background: rgba(255, 255, 255, 0.22);
                border-radius: 50%;
                transform: scale(0);
                animation: ripple 0.55s linear;
                pointer-events: none;
            `;
            const rect = this.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width  = ripple.style.height = size + 'px';
            ripple.style.left   = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top    = (e.clientY - rect.top  - size / 2) + 'px';
            this.style.position = 'relative';
            this.style.overflow = 'hidden';
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 560);
        });
    });

    const style = document.createElement('style');
    style.textContent = `@keyframes ripple { to { transform: scale(4); opacity: 0; } }`;
    document.head.appendChild(style);
}
