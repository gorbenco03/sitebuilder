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
(function (root) {
    'use strict';
    // Reed-Solomon GF(256) tables
    var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    (function () {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            EXP[i] = x; LOG[x] = i;
            x = x << 1; if (x & 0x100) x ^= 0x11d;
        }
        for (var i2 = 255; i2 < 512; i2++) EXP[i2] = EXP[i2 - 255];
    })();
    function gfMul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
    function gfPolyMul(p, q) {
        var r = new Uint8Array(p.length + q.length - 1);
        for (var i = 0; i < p.length; i++)
            for (var j = 0; j < q.length; j++)
                r[i + j] ^= gfMul(p[i], q[j]);
        return r;
    }
    function rsGenerator(n) {
        var g = new Uint8Array([1]);
        for (var i = 0; i < n; i++) g = gfPolyMul(g, new Uint8Array([1, EXP[i]]));
        return g;
    }
    function rsEncode(data, n) {
        var gen = rsGenerator(n), msg = new Uint8Array(data.length + n);
        msg.set(data);
        for (var i = 0; i < data.length; i++) {
            var c = msg[i];
            if (c) for (var j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], c);
        }
        return msg.slice(data.length);
    }

    // QR version/ec tables (version 1-10, level M)
    var EC_M = [
        null,
        {total:26, data:16, ec:10, blocks:1},
        {total:44, data:28, ec:16, blocks:1},
        {total:70, data:44, ec:26, blocks:1},
        {total:100, data:64, ec:18, blocks:2},
        {total:134, data:86, ec:24, blocks:2},
        {total:172, data:108, ec:16, blocks:4},
        {total:196, data:124, ec:18, blocks:4},
        {total:242, data:154, ec:22, blocks:2},
        {total:292, data:182, ec:22, blocks:3},
        {total:346, data:216, ec:26, blocks:4}
    ];

    function getVersion(byteLen) {
        for (var v = 1; v <= 10; v++)
            if (EC_M[v] && EC_M[v].data >= byteLen + 2) return v;
        return -1;
    }

    // Alignment pattern positions
    var ALIGN = [null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];

    function makeMatrix(v) {
        var s = v * 4 + 17, m = [];
        for (var i = 0; i < s; i++) { m[i] = new Int8Array(s); for (var j = 0; j < s; j++) m[i][j] = -1; }

        function setFinder(r, c) {
            for (var i = -1; i <= 7; i++) for (var j = -1; j <= 7; j++) {
                var rr = r + i, cc = c + j; if (rr < 0 || rr >= s || cc < 0 || cc >= s) continue;
                var onBorder = (i === -1 || i === 7 || j === -1 || j === 7);
                var onInner = (i >= 1 && i <= 5 && j >= 1 && j <= 5);
                m[rr][cc] = (onBorder || onInner) ? 1 : 0;
            }
        }
        setFinder(0, 0); setFinder(0, s - 7); setFinder(s - 7, 0);

        // Timing
        for (var i2 = 8; i2 < s - 8; i2++) { m[6][i2] = i2 % 2 === 0 ? 1 : 0; m[i2][6] = i2 % 2 === 0 ? 1 : 0; }

        // Alignment
        var ap = ALIGN[v];
        for (var ai = 0; ai < ap.length; ai++) for (var aj = 0; aj < ap.length; aj++) {
            var ar = ap[ai], ac = ap[aj];
            if (m[ar][ac] !== -1) continue;
            for (var di = -2; di <= 2; di++) for (var dj = -2; dj <= 2; dj++) {
                var rv = di === -2 || di === 2 || dj === -2 || dj === 2 ? 1 : (di === 0 && dj === 0 ? 1 : 0);
                m[ar + di][ac + dj] = rv;
            }
        }

        // Dark module
        m[s - 8][8] = 1;
        return m;
    }

    function placeFormat(m, mask) {
        var s = m.length;
        var fmt = [0,1,1,0,1,1,1,1,1,0,0,1,0,1,0]; // level M, mask bits (filled per mask)
        // Format info string: EC level M = 00, mask pattern
        var fmtData = (1 << 3) | mask; // 01 for M (after XOR with 101010000010010 = 21522)
        // Compute format bits: 5-bit data + 10-bit ECC
        var gen = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
        var rem = fmtData << 10;
        for (var i2 = 4; i2 >= 0; i2--) { if (rem & (1 << (i2 + 10))) rem ^= gen << i2; }
        var bits = ((fmtData << 10) | rem) ^ 21522;
        var seq = [];
        for (var b = 14; b >= 0; b--) seq.push((bits >> b) & 1);
        // Place in matrix
        var positions = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
        var positions2 = [[s-1,8],[s-2,8],[s-3,8],[s-4,8],[s-5,8],[s-6,8],[s-7,8],[8,s-8],[8,s-7],[8,s-6],[8,s-5],[8,s-4],[8,s-3],[8,s-2],[8,s-1]];
        for (var pi = 0; pi < 15; pi++) {
            m[positions[pi][0]][positions[pi][1]] = seq[pi];
            m[positions2[pi][0]][positions2[pi][1]] = seq[pi];
        }
    }

    function placeData(m, data) {
        var s = m.length, col = s - 1, row = s - 1, up = true, bitIdx = 0;
        var total = data.length * 8;
        while (col > 0) {
            if (col === 6) col--;
            for (var r2 = 0; r2 < s; r2++) {
                var rr = up ? (s - 1 - r2) : r2;
                for (var cc = 0; cc < 2; cc++) {
                    var c2 = col - cc;
                    if (m[rr][c2] !== -1) continue;
                    var bit = 0;
                    if (bitIdx < total) { var byte = data[bitIdx >> 3]; bit = (byte >> (7 - (bitIdx & 7))) & 1; }
                    m[rr][c2] = bit;
                    bitIdx++;
                }
            }
            col -= 2; up = !up;
        }
    }

    function applyMask(m, maskId) {
        var s = m.length, fn;
        var fns = [
            function(r,c){return (r+c)%2===0;},
            function(r){return r%2===0;},
            function(_,c){return c%3===0;},
            function(r,c){return (r+c)%3===0;},
            function(r,c){return (Math.floor(r/2)+Math.floor(c/3))%2===0;},
            function(r,c){return (r*c)%2+(r*c)%3===0;},
            function(r,c){return ((r*c)%2+(r*c)%3)%2===0;},
            function(r,c){return ((r+c)%2+(r*c)%3)%2===0;}
        ];
        fn = fns[maskId];
        var nm = [];
        for (var i = 0; i < s; i++) {
            nm[i] = new Int8Array(s);
            for (var j = 0; j < s; j++) {
                nm[i][j] = m[i][j];
                if (m[i][j] !== -1 && fn(i, j)) nm[i][j] ^= 1;
            }
        }
        return nm;
    }

    function encode(text) {
        var bytes = [];
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c < 128) { bytes.push(c); }
            else if (c < 2048) { bytes.push(0xC0|(c>>6)); bytes.push(0x80|(c&63)); }
            else { bytes.push(0xE0|(c>>12)); bytes.push(0x80|((c>>6)&63)); bytes.push(0x80|(c&63)); }
        }
        var v = getVersion(bytes.length);
        if (v < 0) return null;
        var ec = EC_M[v];
        // Build data codewords
        var buf = [], cap = ec.data;
        // Header: byte mode (0100), char count (8 bits), data
        var header = (4 << 4) | ((bytes.length >> 4) & 0xF);
        buf.push(((4 << 4) | (bytes.length >> 4)) & 0xFF);
        buf.push(((bytes.length & 0xF) << 4) | ((bytes[0] >> 4) & 0xF));
        for (var i2 = 0; i2 < bytes.length - 1; i2++)
            buf.push(((bytes[i2] & 0xF) << 4) | ((bytes[i2+1] >> 4) & 0xF));
        buf.push((bytes[bytes.length-1] & 0xF) << 4);
        // Terminator + padding
        while (buf.length < cap) buf.push(buf.length % 2 === 0 ? 0xEC : 0x11);

        // RS error correction
        var data = new Uint8Array(buf);
        var ecBytes = rsEncode(data, ec.total - ec.data);
        var allData = new Uint8Array(ec.total);
        allData.set(data); allData.set(ecBytes, data.length);

        // Build matrix
        var mat = makeMatrix(v);
        placeData(mat, allData);
        var best = applyMask(mat, 5); // mask pattern 5 is reliable for URLs
        placeFormat(best, 5);

        return best;
    }

    function toSVG(matrix, size) {
        if (!matrix) return '';
        var s = matrix.length, cell = size / s;
        var rects = [];
        for (var r = 0; r < s; r++) {
            for (var c = 0; c < s; c++) {
                if (matrix[r][c] === 1) {
                    rects.push('<rect x="' + (c * cell).toFixed(2) + '" y="' + (r * cell).toFixed(2) +
                        '" width="' + cell.toFixed(2) + '" height="' + cell.toFixed(2) + '" fill="#1A1714"/>');
                }
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
            '" width="' + size + '" height="' + size + '" style="background:#fff">' +
            rects.join('') + '</svg>';
    }

    root.generateQRSVG = function (text, size) { return toSVG(encode(text), size || 240); };
})(window);

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
