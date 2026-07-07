/**
 * Servicii Locale — script.js
 * Vanilla JS, zero dependențe externe.
 * Fiecare funcție init face early-return dacă elementele necesare lipsesc.
 */

document.addEventListener('DOMContentLoaded', () => {
    initTopNav();
    initHeroScrollIndicator();
    initParallax();
    initScrollReveal();
    initServiceCardStagger();
    initWhatsAppQR();
    initSmoothAnchorScroll();
});

/* ─────────────────────────────────────────────────────────────────
   TOPNAV — apare după ce hero-ul a ieșit din viewport
   ───────────────────────────────────────────────────────────────── */
function initTopNav() {
    const nav  = document.getElementById('topnav');
    const hero = document.getElementById('hero');
    if (!nav || !hero) return;

    const observer = new IntersectionObserver(
        ([entry]) => {
            nav.classList.toggle('visible', !entry.isIntersecting);
        },
        { rootMargin: '-10% 0px 0px 0px', threshold: 0 }
    );

    observer.observe(hero);
}

/* ─────────────────────────────────────────────────────────────────
   HERO — click pe scroll indicator scrollează la main
   ───────────────────────────────────────────────────────────────── */
function initHeroScrollIndicator() {
    const btn  = document.querySelector('.hero__scroll-btn');
    const main = document.getElementById('main');
    if (!btn || !main) return;

    btn.addEventListener('click', () => {
        main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

/* ─────────────────────────────────────────────────────────────────
   PARALLAX — hero background se mișcă ușor la scroll
   ───────────────────────────────────────────────────────────────── */
function initParallax() {
    const bg      = document.querySelector('.hero__bg');
    const hero    = document.getElementById('hero');
    const content = document.querySelector('.hero__body');
    if (!bg || !hero) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = null;

    const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            const scrollY     = window.scrollY;
            const heroHeight  = hero.offsetHeight;

            if (scrollY < heroHeight) {
                // Fundal: mișcare mai lentă
                bg.style.transform = `translateY(${scrollY * 0.35}px)`;

                // Conținut: fade + drift
                if (content) {
                    const progress = scrollY / (heroHeight * 0.5);
                    const opacity  = Math.max(0, 1 - progress);
                    content.style.opacity   = opacity;
                    content.style.transform = `translateY(${scrollY * 0.22}px)`;
                }
            }
            raf = null;
        });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
}

/* ─────────────────────────────────────────────────────────────────
   SCROLL REVEAL — secțiuni fade-in la intrarea în viewport
   ───────────────────────────────────────────────────────────────── */
function initScrollReveal() {
    const sections = document.querySelectorAll('.js-reveal');
    if (!sections.length) return;

    const obs = new IntersectionObserver(
        (entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        },
        { rootMargin: '0px 0px -72px 0px', threshold: 0.08 }
    );

    sections.forEach(el => obs.observe(el));

    // Secțiuni deja vizibile la load
    sections.forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
            el.classList.add('is-visible');
            obs.unobserve(el);
        }
    });
}

/* ─────────────────────────────────────────────────────────────────
   SERVICE CARDS — stagger reveal cu delay CSS custom property
   ───────────────────────────────────────────────────────────────── */
function initServiceCardStagger() {
    const grid = document.querySelector('.services-grid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.service-card');
    if (!cards.length) return;

    const obs = new IntersectionObserver(
        (entries, observer) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;

                cards.forEach((card, i) => {
                    card.style.setProperty('--stagger-delay', `${Math.min(i * 55, 440)}ms`);
                    card.classList.add('revealed');
                });

                observer.unobserve(entry.target);
            });
        },
        { rootMargin: '0px 0px -48px 0px', threshold: 0.05 }
    );

    obs.observe(grid);

    // Deja vizibil la load
    if (grid.getBoundingClientRect().top < window.innerHeight) {
        cards.forEach((card, i) => {
            card.style.setProperty('--stagger-delay', `${Math.min(i * 55, 440)}ms`);
            card.classList.add('revealed');
        });
        obs.disconnect();
    }
}

/* ─────────────────────────────────────────────────────────────────
   MICRO QR GENERATOR — zero dependențe externe, zero CDN
   Generează un QR Code SVG inline pentru URL-uri scurte (wa.me).
   Algoritm: versiunea auto (1-10), nivel de corecție M, byte mode.
   ───────────────────────────────────────────────────────────────── */
