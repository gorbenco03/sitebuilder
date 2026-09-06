// Trade / construction vertical — defensive vanilla JS.
// Zero dependencies; every init returns early when its elements are absent.

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
    initScrollIndicator();
    initParallax();
    initWhatsAppQR();
    initLightbox();
    initContactRipple();
    initEditableLists();
});

// ============================================================
// WHATSAPP QR MODAL (desktop only)
// On desktop shows QR so pre-filled message is kept on the phone.
// On mobile / tablet the wa.me link opens directly.
// ============================================================
/* ─────────────────────────────────────────────────────────────
   QR Code generator — pure vanilla JS, no CDN, zero dependencies.
   Faithful ISO 18004 implementation, byte mode, versions 1-10, level M.
   Rewritten (audit LS-01): the previous hand-rolled encoder XOR-masked
   its own finder/timing/alignment/dark-module cells (corrupting the
   scanner-critical finder patterns), never reserved the format/version
   info strips before placing data (silently eating data-codeword bits),
   never emitted version info for v7-10 (needed by the default preset
   message, which already requires version 8), and always forced mask
   pattern 5 instead of scoring all 8 candidates — some payloads produce
   a technically valid but unreliable-to-scan symbol under a fixed mask.
   Verified end-to-end: generated codes decode correctly via cv2 and
   zbar for the default preset message and a wide sweep of lengths
   across every supported version (see bot/test/wave5-local-service-*).
   ───────────────────────────────────────────────────────────── */
