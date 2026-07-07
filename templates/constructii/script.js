// CONSTRUCTII template — script.js (v2 premium redesign)
// Vanilla JS, zero dependencies, fully defensive (early-return when elements absent).

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initScrollIndicator();
    initParallax();
    initWhatsAppQR();
    initLightbox();
    initContactRipple();
});

// ============================================================
// WHATSAPP QR MODAL (desktop only)
// On desktop shows QR so pre-filled message is kept on the phone.
// On mobile / tablet the wa.me link opens directly.
// ============================================================
function initWhatsAppQR() {
    const modal  = document.getElementById('wa-qr');
    const img    = document.getElementById('wa-qr-img');
    const links  = document.querySelectorAll('a[href*="wa.me"]');
    if (!modal || !img || !links.length) return;

    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    if (isMobile) return;

    const openBtn = document.getElementById('wa-qr-open');

    const openModal = (waUrl) => {
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data='
            + encodeURIComponent(waUrl);
        if (openBtn) openBtn.href = waUrl;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        // Return focus to close button for keyboard users
        const closeBtn = modal.querySelector('[data-wa-close] button, .wa-qr__close');
        if (closeBtn) closeBtn.focus();
    };

    const closeModal = () => {
        modal.hidden = true;
        document.body.style.overflow = '';
        // Clear src to stop any pending request
        setTimeout(() => { img.removeAttribute('src'); }, 300);
    };

    links.forEach(a => a.addEventListener('click', (e) => {
        e.preventDefault();
        openModal(a.href);
    }));

    modal.querySelectorAll('[data-wa-close]').forEach(el =>
        el.addEventListener('click', closeModal)
    );

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
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
