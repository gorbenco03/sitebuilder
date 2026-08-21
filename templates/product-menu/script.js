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
});

// ── WhatsApp QR modal ─────────────────────────────────────
// On DESKTOP: intercept all wa.me links and show a QR instead.
// On MOBILE:  the wa.me link opens directly (keeps the pre-filled draft).
function initWhatsAppQR() {
    const modal   = document.getElementById('wa-qr');
    const img     = document.getElementById('wa-qr-img');
    const links   = document.querySelectorAll('a[href*="wa.me"]');
    if (!modal || !img || !links.length) return;

    const ua       = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ||
                     (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
    if (isMobile) return;

    const openBtn = document.getElementById('wa-qr-open');

    function openQr(waUrl) {
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=' +
                  encodeURIComponent(waUrl);
        if (openBtn) openBtn.href = waUrl;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeQr() {
        modal.hidden = true;
        document.body.style.overflow = '';
        img.removeAttribute('src');
    }

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
        document.documentElement.setAttribute('lang', lang);
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