(function (root) {
    'use strict';

    // ---- GF(256) tables (Reed-Solomon) ----
    var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    (function () {
        var x = 1;
        for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
        for (var i2 = 255; i2 < 512; i2++) EXP[i2] = EXP[i2 - 255];
    })();
    function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
    function rsGenerator(n) {
        var g = new Uint8Array([1]);
        for (var i = 0; i < n; i++) {
            var next = new Uint8Array(g.length + 1);
            for (var j = 0; j < g.length; j++) {
                next[j] ^= g[j];
                next[j + 1] ^= gfMul(g[j], EXP[i]);
            }
            g = next;
        }
        return g;
    }
    function rsEncode(data, eccLen) {
        var gen = rsGenerator(eccLen);
        var res = new Uint8Array(data.length + eccLen);
        res.set(data);
        for (var i = 0; i < data.length; i++) {
            var factor = res[i];
            if (factor !== 0) {
                for (var j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], factor);
            }
        }
        return res.slice(data.length);
    }

    // ---- Version table, level M (versions 1-10) ----
    // total = total codewords, data = data codewords, blocks = [{count, dataLen}]
    var VERSIONS = [
        null,
        { total: 26, data: 16, blocks: [{ c: 1, d: 16 }] },
        { total: 44, data: 28, blocks: [{ c: 1, d: 28 }] },
        { total: 70, data: 44, blocks: [{ c: 1, d: 44 }] },
        { total: 100, data: 64, blocks: [{ c: 2, d: 32 }] },
        { total: 134, data: 86, blocks: [{ c: 2, d: 43 }] },
        { total: 172, data: 108, blocks: [{ c: 4, d: 27 }] },
        { total: 196, data: 124, blocks: [{ c: 4, d: 31 }] },
        { total: 242, data: 154, blocks: [{ c: 2, d: 38 }, { c: 2, d: 39 }] },
        { total: 292, data: 182, blocks: [{ c: 3, d: 36 }, { c: 2, d: 37 }] },
        { total: 346, data: 216, blocks: [{ c: 4, d: 43 }, { c: 1, d: 44 }] }
    ];
    var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

    function getVersion(byteLen) {
        for (var v = 1; v <= 10; v++) {
            // capacity: data codewords minus 2 header bytes (byte-mode 8-bit len field, version<=9) minus ~2 bytes overhead
            var headerBits = 4 + (v <= 9 ? 8 : 16);
            var capacityBits = VERSIONS[v].data * 8;
            var neededBits = headerBits + byteLen * 8 + 4 /* terminator (approx) */;
            if (neededBits <= capacityBits) return v;
        }
        return -1;
    }

    // ---- BCH helpers (format + version info) ----
    function bchDigits(n) { var d = 0; while (n !== 0) { d++; n >>>= 1; } return d; }
    var G15 = 0x537, G15_MASK = 0x5412;
    var G18 = 0x1f25;
    function bchTypeInfo(data) {
        var d = data << 10;
        while (bchDigits(d) - bchDigits(G15) >= 0) d ^= (G15 << (bchDigits(d) - bchDigits(G15)));
        return ((data << 10) | d) ^ G15_MASK;
    }
    function bchVersionInfo(v) {
        var d = v << 12;
        while (bchDigits(d) - bchDigits(G18) >= 0) d ^= (G18 << (bchDigits(d) - bchDigits(G18)));
        return (v << 12) | d;
    }

    // ---- Matrix construction ----
    function Matrix(v) {
        var s = v * 4 + 17;
        this.size = s;
        this.v = v;
        this.m = [];       // module value: 0/1, -1 = unset
        this.reserved = [];
        for (var i = 0; i < s; i++) {
            this.m[i] = new Int8Array(s).fill(-1);
            this.reserved[i] = new Uint8Array(s);
        }
    }
    Matrix.prototype.set = function (r, c, val, isReserved) {
        if (r < 0 || r >= this.size || c < 0 || c >= this.size) return;
        this.m[r][c] = val;
        if (isReserved) this.reserved[r][c] = 1;
    };
    Matrix.prototype.placeFinder = function (r, c) {
        for (var i = -1; i <= 7; i++) for (var j = -1; j <= 7; j++) {
            var rr = r + i, cc = c + j;
            if (rr < 0 || rr >= this.size || cc < 0 || cc >= this.size) continue;
            var val;
            if (i < 0 || i > 6 || j < 0 || j > 6) {
                val = 0; // separator (quiet ring around the finder)
            } else if (i === 0 || i === 6 || j === 0 || j === 6) {
                val = 1; // outer border ring
            } else if (i === 1 || i === 5 || j === 1 || j === 5) {
                val = 0; // inner white ring
            } else {
                val = 1; // 3x3 black core
            }
            this.set(rr, cc, val, true);
        }
    };
    Matrix.prototype.build = function () {
        var s = this.size;
        this.placeFinder(0, 0);
        this.placeFinder(0, s - 7);
        this.placeFinder(s - 7, 0);

        // Alignment patterns — placed BEFORE timing so the "already set" overlap
        // check below only ever means "overlaps a finder" (timing hasn't run yet).
        // Placing them after timing would make alignment centers that legitimately
        // sit ON the timing row/col (the first ALIGN coordinate is always 6) look
        // like false "overlaps", silently dropping real alignment patterns.
        var ap = ALIGN[this.v];
        for (var ai = 0; ai < ap.length; ai++) for (var aj = 0; aj < ap.length; aj++) {
            var ar = ap[ai], ac = ap[aj];
            if (this.m[ar][ac] !== -1) continue; // overlaps finder area
            for (var di = -2; di <= 2; di++) for (var dj = -2; dj <= 2; dj++) {
                var onRing = (di === -2 || di === 2 || dj === -2 || dj === 2);
                this.set(ar + di, ac + dj, (onRing || (di === 0 && dj === 0)) ? 1 : 0, true);
            }
        }

        // Timing patterns — skip any cell an alignment pattern already claimed.
        for (var i = 8; i < s - 8; i++) {
            if (!this.reserved[6][i]) this.set(6, i, i % 2 === 0 ? 1 : 0, true);
            if (!this.reserved[i][6]) this.set(i, 6, i % 2 === 0 ? 1 : 0, true);
        }

        // Format info area reservations (value filled in later by setFormatInfo)
        for (var fi = 0; fi < 9; fi++) {
            this.reserved[fi][8] = 1;
            this.reserved[8][fi] = 1;
        }
        for (var fi2 = 0; fi2 < 8; fi2++) {
            this.reserved[8][s - 1 - fi2] = 1;
            this.reserved[s - 1 - fi2][8] = 1;
        }
        this.reserved[s - 8][8] = 1; // dark module cell also reserved (set later)

        // Version info area reservations (v >= 7)
        if (this.v >= 7) {
            for (var vi = 0; vi < 18; vi++) {
                var row = Math.floor(vi / 3), col = (vi % 3) + s - 11;
                this.reserved[row][col] = 1;
                this.reserved[col][row] = 1;
            }
        }
    };
    Matrix.prototype.placeData = function (dataBytes) {
        var s = this.size, col = s - 1, row = s - 1, up = true, bitIdx = 0, total = dataBytes.length * 8;
        while (col > 0) {
            if (col === 6) col--;
            for (var r2 = 0; r2 < s; r2++) {
                var rr = up ? (s - 1 - r2) : r2;
                for (var cc = 0; cc < 2; cc++) {
                    var c2 = col - cc;
                    if (this.reserved[rr][c2]) continue;
                    var bit = 0;
                    if (bitIdx < total) { var byte = dataBytes[bitIdx >> 3]; bit = (byte >> (7 - (bitIdx & 7))) & 1; }
                    this.m[rr][c2] = bit;
                    bitIdx++;
                }
            }
            col -= 2; up = !up;
        }
    };
    Matrix.prototype.applyMask = function (maskId) {
        var fns = [
            function (r, c) { return (r + c) % 2 === 0; },
            function (r) { return r % 2 === 0; },
            function (_, c) { return c % 3 === 0; },
            function (r, c) { return (r + c) % 3 === 0; },
            function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
            function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
            function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
            function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
        ];
        var fn = fns[maskId], s = this.size;
        for (var i = 0; i < s; i++) for (var j = 0; j < s; j++) {
            if (this.reserved[i][j]) continue;
            if (fn(i, j)) this.m[i][j] ^= 1;
        }
    };
    // Standard QR mask-penalty scoring (ISO 18004 §8.8.2, rules N1-N4). A fixed
    // mask (e.g. always 5) can produce a technically-valid but hard-to-scan
    // symbol for some payloads — long uniform runs or finder-like ratios that
    // confuse real-world scanners even though the bits decode correctly in a
    // lab setting. Evaluating all 8 candidates and keeping the lowest-penalty
    // one is what every conformant encoder does, and is required for reliable
    // scanning, not just spec purity.
    Matrix.prototype.penalty = function () {
        var s = this.size, m = this.m, total = 0;

        // N1: runs of 5+ same-colour modules in a row/column.
        function runPenalty(getVal) {
            var p = 0;
            for (var line = 0; line < s; line++) {
                var run = 1, prev = getVal(line, 0);
                for (var k = 1; k < s; k++) {
                    var v = getVal(line, k);
                    if (v === prev) { run++; }
                    else { if (run >= 5) p += 3 + (run - 5); run = 1; prev = v; }
                }
                if (run >= 5) p += 3 + (run - 5);
            }
            return p;
        }
        total += runPenalty(function (r, c) { return m[r][c]; });
        total += runPenalty(function (c, r) { return m[r][c]; });

        // N2: 2x2 blocks of the same colour.
        for (var i = 0; i < s - 1; i++) for (var j = 0; j < s - 1; j++) {
            var v0 = m[i][j];
            if (v0 === m[i][j + 1] && v0 === m[i + 1][j] && v0 === m[i + 1][j + 1]) total += 3;
        }

        // N3: 1:1:3:1:1 dark:light ratio patterns (finder-like), with 4+ light
        // modules of padding on either side, horizontally and vertically.
        function hasFinderRatio(vals, idx) {
            // vals: 0/1 array; idx: starting index of the 11-cell window (or fewer at edges via padding=1).
            return vals[idx] === 1 && vals[idx + 1] === 0 && vals[idx + 2] === 1 && vals[idx + 3] === 1 && vals[idx + 4] === 1 &&
                vals[idx + 5] === 0 && vals[idx + 6] === 1 &&
                vals[idx + 7] === 0 && vals[idx + 8] === 0 && vals[idx + 9] === 0 && vals[idx + 10] === 0;
        }
        function n3Line(getVal) {
            var p = 0;
            for (var line = 0; line < s; line++) {
                var vals = [];
                for (var k = -4; k < s + 4; k++) vals.push((k < 0 || k >= s) ? 0 : getVal(line, k));
                for (var start = 0; start <= vals.length - 11; start++) {
                    if (hasFinderRatio(vals, start)) p += 40;
                    var rev = vals.slice(start, start + 11).slice().reverse();
                    if (hasFinderRatio(rev, 0)) p += 40;
                }
            }
            return p;
        }
        total += n3Line(function (r, c) { return m[r][c]; });
        total += n3Line(function (c, r) { return m[r][c]; });

        // N4: overall dark-module percentage deviation from 50%.
        var dark = 0;
        for (var ii = 0; ii < s; ii++) for (var jj = 0; jj < s; jj++) if (m[ii][jj] === 1) dark++;
        var percent = (dark * 100) / (s * s);
        var deviation = Math.floor(Math.abs(percent - 50) / 5);
        total += deviation * 10;

        return total;
    };
    Matrix.prototype.setFormatInfo = function (maskId) {
        var s = this.size;
        var data = (0 /* level M indicator */ << 3) | maskId;
        var bits = bchTypeInfo(data);
        for (var i = 0; i < 15; i++) {
            var bit = (bits >> i) & 1;
            if (i < 6) this.m[i][8] = bit;
            else if (i < 8) this.m[i + 1][8] = bit;
            else this.m[s - 15 + i][8] = bit;

            if (i < 8) this.m[8][s - i - 1] = bit;
            else if (i < 9) this.m[8][15 - i - 1 + 1] = bit;
            else this.m[8][15 - i - 1] = bit;
        }
        this.m[s - 8][8] = 1; // dark module
    };
    Matrix.prototype.setVersionInfo = function () {
        if (this.v < 7) return;
        var s = this.size;
        var bits = bchVersionInfo(this.v);
        for (var i = 0; i < 18; i++) {
            var bit = (bits >> i) & 1;
            var row = Math.floor(i / 3), col = (i % 3) + s - 11;
            this.m[row][col] = bit;
            this.m[col][row] = bit;
        }
    };

    function utf8Bytes(text) {
        var bytes = [];
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c < 128) bytes.push(c);
            else if (c < 2048) { bytes.push(0xC0 | (c >> 6)); bytes.push(0x80 | (c & 63)); }
            else { bytes.push(0xE0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 63)); bytes.push(0x80 | (c & 63)); }
        }
        return bytes;
    }

    function encode(text) {
        var bytes = utf8Bytes(String(text));
        var v = getVersion(bytes.length);
        if (v < 0) return null;
        var ver = VERSIONS[v];
        var lenBits = v <= 9 ? 8 : 16;

        // Build bit stream: mode(4)=0100 byte mode, char count, data, terminator, pad to byte, pad bytes.
        var bits = [];
        function pushBits(value, len) { for (var i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); }
        pushBits(0x4, 4);
        pushBits(bytes.length, lenBits);
        for (var bi = 0; bi < bytes.length; bi++) pushBits(bytes[bi], 8);
        // Terminator (up to 4 zero bits)
        var capacityBits = ver.data * 8;
        for (var t = 0; t < 4 && bits.length < capacityBits; t++) bits.push(0);
        while (bits.length % 8 !== 0) bits.push(0);
        var dataBytes = [];
        for (var db = 0; db < bits.length; db += 8) {
            var byte = 0;
            for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[db + k];
            dataBytes.push(byte);
        }
        var padToggle = true;
        while (dataBytes.length < ver.data) { dataBytes.push(padToggle ? 0xEC : 0x11); padToggle = !padToggle; }

        // Split into blocks, RS-encode each, interleave data then ECC (standard QR structure).
        var eccTotalLen = ver.total - ver.data;
        var totalBlocks = ver.blocks.reduce(function (n, b) { return n + b.c; }, 0);
        var eccLenPerBlock = Math.floor(eccTotalLen / totalBlocks);
        var blockDataArrays = [], blockEccArrays = [];
        var offset = 0;
        ver.blocks.forEach(function (grp) {
            for (var bIdx = 0; bIdx < grp.c; bIdx++) {
                var chunk = dataBytes.slice(offset, offset + grp.d);
                offset += grp.d;
                blockDataArrays.push(chunk);
                blockEccArrays.push(rsEncode(new Uint8Array(chunk), eccLenPerBlock));
            }
        });
        var maxDataLen = Math.max.apply(null, blockDataArrays.map(function (a) { return a.length; }));
        var interleaved = [];
        for (var col = 0; col < maxDataLen; col++) {
            for (var blk = 0; blk < blockDataArrays.length; blk++) {
                if (col < blockDataArrays[blk].length) interleaved.push(blockDataArrays[blk][col]);
            }
        }
        for (var ecol = 0; ecol < eccLenPerBlock; ecol++) {
            for (var eblk = 0; eblk < blockEccArrays.length; eblk++) {
                interleaved.push(blockEccArrays[eblk][ecol]);
            }
        }

        // Try every mask pattern and keep the one with the lowest ISO 18004
        // penalty score (see Matrix.prototype.penalty) — a fixed mask can be
        // technically spec-valid yet produce runs/ratios that trip up real
        // camera scanners for some payloads, even though it decodes fine
        // under lab conditions.
        var best = null, bestScore = Infinity;
        for (var maskId = 0; maskId < 8; maskId++) {
            var mat = new Matrix(v);
            mat.build();
            mat.placeData(interleaved);
            mat.applyMask(maskId);
            mat.setFormatInfo(maskId);
            mat.setVersionInfo();
            var score = mat.penalty();
            if (score < bestScore) { bestScore = score; best = mat; }
        }
        return best.m;
    }

    function toSVG(matrix, size) {
        if (!matrix) return '';
        var s = matrix.length, cell = size / s, rects = [];
        for (var r = 0; r < s; r++) for (var c = 0; c < s; c++) {
            if (matrix[r][c] === 1) {
                rects.push('<rect x="' + (c * cell).toFixed(2) + '" y="' + (r * cell).toFixed(2) +
                    '" width="' + cell.toFixed(2) + '" height="' + cell.toFixed(2) + '" fill="#1A1714"/>');
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
            '" width="' + size + '" height="' + size + '" style="background:#fff">' + rects.join('') + '</svg>';
    }

    root.generateQRSVG = function (text, size) { return toSVG(encode(text), size || 240); };
    root.__qrEncode = encode; // exposed for the oracle test only (bot/test/wave5-local-service-whatsapp-qr.test.js)
})(window);

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