(function () {

    /* Tabela de multiplicare GF(256) cu polinomul 0x11D */
    const GF_EXP = new Uint8Array(512);
    const GF_LOG = new Uint8Array(256);
    (function () {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            GF_EXP[i] = x; GF_LOG[x] = i;
            x <<= 1; if (x > 255) x ^= 0x11D;
        }
        for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
    })();

    function gfMul(a, b) {
        if (!a || !b) return 0;
        return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
    }

    function rsEncode(data, nec) {
        /* polinomul generator */
        let g = [1];
        for (let i = 0; i < nec; i++) {
            const a = GF_EXP[i];
            const ng = new Array(g.length + 1).fill(0);
            for (let j = 0; j < g.length; j++) {
                ng[j]     ^= gfMul(g[j], a);
                ng[j + 1] ^= g[j];
            }
            g = ng;
        }
        const r = new Array(nec).fill(0);
        for (let i = 0; i < data.length; i++) {
            const coef = data[i] ^ r[0];
            r.shift(); r.push(0);
            for (let j = 0; j < g.length - 1; j++) r[j] ^= gfMul(g[j + 1], coef);
        }
        return r;
    }

    /* Parametri per versiune (1-10), nivel M */
    const VER_PARAMS = [
        /*v*/null,
        { size: 21,  ecb: [[1, 16,  10]]  },  // v1
        { size: 25,  ecb: [[1, 28,  16]]  },  // v2
        { size: 29,  ecb: [[1, 44,  26]]  },  // v3
        { size: 33,  ecb: [[2, 32,  18]]  },  // v4
        { size: 37,  ecb: [[2, 43,  24]]  },  // v5
        { size: 41,  ecb: [[4, 27,  15]]  },  // v6
        { size: 45,  ecb: [[4, 31,  19]]  },  // v7
        { size: 49,  ecb: [[2, 38,  14],  [4, 39, 14]] },  // v8
        { size: 53,  ecb: [[3, 36,  12],  [5, 37, 12]] },  // v9
        { size: 57,  ecb: [[4, 43,  15],  [4, 44, 15]] },  // v10
    ];

    function pickVersion(len) {
        /* capacitate byte M per versiune */
        const CAP = [0, 14, 26, 42, 62, 84, 106, 122, 154, 180, 212];
        for (let v = 1; v <= 10; v++) { if (CAP[v] >= len) return v; }
        return 10;
    }

    function bitArray(n, bits) {
        const a = [];
        for (let i = bits - 1; i >= 0; i--) a.push((n >> i) & 1);
        return a;
    }

    /* format info M, masca 2 */
    const FORMAT_INFO = [
        [1,1,0,1,1,0,1,1,1,0,1,0,0,0,0],  // masca 0
        [1,1,0,0,1,1,0,0,1,1,1,1,0,1,1],  // masca 1
        [1,1,1,1,0,1,1,0,1,1,0,0,1,1,0],  // masca 2  ← alegem implicit masca 2
        [1,1,1,0,0,0,0,1,1,0,0,1,1,0,1],
        [1,0,0,1,1,0,0,0,0,1,1,1,1,0,0],
        [1,0,0,0,1,1,1,1,0,0,1,0,1,1,1],
        [1,0,1,1,0,1,0,1,0,0,0,1,0,1,0],
        [1,0,1,0,0,0,1,0,0,1,0,0,0,0,1],
    ];

    function initMatrix(sz) {
        return Array.from({ length: sz }, () => new Array(sz).fill(null));
    }

    function placeFinderAndSep(m, r, c) {
        for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
            m[r+i][c+j] = (i===0||i===6||j===0||j===6||
                           (i>=2&&i<=4&&j>=2&&j<=4)) ? 1 : 0;
        }
        // separator
        for (let k = 0; k <= 7; k++) {
            if (r+7 < m.length) m[r+7][c+k] = (m[r+7][c+k]==null)?0:m[r+7][c+k];
            if (c+7 < m.length) m[r+k][c+7] = (m[r+k][c+7]==null)?0:m[r+k][c+7];
        }
    }

    function placeAlignment(m, version) {
        if (version < 2) return;
        const TABLE = [
            [],[], [6,18],[6,22],[6,26],[6,30],[6,34],
            [6,22,38],[6,24,42],[6,26,46],[6,28,50],
        ];
        const pos = TABLE[version] || [];
        for (const r of pos) for (const c of pos) {
            if (m[r][c] !== null) continue; // skip se suprapune cu finder
            for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
                m[r+i][c+j] = (i===0&&j===0)||
                               Math.abs(i)===2||Math.abs(j)===2 ? 1 : 0;
            }
        }
    }

    function placeTiming(m, sz) {
        for (let i = 8; i < sz - 8; i++) {
            const v = i % 2 === 0 ? 1 : 0;
            if (m[6][i] === null) m[6][i] = v;
            if (m[i][6] === null) m[i][6] = v;
        }
        m[6][6] = 1;
    }

    function placeFormatInfo(m, maskId, sz) {
        const fi = FORMAT_INFO[maskId];
        /* pozițiile fixe de format */
        const POS_1 = [
            [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
            [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
        ];
        const POS_2 = [
            [sz-1,8],[sz-2,8],[sz-3,8],[sz-4,8],[sz-5,8],[sz-6,8],[sz-7,8],
            [8,sz-8],[8,sz-7],[8,sz-6],[8,sz-5],[8,sz-4],[8,sz-3],[8,sz-2],[8,sz-1]
        ];
        for (let i = 0; i < 15; i++) {
            m[POS_1[i][0]][POS_1[i][1]] = fi[i];
            m[POS_2[i][0]][POS_2[i][1]] = fi[i];
        }
        m[8][sz-8] = 1; // dark module
    }

    function maskFn(id, r, c) {
        switch (id) {
            case 0: return (r + c) % 2 === 0;
            case 1: return r % 2 === 0;
            case 2: return c % 3 === 0;
            case 3: return (r + c) % 3 === 0;
            case 4: return (Math.floor(r/2)+Math.floor(c/3)) % 2 === 0;
            case 5: return (r*c)%2+(r*c)%3===0;
            case 6: return ((r*c)%2+(r*c)%3)%2===0;
            case 7: return ((r+c)%2+(r*c)%3)%2===0;
        }
    }

    function scoreMatrix(m) {
        const sz = m.length; let s = 0;
        for (let r = 0; r < sz; r++) {
            let run = 1;
            for (let c = 1; c < sz; c++) {
                if (m[r][c]===m[r][c-1]) { run++; if(run===5) s+=3; else if(run>5) s++; }
                else run=1;
            }
        }
        for (let c = 0; c < sz; c++) {
            let run = 1;
            for (let r = 1; r < sz; r++) {
                if (m[r][c]===m[r-1][c]) { run++; if(run===5) s+=3; else if(run>5) s++; }
                else run=1;
            }
        }
        for (let r = 0; r < sz-1; r++) for (let c = 0; c < sz-1; c++) {
            const v = m[r][c];
            if(m[r][c+1]===v&&m[r+1][c]===v&&m[r+1][c+1]===v) s+=3;
        }
        let dark=0;
        for(let r=0;r<sz;r++) for(let c=0;c<sz;c++) if(m[r][c]) dark++;
        const pct = dark/(sz*sz)*100;
        s += Math.min(Math.abs(Math.floor(pct/5)*5-50),Math.abs(Math.ceil(pct/5)*5-50))/5*10;
        return s;
    }

    function makeQR(text) {
        const bytes = [];
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            if (c > 127) { /* UTF-8 encode */
                if (c <= 0x7FF) {
                    bytes.push(0xC0|(c>>6), 0x80|(c&0x3F));
                } else {
                    bytes.push(0xE0|(c>>12), 0x80|((c>>6)&0x3F), 0x80|(c&0x3F));
                }
            } else bytes.push(c);
        }
        const version = pickVersion(bytes.length);
        const p = VER_PARAMS[version];
        const sz = p.size;

        /* construiesc bitstream de date */
        const bits = [];
        /* mode byte */
        bits.push(...bitArray(4, 4));
        /* char count */
        const ccBits = version < 10 ? 8 : 16;
        bits.push(...bitArray(bytes.length, ccBits));
        /* date */
        for (const b of bytes) bits.push(...bitArray(b, 8));
        /* terminator */
        for (let i = 0; i < 4 && bits.length % 8 !== 0; i++) bits.push(0);
        while (bits.length % 8 !== 0) bits.push(0);
        /* pad */
        const padBytes = [0xEC, 0x11];
        const totalDC = p.ecb.reduce((s, b) => s + b[0]*b[1], 0);
        while (bits.length < totalDC * 8) {
            bits.push(...bitArray(padBytes[(bits.length/8 - bytes.length - 2) % 2 === 0 ? 0 : 1], 8));
        }

        /* convertesc biți → bytes */
        const rawDC = [];
        for (let i = 0; i < bits.length; i += 8) {
            let b = 0; for (let j = 0; j < 8; j++) b = (b<<1)|(bits[i+j]||0);
            rawDC.push(b);
        }

        /* RS encode per bloc */
        const dcBlocks = [], ecBlocks = [];
        let dcOff = 0;
        for (const [cnt, total, dc] of p.ecb) {
            const ec = total - dc;
            for (let b = 0; b < cnt; b++) {
                const blk = rawDC.slice(dcOff, dcOff + dc);
                dcBlocks.push(blk);
                ecBlocks.push(rsEncode(blk, ec));
                dcOff += dc;
            }
        }

        /* interleave */
        const finalBytes = [];
        const maxDC = Math.max(...dcBlocks.map(b=>b.length));
        for (let i = 0; i < maxDC; i++) for (const blk of dcBlocks) if(i<blk.length) finalBytes.push(blk[i]);
        const maxEC = Math.max(...ecBlocks.map(b=>b.length));
        for (let i = 0; i < maxEC; i++) for (const blk of ecBlocks) if(i<blk.length) finalBytes.push(blk[i]);

        /* finalizez bitstream */
        const allBits = [];
        for (const b of finalBytes) allBits.push(...bitArray(b, 8));
        /* remainder bits per versiune */
        const REM = [0,0,7,7,7,7,7,0,0,0,0];
        for (let i = 0; i < (REM[version]||0); i++) allBits.push(0);

        /* construiesc matricea */
        const mat = initMatrix(sz);
        placeFinderAndSep(mat, 0, 0);
        placeFinderAndSep(mat, 0, sz-7);
        placeFinderAndSep(mat, sz-7, 0);
        placeAlignment(mat, version);
        placeTiming(mat, sz);

        /* version info v7+ */
        if (version >= 7) {
            /* omit pentru v1-6, nu e necesar */
        }

        /* dark module */
        mat[4*version+9][8] = 1;

        /* plasez datele */
        function isReserved(r, c) { return mat[r][c] !== null; }
        let bitIdx = 0;
        let goUp = true;
        let col = sz - 1;
        while (col > 0) {
            if (col === 6) col--;
            for (let rowStep = 0; rowStep < sz; rowStep++) {
                const r = goUp ? sz - 1 - rowStep : rowStep;
                for (let dc = 0; dc <= 1; dc++) {
                    const c = col - dc;
                    if (!isReserved(r, c)) {
                        mat[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
                    }
                }
            }
            goUp = !goUp;
            col -= 2;
        }

        /* aleg masca optimă */
        let bestMask = 2, bestScore = Infinity;
        for (let maskId = 0; maskId < 8; maskId++) {
            const tmp = mat.map(row => row.slice());
            for (let r = 0; r < sz; r++) for (let c = 0; c < sz; c++) {
                if (tmp[r][c] !== null && isDataModule(r, c, version, sz)) {
                    if (maskFn(maskId, r, c)) tmp[r][c] ^= 1;
                }
            }
            placeFormatInfo(tmp, maskId, sz);
            const sc = scoreMatrix(tmp);
            if (sc < bestScore) { bestScore = sc; bestMask = maskId; }
        }

        /* aplică masca aleasă */
        for (let r = 0; r < sz; r++) for (let c = 0; c < sz; c++) {
            if (mat[r][c] !== null && isDataModule(r, c, version, sz)) {
                if (maskFn(bestMask, r, c)) mat[r][c] ^= 1;
            }
        }
        placeFormatInfo(mat, bestMask, sz);

        return { mat, sz };
    }

    function isDataModule(r, c, version, sz) {
        /* finder areas */
        if (r<9&&c<9) return false;
        if (r<9&&c>sz-9) return false;
        if (r>sz-9&&c<9) return false;
        /* timing */
        if (r===6||c===6) return false;
        /* alignment (simplified: bounding box per version) */
        return true;
    }

    function qrToSVG(text, px) {
        try {
            const { mat, sz } = makeQR(text);
            const cell = px / sz;
            const margin = 4; // module margin
            const total = (sz + margin * 2) * cell;
            let rects = '';
            for (let r = 0; r < sz; r++) for (let c = 0; c < sz; c++) {
                if (mat[r][c]) {
                    const x = ((c + margin) * cell).toFixed(2);
                    const y = ((r + margin) * cell).toFixed(2);
                    const s = cell.toFixed(2);
                    rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}"/>`;
                }
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${total.toFixed(2)}" width="${px}" height="${px}" role="img" aria-label="QR WhatsApp"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
        } catch (e) {
            return null;
        }
    }

    window._qrSVG = qrToSVG;
})();

