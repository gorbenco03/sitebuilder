// Desserdirina Landing Page JavaScript

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initParallaxEffect();
    initGalleryEffects();
    initSmoothScrolling();
});

/**
 * Scroll-triggered fade-in animations
 */
function initScrollAnimations() {
    const fadeElements = document.querySelectorAll('.fade-in-section');

    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -100px 0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                if (entry.target.classList.contains('gallery-preview')) {
                    triggerGalleryAnimations(entry.target);
                }
                if (entry.target.classList.contains('instagram-section')) {
                    triggerInstagramAnimations(entry.target);
                }
            }
        });
    }, observerOptions);

    fadeElements.forEach(el => observer.observe(el));
}

/**
 * Trigger staggered gallery item animations
 */
function triggerGalleryAnimations(section) {
    const items = section.querySelectorAll('.gallery-item');
    items.forEach((item) => {
        item.style.animationPlayState = 'running';
    });
}

/**
 * Trigger Instagram grid animations
 */
function triggerInstagramAnimations(section) {
    const posts = section.querySelectorAll('.insta-post');
    posts.forEach((post) => {
        post.style.animationPlayState = 'running';
    });
}

/**
 * Parallax effect for hero section
 */
function initParallaxEffect() {
    const hero = document.querySelector('.hero');
    const heroContent = hero?.querySelector('.hero-content');
    const scrollIndicator = hero?.querySelector('.scroll-indicator');

    if (!hero) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    let ticking = false;

    window.addEventListener('scroll', () => {
        if (!ticking) {
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

            ticking = true;
        }
    });
}

/**
 * Gallery hover effects
 */
function initGalleryEffects() {
    const galleryItems = document.querySelectorAll('.gallery-item, .insta-post');

    galleryItems.forEach(item => {
        item.addEventListener('mouseenter', () => {
            const siblings = Array.from(item.parentElement.children);
            siblings.forEach(sibling => {
                if (sibling !== item) {
                    sibling.style.transform = 'scale(0.98)';
                    sibling.style.opacity = '0.8';
                }
            });
        });

        item.addEventListener('mouseleave', () => {
            const siblings = Array.from(item.parentElement.children);
            siblings.forEach(sibling => {
                sibling.style.transform = '';
                sibling.style.opacity = '';
            });
        });
    });
}

/**
 * Smooth scrolling for anchor links
 */
function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
}

/**
 * Service item hover effect
 */
document.querySelectorAll('.service-item').forEach(item => {
    item.addEventListener('mouseenter', function() {
        this.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    });
});

/**
 * Contact item interaction
 */
document.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', function(e) {
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

// Add ripple animation
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

/**
 * Handle scroll indicator click
 */
const scrollIndicator = document.querySelector('.scroll-indicator');
if (scrollIndicator) {
    scrollIndicator.style.cursor = 'pointer';
    scrollIndicator.addEventListener('click', () => {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.scrollIntoView({ behavior: 'smooth' });
        }
    });
}

/**
 * Loading state management
 */
window.addEventListener('load', () => {
    document.body.classList.add('loaded');

    const fadeElements = document.querySelectorAll('.fade-in-section');
    fadeElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            el.classList.add('visible');
        }
    });
});