// ============================================================
// EDITABLE LISTS — add / remove for services, "De ce noi" points,
// portfolio categories and certifications (audit LS-02).
//
// Only active inside the builder editor: every field the render engine
// marks editable carries a data-hb-edit="config.path" attribute (see
// build.js, opts.editMode); a published/exported site never has that
// attribute, so this whole function is a silent no-op there.
//
// The generic in-iframe overlay (builder/edit-overlay.js) already scans for
// data-hb-edit="root.N..." groups and injects its own "+"/"×" controls, but
// only for a fixed name whitelist (SAFE_LIST_PATHS) that omits
// "certifications" and "trust" entirely — see HANDOFF-local-service.md for
// the one-line fix needed there. It DOES include "services" and
// "categories", but its container-detection assumes an item's fields sit
// directly on (or contain) the repeated card element; a service has only
// one field ("label") wrapped in its own inline span
// (<span class="ls-punch__label"><span data-hb-edit=...>), one DOM level
// short of the real item root (<li class="service-card">) — the exact class
// of bug the round-2 audit wave already fixed for product-menu/
// professionals/portfolio (also documented in HANDOFF-local-service.md).
// Rather than depend on that being ported here, this template builds its
// own controls for ALL FOUR lists — using CSS classes it owns and controls
// precisely — and talks the SAME postMessage protocol
// ({hb:'list-add',listPath} / {hb:'list-remove',path} / {hb:'text',path,
// value}) builder/app.js already handles unconditionally (onListAdd/
// onListRemove/onInlineTextEdit carry no whitelist of their own). Any stray
// controls the generic overlay still injects for "services"/"categories"
// are removed once its mount() has run, so there is only ever one set of
// buttons per item.
//
// A freshly added item always starts with every itemShape field set to an
// empty string (builder/app.js: onListAdd). An empty text node has nothing
// for an owner to click into, so as soon as a new item's fields are all
// still empty this template fills it with real Romanian placeholder copy,
// echoed back via the same {hb:'text'} message app.js already listens for.
// Never a literal "New item"/"Element nou" placeholder.
// ============================================================
function initEditableLists() {
    if (!document.querySelector('[data-hb-edit]')) return; // not in the editor iframe

    function toParent(msg) {
        try { window.parent.postMessage(msg, '*'); } catch (_) {}
    }

    function fieldsForItem(root, idx) {
        var itemPath = root + '.' + idx;
        return Array.prototype.slice.call(document.querySelectorAll(
            '[data-hb-edit="' + itemPath + '"], [data-hb-edit^="' + itemPath + '."]'
        ));
    }

    function fillEmptyDefaults(listRoot, itemSelector, defaults) {
        var items = Array.prototype.slice.call(document.querySelectorAll(itemSelector));
        items.forEach(function (el) {
            var marker = el.querySelector('[data-hb-edit^="' + listRoot + '."]') ||
                (el.matches('[data-hb-edit^="' + listRoot + '."]') ? el : null);
            if (!marker) return;
            var markerPath = marker.getAttribute('data-hb-edit');
            var idx = parseInt(markerPath.slice(listRoot.length + 1).split('.')[0], 10);
            if (isNaN(idx)) return;

            var itemPath = listRoot + '.' + idx;
            var fields = fieldsForItem(listRoot, idx);
            var allEmpty = fields.length > 0 && fields.every(function (f) {
                return f.textContent.replace(/\s+/g, '') === '';
            });
            if (!allEmpty) return;
            fields.forEach(function (f) {
                var p = f.getAttribute('data-hb-edit');
                // "certifications.3" (scalar item) -> key "."; "services.3.label" -> key "label".
                var key = (p === itemPath) ? '.' : p.slice(itemPath.length + 1);
                var text = defaults[key] || defaults['.'];
                if (text) {
                    f.textContent = text;
                    toParent({ hb: 'text', path: p, value: text });
                }
            });
        });
    }

    function setupCustomList(opts) {
        var items = Array.prototype.slice.call(document.querySelectorAll(opts.itemSelector));
        if (!items.length) return; // list is currently empty — see note in HANDOFF-local-service.md

        items.forEach(function (el) {
            var marker = el.querySelector('[data-hb-edit^="' + opts.listRoot + '."]') ||
                (el.matches('[data-hb-edit^="' + opts.listRoot + '."]') ? el : null);
            if (!marker) return;
            var idx = parseInt(marker.getAttribute('data-hb-edit').slice(opts.listRoot.length + 1).split('.')[0], 10);
            if (isNaN(idx)) return;

            // Never let the last remaining item be removed: the whole section
            // is wrapped in <!-- @if root --> in template.html, so an empty
            // array would hide the section entirely — including this button's
            // own anchor point — leaving no way back in from the editor.
            if (items.length > 1) {
                var removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'hb-ls-remove';
                removeBtn.setAttribute('aria-label', opts.removeAriaPrefix + ' ' + (idx + 1));
                removeBtn.textContent = '×';
                removeBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    toParent({ hb: 'list-remove', path: opts.listRoot + '.' + idx });
                });
                if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
                el.appendChild(removeBtn);
            }
        });

        fillEmptyDefaults(opts.listRoot, opts.itemSelector, opts.defaults);

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'hb-ls-add';
        addBtn.textContent = opts.addLabel;
        addBtn.addEventListener('click', function () {
            toParent({ hb: 'list-add', listPath: opts.listRoot });
        });

        var last = items[items.length - 1];
        if (last.parentNode) last.parentNode.insertBefore(addBtn, last.nextSibling);
    }

    setupCustomList({
        itemSelector: '.service-card',
        listRoot: 'services',
        addLabel: '+ Adaugă serviciu',
        removeAriaPrefix: 'Șterge serviciul',
        defaults: { label: 'Serviciu nou' }
    });
    setupCustomList({
        itemSelector: '.ls-trust__card',
        listRoot: 'trust',
        addLabel: '+ Adaugă punct',
        removeAriaPrefix: 'Șterge punctul',
        defaults: { title: 'Motiv nou', text: 'Adaugă o propoziție scurtă despre acest motiv de a vă alege.' }
    });
    setupCustomList({
        itemSelector: '.ls-work',
        listRoot: 'categories',
        addLabel: '+ Adaugă categorie',
        removeAriaPrefix: 'Șterge categoria',
        defaults: {
            title: 'Categorie de lucrări nouă',
            blurb: 'Adaugă o descriere scurtă a acestei categorii de lucrări.'
        }
    });
    setupCustomList({
        itemSelector: '.ls-cert',
        listRoot: 'certifications',
        addLabel: '+ Adaugă certificare',
        removeAriaPrefix: 'Șterge certificarea',
        defaults: { '.': 'Certificare nouă' }
    });

    // "services" and "categories" are ALSO in builder/edit-overlay.js's
    // SAFE_LIST_PATHS, so its generic in-iframe overlay tries to add its own
    // +/- controls for them too. For a single-text-field item (a service has
    // only "label") its container-detection lands one DOM level too shallow
    // — on the field's own inline wrapper span, not the repeated <li> — so
    // its button ends up misplaced rather than simply duplicating ours (this
    // is the same class of bug the round-2 audit wave fixed for product-menu/
    // professionals/portfolio; see HANDOFF-local-service.md for the pointer).
    // Rather than fight two competing sets of injected controls, remove any
    // the generic overlay adds once its own mount() has run (it registers its
    // DOMContentLoaded listener after this file's, so a same-tick deferral is
    // enough to run strictly after it) and keep this template's own controls
    // as the single source of truth for all four lists.
    setTimeout(function () {
        document.querySelectorAll('.hb-add-btn, .hb-remove-btn').forEach(function (el) { el.remove(); });
    }, 0);
}