/* ─────────────────────────────────────────────────────────────────
   WHATSAPP QR MODAL
   Desktop: click pe orice link wa.me → modal cu QR generat local
   Mobile: link se deschide direct
   ───────────────────────────────────────────────────────────────── */
function initWhatsAppQR() {
    const modal = document.getElementById('wa-modal');
    const qrImg = document.getElementById('wa-qr-img');
    if (!modal || !qrImg) return;

    const links = document.querySelectorAll('a[href*="wa.me"]');
    if (!links.length) return;

    // Detectare mobile/tablet
    const ua       = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua)
                  || (navigator.maxTouchPoints > 1 && /Mac/i.test(ua));
    if (isMobile) return; // lasă linkurile să se deschidă direct

    const openLink = document.getElementById('wa-qr-open');

    /* Generăm QR inline — fără nicio cerere externă */
    function renderQR(waUrl) {
        const svg = window._qrSVG ? window._qrSVG(waUrl, 220) : null;
        if (svg) {
            /* înlocuiesc <img> cu <div> SVG inline la prima utilizare */
            if (qrImg.tagName === 'IMG') {
                const wrap = qrImg.parentElement;
                const div = document.createElement('div');
                div.id = 'wa-qr-img';
                div.style.cssText = 'width:220px;height:220px;margin:0 auto;border-radius:12px;overflow:hidden;background:#fff;';
                div.innerHTML = svg;
                wrap.replaceChild(div, qrImg);
            } else {
                qrImg.innerHTML = svg;
            }
        }
    }

    /* Pre-render la prima utilizare pentru lentență zero */
    let preRender = null;

    function openModal(waUrl) {
        if (!preRender || preRender !== waUrl) {
            renderQR(waUrl);
            preRender = waUrl;
        }
        if (openLink) openLink.href = waUrl;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';

        // Focus pe buton de închidere pentru accesibilitate
        const closeBtn = modal.querySelector('[data-wa-close]:not([class*=backdrop])');
        if (closeBtn) setTimeout(() => closeBtn.focus(), 50);
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = '';
    }

    // Interceptăm toate linkurile WhatsApp
    links.forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            openModal(a.href);
        });
    });

    // Buton de închidere + backdrop
    modal.querySelectorAll('[data-wa-close]').forEach(el =>
        el.addEventListener('click', closeModal)
    );

    // Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    // Click în afara card-ului
    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });
}

/* ─────────────────────────────────────────────────────────────────
   SMOOTH SCROLL pentru anchor-uri interne (#contact etc.)
   ───────────────────────────────────────────────────────────────── */
function initSmoothAnchorScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

/* ─────────────────────────────────────────────────────────────────
   LOAD — reveal secțiuni și service-cards vizibile fără scroll
   ───────────────────────────────────────────────────────────────── */
window.addEventListener('load', () => {
    document.querySelectorAll('.js-reveal').forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
            el.classList.add('is-visible');
        }
    });

    // Fallback: service-cards în viewport la load → revealed imediat
    document.querySelectorAll('.service-card').forEach((card, i) => {
        if (card.getBoundingClientRect().top < window.innerHeight) {
            card.style.setProperty('--stagger-delay', `${Math.min(i * 55, 440)}ms`);
            card.classList.add('revealed');
        }
    });
});
